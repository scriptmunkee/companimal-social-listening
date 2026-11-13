import * as TAX from "../config/taxonomy";
import { PROJECT } from "../config/taxonomy";
import { Env, runJob, recordQueryVersion, nowIso, saveItems, withLock } from "./lib";
import { postSerpTasks, collectSerpTasks, collectContentAnalysis } from "./collectors/dataforseo";
import { postRedditTasks, backfillRedditItems } from "./collectors/reddit";
import { hasSerpent, collectRedditFeeds, collectRedditDaily, collectRedditComments, collectRedditNow, pruneReddit } from "./collectors/reddit-api";
import { analyseRedditThreads, buildRedditThemes } from "./reddit-insights";
import { redditThreadsApi, redditThemesApi } from "./dashboard/reddit";
import { collectYoutube } from "./collectors/youtube";
import { enrichItems, refreshSitemap } from "./enrich";
import { rollup, buildBrief, opportunities, risingTopics } from "./analysis";
import { renderPage, notFoundPage } from "./dashboard/views";
import { questionDetail, topicDetail, seasonality, mythGroups } from "./dashboard/data";
import { ensureSchema } from "./migrations";
import { healthJob, checkHealth } from "./health";

/** 02:00 daily: post SERP tasks (PAA on Mondays), YouTube, Content Analysis. */
async function dailyCollect(env: Env) {
  await recordQueryVersion(env, TAX);
  const monday = new Date().getUTCDay() === 1;
  await runJob(env, "serp_post", () => postSerpTasks(env, monday));
  // Reddit through Serpent when its key is set; Google's index of Reddit otherwise
  await runJob(env, "reddit_post", () => hasSerpent(env) ? collectRedditDaily(env) : postRedditTasks(env, "daily"));
  await runJob(env, "youtube", () => collectYoutube(env));
  await runJob(env, "content_analysis", () => collectContentAnalysis(env));
}

/** Every 10 minutes: pick up finished SERP tasks, enrich new items, read new Reddit threads. */
async function hourly(env: Env) {
  // Skip if the previous run is still going, so rows are never processed twice
  // The lock outlives the longest possible run (cron runs are capped at 15 minutes)
  await withLock(env, "tick", 14 * 60, () => tick(env));
}

async function tick(env: Env) {
  // Time budget: finish well inside the 10-minute gap so runs never pile up
  const start = Date.now();
  await runJob(env, "serp_collect", () => collectSerpTasks(env));
  if (hasSerpent(env)) {
    // Subreddit feeds every few hours (upvote and comment snapshots), comment threads every run
    const last = await env.DB.prepare(`SELECT MAX(started_at) AS t FROM runs WHERE project=?1 AND job='reddit_feeds' AND status='ok'`).bind(PROJECT.id).first<any>();
    if (!last?.t || Date.parse(last.t) < Date.now() - (TAX.REDDIT_FEEDS_EVERY_HOURS * 3600000 - 5 * 60000)) {
      await runJob(env, "reddit_feeds", () => collectRedditFeeds(env, start + 90000));
    }
    await runJob(env, "reddit_comments", () => collectRedditComments(env, start + 150000));
  }
  await runJob(env, "reddit_insights", () => analyseRedditThreads(env, 144, start + 5 * 60000));
  await runJob(env, "enrich", () => enrichItems(env, 400, start + 8.5 * 60000));
  // One-off themes rebuild (queued by a migration), after the routine work
  if ((await env.DB.prepare(`DELETE FROM pending_jobs WHERE job='reddit_themes_now'`).run()).meta?.changes) {
    await runJob(env, "reddit_themes", () => buildRedditThemes(env));
  }
  // Reddit themes as soon as the thread backlog is analysed (one-off after a backfill)
  if (await env.DB.prepare(`SELECT 1 FROM pending_jobs WHERE job='reddit_themes_when_ready'`).first()) {
    const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM reddit_threads WHERE insight_done=0`).first<any>();
    const pendingSearches = await env.DB.prepare(`SELECT COUNT(*) AS n FROM serp_tasks WHERE fetched_at IS NULL AND kind LIKE 'reddit%'`).first<any>();
    const pullWaiting = await env.DB.prepare(`SELECT 1 FROM pending_jobs WHERE job='reddit_api_now'`).first();
    // After the first Serpent pull, wait for its comment threads too (one ceiling's worth at most)
    const commentsLeft = hasSerpent(env) ? await env.DB.prepare(`SELECT COUNT(*) AS n FROM reddit_threads WHERE comments_fetched_at IS NULL AND posts_count >= ?1 AND last_seen >= ?2`).bind(TAX.REDDIT_COMMENTS_MIN, new Date(Date.now() - 86400000).toISOString()).first<any>() : null;
    if ((left?.n || 0) <= 5 && !pendingSearches?.n && !pullWaiting && (commentsLeft?.n || 0) <= 20) {
      await env.DB.prepare(`DELETE FROM pending_jobs WHERE job='reddit_themes_when_ready'`).run();
      await runJob(env, "reddit_themes", () => buildRedditThemes(env));
    }
  }
  // A queued brief runs as soon as the analysis backlog is cleared
  const waiting = await env.DB.prepare(`SELECT 1 FROM pending_jobs WHERE job='morning_when_ready'`).first();
  if (waiting) {
    const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM items WHERE enriched=0`).first<any>();
    if (!left?.n) {
      await env.DB.prepare(`DELETE FROM pending_jobs WHERE job='morning_when_ready'`).run();
      await runJob(env, "rollup", () => rollup(env, 3));
      await runJob(env, "brief", () => buildBrief(env));
    }
  }
}

/** One-off jobs queued by a migration (e.g. a catch-up after a fix). Each is removed before it runs. */
async function runPending(env: Env) {
  const jobs: Record<string, () => Promise<unknown>> = {
    sitemap: () => runJob(env, "sitemap", () => refreshSitemap(env)),
    collect: () => dailyCollect(env),
    paa: () => runJob(env, "serp_post", () => postSerpTasks(env, true, false)),
    subreddits: () => runJob(env, "reddit_post", () => postRedditTasks(env, "daily")),
    reddit_backfill_items: () => runJob(env, "reddit_backfill", async () => {
      const r = await backfillRedditItems(env);
      const s = await saveItems(env, r.items, null);
      return { ...s, note: r.note };
    }),
    reddit_now: () => runJob(env, "reddit_post", () => postRedditTasks(env, "full")),
    reddit_api_now: () => runJob(env, "reddit_post", () => collectRedditNow(env)),

  };
  // Jobs that wait for something before they can run (left queued until then)
  const ready: Record<string, () => boolean> = { reddit_api_now: () => hasSerpent(env) };
  for (const name of Object.keys(jobs)) {
    if (ready[name] && !ready[name]()) continue;
    const r = await env.DB.prepare(`DELETE FROM pending_jobs WHERE job=?1`).bind(name).run();
    if (r.meta?.changes) await jobs[name]();
  }
}

/** 06:30 daily: rollups and the morning brief. Sitemap refresh on Mondays. */
async function morning(env: Env) {
  if (new Date().getUTCDay() === 1) await runJob(env, "sitemap", () => refreshSitemap(env));
  await runJob(env, "rollup", () => rollup(env, 3));
  await runJob(env, "brief", () => buildBrief(env));
  await runJob(env, "reddit_themes", () => buildRedditThemes(env));
  await runJob(env, "health", () => healthJob(env));
  if (new Date().getUTCDate() === 1) await runJob(env, "reddit_prune", () => pruneReddit(env));
}

function authorised(req: Request, env: Env): boolean {
  if (!env.DASHBOARD_PASSWORD) return true;
  const h = req.headers.get("Authorization") || "";
  if (!h.startsWith("Basic ")) return false;
  const [, pass] = atob(h.slice(6)).split(":");
  return pass === env.DASHBOARD_PASSWORD;
}

const html = (s: string) => new Response(s, { headers: { "content-type": "text/html; charset=utf-8" } });
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o, null, 2), { status, headers: { "content-type": "application/json" } });

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    await ensureSchema(env);
    switch (event.cron) {
      case "0 2 * * *": ctx.waitUntil(dailyCollect(env)); break;
      case "*/10 * * * *": ctx.waitUntil(runPending(env).then(() => hourly(env))); break;
      case "30 6 * * *": ctx.waitUntil(morning(env)); break;
    }
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!authorised(req, env)) return new Response("Login required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="Companimal listening"' } });
    const url = new URL(req.url);
    const lens = url.searchParams.get("lens") || undefined;
    const region = url.searchParams.get("region") === "all" ? "all" : "uk";
    try {
      await ensureSchema(env);
      if (req.method === "POST" && url.pathname === "/api/run") {
        const job = url.searchParams.get("job");
        const map: Record<string, () => Promise<unknown>> = {
          collect: () => dailyCollect(env), hourly: () => hourly(env), morning: () => morning(env),
          sitemap: () => runJob(env, "sitemap", () => refreshSitemap(env)),
          paa: () => runJob(env, "serp_post", () => postSerpTasks(env, true)),
          rollup_all: () => runJob(env, "rollup", () => rollup(env, 400)),
          health: () => runJob(env, "health", () => healthJob(env)),
          reddit: () => runJob(env, "reddit_post", () => hasSerpent(env) ? collectRedditNow(env) : postRedditTasks(env, "full")),
          reddit_feeds: () => runJob(env, "reddit_feeds", () => collectRedditFeeds(env)),
          reddit_comments: () => runJob(env, "reddit_comments", () => collectRedditComments(env)),
          reddit_insights: () => runJob(env, "reddit_insights", () => analyseRedditThreads(env)),
          reddit_themes: () => runJob(env, "reddit_themes", () => buildRedditThemes(env)),
        };
        if (!job || !map[job]) return json({ error: "unknown job", jobs: Object.keys(map) }, 400);
        await map[job]();
        return json({ ok: true, job });
      }
      if (req.method === "POST" && url.pathname === "/api/pipeline") {
        const b: any = await req.json();
        if (!b?.topic) return json({ error: "topic required" }, 400);
        await env.DB.prepare(`INSERT INTO pipeline_queue (id, project, topic, question, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(crypto.randomUUID(), PROJECT.id, b.topic, b.question || null, nowIso()).run();
        return json({ ok: true });
      }
      if (url.pathname === "/api/opportunities") return json(await opportunities(env, Number(url.searchParams.get("days") || 30), lens, 100, region));
      if (url.pathname === "/api/rising") return json(await risingTopics(env, lens, region));
      if (url.pathname === "/api/health") return json(await checkHealth(env));
      if (url.pathname === "/api/reddit/threads") return json(await redditThreadsApi(env, url, lens, region));
      if (url.pathname === "/api/reddit/themes") return json(await redditThemesApi(env));
      if (url.pathname === "/api/pipeline") return json((await env.DB.prepare(`SELECT * FROM pipeline_queue WHERE project=?1 ORDER BY created_at DESC LIMIT 100`).bind(PROJECT.id).all()).results);

      // Read-only JSON for the dashboard
      if (url.pathname === "/api/question") {
        const topic = url.searchParams.get("topic"), q = url.searchParams.get("q");
        if (!topic || !q) return json({ error: "topic and q required" }, 400);
        return json(await questionDetail(env, topic, q, Number(url.searchParams.get("days") || 90), lens, region));
      }
      if (url.pathname === "/api/topic") {
        const topic = url.searchParams.get("topic");
        if (!topic) return json({ error: "topic required" }, 400);
        return json(await topicDetail(env, topic, lens, region, Number(url.searchParams.get("days") || 90)));
      }
      if (url.pathname === "/api/seasonality") return json(await seasonality(env, lens, region));
      if (url.pathname === "/api/myths") return json(await mythGroups(env, lens, region, url.searchParams.get("topic") || undefined));
      if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);

      if (req.method === "GET") {
        if (url.pathname === "/topics") return Response.redirect(new URL(`/rising${url.search}`, url).toString(), 302);
        const page = await renderPage(env, url, lens, region);
        if (page) return html(page);
        return new Response(await notFoundPage(env, url, lens, region), { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return new Response("Not found", { status: 404 });
    } catch (e: any) {
      console.error(e);
      return new Response(`Error: ${e?.message || e}`, { status: 500 });
    }
  },
};
