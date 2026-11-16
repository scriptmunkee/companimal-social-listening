# Companimal listening desk: design system

## Intent
- **Who:** Chris, an SEO consultant who owns companimal.co.uk. He opens this most mornings, usually before client work, with ten minutes to decide what Companimal publishes or fixes this week.
- **Task:** pick the next moves (write, update, fix a hub page, get ahead of a season) and mark them planned, done or dismissed. Not browse data; the data sits a click behind each move.
- **Feel:** the morning edition of a local paper's classifieds desk. Warm newsprint, ink, a single terracotta mark for what to act on. Calm, decisive, grown-up; never cute.

## Domain
Puppies-for-sale classifieds, litter registers, collection day, the dog year (fireworks, Christmas puppies, spring litters), breed guides, verified listings, the editor's ledger.

## Colour world (tokens)
| Token | Hex | Use |
|---|---|---|
| `--cream` | #F8F4EE | page canvas (Companimal cream, newsprint) |
| `--paper` | #FFFFFF | raised surfaces only: move cards, panels, tables |
| `--well` / `--well-2` | #F2ECE3 / #EBE4D9 | inputs, tag fills, hover wells (inset, slightly darker than canvas) |
| `--sand` | #E8E4DD | hairline borders |
| `--rule` | #D9D2C6 | stronger rules, dashed empty states |
| `--grey` | #766F61 | metadata, labels |
| `--ink` / `--ink-2` | #1A1614 / #3D3732 | primary and secondary text |
| `--forest` / `--forest-tint` | #2F4A3A / #E4EBE5 | data: bars, season bands, Planned state, "covered" |
| `--terra` / `--terra-ink` / `--terra-tint` | #C8552D / #A8441F / #F7E4DA | the 2% accent: primary button, active tab, the "now" marker, urgent tags (always with a label) |

## Depth
Borders only. 1px `--sand` hairlines and the cream to paper step. No shadows, no gradients.

## Typography
- Display: **Instrument Serif** 400 (and italic for one-word emphasis). Headlines are findings, not labels.
- UI and body: **Instrument Sans** 400/500/600. Mono: **JetBrains Mono** for page paths and timestamps.
- Scale (ratio 1.25 from 14px): 11 · 12.5 · 14 · 16 · 20 · 24 · 30 · 44. Labels 11px/600, +0.08em, uppercase. Display tracking -0.02em.
- Never Inter, never Fraunces. All numbers `tabular-nums`.

## Spacing and shape
4px base. Move card padding 20px 24px (first move 26px 28px). Sections 44px apart. Radius 10px cards, 8px buttons, 999px chips. Medium density: airy around the headline, tight in tables.

## Signature
- **The dog year strip:** twelve months with season bands (New Year puppy rush, spring litters, ticks, hot weather, summer holidays, fireworks, Christmas puppies) and a terracotta "now" marker, under the week's headline. Bands people are talking about now are solid forest.
- **Classified-ad move cards:** a big serif rank number, a type label set like a classifieds heading, the finding as the headline, the page path in mono as the "address".
- **Planned stamp:** marking a move Planned inks a rotated forest stamp onto the card (the same stamp as Send to pipeline).

## Patterns
- **Headline sentence:** eyebrow (week and date) · serif 44 headline built from the numbers ("14 moves this week: 6 to write, 4 to update, 2 demand signals.") · one lede sentence naming the top move's numbers. Replaces a KPI tile row.
- **Move card:** rank (serif 30, `--grey`) | type label row | headline (serif 24) | so what (14, `--ink-2`) | action row: primary button + action text + target path (mono) | evidence line (12, channels, threads, comments, UK share) | status buttons right (Plan, Done, Dismiss with reasons).
- **Button primary:** 36px h, 0 14px, 8px radius, `--terra` fill, white text, 13px/600; hover `--terra-ink`; `:active` scale .97.
- **Button ghost:** same size, transparent, `--sand` border, `--ink-2`; hover `--well`.
- **Bar list:** 8px forest bars on a `--well` track, label left, value right, tooltip on hover.
- **Tabs:** one quiet row beside the wordmark, 13.5px/500 `--grey`; active is `--ink` with a 3px terracotta underline. Rare views sit under More.

## Rejected defaults
- KPI tile row → a headline sentence built from the numbers.
- Uniform card grid → a ranked ledger of moves.
- Sidebar navigation and a tall masthead → a quiet top tab row.
