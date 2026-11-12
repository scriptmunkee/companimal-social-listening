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

## Dashboard

Light mode, Companimal palette. Filter every view by audience: Buyers, Breeders, Rescues, Owners.

- **Today**: brief, KPIs, rising topics, top unanswered questions
- **Question bank**: every extracted question, grouped and scored, searchable
- **Rising topics**: last 7 days against each topic's own 4-week baseline (switches on after 3 weeks of data)
- **Content gaps**: topic coverage against the sitemap
- **Myths and claims**: candidates for Dog Data Library articles
- **Sources and coverage**: best communities, and every collector run with its cost

"Send to pipeline" adds an opportunity to `pipeline_queue` (readable at `/api/pipeline`) ready to feed the Content Ledger.

## Changing what it tracks

Edit `config/taxonomy.ts` and bump `QUERY_VERSION`. Each version is stored in `query_versions` so trend changes can be traced to query changes.

## API

All behind the dashboard password (HTTP basic auth, any username).

- `GET /api/opportunities?days=30&lens=breeder`
- `GET /api/rising?lens=buyer`
- `GET /api/pipeline`
- `POST /api/run?job=collect|hourly|morning|sitemap|paa|rollup_all`

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
