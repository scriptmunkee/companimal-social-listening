import { YOUTUBE_QUERIES, YOUTUBE_VIDEOS_PER_QUERY, YOUTUBE_LOOKBACK_DAYS } from "../../config/taxonomy";
import { Env, Item, archiveRaw, saveItems, clean } from "../lib";
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

/** Search recent UK videos per query, then pull top-level comments on each. */
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
  return { added, seen, note: `${videoIds.size} videos` };
}
