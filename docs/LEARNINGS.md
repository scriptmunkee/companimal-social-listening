# Learnings

What went wrong building the Companimal tool, what fixed it, and where the fix lives. The Beatrice Vasey tool (scriptmunkee/beatricevasey-social-listening) was built from the first version of this list; its own fixes came back here in November 2026.

| Problem | Fix | Where |
|---|---|---|
| Workers AI returns JSON already parsed; treating it as text made every batch fall back to keyword rules | `toArray` and `aiText` handle every response shape; health alert if three runs in a row read nothing by AI | `src/enrich.ts`, `src/health.ts` |
| Runs overran their 10-minute slot and overlapped | AI batches four at a time against a time budget, unfinished work carries over, and a lock outlives the longest run | `src/lib.ts` (`inWaves`, `withLock`), `src/index.ts` |
| Errored searches were polled forever; stragglers blocked themes | Errored tasks are marked done, tasks expire after a day, threads fall back to rules after failed attempts, themes don't wait on stragglers | `src/collectors/dataforseo.ts`, `src/reddit-insights.ts` |
| Moves fell back to rules on some days: Workers AI rejected the request ("8006: reason must be valid JSON") | Titles cut to a length split emoji into half surrogate pairs; `runAi` now drops unpaired surrogates before every call | `runAi` in `src/enrich.ts` |
| One slow AI answer stalled a run | Every model call has a timeout and falls back to a smaller model | `runAi` in `src/enrich.ts` |
| An AI outage turned into keyword-rule readings | When no batch is answered, nothing is marked: threads wait for the next run instead of using up their attempts | `analyseRedditThreads` (from Beatrice) |
| First themes were generic categories | Stronger model (gpt-oss-120b), "situation not category" rules, sentence case, filler titles dropped; topic-level labels never become moves | `src/reddit-insights.ts`, `src/insights.ts` |
| The themes builder overwrote each thread's upvotes with its "doing well" score, so the AI saw the wrong numbers | Ranking score kept separately (`s`) | `buildRedditThemes` |
| Old evergreen threads led "most discussed" | Scores use upvotes and growth, discounted by age | `threadScore` |
| Search results carry no date | The earliest comment stands in for the posting date; undated search finds don't count as new | `src/collectors/reddit-api.ts` |
| D1 has a size limit | Comments over 90 days old thinned to the top 10 per thread; everything stays in R2 | `pruneReddit` |
| Google `site:` searches gave best-of-all-time threads with snippets only | Serpent API: real feeds, bodies, upvotes and comments; Google stays as the fallback | `src/collectors/reddit-api.ts` |
| The site's sitemap was blocked (Cloudflare challenge, 403) | Browser-like user agent containing `CompanimalListening`; the last good read or the saved inventory is kept; the health email names the WAF rule to add | `src/site.ts`, `config/site-snapshot.ts` |
| A misspelled secret (`SERPANT_API_KEY`) would silently switch Reddit off | Both spellings accepted; health alert when no key is set | `prepareEnv` in `src/lib.ts` |
| Spend could creep unnoticed | Every paid call logged in `api_usage`; health alert over $0.50 a day | `src/health.ts` |
| The dashboard showed data, not decisions | Insight layer: Finding, So what, Now what, with status, dismiss reasons and briefs; insights-first layout | `src/insights.ts`, `src/dashboard/moves.ts` |
| The fallback model returned moves for only some themes, so the rest silently vanished | The AI must answer every ref (marking covered ones); rules write any it leaves out; the strong model is tried twice | `buildInsights` |
| Renamed AI themes brought back moves already dismissed | A new move whose evidence mostly overlaps a closed or planned one counts as that move; recent dismissals go into the prompt; "Not relevant" closes a move for good | `saveCards` in `src/insights.ts` |
| A scrolling tab row clipped the More menu on phones | The menu is fixed-positioned on narrow screens | `src/dashboard/ui.ts` |
| Too many channels before one was right | One channel at a time: Reddit first, then the insight layer across all of them | |
