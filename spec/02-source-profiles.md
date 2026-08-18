# ASR 02 — Source Profiles

A source profile (`sources/<slug>/source.json`, schema
`schemas/source.schema.json`) is the operational description of one
authoritative source: a *service* operated by someone — an agency site, an
encyclopedia, a database, an archive — not an individual document. (Individual
captured documents are UPC's unit; the crosswalk connects them.)

Required members: `source_id`, `identity`, `source_role`, `source_class`,
`authority`, `scope`, `access` (≥ 1 method), `lifecycle`, `provenance`.

## 2.1 Identity

`identity.name` is the source's common name; the directory slug is computed
from it (§06.5). `identity.homepage_url` is the public front door as given;
`identity.canonical_url` is its normalization (§06.4) and **feeds the
content-addressed id** (§06.2). `publisher` names the operating entity when it
differs from the name (e.g. name "OSTI.GOV", publisher "U.S. Department of
Energy, Office of Scientific and Technical Information").

A source whose canonical URL changes (domain move) is a **new source**; relate
the two with `supersedes` / `superseded_by`. Ids are stable or they are
worthless.

## 2.2 Role and class

`source_role` says what the source *is structurally* (publisher, aggregator,
index, repository, archive, mirror, community). `source_class` says its
*evidential distance* (primary, secondary, tertiary). The two are orthogonal:
a state agency (publisher) is usually primary; a well-run database of pointers
(aggregator) is usually tertiary — and its profile SHOULD carry `relations:
aggregates` edges plus guidance telling agents to follow entries to the
underlying primaries rather than citing the aggregator itself.

## 2.3 Authority — asserted vs adjudicated

The `authority` block holds two quarantined halves, and the quarantine is the
point:

- **`authority.asserted`** — triage. `tier` (1/2/3, legend in
  `vocab.json#/$defs/authority_tier`), `basis[]` (why: statute, government
  agency, standards body, peer review, …), `rationale`, and attribution
  (`asserted_by`, `asserted_at`). This half MAY be written by a machine when a
  profile is created.
- **`authority.adjudicated`** — judgment. `tier` and `score` are **null until
  a human scoring pass** (or an explicitly attributed process) fills them.
  When either is non-null, `scored_by` and `scored_at` MUST be present
  (`adjudication_unattributed`); when the profile's own provenance says a
  model wrote it, a non-null adjudication draws the `adjudication_by_machine`
  warning. Machine judgment must not masquerade as human judgment.

Consumers needing one number use `adjudicated.tier ?? asserted.tier`, and MUST
preserve the distinction when re-exporting.

## 2.4 Scope

`scope.topics[]` are ids from the registry's `topics.json` (§01.5;
`unknown_topic` otherwise). `scope.jurisdiction` structures locality as
`{level, regions[], notes}` — `level` from the closed enum, `regions` as ISO
3166-1/-2 codes (`"US"`, `"US-CA"`), `notes` for compound realities ("Federal
9th-Circuit ruling with effect in CA"). `scope.temporal` records coverage
(`coverage_start`, `coverage_end` — an ISO date, a year, or `"present"`).

## 2.5 Content model

`content` describes WHAT the source holds, never how it is reached:
`artifacts[]` ({kind, formats[], notes}) and `landing_pattern` — the explicit
hop count from a public URL to the artifact you actually want:

| Pattern | Meaning | Agent behavior |
|---|---|---|
| `direct` | the URL is the artifact | fetch it |
| `landing_then_file` | a landing page fronts the real file | follow the file link; do not extract the landing page |
| `landing_then_viewer` | landing opens an embedded viewer | find the underlying file URL |
| `search_then_record` | records reached through search/docket UI | drive the search interface |
| `portal_query` | a query portal builds the artifact | drive the portal (usually `web_render`) |

## 2.6 Access, verification rollup

`access[]` is the ordered list of access methods (§03), most preferred first.
The source-level `verification` block is a **rollup cache**: the worst state
among non-retired access methods, ordered
`broken > blocked > stale > asserted > degraded > verified`. Regen and
validate recompute it; a stored rollup that disagrees is `state_drift`.

## 2.7 Guidance

`guidance` is the block agents load to spend requests well: `best_for[]`
(tasks this source settles), `query_shapes[]` ({task, access, endpoint,
recipe, example} — what actually works against this source's retrieval
characteristics), `pitfalls[]` (what wastes round-trips), `llm_notes`.
Human-facing projections render guidance FIRST (§09) — it is the payoff of the
profile. Required at L2 (`guidance_missing`).

## 2.8 Lifecycle

`lifecycle.status` (active / dormant / archived / deprecated / defunct) and
`lifecycle.update_cadence` (realtime … static / unknown) are first-class and
required, with `cadence_notes` for what the enum cannot say and
`effective_date` for standards/statutes that take force on a date. Content
cadence is deliberately independent of access verification windows (§04.5):
a static archive is reachable daily but never updates.

## 2.9 Relations, discovery, stamps

`relations[]` are typed edges ({type, target, notes}); a target is an
in-registry `{source_id}` or an external `{name, url}` for sources not yet
profiled. `discovery` records how the source entered the registry
(`discovered_via`, verbatim `retrieved_via` query, `first_added`, `added_by`,
`import_ref` for corpus imports). Every profile carries a provenance stamp
(`schemas/provenance-stamp.schema.json`); `ext` and `aliases` follow the §0.7
extension contract.
