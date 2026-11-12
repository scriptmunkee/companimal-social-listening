import { PROJECT, QUERY_VERSION } from "../config/taxonomy";

export interface Env {
  DB: D1Database;
  ARCHIVE: R2Bucket;
  AI?: Ai;
  DATAFORSEO_LOGIN?: string;
  DATAFORSEO_PASSWORD?: string;
  YOUTUBE_API_KEY?: string;
  DASHBOARD_PASSWORD?: string;
  HASH_SALT?: string;
  MOCK?: string; // "1" = generate fixture data instead of calling APIs (local testing)
}

export interface Item {
  source: string;
  source_id: string;
  url?: string | null;
  title?: string | null;
  text?: string | null;
  community?: string | null;
  author?: string | null; // hashed before storage
  published_at?: string | null;
  query?: string | null;
  engagement?: number;
}

export const nowIso = () => new Date().toISOString();
export const today = () => nowIso().slice(0, 10);

export function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function dayOfYear(d = new Date()): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((d.getTime() - start) / 86400000);
}

export function clean(s: unknown, max = 4000): string | null {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

/** Write a raw API response to the R2 archive. Never modified afterwards. */
export async function archiveRaw(env: Env, source: string, label: string, body: unknown): Promise<string> {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).split("-");
  const key = `raw/${PROJECT.id}/${source}/${ymd[0]}/${ymd[1]}/${ymd[2]}/${d.getTime()}-${label.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.json`;
  await env.ARCHIVE.put(key, JSON.stringify(body), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { source, query_version: QUERY_VERSION },
  });
  return key;
}

/** Insert items, skipping ones already seen. Returns number of new items. */
export async function saveItems(env: Env, items: Item[], rawKey: string | null): Promise<{ added: number; seen: number }> {
  if (!items.length) return { added: 0, seen: 0 };
  const salt = env.HASH_SALT || "companimal";
  const collected = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const it of items) {
    const id = `${it.source}:${it.source_id}`;
    const authorHash = it.author ? (await sha256(salt + it.author)).slice(0, 16) : null;
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO items (id, project, source, source_id, url, title, text, community, author_hash, published_at, collected_at, collected_date, query, query_version, engagement, raw_key)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`
      ).bind(id, PROJECT.id, it.source, it.source_id, it.url ?? null, it.title ?? null, it.text ?? null, it.community ?? null, authorHash, it.published_at ?? null, collected, collected.slice(0, 10), it.query ?? null, QUERY_VERSION, it.engagement ?? 0, rawKey)
    );
  }
  let added = 0;
  for (let i = 0; i < stmts.length; i += 50) {
    const res = await env.DB.batch(stmts.slice(i, i + 50));
    added += res.reduce((a, r) => a + (r.meta?.changes ?? 0), 0);
  }
  return { added, seen: items.length };
}

export async function startRun(env: Env, job: string): Promise<string> {
  const id = `${job}:${Date.now()}`;
  await env.DB.prepare(`INSERT INTO runs (id, project, job, started_at, status) VALUES (?1, ?2, ?3, ?4, 'running')`).bind(id, PROJECT.id, job, nowIso()).run();
  return id;
}

export async function finishRun(env: Env, id: string, status: string, added = 0, seen = 0, cost = 0, note = ""): Promise<void> {
  await env.DB.prepare(`UPDATE runs SET finished_at=?2, status=?3, items_new=?4, items_seen=?5, cost_usd=?6, note=?7 WHERE id=?1`)
    .bind(id, nowIso(), status, added, seen, cost, note.slice(0, 500)).run();
}

/** Wrap a job so failures are logged to the coverage table rather than lost. */
export async function runJob(env: Env, job: string, fn: () => Promise<{ added: number; seen: number; cost?: number; note?: string }>) {
  const id = await startRun(env, job);
  try {
    const r = await fn();
    await finishRun(env, id, "ok", r.added, r.seen, r.cost ?? 0, r.note ?? "");
    return r;
  } catch (e: any) {
    await finishRun(env, id, "error", 0, 0, 0, String(e?.message || e));
    console.error(job, e);
    return { added: 0, seen: 0, note: String(e?.message || e) };
  }
}

export async function recordQueryVersion(env: Env, config: unknown) {
  await env.DB.prepare(`INSERT OR IGNORE INTO query_versions (version, project, first_seen, config_json) VALUES (?1, ?2, ?3, ?4)`)
    .bind(QUERY_VERSION, PROJECT.id, nowIso(), JSON.stringify(config)).run();
}
