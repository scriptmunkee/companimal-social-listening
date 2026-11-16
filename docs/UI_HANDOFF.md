# Front-end handoff: Companimal social listening dashboard

You own the dashboard UI for this repo. The data pipeline is done and live; your job is to make the dashboard bespoke, studio-grade and genuinely useful for content planning. Follow the **ui-craft** rules at the bottom of this file without exception.

## What the product is

A social listening tool for **Companimal** (companimal.co.uk), a UK puppy marketplace connecting buyers with breeders, rescues and rehomers. Every day it collects what UK dog people ask and argue about (Reddit via Serpent, YouTube, People Also Ask, UK forums, web mentions), reads it with AI, and every morning turns it into a short ranked list of **moves**: Finding, So what, Now what, each with a target page on companimal.co.uk, a priority and a type. The owner opens it to decide what to write, update or fix this week. The archive grows for years, so seasonality and trends matter.

**Primary user:** Chris, an SEO consultant. He opens it most mornings with ten minutes to decide. Busy, technical, dislikes walls of text. Decisions first, data a click behind.

## Architecture (don't change the data layer)

- Cloudflare Worker, TypeScript, `src/index.ts` routes requests. No framework, no build step.
- Dashboard is server-rendered HTML: `src/dashboard/ui.ts` (tokens, CSS, page shell, shared components), `moves.ts` (This week, one move, Demand, Themes, Coverage), `views.ts` and `reddit.ts` (data views), `data.ts` (query helpers), `client.ts` (status buttons, briefs, drawer, shortcuts, tooltips).
- The insight layer is `src/insights.ts` (moves, status, briefs); site pages are `src/site.ts`. Schema in `migrations/*.sql` and `src/migrations.ts` (append only; never drop or rewrite a table).
- Auth: HTTP basic auth on every route (`DASHBOARD_PASSWORD`). Keep it.
- **Deploys are automatic:** every push to `main` builds and deploys via Cloudflare Workers Builds (deploy command `npx wrangler deploy`, no build command). Whatever you add must still work with `wrangler deploy` alone. Do not add a separate Pages app.
- **Do not modify** collectors (`src/collectors/*`), enrichment (`src/enrich.ts`, `src/reddit-insights.ts`), the insight builder, health, migrations, cron triggers or `config/taxonomy.ts` unless a UI need forces it, and then say why in the commit.
- You may add **read-only** JSON endpoints under `/api/` and new query helpers for the UI.

## Views (improve freely, keep the insights-first order)

| Route | Purpose |
|---|---|
| `/` This week | Headline sentence built from the numbers (no KPI tile row), the dog year strip, the ranked ledger of moves with type and status filters. Aside: people ready to act, where it's coming from, spend |
| `/move/{id}` | One move: finding, so what, Now what with the target page, Draft the brief, the brief, every piece of evidence, why it ranks, history |
| `/demand` | Buyers, breeders, rehomers and adopters (last 14 days) by breed and against the fortnight before, linked to their moves |
| `/themes` | Reddit conversation themes with coverage label, article ideas and the threads |
| `/coverage` | Pages that need work, pages people are asking for, articles with nothing raised |
| `/questions`, `/q` | Question bank and question detail (drawer) |
| `/reddit` | Threads ranked by "doing well" (comments, upvotes, growth, age), with breed, intent, UK region and what the replies say |
| `/sources` | Communities, UK YouTube channels, run log with costs |
| Under More | `/rising`, `/myths`, `/gaps`, `/seasonality`, `/pipeline` |

Navigation is a quiet top tab row (no sidebar, no masthead). The audience (`?lens=`) and region (`?region=all`) filters show only on the data views.

Status buttons on every move: **Plan**, **Done**, **Dismiss** (asks why: Not relevant, Already covered, Not now, Wrong page). Tapping the pressed status again reopens the move. JSON: `GET /api/insights`, `POST /api/insights/{id}/status`, `POST /api/insights/{id}/brief`, plus the older `/api/opportunities`, `/api/rising`, `/api/health`, `/api/pipeline`, `/api/reddit/threads`, `/api/reddit/themes`.

## Design system

Read `.interface-design/system.md` first: intent, tokens, type scale, the dog year strip and classified-ad move cards (the signature), and the rejected defaults. Use the `interface-design` and `data-storytelling` skills in `.claude/skills/` for any front-end change, and add new patterns to `system.md` when a component is used twice.

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
python3 - <<'PY'
import re
s=open('wrangler.toml').read()
s=re.sub(r'database_id = "[^"]+"','database_id = "local-test"',s)
s=re.sub(r'\[ai\]\nbinding = "AI"\n','',s); s=re.sub(r'\[\[send_email\]\]\nname = "ALERTS"\n','',s)
open('wrangler.test.toml','w').write(s.replace('[vars]\n','[vars]\nMOCK = "1"\n'))
PY
npx wrangler d1 migrations apply companimal-social-listening --local -c wrangler.test.toml
npx wrangler dev -c wrangler.test.toml --test-scheduled
# populate mock data and build moves
for j in tick tick morning; do curl -X POST "localhost:8787/api/run?job=$j&wait=1"; done
```

No password locally (DASHBOARD_PASSWORD unset). Mock mode produces every move type. `npx tsc -p .` must pass.

## Definition of done

1. Read `.interface-design/system.md`; for a new direction write the 4-line design spec first (ui-craft Phase 1), then build.
2. Every view works with empty states, first-week states (no baseline yet), real volumes (hundreds of rows: paginate or virtualise), and the lens and region filters where they apply.
3. Keyboard focus visible on every control; hover, focus-visible and active states everywhere; tabular numbers on all metrics and tables.
4. Screenshots of every view at 1440px and 390px checked by you before pushing, tapping through on mobile (tabs, More, Plan, Dismiss with a reason, Draft the brief); fix what looks off.
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
