# Companimal social listening

A self-built social listening tool for content strategy. Every day it collects what UK dog buyers, breeders, rescues and owners ask and talk about (Reddit, YouTube, People Also Ask, UK forums and the web), keeps a permanent archive, and every morning turns it into a short ranked list of **moves** for companimal.co.uk, each written as:

1. **Finding**: the takeaway, with a number ("Nine threads this fortnight ask whether a £500 deposit before viewing is normal")
2. **So what**: why it matters for the site (which page is missing or thin, or what the demand means for listings)
3. **Now what**: one action on one named page, with a content brief on request

Built to match the Beatrice Vasey tool (scriptmunkee/beatricevasey-social-listening); see `docs/LEARNINGS.md`. The long-term value is still the archive: every day it runs adds to a history that can't be bought back later.

## What runs when (UTC)

| When | Job | What it does |
|---|---|---|
| 02:00 daily | `collect` | DataForSEO SERP tasks (forums daily; People Also Ask on Mondays), Reddit top of week and month plus every search (Serpent), YouTube, web mentions |
| Every 10 minutes | `tick` | Picks up SERP results; Reddit feeds every 3 hours and comment threads; the AI reads new threads and posts |
| 06:30 daily | `morning` | Rollups, Reddit themes, **moves**, health check. Mondays: re-read the site's pages and email the week's top five moves. 1st of the month: thin old comments |

Storage:

- **R2** `raw/companimal/{source}/{yyyy}/{mm}/{dd}/…json`: every raw API response, never edited. Expires after 730 days (personal data minimisation).
- **D1**: normalised posts (usernames hashed), readings, Reddit threads and comments, themes, moves (`insights`, `insight_events`), the site's pages (`site_pages`), daily topic counts (kept forever), coverage log, query versions.

## Deploys are automatic

The repo is connected to Cloudflare Workers Builds: every push to `main` deploys. Database changes live in `src/migrations.ts` and the Worker applies them itself on its next request or cron run, so no manual migration step is needed.

## UK focus

- Every post is tagged `uk`, `non_uk` or `unknown` (keyword rules for hard signals such as £, councils, RSPCA, US states and $, then the AI for the rest).
- The dashboard defaults to **UK only** (UK plus unsure); **All regions** shows everything. Non-UK posts stay in the archive.
- Google searches run on UK Google and include UK communities (Mumsnet, Netmums, Champdogs, r/AskUK, r/CasualUK).
- Web mentions are limited to `.uk` sites and known UK forums.
- YouTube reads recent uploads from named UK channels (`YOUTUBE_UK_CHANNELS` in `config/taxonomy.ts`); channel lookups are cached and listed on the Sources page.

## Health alerts and the Monday email

Every morning a health check looks at the last 26 hours and emails `ALERT_EMAIL` from `alerts@companimal.co.uk` if anything is wrong: a job failed, didn't run or collected nothing; the AI stopped answering three runs in a row; a UK YouTube channel can't be found; the Serpent key is missing or rejected; Serpent spend passed $0.50 in a day; or the site's sitemap was blocked (the alert names the fix). Silent when healthy. `GET /api/health` returns the current issues.

Every Monday at 06:30 the week's top five open moves are emailed to the same address, with links to each move on the dashboard (`DASHBOARD_URL` in `wrangler.toml`).

## Moves (the insight layer)

`src/insights.ts` rebuilds the moves every morning from the last 14 days, reading across every channel: Reddit themes and per-thread readings, question clusters from YouTube, People Also Ask, forums and the web, and myths from both.

| Type | Trigger | Action |
|---|---|---|
| New article | A theme or question cluster nothing on the site answers | The article to write, at a new `/puppy-advice/` path, with brief |
| Update an article | A puppy advice, Dog Data Library or breed page covers it, but thinly | The section to add, on the named page |
| Demand signal | 2+ threads in 14 days from people looking to buy, sell, find a stud, rehome or adopt (by breed where 2+ share one) | What the sale, stud or `/sell-my-puppies` hub should answer |
| Seasonal | A season in the dog year opening within 8 weeks, or under way with 3+ threads | Refresh or publish the seasonal page in time |
| Myth to correct | Replies that disagree or repeat risky advice, and claims tagged as myths on other channels | An article or section that settles it |
| Tool or calculator hook | 3+ posts asking a number question a tool answers (cost, price, feeding, adult size, due date, walks, dog years) | Add the calculator to the existing article, or plan a new tool page |

Priority: engagement and growth of the evidence, discounted by age; more for people asking for a guide, urgency, clearly UK posts and the same thing on more than one channel. The AI (gpt-oss-120b, falling back to Llama 3.3) writes the moves; keyword rules write them when it can't.

**Status sticks.** Plan, Done or Dismiss (with a reason) on any move. Moves keep their status across daily rebuilds by key, and a new move whose evidence mostly overlaps a closed one counts as the same move even if the AI renames it. Closed moves only come back if their evidence doubles; **Not relevant** closes a move for good; **Not now** brings it back after four weeks if it's still there. Recent dismissals are given to the AI so it stops suggesting them.

**Briefs** are drafted on request from a move (`Draft the brief`): H1, title tag, meta description, an outline from the real questions, what the replies agree on, what the threads lacked, and natural internal links. Dog Data Library briefs list sources to cite; puppy advice briefs don't.

**Site coverage** (`src/site.ts`): read from the sitemap on first install and every Monday. Puppy advice, the Dog Data Library and core pages get their titles read; breed, sale and stud hubs come from the breed list. The site sits behind Cloudflare's bot protection, so the Worker sends a browser-like user agent containing `CompanimalListening`; if it's still blocked, the last good read (or the saved inventory in `config/site-snapshot.ts`) is used and the health email names the WAF rule to add.

## Richer reading per thread

The AI reads every Reddit thread with its post body and six most upvoted replies, and records: kind, theme, pain point, need, emotion, content angle, audience, topic, region, what the replies say, **breed** (mapped to its `/breeds/` page), **intent** (buy, sell, stud, rehome, adopt, own, learn, share), **urgency** (now, soon, planning), **UK region**, the question as a search query, and whether the replies disagree. People explicitly asking for a guide are flagged by wording. An AI outage leaves threads unread for the next run rather than falling back to keyword rules.

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
| Themes | Daily AI grouping of the last 14 days' threads posted in the last 30 days (`reddit_themes`) | What people are talking about, why it matters, article ideas |

"Doing well" score (`threadScore`): comments and upvotes (discounted by age), growth in both over the last day, repeat sightings and feed rank. Old evergreen threads still lead "Most discussed".

Every Serpent call is counted in `api_usage` (per day, per endpoint) and each run's cost shows in `runs.cost_usd`. Out of credit (HTTP 402) or a rejected key makes the run fail, which triggers the health alert email.

Cost: about $0.20 a day (feeds ~$0.05, searches ~$0.01, comments up to ~$0.15). Serpent charges $0.12 per 1,000 calls, and posts and comments per started block of 25.

Search results carry no date; until a thread's comments are fetched, its age is unknown and it isn't treated as new. The earliest comment then stands in for the posting date.

Note: Serpent is not Reddit's official API. If it stops working, remove the secret and the Google route takes over.

## Dashboard

Server-rendered from `src/dashboard/` (no build step): `ui.ts` holds the design tokens, page shell and shared components, `moves.ts` the insights-first views, `views.ts` and `reddit.ts` the data views, `data.ts` read-only query helpers, `client.ts` the small client script. Design rules: `.interface-design/system.md`. Light mode, Companimal palette (terracotta only for actions and "now"), Instrument Serif with Instrument Sans and JetBrains Mono. Never Fraunces or Inter.

Quiet top tab row:

- **This week** (`/`): a headline sentence built from the numbers, the dog year strip, then the ranked ledger of moves with type and status filters (Open, Planned, Closed). Aside: people ready to act, where the evidence comes from, spend
- **One move** (`/move/{id}`): the finding, Now what, the brief, every piece of evidence with what the replies say, why it ranks, history
- **Demand** (`/demand`): buyers, breeders, rehomers and adopters in the last 14 days, by breed, against the fortnight before, linked to their moves
- **Themes** (`/themes`): Reddit conversation themes with coverage, article ideas and the threads behind them
- **Coverage** (`/coverage`): pages that need work and pages people are asking for
- **Questions** (`/questions`), **Reddit** (`/reddit`), **Sources** (`/sources`): the data views, with the audience (`?lens=`) and region (`?region=all`) filters
- Under More: Rising topics, Myths, Topic gaps, Seasonality, Pipeline

Keyboard: `j`/`k` move through questions, `o` opens, `s` sends to the pipeline, `/` searches, `g` then `w`/`d`/`t`/`c`/`q`/`r` jumps between views, `?` lists shortcuts.

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
- `GET /api/insights` (moves, highest priority first)
- `POST /api/insights/{id}/status` with `{"status": "new|planned|done|dismissed", "reason": "Not relevant|Already covered|Not now|Wrong page"}`
- `POST /api/insights/{id}/brief` (drafts and stores the brief)
- `POST /api/run?job=collect|tick|morning|site|insights|themes|digest|health|reddit|reddit_feeds|reddit_comments|reddit_insights|paa|rollup_all|brief` (long jobs run in the background; add `&wait=1` to wait)

## Deploy

```bash
export DATAFORSEO_LOGIN=… DATAFORSEO_PASSWORD=… YOUTUBE_API_KEY=… SERPENT_API_KEY=… DASHBOARD_PASSWORD=…
./deploy.sh
```

## Local testing with fixture data

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
for j in tick tick morning; do curl -X POST "localhost:8787/api/run?job=$j&wait=1"; done
```

Mock mode uses the saved site inventory and fixture posts, and keyword rules instead of the AI, so every move type appears. `npx tsc -p .` must pass.

## Roadmap

- Phase 2: semantic URL matching (Workers AI embeddings + Vectorize), question clustering by meaning rather than wording
- Phase 3: pipeline queue to Content Ledger Google Sheet and NeuronWriter queries; Fan-out Lens data as a source
- Year 2: seasonality view (week of year, year on year)
