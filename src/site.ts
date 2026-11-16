// companimal.co.uk's own pages, so every move can say "update this page" or "this page doesn't exist yet".
// Read from the sitemap on first install and every Monday. Advice articles, the Dog Data Library and the
// core pages get their titles fetched; breed, sale and stud hubs are derived from the breed list (one per breed).
// Location spokes (county, city, near-me) are skipped: they mirror their hub.
import { PROJECT, BREED_ALIASES } from "../config/taxonomy";
import { SNAPSHOT_PAGES, SNAPSHOT_BREEDS, SNAPSHOT_DATE } from "../config/site-snapshot";
import { Env, nowIso, clean, batch } from "./lib";
import { tokens } from "./enrich";

// The site sits behind Cloudflare bot protection: a plain user agent gets a challenge (403)
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 CompanimalListening/1.0";
const BLOCKED_HINT = "the site's bot protection blocked the Worker. Fix: in Cloudflare, Security, WAF, add a custom rule for companimal.co.uk that skips managed challenges for User-Agent containing \"CompanimalListening\"";

export type PageKind = "advice" | "statistics" | "breed" | "sale" | "stud" | "core";
export interface SitePage { url: string; path: string; kind: PageKind; title: string | null; h1: string | null; description: string | null; breed: string | null }

const kindOf = (path: string): PageKind =>
  path.startsWith("/puppy-advice/") ? "advice" : path.startsWith("/statistics/") ? "statistics" : path.startsWith("/breeds/") ? "breed"
    : path.startsWith("/sale/puppies/") ? "sale" : path.startsWith("/stud/dogs/") ? "stud" : "core";

/** "cavalier-king-charles-spaniel" → "Cavalier King Charles Spaniel" */
export const breedName = (s: string) => s.split("-").map((w) => (w.length <= 2 && w !== "st" ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(" ").replace(/^St /, "St ");

function breedPages(slugs: string[]): SitePage[] {
  const out: SitePage[] = [];
  for (const b of slugs) {
    const name = breedName(b);
    out.push({ url: `${PROJECT.site}/breeds/${b}/`, path: `/breeds/${b}/`, kind: "breed", title: `${name}: breed guide`, h1: name, description: null, breed: b });
    out.push({ url: `${PROJECT.site}/sale/puppies/${b}/`, path: `/sale/puppies/${b}/`, kind: "sale", title: `${name} puppies for sale`, h1: null, description: null, breed: b });
    out.push({ url: `${PROJECT.site}/stud/dogs/${b}/`, path: `/stud/dogs/${b}/`, kind: "stud", title: `${name} stud dogs`, h1: null, description: null, breed: b });
  }
  return out;
}

function snapshot(): SitePage[] {
  return [
    ...SNAPSHOT_PAGES.map(([path, title, h1]) => ({ url: `${PROJECT.site}${path}`, path, kind: kindOf(path), title, h1, description: null, breed: null })),
    ...breedPages(SNAPSHOT_BREEDS),
  ];
}

async function getLocs(url: string): Promise<string[]> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8" } });
  if (!res.ok) throw new Error(`sitemap ${new URL(url).pathname} HTTP ${res.status}${res.status === 403 || res.status === 503 ? `: ${BLOCKED_HINT}` : ""}`);
  const xml = await res.text();
  if (!xml.includes("<loc>")) throw new Error(`sitemap ${new URL(url).pathname} returned no URLs (a challenge page?): ${BLOCKED_HINT}`);
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
}

async function save(env: Env, pages: SitePage[], source: string) {
  const now = nowIso();
  const stmts = [env.DB.prepare(`DELETE FROM site_pages WHERE project=?1`).bind(PROJECT.id)];
  for (const p of pages) stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO site_pages (url, project, path, kind, title, h1, description, breed, source, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`)
    .bind(p.url, PROJECT.id, p.path, p.kind, p.title, p.h1, p.description, p.breed, source, now));
  // The older URL matcher (question coverage) still reads site_urls: keep it in step with the articles
  for (const p of pages.filter((x) => x.kind === "advice" || x.kind === "statistics" || x.path === "/sell-my-puppies" || x.path === "/lucys-law")) {
    stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO site_urls (project, url, tokens, updated_at) VALUES (?1, ?2, ?3, ?4)`).bind(PROJECT.id, p.url, tokens(`${p.path.replace(/\//g, " ")} ${p.title || ""}`).join(" "), now));
  }
  await batch(env, stmts);
}

export async function refreshSitePages(env: Env) {
  if (env.MOCK === "1") {
    const pages = snapshot();
    await save(env, pages, "snapshot");
    return { added: pages.length, seen: pages.length, note: `mock: ${pages.length} pages from the ${SNAPSHOT_DATE} snapshot` };
  }
  let locs: string[];
  try {
    const top = await getLocs(PROJECT.sitemap);
    const children = top.filter((u) => u.endsWith(".xml"));
    // Location spokes (near-me, county, city) are skipped
    const wanted = children.filter((u) => /(core|statistics|puppy-advice|breeds-encyclopedia|advice|blog|guide)/.test(u));
    locs = children.length ? [] : top;
    for (const c of wanted) locs.push(...(await getLocs(c)));
  } catch (e: any) {
    // Blocked: keep what we have; on a first install, start from the snapshot so moves can still point at pages
    const have = await env.DB.prepare(`SELECT COUNT(*) AS n FROM site_pages WHERE project=?1`).bind(PROJECT.id).first<any>();
    if (!have?.n) await save(env, snapshot(), "snapshot");
    throw new Error(`${e?.message || e}${have?.n ? " (kept the last good read)" : ` (using the ${SNAPSHOT_DATE} snapshot meanwhile)`}`);
  }
  const paths = [...new Set(locs.map((u) => new URL(u).pathname))];
  const breeds = paths.filter((p) => /^\/breeds\/[^/]+\/$/.test(p)).map((p) => p.split("/")[2]);
  const articles = paths.filter((p) => !p.startsWith("/breeds/") && !/^\/(sale|stud)\//.test(p) || p === "/sale/puppies/" || p === "/stud/dogs/");
  const fetched: SitePage[] = [];
  let i = 0, titled = 0;
  const worker = async () => {
    while (i < articles.length) {
      const path = articles[i++];
      const url = `${PROJECT.site}${path}`;
      try {
        const r = await fetch(url, { headers: { "User-Agent": UA } });
        const html = r.ok ? await r.text() : "";
        const title = clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1], 200)?.replace(/\s*[|·—-]\s*Companimal\s*$/i, "") || null;
        if (title && !/just a moment/i.test(title)) titled++;
        fetched.push({ url, path, kind: kindOf(path), title: title && !/just a moment/i.test(title) ? title : null,
          h1: clean(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1], 200), description: clean(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1], 300), breed: null });
      } catch { fetched.push({ url, path, kind: kindOf(path), title: null, h1: null, description: null, breed: null }); }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  // Pages whose title couldn't be read keep the snapshot's title where there is one
  const snap = new Map(SNAPSHOT_PAGES.map(([p, t, h]) => [p, { t, h }]));
  for (const p of fetched) if (!p.title && snap.has(p.path)) { p.title = snap.get(p.path)!.t; p.h1 = p.h1 || snap.get(p.path)!.h; }
  const pages = [...fetched, ...breedPages(breeds.length ? breeds : SNAPSHOT_BREEDS)];
  await save(env, pages, "sitemap");
  return { added: pages.length, seen: locs.length, note: `${fetched.length} articles and core pages (${titled} titles read), ${breeds.length} breeds` };
}

export async function sitePages(env: Env, kinds?: PageKind[]): Promise<SitePage[]> {
  const rows = (await env.DB.prepare(`SELECT url, path, kind, title, h1, description, breed FROM site_pages WHERE project=?1 ORDER BY kind, path`).bind(PROJECT.id).all<any>()).results || [];
  return kinds ? rows.filter((r: any) => kinds.includes(r.kind)) : rows;
}

// ---------------------------------------------------------------------------
// Breeds: names people use, mapped to the breed page
// ---------------------------------------------------------------------------
let breedRe: RegExp | null = null;
let breedBy: Map<string, string> | null = null;

function breedIndex() {
  if (breedBy) return;
  breedBy = new Map<string, string>();
  for (const b of SNAPSHOT_BREEDS) {
    const name = b.replace(/-/g, " ");
    breedBy.set(name, b);
    // "Cocker Spaniel" also as plural
    breedBy.set(`${name}s`, b);
  }
  for (const [k, v] of Object.entries(BREED_ALIASES)) breedBy.set(k, v);
  // Drop generic entries that would match everyday words
  for (const k of ["mixed breed", "unknown breed", "rescue mix", "pointer", "harrier", "kai", "jug", "mudi", "frug", "chug"]) breedBy.delete(k);
  const names = [...breedBy.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  breedRe = new RegExp(`\\b(${names.join("|")})\\b`, "i");
}

/** Breed slug for a breed name the AI gave ("Cocker Spaniel", "frenchie"), if Companimal has a page for it. */
export function breedSlugOf(name: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return null;
  breedIndex();
  const n = name.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  if (breedBy!.has(n)) return breedBy!.get(n)!;
  const m = n.match(breedRe!);
  return m ? breedBy!.get(m[1].toLowerCase()) || null : null;
}

/** First breed mentioned in a piece of text, for channels without an AI breed reading. */
export function breedInText(text: string): string | null {
  breedIndex();
  const m = text.toLowerCase().match(breedRe!);
  return m ? breedBy!.get(m[1].toLowerCase()) || null : null;
}
