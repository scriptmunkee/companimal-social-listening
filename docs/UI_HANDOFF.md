# Front-end handoff: Companimal social listening dashboard

You own the dashboard UI for this repo. The data pipeline is done and live; your job is to make the dashboard bespoke, studio-grade and genuinely useful for content planning. Follow the **ui-craft** rules at the bottom of this file without exception.

## What the product is

A social listening tool for **Companimal** (companimal.co.uk), a UK puppy marketplace connecting buyers with breeders, rescues and rehomers. Every day it collects what UK dog people ask and argue about (Reddit and UK forums via Google, People Also Ask, YouTube comments, UK web mentions), uses AI to pull out questions, topics, audience and region, and turns that into content opportunities. The owner uses it to decide what articles to write next. The archive grows for years, so seasonality and trends matter.

**Primary user:** Chris, an SEO consultant. He opens it most mornings to decide what to write. He is busy, technical and dislikes walls of text.

## Architecture (don't change the data layer)

- Cloudflare Worker, TypeScript, `src/index.ts` routes requests. No framework, no build step today.
- Dashboard is server-rendered HTML in `src/dashboard/views.ts` (one `layout()` plus one function per view). Small inline script for the "Send to pipeline" buttons.
- Data: D1 (SQLite). Read the schema in `migrations/*.sql` and `src/migrations.ts`. Query helpers live in `src/analysis.ts` (`opportunities`, `risingTopics`, `regionSql`, `RELEVANT_SQL`).
- Auth: HTTP basic auth on every route (`DASHBOARD_PASSWORD`). Keep it.
- **Deploys are automatic:** every push to `main` builds and deploys via Cloudflare Workers Builds (deploy command `npx wrangler deploy`, no build command). If you add a framework or bundler, it must still work with `wrangler deploy` alone (Hono with JSX is fine; wrangler bundles it). Do not add a separate Pages app.
- **Do not modify** collectors (`src/collectors/*`), enrichment (`src/enrich.ts`), health (`src/health.ts`), migrations, cron triggers or `config/taxonomy.ts` unless a UI need forces it, and then say why in the commit.
- You may add **read-only** JSON endpoints under `/api/` and new query helpers for the UI.

## Views that must exist (improve freely)

| Route | Purpose |
|---|---|
| `/` Today | Morning brief (AI content ideas), health banner, KPIs, rising topics with sparklines, top unanswered questions |
| `/questions` | Question bank: grouped questions, mentions, engagement, sources, covered vs gap, score, search and topic filter, "Send to pipeline" |
| `/rising` | Topics this week vs their own 4-week baseline (baseline switches on after 3 weeks of data; handle that state gracefully) |
| `/gaps` | Topic coverage vs Companimal's content URLs, biggest gaps |
| `/myths` | Claims owners repeat that may be untrue (Dog Data Library article candidates) |
| `/reddit` | Reddit intelligence: weekly conversation themes (summary, why it matters, article ideas, example threads), threads ranked by a "doing well" score (comments, comment growth, repeat sightings, Google rank, freshness) with sort Hot / Most discussed / Newest, filters by subreddit, kind (question, advice request, vent, story, debate...) and window (7/30/90 days), per-thread theme, pain point, emotion, need and content angle with "Send to pipeline", pain points, content angles, emotion mix, subreddit leaderboard. Source is Google's index of Reddit: comment counts yes, comment text no; say so honestly in the UI |
| `/sources` | Best communities (question rate, UK %, off-topic %), UK YouTube channel status, run log with costs |

Global filters that must persist across every view: **audience lens** (`?lens=buyer|breeder|rescue|owner`) and **region** (`?region=all`, default UK only). Read `layout()` for current behaviour.

Existing JSON: `GET /api/opportunities?days=30&lens=…&region=all`, `GET /api/rising`, `GET /api/health`, `GET /api/pipeline`, `POST /api/pipeline {topic, question}`, `GET /api/reddit/threads?days=7&sub=dogs&kind=vent&topic=…&limit=200` (threads with insights and score), `GET /api/reddit/themes` (latest themes snapshot plus available dates). Reddit server code: `src/dashboard/reddit.ts` (view), `src/collectors/reddit.ts` (data, `threadScore`), `src/reddit-insights.ts` (AI). Reddit is the flagship channel right now: give it the most design attention after Today.

## Ideas worth building (your call)

- Today as an editorial bento: one hero opportunity, ranked queue, rising topics strip, health as a quiet status line when fine.
- Question detail drawer: every source post behind a grouped question (link out), suggested H2s, matched Companimal URL.
- Topic pages: trend over time, top questions, myths, best communities for that topic.
- Seasonality view (week-of-year heatmap) that shows an honest "builds after 12 months" state now.
- Pipeline queue view showing what's been sent to the content pipeline.
- Keyboard shortcuts for power use (j/k through the question bank, s to send).

## Brand and owner preferences (these override ui-craft where they conflict)

- **Light mode only.** The owner dislikes dark UIs. No dark mode toggle.
- **Companimal brand:** warm cream `#F8F4EE`, marmalade terracotta `#C8552D`, near-black ink `#1A1614`, deep forest green `#2F4A3A`, warm grey `#766F61`, light sand `#E8E4DD`, paper `#FFFFFF` for raised surfaces only. Display face **Instrument Serif**. **Never use Fraunces** (owner's instruction, overrides the brand guide). Pick a non-banned UI sans and a mono per ui-craft. Characterful, grown-up, trustworthy; not corporate, not childish. No paw prints, hearts, bones, gradients or drop shadows.
- Terracotta is the 2% accent: primary actions and active states only.
- **UK English** in all copy. **Never use double hyphens ("--")** in any copy or UI text.
- Varied formats over walls of text: tables, ranked lists, compact cards.
- Real data only. Use the live data or the local mock data; never invent placeholder content.

## Working locally

```bash
npm install
# Test config: no AI or email bindings, mock data mode
python3 - <<'PY'
import re
s=open('wrangler.toml').read()
s=re.sub(r'database_id = "[^"]+"','database_id = "local-test"',s)
s=re.sub(r'\[ai\]\nbinding = "AI"\n','',s); s=re.sub(r'\[\[send_email\]\]\nname = "ALERTS"\n','',s)
open('wrangler.test.toml','w').write(s+'\n[vars]\nMOCK = "1"\n')
PY
npx wrangler d1 migrations apply companimal-social-listening --local -c wrangler.test.toml
npx wrangler dev -c wrangler.test.toml --test-scheduled
# populate mock data
curl -X POST "localhost:8787/api/run?job=collect"; curl -X POST "localhost:8787/api/run?job=hourly"; curl -X POST "localhost:8787/api/run?job=hourly"; curl -X POST "localhost:8787/api/run?job=morning"
```

No password locally (DASHBOARD_PASSWORD unset). `npx tsc -p .` must pass.

## Definition of done

1. 4-line design spec written first (ui-craft Phase 1), then build.
2. Every view works with lens and region filters, empty states, first-week states (no baseline yet), and real volumes (hundreds of rows: paginate or virtualise).
3. Keyboard focus visible on every control; hover, focus-visible and active states everywhere; tabular numbers on all metrics and tables.
4. Screenshots of every view at 1440px and 390px checked by you before pushing; fix what looks off.
5. `npx tsc -p .` passes; push to `main`; confirm the Cloudflare build goes green.

---

## ui-craft rules (mandatory)

### Phase 1: The 4-line design spec (mandatory first output)
Before outputting code, write a concise 4-line architectural spec:
1. **Aesthetic direction:** e.g. Swiss Editorial, Brutalist Utility, Tactile Hardware
2. **Typography pair:** display font + body/UI font + monospace font
3. **Surface and border strategy:** how depth is created (1px hairline borders, tonal shifts)
4. **Signature micro-interaction:** one deliberate, tactile detail tailored to this UI

### Phase 2: Hard visual constraints (zero exceptions)

**Banned defaults**
- Fonts: never Inter, Roboto, Open Sans or system defaults. Load expressive Google Fonts (e.g. Instrument Serif, Plus Jakarta Sans, Space Grotesk, Geist, Syne, JetBrains Mono, Newsreader). Never Fraunces either (owner's instruction).
- Colours: never Tailwind default indigo-500, purple-600 or cyan-to-purple gradients.
- Shadows: never heavy drop shadows. Use 1px crisp borders and subtle surface-colour steps for elevation.

**Typography and hierarchy**
- Headings 24px and larger: letter-spacing -0.02em to -0.04em, line-height 1.05 to 1.15.
- All metrics, prices, counters, tables and timestamps: `font-variant-numeric: tabular-nums`.
- Uppercase labels and eyebrows (11 to 12px): tracking +0.08em, weight 600.

**Colour and contrast**
- 90 / 8 / 2: 90% neutral canvas and surfaces, 8% muted borders and secondary text, 2% high-contrast accent strictly for primary actions and active states.
- Tinted neutrals: never pure #000 or #FFF for large surfaces; light mode uses warm alabaster or stone (the Companimal cream fits).

**Layout, spacing and polish**
- Asymmetric, intentional grids: avoid uniform 3-column card grids; use bento spans, split-screen sticky layouts or editorial whitespace.
- Every clickable element has distinct :hover, :focus-visible and :active states (e.g. scale 0.98 on press, border brightening, background shift).
- Real data only: no lorem ipsum, no "John Doe", no placeholder numbers.
