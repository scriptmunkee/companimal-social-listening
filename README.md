# Companimal social listening

A self-built social listening tool for content strategy. Every day it collects what UK dog buyers, breeders, rescues and owners ask and talk about, keeps a permanent archive, pulls out the questions, and turns them into content opportunities for companimal.co.uk.

The long-term value is the archive: every day it runs adds to a history that can't be bought back later.

## How it works

| Time (UTC) | Job | What it does |
|---|---|---|
| 02:00 daily | `collect` | Posts Google SERP tasks to the DataForSEO standard queue (Reddit and forum threads daily; People Also Ask on Mondays), collects YouTube comments, runs DataForSEO Content Analysis |
| :15 hourly | `hourly` | Picks up finished SERP tasks, enriches up to 200 new posts (Workers AI: type, question, topic, audience, sentiment, matching Companimal URL) |
| 06:30 daily | `morning` | Daily rollups, then the morning brief (5 content ideas). Sitemap refresh on Mondays |

Storage:

- **R2** `raw/companimal/{source}/{yyyy}/{mm}/{dd}/…json`: every raw API response, never edited. Expires after 730 days (personal data minimisation).
- **D1**: normalised posts (usernames hashed), enrichments, daily topic counts (kept forever), coverage log, query versions, briefs, pipeline queue.

## Deploys are automatic

The repo is connected to Cloudflare Workers Builds: every push to `main` deploys. Database changes live in `src/migrations.ts` and the Worker applies them itself on its next request or cron run, so no manual migration step is needed.

## UK focus

- Every post is tagged `uk`, `non_uk` or `unknown` (keyword rules for hard signals such as £, councils, RSPCA, US states and $, then the AI for the rest).
- The dashboard defaults to **UK only** (UK plus unsure); **All regions** shows everything. Non-UK posts stay in the archive.
- Google searches run on UK Google and include UK communities (Mumsnet, Netmums, Champdogs, r/AskUK, r/CasualUK).
- Web mentions are limited to `.uk` sites and known UK forums.
- YouTube reads recent uploads from named UK channels (`YOUTUBE_UK_CHANNELS` in `config/taxonomy.ts`); channel lookups are cached and listed on the Sources page.

## Health alerts

Every morning a health check looks at the last 26 hours. If any job failed, didn't run, collected nothing, or the AI stopped responding (it falls back to a second model first), it emails `ALERT_EMAIL` from `alerts@companimal.co.uk` and shows a banner on the Today page. Silent when healthy. `GET /api/health` returns the current issues.

## Reddit

Reddit is read through **Google's index of Reddit** (via DataForSEO). The tool never calls Reddit directly: Reddit blocks automated access from servers and has closed its API to new users, and we don't work around that.

| Layer | How | Gives |
|---|---|---|
| Fresh threads | Per subreddit, daily: `site:reddit.com/r/x` past day + past week + 2 rotating angles (`REDDIT_FACETS`) | New threads, title, snippet, posted time, Google rank |
| Comment counts | ~60 topic searches (`REDDIT_TOPIC_QUERIES`) daily, plus 30 questions harvested from Reddit, plus re-running searches that recently surfaced commented threads | Google's Discussions and forums block lists Reddit threads with `posts_count` (comments); about 1 in 3 searches shows it |
| Registry | `reddit_threads` keyed by Reddit post id; every sighting in `reddit_thread_hits` | Comment growth over time, repeat appearances, best rank |
| Insights | Workers AI per thread (`reddit_insights`) | Kind (question, advice request, vent, story, debate...), theme, pain point, need, emotion, content angle, audience, topic, region |
| Themes | Daily AI grouping of the week's threads (`reddit_themes`, one snapshot per day) | What people are talking about, why it matters, article ideas |

"Doing well" score (`threadScore`): comments, comment growth, repeat sightings, Google rank and freshness.

Not available: comment text and upvote scores. If proper Reddit data access is ever obtained (an approved Reddit Data API app or a licensed data provider), it can feed the same tables.

Cost: roughly $0.24 a day for Reddit, most of it `site:` searches (DataForSEO charges those at 5x).

## Dashboard

Server-rendered from `src/dashboard/` (no build step): `ui.ts` holds the design tokens, page shell and components, `views.ts` the pages, `data.ts` read-only query helpers, `client.ts` the small client script. Light mode, Companimal palette, Instrument Serif with Instrument Sans and JetBrains Mono (never Fraunces).

Every view keeps the **audience** (`?lens=buyer|breeder|rescue|owner`) and **region** (`?region=all`, default UK only) filters.

- **Today** (`/`): lead idea from the morning brief with the communities asking it, the rest of the brief, KPIs, rising topics with 35-day sparklines, top unanswered questions, claims to fact-check, recent pipeline sends
- **Questions** (`/questions`): every grouped question with search, topic, period, coverage and sort filters, 50 a page. Click a question for the detail drawer (every source post, related questions as H2 candidates, matched Companimal URL); `/q?topic=…&q=…` is the same detail as a page
- **Rising** (`/rising`): last 7 days against each topic's 4-week average; shows a "day X of 21" state until the baseline exists
- **Topic pages** (`/topics/{id}`): 90-day daily trend, top questions, myths, best communities, what people post
- **Gaps** (`/gaps`): coverage by topic against the sitemap, biggest gaps
- **Myths** (`/myths`): claims grouped and counted, with the posts behind them
- **Seasonality** (`/seasonality`): week-of-year grid per topic; reliable after 12 months of collection
- **Pipeline** (`/pipeline`): everything sent with "Send to pipeline"
- **Sources** (`/sources`): spend, best communities, UK YouTube channels, paginated run log

Keyboard: `j`/`k` move through questions, `o` opens, `s` sends to the pipeline, `/` searches, `g` then `t`/`q`/`r`/`m` jumps between views, `?` lists shortcuts.

## Changing what it tracks

Edit `config/taxonomy.ts` and bump `QUERY_VERSION`. Each version is stored in `query_versions` so trend changes can be traced to query changes.

## API

All behind the dashboard password (HTTP basic auth, any username).

- `GET /api/opportunities?days=30&lens=breeder`
- `GET /api/question?topic=scams-fraud&q=…&days=90` (posts behind one question, related questions)
- `GET /api/topic?topic=health&days=90`
- `GET /api/seasonality`
- `GET /api/myths?topic=health`
- `GET /api/rising?lens=buyer`
- `GET /api/pipeline`
- `GET /api/health`
- `POST /api/run?job=collect|hourly|morning|sitemap|paa|rollup_all|health`

## Deploy

```bash
export DATAFORSEO_LOGIN=… DATAFORSEO_PASSWORD=… YOUTUBE_API_KEY=… DASHBOARD_PASSWORD=…
./deploy.sh
```

## Local testing with fixture data

```bash
cp wrangler.toml wrangler.test.toml   # remove the [ai] block, set database_id to anything, add [vars] MOCK = "1"
npx wrangler d1 migrations apply companimal-social-listening --local -c wrangler.test.toml
npx wrangler dev -c wrangler.test.toml
curl -X POST "localhost:8787/api/run?job=collect"; curl -X POST "localhost:8787/api/run?job=hourly"; curl -X POST "localhost:8787/api/run?job=morning"
```

## Roadmap

- Phase 2: semantic URL matching (Workers AI embeddings + Vectorize), question clustering by meaning rather than wording
- Phase 3: pipeline queue to Content Ledger Google Sheet and NeuronWriter queries; Fan-out Lens data as a source
- Year 2: seasonality view (week of year, year on year)
