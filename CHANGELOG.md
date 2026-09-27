# Changelog

All notable changes to the ASR standard are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
standard adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Optional credentials** (spec/03.2): `auth.required: false` with a secret
  scheme and `credential_ref` means the key is optional. `authority fetch`
  sends it when it resolves and fetches keyless otherwise, redacted from the
  record as before. First use: OpenAlex `api_key` (scholarly registry).

### Fixed

- Registry contact address: `eorwyn@ucdavis.edu` (was typed `eorywn@`).

## [0.3.0] — 2026-08-20

Backward-compatible minor revision: **registry-local facets** turn the flat
topic tree into multi-axis, queryable classification. The universal core grows
by exactly one optional field (`scope.facets`) and one conditional conformance
rule; all energy facet *values* stay registry-local. Registries with no
`facets.json` validate unchanged (version stamp + schema hash only).

### Added

- **Facets** (`scope.facets`, `facets.json`, `schemas/facets.schema.json`,
  `sections.facets`): a profile carries independent classification axes
  (governance domain, sector, policy stage) as `{axis: [values]}`, validated
  against the registry's hand-authored facet vocabulary. Orthogonal to topics
  (a single-parent tree) and to `source_role`/`officiality`.
- **Conformance rule 0.8** (`facets_invalid`, `unknown_facet_value`; L0,
  conditional): fires only when a profile carries `scope.facets`.
- **`authority query`**: faceted source selection —
  `--facet name=value` (AND across axes, OR within), `--topic`, `--region`
  (subnational reaches national), `--task` (ranks by routing disposition) —
  resolving *which sources settle a question* without knowing their names.
- **agent-card** projection now carries `facets` (envelope `schemaVersion` → 2);
  the HTML browser gains one filter dropdown per declared facet axis.

### Changed

- **Energy registry** migrated to the clean end-state: the facet-ish topics
  `legislation`/`regulation`/`utility-regulation`/`facility-data`/`research-data`
  were removed from `topics.json` and demoted to `governance_domain` facet
  values; all 30 sources backfilled with `governance_domain`. `sector` is
  carried by the 12 sources with a genuine sector focus (seeded by the migrated
  `coverage.sectors`, extended to the utility/regulatory/standards/research
  bodies whose sector is unambiguous — e.g. CPUC electricity+gas, CEC
  electricity/buildings/transportation/renewables); sector-agnostic sources omit
  it. `policy_stage` is carried where evidenced.

### Removed

- **`coverage.policy_states` / `coverage.sectors`** (the 0.2.0 free-string
  facets): promoted to declared `scope.facets` axes. Existing values migrated;
  the fields are gone from the schema and spec §2.10.

## [0.2.0] — 2026-08-18

Backward-compatible minor revision: ASR grows from a curated authoritative-
source registry into a machine-readable **source-selection and retrieval-
routing layer**. Every addition is optional; all 0.1.0 registries validate
unchanged and migrate deterministically (version stamp + schema hash only).
New conformance rules are conditional — each fires only when its new field is
present, so a conformant 0.1.0 registry stays conformant.

### Added

- **Officiality** (`officiality`, plus per-artifact `content.artifacts[].officiality`):
  institutional status of material, kept distinct from evidential class and from
  authority — officiality never sets tier (official is not true).
- **Routing** (`guidance.routing`, `guidance.resolution`): per-task dispositions
  (`preferred`/`acceptable`/`conditional`/`follow_primary`/`avoid`/`not_applicable`)
  so authority-to-discover is expressible separately from authority-to-establish.
- **Coverage** (`coverage`): completeness claim + basis, jurisdictions, temporal
  range, and registry-local policy/sector facets — absence-as-evidence made explicit.
- **Freshness** (`freshness`): three independent clocks (profile review, content
  currency) separate from access verification; content freshness is never derived
  from a probe.
- **Structured organization identity** (`identity.operator`, with ROR/Wikidata),
  alongside the retained free-text `publisher`.
- **Upstream federation provenance** (`discovery.upstream`): where a profile was
  imported/enriched from, without upgrading imported claims to verified or
  adjudicated.
- **OpenAPI / DCAT seam** (`access[].openapi`): a machine-readable API description
  reference that never counts as operational verification.
- New extensible vocabularies (`officiality`, `routing_disposition`, `completeness`,
  `completeness_basis`, `content_freshness_basis`, `resolution_strategy`,
  `upstream_registry`) and eight new `relation_type` edges (`indexes`,
  `operated_by`, `official_source_for`, `discovery_for`, `resolves_to`,
  `publishes`, `catalogs`, `derived_from_registry`).
- Conformance rules **1.12** (coverage basis) and **1.13** (follow_primary
  resolution), plus advisories `adjudication_by_import`,
  `coverage_assessment_unsupported`, `external_id_shape`. Fixtures gain an
  `expect_warnings` assertion for conditional warning-level rules.
- `authority export --format agent-card`: a token-frugal routing projection.
- `authority import <registry> re3data …`: a federation proof-of-concept
  (new `authority_import.mjs`) that retains upstream provenance and manufactures
  no verification or adjudication; imports land as staged candidates.
- Crosswalks: `crosswalks/dcat.md`, `openapi.md`, `fairsharing.md`, `re3data.md`,
  `ror.md`. New spec section `spec/10-federation-and-import.md`.
- Human/agent projections reordered (spec/09.2) to surface officiality, routing,
  coverage, freshness, and upstream provenance first.

## [0.1.0] — 2026-08-17

Initial release of the Authoritative Source Registry standard.

### Added

- The hard promise: **every access claim is backed by stored evidence, or it
  says so** — verification states are recomputable from hashed probe artifacts.
- Object model: `REGISTRY → SOURCE → ACCESS METHOD → ENDPOINT`, with `PROBE`
  evidence records and `FETCH` exercise records.
- Normative specification `spec/00`–`09` plus appendix ADRs (credential-chain
  choice; evidence tracked vs payloads gitignored; `asc-` vs UPC `src-`
  identity).
- `vocab/vocab.json` — controlled vocabularies with `x-` escape hatches.
- JSON Schemas (2020-12) for registry, topics, source (with access-method and
  endpoint `$defs`), probe, fetch record, and the provenance stamp.
- Conformance levels **L0 Browsable / L1 Verified / L2 Operational**, a
  numbered rule registry with stable error codes, and per-rule fixtures.
- Zero-dependency reference CLI (`authority.mjs`, Node ≥ 18): `init`, `add`,
  `validate`, `probe`, `fetch`, `creds`, `regen`, `export`, `build-index`,
  `mint`.
- Credential resolution chain: `AUTHORITY_CRED_<REF>` / `FORGE_API_KEY_<REF>`
  environment variables → gitignored `credentials.json` → macOS Keychain.
- Crosswalks: UPC (fetch sidecar ⇄ `source.retrieval`) and pi-forge
  (canonical-sources / domain-strategies / provider-stub exports, credential
  mapping, pi package seam).
- Seed registries: `registries/energy`, `registries/philosophy`,
  `registries/naturalism` (23 profiles chosen to exercise every access
  pattern), plus a fictional example registry regenerated deterministically.
- Skill packaging: `skill/authoritative-sources/` (SKILL.md, manifest.json,
  references, scripts).
