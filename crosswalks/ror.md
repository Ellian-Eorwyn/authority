# Crosswalk: ASR ⇄ ROR

ROR (the Research Organization Registry) is an open registry of persistent
identifiers for research organizations. A ROR id looks like
`https://ror.org/01bj3aw27` — the bare 9-character form (`01bj3aw27`) always
starts with `0`. ASR uses ROR in exactly one place: `identity.operator.
identifiers.ror`, the machine identity of the **organization that operates a
source**. The distinction is the whole point of the field: the *operator* is the
ORGANIZATION; the *source/service* is what it OPERATES. The U.S. Department of
Energy (one ROR org) operates EIA, OSTI, and Energy.gov (three distinct ASR
sources) — the org gets one ROR id, each service gets its own profile.

`ror` is **optional and often absent.** Many regulators, standards bodies, trade
associations, and commercial services have no ROR record because ROR scopes to
research organizations. A profile with no `identity.operator` at all is fully
conforming; `publisher` free text carries the operator name when structured
identity is not warranted.

## Field-by-field

| ROR record | ASR | Notes |
|---|---|---|
| `id` (`https://ror.org/01bj3aw27`) | `identity.operator.identifiers.ror` | store the full URL or the bare `0…` form; both are accepted |
| `name` | `identity.operator.name` | the ORGANIZATION's name, not the source's `identity.name` |
| `aliases` / `acronyms` | `identity.operator` (additive) / `notes` | no dedicated core field; keep for search, not identity |
| `links[]` (org homepage) | *(not `identity.homepage_url`)* | the org's site is **not** the source's `canonical_url` — a service's front door is profiled on the source, the org's on `operator` context |
| `types[]` (Government, Facility, Education, Company, …) | `authority.asserted.basis[]` (triage hint) | e.g. Government → `government_agency`, Facility of a lab → `national_lab`; a hint only, never sets `adjudicated` |
| `relationships[]` (parent / child / related) | `relations[]` (`part_of`, `operated_by`) | ROR's org graph becomes ASR's typed edges when both ends are profiled |
| `external_ids.Wikidata` | `identity.operator.identifiers.wikidata` | a Wikidata QID, e.g. `Q217810` |
| `external_ids` (GRID, ISNI, FundRef) | `identity.operator.identifiers.other[]` | as `"scheme:id"` strings, e.g. `"isni:0000000121581551"`, `"grid:grid.94225.38"` |

The core mapping is deliberately narrow: ASR takes the org's stable **identity**
(`ror`, `wikidata`, `other[]`, `name`) and leaves ROR's fuller organizational
metadata in ROR, pointed at by the id.

### Worked example — one org, many services

The U.S. Department of Energy has a single ROR record; the sources it operates
each carry it as their `operator`, sharing one canonical org identity:

```json
"identity": {
  "name": "OSTI.GOV",
  "operator": {
    "name": "U.S. Department of Energy",
    "identifiers": {
      "ror": "https://ror.org/01bj3aw27",
      "wikidata": "Q217810",
      "other": ["isni:0000000121581551"]
    }
  }
}
```

EIA and Energy.gov are separate profiles with their own `identity.name`,
`content`, and `access[]`, but the same `operator` block — the ROR id is the
join key, not a copy of each service's identity.

## Validation: shape-checked, never required

The validator's `external_id_shape` advisory (spec/08) checks that a present
`ror` (or `wikidata`) id is well-formed — a ROR id must match the `0…` 9-char
pattern — but it **never requires** the field. External-service identifiers are
never mandatory for conformance; a missing or absent `identity.operator` draws no
finding. This keeps ASR honest about the long tail of sources that ROR simply
does not cover.

## Linking a service to its operating org

When both an operating organization and a service it runs are profiled in a
registry, connect them with typed edges rather than duplicating identity:

- **`operated_by`** — from the profiled *service* to the profiled *organization*
  (`{type: "operated_by", target: {source_id: …}}`). This is the in-registry
  form of the ORGANIZATION-operates-SOURCE relation that `identity.operator`
  expresses inline. Use the relation when the org itself has a profile; use the
  inline `operator` block when it does not.
- **`derived_from_registry`** — from a profile to the upstream registry record it
  was federated from, the edge companion to `discovery.upstream[]`. When an
  operator's ROR identity arrives via a re3data or FAIRsharing import
  (crosswalks/re3data.md), this edge records that the identity is upstream-derived,
  not locally authored.

## What ASR adds beyond ROR

ROR answers "which organization is this, canonically?" — and nothing more. It has
no concept of the service an org operates, whether that service is reachable, or
whether to trust it. ASR uses the ROR id as a stable anchor for `identity.
operator` and builds the operational and epistemic layers on top: `access[]` and
its probe-derived `verification.state` (spec/04), `authority.adjudicated` (human
judgment, quarantined from machine `asserted`), and `guidance.routing` for
per-task use. A ROR id says *who* runs a source; ASR says *what it holds, whether
it works, and how much to trust it.*

ASR specializes in the layer ROR lacks: the operator-to-service edge, evidence-backed
verification, adjudicated authority, and per-task routing — with the org's
canonical identity anchored by the ROR id rather than reinvented.
