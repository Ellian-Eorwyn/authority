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

`identity.operator` is the optional **structured** form of the operating
organization — `{name, identifiers{ror, wikidata, other[]}}` — distinguishing
the ORGANIZATION (which operates) from the SOURCE/SERVICE (which is operated).
Use ROR ids for research organizations where they map; many regulators,
standards bodies, and commercial services will not, and `operator` stays
optional (the free-text `publisher` is untouched). When both an org and a
service it runs are profiled, link them with an `operated_by` relation. The
validator checks the `ror`/`wikidata` id shapes when present (advisory
`external_id_shape`) but never requires them.

A source whose canonical URL changes (domain move) is a **new source**; relate
the two with `supersedes` / `superseded_by`. Ids are stable or they are
worthless.

## 2.2 Role, class, and officiality

`source_role` says what the source *is structurally* (publisher, aggregator,
index, repository, archive, mirror, community). `source_class` says its
*evidential distance* (primary, secondary, tertiary). The two are orthogonal:
a state agency (publisher) is usually primary; a well-run database of pointers
(aggregator) is usually tertiary — and its profile SHOULD carry `relations:
aggregates` edges plus guidance telling agents to follow entries to the
underlying primaries rather than citing the aggregator itself.

`officiality` is a third, independent axis: the **institutional status** of the
source's material. `officiality.default` takes a value from
`vocab.json#/$defs/officiality` — `source_of_record` (the legally operative or
definitive edition), `official_service` (a service the issuing institution
operates), `official_representation` (an institution's convenience rendering of
material whose authoritative edition lives elsewhere), `official_mirror`,
`curated_secondary`, `discovery_aggregator`, `unofficial`, `mixed`, or
`unknown`. Where one service carries material of differing status — a government
site with legally operative PDFs *and* convenience HTML *and* press releases —
set `default` to `mixed` and record per-artifact officiality on
`content.artifacts[].officiality`. **Officiality records provenance, not
correctness, and MUST NOT set the authority tier**: official is not the same as
true, and a conforming tool never infers a tier from officiality.

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

`scope.facets` is an optional, registry-local, **multi-axis** classification: a
map of facet-axis id → value ids, e.g. `{"governance_domain": ["utility"],
"sector": ["electricity"]}`. Where `topics` is a single-parent subject tree,
facets are independent axes a source carries simultaneously — governance domain,
sector, and policy stage at once — so an agent can select sources by faceted
query without knowing their names (§09). Every axis id and value a profile uses
MUST be declared in the registry's `facets.json` (§01.5; `unknown_facet_value`
otherwise). Facet vocabularies are registry-local and never enter the universal
core: energy axes and mycology axes do not share one list. `scope.facets`
supersedes the 0.2.0 free-string `coverage.policy_states` / `coverage.sectors`.

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

`guidance.routing` records, per task, *how to use* the source — the routing
model that keeps discovery authority distinct from substantive authority. Keys
are task names (`discovery`, `citation`, `legal_status`, `quantitative_claims`,
`technical_claims` are conventional; any task key is allowed), each mapping to a
`routing_disposition`: `preferred`, `acceptable`, `conditional`,
`follow_primary`, `avoid`, or `not_applicable`. A `follow_primary` disposition
means *search here to locate the material, then resolve to the source of record
before making the claim*; it MUST be backed by `guidance.resolution`
(`{strategy, notes}`, `strategy` from `resolution_strategy` — e.g.
`originating_authority`) or by a `resolves_to` / `official_source_for` relation
that names the primary (rule 1.13, `routing_primary_unresolved`). This lets a
registry say "search this database first, but do not cite it as the final
authority" without ambiguity.

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
`import_ref` for corpus imports). For profiles federated from an external
catalog, `discovery.upstream[]` records each upstream record — `{registry,
record_id, record_url, retrieved_at, upstream_updated_at, mapping_version,
inherited_fields[]}` — and `discovered_via` is conventionally
`"registry_import"`; an imported claim is never a locally verified or
adjudicated claim (§10). Every profile carries a provenance stamp
(`schemas/provenance-stamp.schema.json`); `ext` and `aliases` follow the §0.7
extension contract.

## 2.10 Coverage

`coverage` records how much of a domain the source spans and how completely —
load-bearing for policy, legal, and legislative databases, where **absence from
a comprehensive source is itself evidence** and absence from a selective one is
not. `coverage.completeness` is a claim (`exhaustive`, `systematic`,
`selective`, `opportunistic`, `unknown`) paired with a `basis`
(`provider_asserted`, `independently_assessed`, `inferred`, `unknown`) — the two
are kept apart because a provider's completeness claim is not independently
established. A claim of `exhaustive`/`systematic` MUST state a basis (rule 1.12,
`coverage_basis_missing`); a basis of `independently_assessed` SHOULD carry
supporting notes. `coverage` also carries `jurisdictions[]`,
`jurisdiction_levels[]`, and a `temporal` range. (The 0.2.0 free-string
`policy_states[]` / `sectors[]` facets that lived here were promoted in 0.3.0 to
declared, queryable `scope.facets` axes — §2.4, §01.5.)

## 2.11 Freshness

`freshness` separates three questions the access-verification window (§04) must
not be overloaded with:

- **Profile freshness** — `profile_reviewed_at`, `profile_reviewed_by`,
  `review_interval_days`: when a human last checked whether the source's
  organization, interfaces, or scope changed.
- **Content freshness** — `content_last_checked_at`, `content_current_through`,
  `content_freshness_basis`: whether the source is maintaining the information it
  claims to hold. `content_current_through` is **never** derived from a
  successful probe — a working API can serve stale data, and a static archive can
  be perfectly current for its intended scope. `content_freshness_basis`
  (`provider_metadata`, `provider_asserted`, `independently_verified`,
  `inferred`, `unknown`) records how the currency was determined.

Access freshness — does the endpoint still work — remains the province of probes
and the verification state machine (§04); these three clocks tick independently.
