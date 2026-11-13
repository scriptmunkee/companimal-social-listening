import { YOUTUBE_QUERIES, YOUTUBE_VIDEOS_PER_QUERY, YOUTUBE_LOOKBACK_DAYS, YOUTUBE_UK_CHANNELS, YOUTUBE_UPLOADS_PER_CHANNEL } from "../../config/taxonomy";
import { Env, Item, archiveRaw, saveItems, clean, nowIso } from "../lib";
import { mockYoutubeSearch, mockYoutubeComments } from "../mock";

const API = "https://www.googleapis.com/youtube/v3";

async function yt(env: Env, path: string, params: Record<string, string>): Promise<any> {
  if (!env.YOUTUBE_API_KEY) throw new Error("YOUTUBE_API_KEY not set");
  const qs = new URLSearchParams({ ...params, key: env.YOUTUBE_API_KEY });
  const res = await fetch(`${API}/${path}?${qs}`);
  if (res.status === 403) {
    const body: any = await res.json().catch(() => ({}));
    const reason = body?.error?.errors?.[0]?.reason;
    if (reason === "commentsDisabled") return { items: [] };
    throw new Error(`YouTube ${path} 403 ${reason || ""}`);
  }
  if (!res.ok) throw new Error(`YouTube ${path} HTTP ${res.status}`);
  return res.json();
}

/** Look up each configured UK channel once and remember its id. */
async function resolveChannels(env: Env): Promise<{ id: string; title: string; name: string }[]> {
  const rows = await env.DB.prepare(`SELECT name, channel_id, title, status FROM yt_channels`).all<any>();
  const known = new Map((rows.results || []).map((r: any) => [r.name, r]));
  const out: { id: string; title: string; name: string }[] = [];
  for (const name of YOUTUBE_UK_CHANNELS) {
    let r: any = known.get(name);
    if (!r) {
      let id: string | null = null, title = "";
      if (env.MOCK === "1") { id = `UCmock${name.length}`; title = name; }
      else if (name.startsWith("@")) {
        const j = await yt(env, "channels", { part: "snippet", forHandle: name });
        id = j.items?.[0]?.id || null; title = j.items?.[0]?.snippet?.title || "";
      } else {
        const j = await yt(env, "search", { part: "snippet", q: name, type: "channel", regionCode: "GB", maxResults: "1" });
        id = j.items?.[0]?.id?.channelId || null; title = j.items?.[0]?.snippet?.title || "";
      }
      r = { name, channel_id: id, title, status: id ? "ok" : "not_found" };
      await env.DB.prepare(`INSERT OR REPLACE INTO yt_channels (name, channel_id, title, resolved_at, status) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(name, id, title, nowIso(), r.status).run();
    }
    if (r.channel_id) out.push({ id: r.channel_id, title: r.title || name, name });
  }
  return out;
}

/** Search recent UK videos per query and read recent uploads from UK channels, then pull comments. */
export async function collectYoutube(env: Env) {
  const publishedAfter = new Date(Date.now() - YOUTUBE_LOOKBACK_DAYS * 86400000).toISOString();
  const videoIds = new Map<string, { title: string; channel: string; query: string }>();
  for (const q of YOUTUBE_QUERIES) {
    const raw = env.MOCK === "1" ? mockYoutubeSearch(q) : await yt(env, "search", {
      part: "snippet", q, type: "video", regionCode: "GB", relevanceLanguage: "en",
      publishedAfter, order: "viewCount", maxResults: String(YOUTUBE_VIDEOS_PER_QUERY),
    });
    await archiveRaw(env, "youtube_search", q, raw);
    for (const v of raw.items || []) {
      const id = v.id?.videoId;
      if (id && !videoIds.has(id)) videoIds.set(id, { title: v.snippet?.title || "", channel: v.snippet?.channelTitle || "", query: q });
    }
  }

  // Recent uploads from named UK channels (playlistItems costs 1 quota unit)
  let channelNote = "";
  try {
    const channels = await resolveChannels(env);
    const cutoff = Date.now() - YOUTUBE_LOOKBACK_DAYS * 86400000;
    for (const ch of channels) {
      const raw = env.MOCK === "1"
        ? { items: [{ contentDetails: { videoId: `${ch.id}-v1`, videoPublishedAt: new Date().toISOString() }, snippet: { title: `Upload from ${ch.title}` } }] }
        : await yt(env, "playlistItems", { part: "snippet,contentDetails", playlistId: "UU" + ch.id.slice(2), maxResults: String(YOUTUBE_UPLOADS_PER_CHANNEL) });
      for (const v of raw.items || []) {
        const id = v.contentDetails?.videoId;
        const when = Date.parse(v.contentDetails?.videoPublishedAt || v.snippet?.publishedAt || "");
        if (id && when >= cutoff && !videoIds.has(id)) videoIds.set(id, { title: v.snippet?.title || "", channel: ch.title, query: `uk-channel:${ch.name}` });
      }
    }
    channelNote = `, ${channels.length}/${YOUTUBE_UK_CHANNELS.length} UK channels`;
  } catch (e: any) {
    channelNote = `, UK channels failed: ${e?.message || e}`;
  }

  let added = 0, seen = 0;
  for (const [videoId, meta] of videoIds) {
    const raw = env.MOCK === "1" ? mockYoutubeComments(videoId, meta.query) : await yt(env, "commentThreads", {
      part: "snippet", videoId, maxResults: "100", order: "relevance", textFormat: "plainText",
    });
    const key = await archiveRaw(env, "youtube_comments", videoId, raw);
    const items: Item[] = [];
    for (const t of raw.items || []) {
      const c = t.snippet?.topLevelComment?.snippet;
      if (!c?.textDisplay) continue;
      items.push({
        source: "youtube",
        source_id: t.id,
        url: `https://www.youtube.com/watch?v=${videoId}&lc=${t.id}`,
        title: clean(meta.title, 300),
        text: clean(c.textDisplay),
        community: meta.channel,
        author: c.authorChannelId?.value || c.authorDisplayName || null,
        published_at: c.publishedAt,
        query: meta.query,
        engagement: (c.likeCount || 0) + (t.snippet?.totalReplyCount || 0),
      });
    }
    const r = await saveItems(env, items, key);
    added += r.added; seen += r.seen;
  }
  return { added, seen, note: `${videoIds.size} videos${channelNote}` };
}
