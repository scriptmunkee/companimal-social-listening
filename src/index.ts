import * as TAX from "../config/taxonomy";
import { PROJECT } from "../config/taxonomy";
import { Env, runJob, recordQueryVersion, nowIso } from "./lib";
import { postSerpTasks, collectSerpTasks, collectContentAnalysis } from "./collectors/dataforseo";
import { collectYoutube } from "./collectors/youtube";
import { enrichItems, refreshSitemap } from "./enrich";
import { rollup, buildBrief, opportunities, risingTopics } from "./analysis";
import { viewToday, viewQuestions, viewRising, viewGaps, viewMyths, viewSources } from "./dashboard/views";
import { ensureSchema } from "./migrations";
import { healthJob, checkHealth } from "./health";

/** 02:00 daily: post SERP tasks (PAA on Mondays), YouTube, Content Analysis. */
async function dailyCollect(env: Env) {
  await recordQueryVersion(env, TAX);
  const monday = new Date().getUTCDay() === 1;
  await runJob(env, "serp_post", () => postSerpTasks(env, monday));
  await runJob(env, "youtube", () => collectYoutube(env));
  await runJob(env, "content_analysis", () => collectContentAnalysis(env));
}

/** Hourly: pick up finished SERP tasks, enrich new items. */
async function hourly(env: Env) {
  await runJob(env, "serp_collect", () => collectSerpTasks(env));
  await runJob(env, "enrich", () => enrichItems(env, 400));
}

/** 06:30 daily: rollups and the morning brief. Sitemap refresh on Mondays. */
async function morning(env: Env) {
  if (new Date().getUTCDay() === 1) await runJob(env, "sitemap", () => refreshSitemap(env));
  await runJob(env, "rollup", () => rollup(env, 3));
  await runJob(env, "brief", () => buildBrief(env));
  await runJob(env, "health", () => healthJob(env));
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
      case "15 * * * *": ctx.waitUntil(hourly(env)); break;
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
      if (url.pathname === "/api/pipeline") return json((await env.DB.prepare(`SELECT * FROM pipeline_queue WHERE project=?1 ORDER BY created_at DESC LIMIT 100`).bind(PROJECT.id).all()).results);

      switch (url.pathname) {
        case "/": return html(await viewToday(env, lens, region));
        case "/questions": return html(await viewQuestions(env, url, lens, region));
        case "/rising": return html(await viewRising(env, lens, region));
        case "/gaps": return html(await viewGaps(env, lens, region));
        case "/myths": return html(await viewMyths(env, lens, region));
        case "/sources": return html(await viewSources(env, lens, region));
      }
      return new Response("Not found", { status: 404 });
    } catch (e: any) {
      console.error(e);
      return new Response(`Error: ${e?.message || e}`, { status: 500 });
    }
  },
};
