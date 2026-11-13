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

Reddit comes through **Serpent API** (apiserpent.com, a third-party Reddit data API) whenever the `SERPENT_API_KEY` secret is set. Without the key, the tool falls back to **Google's index of Reddit** via DataForSEO, as before. Both feed the same tables.

| Layer | How (Serpent) | Gives |
|---|---|---|
| Feeds | Every 3 hours, each subreddit in `SUBREDDITS`: `new` (100), `hot` (50), `rising` (25). r/AskUK and r/CasualUK keep only posts that mention dogs (`REDDIT_DOG_FILTER`) | Every new thread, with post body, upvotes, upvote ratio, comment count, flair, posted time |
| Best of | Daily: `top` of the week (100) and the month (50) per subreddit | What did best |
| Search | Daily: ~60 topic searches (`REDDIT_TOPIC_QUERIES`), UK subreddit searches (`REDDIT_UK_SEARCHES`), 30 questions harvested from Reddit | Threads anywhere on Reddit, including evergreen ones |
| Comments | Every 10 minutes, up to 1,000 threads a day: threads with 3+ comments, fetched again when comments grow by half (and by 10+) | The replies themselves (`reddit_comments`, authors hashed) |
| Growth | A snapshot each time a thread is seen (`reddit_metrics`, hourly grain) | Comment and upvote growth over the last day |
| Insights | Workers AI per thread, reading the post body and the 6 most upvoted replies (`reddit_insights`) | Kind, theme, pain point, need, emotion, content angle, audience, topic, region, and what the replies say |
| Themes | Daily AI grouping of the last 7 days' threads posted in the last 30 days (`reddit_themes`) | What people are talking about, why it matters, article ideas |

"Doing well" score (`threadScore`): comments and upvotes (discounted by age), growth in both over the last day, repeat sightings and feed rank. Old evergreen threads still lead "Most discussed".

Every Serpent call is counted in `api_usage` (per day, per endpoint) and each run's cost shows in `runs.cost_usd`. Out of credit (HTTP 402) or a rejected key makes the run fail, which triggers the health alert email.

Cost: about $0.20 a day (feeds ~$0.05, searches ~$0.01, comments up to ~$0.15). Serpent charges $0.12 per 1,000 calls, and posts and comments per started block of 25.

Search results carry no date; until a thread's comments are fetched, its age is unknown and it isn't treated as new. The earliest comment then stands in for the posting date.

Note: Serpent is not Reddit's official API. If it stops working, remove the secret and the Google route takes over.

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
