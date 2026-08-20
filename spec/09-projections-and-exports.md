# ASR 09 — Projections and Exports

Structured objects are the single source of truth (§0.4); everything a human
or consumer reads is a **regenerable projection**. When a projection
disagrees with the objects it is stale (`csv_stale`, `counts_mismatch`) —
the objects govern, and `authority regen` repairs.

## 9.1 The CSV mirror (`sources.csv`)

One row per source, for spreadsheet triage. Dialect is pinned byte-exactly:
UTF-8 without BOM, LF line endings, RFC 4180 quoting, header row, fixed
column order:

```
source_id,slug,name,publisher,role,class,tier_asserted,tier_adjudicated,
topics,jurisdiction,cadence,lifecycle,access_types,verification_state,
last_verified_at,homepage_url
```

`topics` and `access_types` are `;`-joined. The CSV never carries columns the
profiles do not; it is a view, not a second schema.

## 9.2 The browser (`index.html`)

A single self-contained offline HTML file (no external requests), generated
by `build-index`. Required affordances:

- **Source table** — name, role and tier chips (asserted and adjudicated
  visually distinct — an adjudicated tier is earned, an asserted tier is
  triage), topics, jurisdiction, cadence, access-type chips, and a
  **verification badge with age** ("verified 12d ago" / "stale" /
  "asserted — never probed" / "blocked"), filterable by topic, tier, state,
  access type, and — one dropdown per declared axis — **facet** (§02.4).
- **Source detail** — guidance rendered FIRST (it is the payoff), then
  identity/authority/scope/content, endpoints with copy-ready example
  requests using `$CREDENTIAL` placeholders, the probe timeline, and fetch
  history. Deep-linkable as `#src=<source_id>`.
- **Registry health banner** — verified / stale / asserted / broken / blocked
  counts. A registry with broken claims never looks clean.
- **Credential coverage** — every `credential_ref`, which sources need it,
  where it resolves locally if known at build time (never values).

The browser is read-only and makes no network requests; verification badges
are computed from the same derivation the validator uses (§04.6), so the
page cannot show a promise the validator would reject.

## 9.3 Markdown export

`export --format markdown` renders the registry as one document (per-source
sections, guidance first) for pasting into notes or feeding to a model whose
harness lacks JSON tooling. Like every projection it is regenerable and
carries a generated-from note naming the registry id and timestamp.

## 9.4 Consumer exports

`export` also emits consumer-shaped projections, deterministic
(stable ordering, no timestamps beyond the objects' own) so consumers can
hash them:

- **`pi-canonical-sources`** — the pi-forge editorial-policy shape:
  `{schemaVersion, updatedAt, sources: [{id, label, site, authority, kinds,
  topics, notes, provider}]}` with `id`/`provider`/`kinds` from
  `ext["pi-forge"]` (fallback: slug), `authority` = `adjudicated.tier ??
  asserted.tier`, and registry topics mapped through the export map (§9.5).
- **`pi-domain-strategies`** — per web access method:
  `{domain, preferred_strategy, rate_limit, last_verified, notes}` (+
  selector passthrough from `ext["pi-forge"]`), `web_fetch` →
  `direct_http`, `web_render` → browser strategy.
- **`pi-provider-stub`** — a per-API JSON descriptor with `capabilities()`
  fields prefilled from auth/limits/guidance, for a human writing a real
  provider module.

Field-by-field bridges live in `crosswalks/pi-forge.md`; the UPC bridge for
fetch sidecars in `crosswalks/upc.md`.

## 9.5 Topic mapping

A registry MAY carry `ext["pi-forge"].topic_map` (or the analogous member
for another consumer) in its manifest: `{ "<registry topic id>":
["<consumer topic>", …] }`. Exports apply the map; unmapped topics pass
through verbatim and the export notes them, so vocabulary drift is visible
rather than silent.

## 9.7 Agent card and faceted query

`export --format agent-card` emits the token-frugal per-source projection a
routing agent loads to decide **where** to search: identity, officiality,
`use_for`/`caveats`, the routing dispositions and `follow_to_primary`
resolution, jurisdiction, topics, `facets` (§02.4), the preferred access
method, and verification freshness. It is a regenerable projection like any
other; the envelope carries a `schemaVersion` so consumers can pin the shape
(bumped to `2` in 0.3.0 when the per-source `facets` map was added).

`authority query <registry> [--facet name=value …] [--topic id] [--region ISO]
[--task t]` resolves *which sources settle a question* from the facet axes plus
topic/region — **without knowing source names first**. Facet matching is AND
across axes, OR within one axis (repeating an axis widens it); `--region`
matches a queried subnational code against a source scoped to its parent (a
`US-CA` query reaches `US`-national sources). With `--task`, results are ranked
by that task's routing disposition (`preferred` → `avoid`), then authority tier,
then verification state; each hit carries the agent-card fields, so the answer
already says whether to cite the source or follow it to a primary. The command
is read-only.

## 9.6 Regeneration contract

`regen` rebuilds, atomically and idempotently: manifest derived parts
(index, counts, schema_hash), `sources.csv`, `index.html`, and the mechanical
state transitions (`verified` → `stale` on window lapse, rollups, drift
repair). Running it twice changes nothing the second time. It never touches
hand-authored content (profiles' human fields, `topics.json`, notes), never
writes outside the registry, and never needs the network.
