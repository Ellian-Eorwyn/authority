# ASR 08 — Conformance

Conformance is defined by this rule registry, not by the reference code: an
independent implementation can self-test against `tests/conformance/`
fixtures without ever running this repository's validator. Levels are
cumulative and **computed from rules passed**, never from object counts.

- **L0 Browsable** — the registry parses, resolves, and travels: a tool can
  read it.
- **L1 Verified** — identity and the hard promise hold: ids recompute, refs
  resolve, **no access claim overstates its evidence**, no secrets in tracked
  files. L1 is the level at which *the registry never lies about what works*.
- **L2 Operational** — the registry is exercised and agent-ready: recipes
  have been run for real, guidance and lifecycle are complete.

## 8.1 Rule registry

Severity E = error (blocks the level), W = warning (advisory, never blocks
except under `--strict`).

Rules tagged *(0.2.0, conditional)* were added in the 0.2.0 minor revision;
each inspects a field that did not exist in 0.1.0 and fires only when that
field is present, so every conformant 0.1.0 registry stays conformant
unchanged.

### L0 Browsable

| # | Rule | Code(s) | Sev |
|---|---|---|---|
| 0.1 | `registry.json` exists, parses, validates, carries `asr_spec_version` | `load_error`, `schema_invalid`, `spec_version_missing` | E |
| 0.2 | every indexed source has a parseable, schema-valid `source.json`; every `source.json` on disk is indexed | `missing_source_json`, `manifest_source_unlisted` | E |
| 0.3 | every referenced path resolves inside the registry root, through no escaping symlink | `path_escape`, `symlink_escape` | E |
| 0.4 | filenames are portable (§01.1) | `filename_illegal` | E |
| 0.5 | journals are well-formed JSONL (torn final line tolerated) | `jsonl_invalid` E, `jsonl_torn_tail` W | E/W |
| 0.6 | every source declares ≥ 1 access method with `type` + `base_url` | `missing_access` | E |
| 0.7 | `topics.json` exists and validates; every profile topic exists in it | `topics_invalid`, `unknown_topic` | E |

### L1 Verified

| # | Rule | Code(s) | Sev |
|---|---|---|---|
| 1.1 | every content-addressed id recomputes from its recipe (§06); no duplicates, no malformed ids | `id_format`, `id_mismatch`, `id_duplicate` | E |
| 1.2 | every profile-side reference resolves: relations to in-registry ids, `last_probe_id` to a probe record. (Journal-side references to superseded access/endpoint ids are history, not lies — the advisory `orphaned_record`, §6.6.) | `dangling_relation`, `dangling_probe` | E |
| 1.3 | **a `verified` state has a matching `ok` probe record** — the hard promise | `unverified_claim` | E |
| 1.4 | probe records are schema-valid; every probe evidence file exists and its stored bytes hash-match | `schema_invalid`, `probe_evidence_missing`, `probe_evidence_hash_mismatch` | E |
| 1.5 | a `verified` state is within its staleness window; lapsed MUST read `stale` | `stale_verification` | E |
| 1.6 | `broken`/`blocked` states carry the failing probe reference | `state_without_evidence` | E |
| 1.7 | no secret values in tracked files: profiles, examples file, journals, evidence all scan clean; `credentials.json` untracked; refs well-formed | `credential_in_profile`, `credential_file_unignored`, `credential_ref_invalid` | E |
| 1.8 | every auth-required method declares `scheme` + `credential_ref` (+ `location` for api_key schemes) | `auth_underspecified` | E |
| 1.9 | robots posture recorded for every method where robots applies, with captured robots.txt evidence behind it | `robots_unrecorded`, `robots_evidence_missing` | E |
| 1.10 | non-null adjudication carries `scored_by` + `scored_at`; adjudication on a model-written or imported profile draws a warning (machine or import judgment must not masquerade as human adjudication) | `adjudication_unattributed` E, `adjudication_by_machine` W, `adjudication_by_import` W | E/W |
| 1.11 | every profile and manifest carries a provenance stamp | `missing_provenance` | E |
| 1.12 | *(0.2.0, conditional)* when `coverage.completeness.claim` is `exhaustive`/`systematic` it states a `basis`; a basis of `independently_assessed` carries supporting notes (absence-as-evidence must be grounded) | `coverage_basis_missing` E, `coverage_assessment_unsupported` W | E/W |
| 1.13 | *(0.2.0, conditional)* when `guidance.routing` sets a task to `follow_primary`, the primary is identified — via `guidance.resolution` or a `resolves_to`/`official_source_for` relation | `routing_primary_unresolved` | E |

### L2 Operational

| # | Rule | Code(s) | Sev |
|---|---|---|---|
| 2.1 | every non-retired `api_*`/`oai_pmh`/`feed` method has ≥ 1 endpoint with a successful fetch record — L2 means the recipes demonstrably work, so an `asserted` API blocks L2 exactly as an unexercised verified one does | `endpoint_unexercised` | E |
| 2.2 | fetch records are schema-valid with complete retrieval blocks; a missing payload file is advisory (payloads are cleanable) | `fetch_record_invalid` E, `fetch_payload_missing` W | E/W |
| 2.3 | guidance present: `best_for` non-empty plus ≥ 1 query shape or pitfall | `guidance_missing` | E |
| 2.4 | lifecycle declared: `status` + `update_cadence` | `lifecycle_missing` | E |
| 2.5 | no access method remains `asserted` without an explanatory note (a waiver, e.g. "keyless probe impossible; awaiting credential") | `asserted_remaining` | W |

### Level-independent advisories

| Code | Meaning |
|---|---|
| `csv_stale` | `sources.csv` disagrees with the profiles (regen repairs) |
| `counts_mismatch` | manifest counts/index disagree with objects (regen repairs) |
| `state_drift` | a stored verification state ≠ derivation from probes + clock (regen repairs) |
| `orphaned_record` | a probe/fetch record references a superseded access/endpoint id — retained history after a transport change (§6.6) |
| `unknown_field` | unrecognized top-level member (E under `--strict`) |
| `x_extension` | an `x-` vocabulary value in use |
| `alias_collision` | one alias value maps to two objects |
| `sample_hash_mismatch` | a tracked sample's bytes disagree with the NEWEST fetch record referencing it (samples are newest-wins, §07.4; older records' sample blocks are history) (E under `--strict`) |
| `external_id_shape` | an `identity.operator` `ror`/`wikidata` identifier is malformed (0.2.0; external identifiers are never mandatory for conformance) |

## 8.2 The report

`authority validate` prints one bounded JSON report:

```json
{
  "status": "error | warning | ok",
  "registry": "<registry_id>",
  "asr_spec_version": "0.2.0",
  "level": "none | L0 | L1 | L2",
  "operational_here": false,
  "counts": { "sources": 0, "access_methods": 0, "endpoints": 0, "probes": 0, "fetches": 0 },
  "errors":   [ { "code": "unverified_claim", "level": "L1", "object": "asc-…/api",
                  "detail": "state verified but last probe …", "hint": "run: authority probe <registry> <slug> --access api" } ],
  "warnings": [ { "code": "asserted_remaining", "level": "L2", "object": "…", "detail": "…" } ]
}
```

`level` is the highest level whose rules all pass, computed from the full
finding set. Exit is governed by a **target level** (`--level`, default
**L1** — the promise level is the bar every registry should hold): rule
failures *above* the target are reported as warnings (tagged
`above_target`) so a deliberately-L1 registry validates clean while still
showing its distance to L2; `--level L2` raises the bar for registries that
claim operability. Findings carry repair hints wherever a mechanical repair
exists (`regen`, a `probe` invocation). Exit codes: `0` no errors at or
below target, `1` errors found, `2` the validator itself failed. `--strict`
promotes the marked warnings to errors.

## 8.3 Fixtures

`tests/conformance/fixtures/` ships one minimal registry per error code,
named by the code, plus `pass-l0`, `pass-l1`, `pass-l2` positive controls.
Each carries `expected.json`:
`{"fixture": "<name>", "expect": ["<code>", …]}` (empty array = must pass
clean at the fixture's declared level). An optional `expect_warnings` array
asserts advisory warning codes, for conditional rules whose violation is a
warning rather than an error. Fixtures are built by a committed deterministic
script — every id and every evidence hash in them is real
(`tool.method: "fixture"`), because fixtures must never lie.

## 8.4 `operational_here`

Alongside the level, the validator reports `operational_here`: whether every
`credential_ref` the registry mentions resolves **on this machine** (§05).
It is deliberately not part of any level — a registry is not less conformant
because this laptop lacks a key — but agents should check it before planning
fetches.
