# ASR Phase 5 Handoff — Energy-Policy Taxonomy & Faceting

*Seed card for a future session. Companion to the original 27-section ASR
expansion handoff; picks up where 0.2.0 left off.*

## Context — where 0.2.0 left this

ASR **0.2.0 shipped** (commit `e930dd6`, pushed to `main`): the source-selection
& routing layer — `officiality`, `guidance.routing`/`resolution`, `coverage`,
`freshness`, `identity.operator`, `discovery.upstream[]`, the re3data import PoC,
five crosswalks, and the **energy registry expanded 10 → 30 sources**, all
green (selftest 80, import-test 18, conformance 43; energy/philosophy/naturalism
L1, examples L2).

Phase 5 was **deliberately deferred**, per the original handoff §16/§25: *"Expand
domain-local classification only after real profiles reveal which distinctions
are actually useful. Avoid designing a giant ontology in the abstract."* That
precondition is now met — **30 real energy profiles exist**, so Phase 5 can be
designed from evidence rather than speculation.

## The problem Phase 5 solves

The current classification is a **single-parent topic hierarchy**
(`registries/energy/topics.json`: kebab ids, one `parent` each). Building the
30 profiles forced orthogonal axes to be flattened into that one tree —
`legislation`, `regulation`, `utility-regulation` became sibling "topics";
`facility-data`/`research-data` stand in for sector. That conflation is the smell
Phase 5 removes.

**Goal (original handoff §16/§27):** an agent should answer questions like
*"best sources for California distributed-energy interconnection regulation?"* or
*"US data-center electricity market trends vs federal policy vs utility regulatory
filings?"* by **faceted query**, without knowing source names first.

## What the 30 profiles actually revealed (the evidence)

Design the facets from these observed distinctions, not the abstract list:

- **Governance domain is the most load-bearing axis.** The new sources cluster
  cleanly: legislative (Congress.gov, NCSL, Open States), regulatory
  (Regulations.gov, RegInfo, GovInfo), utility (NARUC, CPUC), judicial (climate
  litigation in CCLW/ECOLEX), and market-operator (RTO/ISO — not yet profiled).
  This is already leaking into `topics` + `source_role`.
- **Policy stage is real and consequential.** RegInfo is explicitly *planned*
  actions; GovInfo is *enacted/effective*; NCSL tracks *introduced/enacted/
  failed*. `coverage.policy_states` already carries these values ad hoc — they
  want a controlled facet, and the "planned ≠ effective" distinction is exactly
  what routing sends to a source of record.
- **Sector and instrument have no first-class home.** They surface in
  `coverage.sectors` (electricity/buildings/renewables/oil-gas/…) and implicitly
  in `source_role`/`authority.basis`, but nowhere queryable.
- **Discovery-vs-primary is already solved — do NOT re-encode it as a facet.**
  `guidance.routing` (`preferred`/`follow_primary`) captures it. Phase 5 must not
  duplicate it.

## The central design decision (the crux)

How to add multi-axis classification **without polluting the universal core**
(non-negotiable: energy vocabulary stays registry-local, out of
`vocab/vocab.json`):

- **Option A — registry-local facets (recommended to prototype).**
  `topics.json` (or a new `facets.json`) declares `facets: { <name>: [allowed
  values] }`. `source.scope` gains an optional generic `facets` map (`{ <name>:
  string[] }`), validated against the *registry's* declared facets — exactly how
  `scope.topics` is validated against `topics.json` today (`unknown_topic` →
  `unknown_facet_value`). The **universal schema change is tiny and domain-
  agnostic**: one optional `scope.facets` object + one validator rule. All energy
  *values* live in the energy registry. This satisfies "keep energy vocab out of
  universal core" and keeps the axes orthogonal (a source can carry sector AND
  instrument AND stage AND governance-domain simultaneously).
- **Option B — keep encoding facets as topics with naming conventions**
  (`sector:electricity`). Rejected: conflates orthogonal axes, breaks the single-
  parent tree, and gives the browser/query layer nothing structured to filter on.

**Recommendation:** prototype Option A; the core addition is as small and
backward-compatible as the 0.2.0 fields were.

## Proposed facet vocabularies (prune against real profiles — §16)

Starting points from the original handoff; **cut anything the 30 profiles + a
handful of target questions don't actually need** before committing them.

- **sector:** electricity, buildings, industry, transportation, fuels, oil-gas,
  renewables, nuclear, energy-storage, hydrogen, data-centers
- **policy_instrument:** statute, regulation, performance-standard, technology-
  standard, tax, subsidy, rebate, grant, trading-scheme, procurement, planning,
  market-design, rate-design, interconnection-rule, permitting, siting, research-
  development, demonstration, public-investment, information-disclosure
- **policy_stage:** proposed, introduced, adopted, enacted, effective,
  implemented, amended, repealed, expired, litigated
- **governance_domain:** legislative, regulatory, judicial, administrative,
  market-operator, utility, standards

## Implementation approach (staged — mirror the 0.2.0 discipline)

1. **Core first.** Add optional `scope.facets` to `schemas/source.schema.json`
   and a facet-declaration block to `schemas/topics.schema.json` (or a new
   `facets.schema.json`). Add validator rule `unknown_facet_value` (model it on
   the existing `unknown_topic` check in `authority.mjs`). Backward-compatible →
   `0.2.1` or `0.3.0`; keep facets optional so existing registries pass unchanged.
2. **Declare energy facets** in `registries/energy` (facets block in `topics.json`
   or a `facets.json`) — the pruned vocab above.
3. **Backfill the 30 profiles** from evidence already present: `coverage.sectors`
   → `facets.sector`; `coverage.policy_states` → `facets.policy_stage`;
   `source_role` + the topics I added → `facets.governance_domain`. Much of this
   is mechanical (a one-time builder like `build-energy-expansion.mjs`).
4. **Make it queryable.** Extend `export --format agent-card` to carry facets, and
   add facet filters to the `index.html` browser (`build-index.mjs`); consider an
   `authority query energy --facet governance_domain=utility --facet
   sector=electricity` command so the target questions resolve without source
   names.
5. **Reconcile topics vs facets.** Decide the boundary: keep `topics` as the
   coarse subject tree and demote the facet-ish entries I added
   (`legislation`/`regulation`/`utility-regulation`, `facility-data`/`research-
   data`) to facet values — or keep both and document which is which. Don't leave
   the same distinction living in two places.

## Files likely to change

- `schemas/source.schema.json` (optional `scope.facets`), `schemas/topics.schema.json`
  or new `schemas/facets.schema.json`
- `vocab/vocab.json` — **no energy values here**; at most a generic facet-name
  shape. Energy facet values stay registry-local.
- `skill/authoritative-sources/scripts/authority.mjs` (validator: `unknown_facet_value`,
  modeled on `unknown_topic`), `authority_cmds.mjs` (regen/export facet columns;
  optional `query` command), `build-index.mjs` (facet filters)
- `registries/energy/topics.json` or new `facets.json`, + backfill the 30
  `sources/*/source.json`
- `spec/` — extend the topics/taxonomy section; state that facets are registry-
  local; `spec/08` (new rule + error code), `spec/09` (facet projection/filters)
- `tests/selftest.mjs` + a `conformance/fixtures/unknown-facet-value` fixture;
  regen energy + examples

## Non-negotiable constraints (carried forward)

- **Energy vocabulary stays out of universal `vocab/vocab.json`** — facets are
  registry-local (this is why Option A wins).
- **Don't duplicate the discovery-vs-substantive routing distinction** — it lives
  in `guidance.routing`, not in a facet.
- **Backward-compatible:** facets optional; existing registries validate unchanged
  with only a version-stamp/schema-hash migration.
- **Don't design the ontology in the abstract** — prune the proposed vocab to what
  the 30 profiles + target questions actually exercise.
- **Keep the axes orthogonal** — a source carries sector(s) AND instrument(s) AND
  stage(s) AND governance-domain(s); never force one hierarchy.

## Success criterion (§27)

An agent resolves *"current policy landscape for data-center electricity use and
grid impacts in California and the United States"* into a defensible source path
by querying facets (`governance_domain`, `sector`, `jurisdiction`) + routing —
without pre-knowing source names — now backed by real facet data on 30 sources.

## Adjacent work still deferred (optional, from the original handoff)

- **Per-state energy office / PUC profiles** — NASEO/NARUC directories are the
  discovery seeds; use the spec/10 candidate flow (`_candidates/` → probe →
  adjudicate → promote).
- **RTO/ISO individual profiles** (CAISO, PJM, MISO, ERCOT, SPP, ISO-NE, NYISO) —
  distinct market data, tariffs, interconnection queues, planning studies.
- **Industry/standards bodies batch** (ASHRAE, IEEE, NFPA, UL, ANSI, NEMA, EEI,
  SEIA, ACP, EPRI, Open Compute Project) — domain-specific routing (technical-
  standard authority ≠ policy-effect authority).
- **FAIRsharing importer** — adapter is documented (`crosswalks/fairsharing.md`);
  needs a credentialed fetch path (re3data is the open reference PoC).
