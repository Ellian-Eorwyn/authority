# Crosswalk: ASR ⇄ FAIRsharing

FAIRsharing is a curated meta-registry of databases, standards, and data
policies for the research world. Its records describe *that a resource exists
and what domain it serves* — rich descriptive metadata, no operational or
evidential layer. ASR imports a FAIRsharing record as a **candidate source
profile**: `identity`, `content`, `scope`, and a first `access[]` sketch are
seeded from the record, and everything ASR is actually *for* — probe evidence,
adjudicated authority — is left explicitly empty for a human or a probe to
fill. A FAIRsharing record is a legitimate `discovery.upstream.registry` value
(`fairsharing`) to import *from*.

## The import invariant (read this first)

Importing a record is **copying descriptive claims, not establishing them.**
An imported profile therefore lands in a deliberately humble state (spec/10):

- **Every `access[].verification.state` is `asserted`, never `verified`.** The
  hard promise (spec/04) is unchanged by import: only a stored `ok` probe
  record moves a method to `verified`. A FAIRsharing "data access: open" note
  is a claim; ASR records it as `asserted` — an honest "not actually tried."
- **`authority.adjudicated` stays `null`.** Import may write `authority.asserted`
  (machine triage from the record's domain and type), but adjudication is a
  human or explicitly-attributed pass. The validator's `adjudication_by_import`
  advisory (spec/08, rule 1.10) fires if an imported profile ships a non-null
  adjudication — import judgment must not masquerade as human judgment.
- **`provenance.produced_by.method = "import"`.** The stamp says a machine
  adapter produced this, not a human.
- **`discovery.upstream[]` records where it came from**, so the provenance of
  every inherited field is auditable.

## Field-by-field

| FAIRsharing record | ASR | Notes |
|---|---|---|
| record id (`FAIRsharing.abc123`) | `discovery.upstream[0].record_id` | the stable upstream key; never becomes the ASR `source_id` (that is content-addressed from `canonical_url`, §06) |
| `name` | `identity.name` | the source's common name; the slug is derived from it |
| homepage / URL | `identity.homepage_url` → `identity.canonical_url` | canonical form via the §06 URL algorithm feeds the id |
| `description` | `identity.description` | descriptive prose, copied verbatim |
| record DOI (`10.25504/FAIRsharing.…`) | `discovery.upstream[0].record_url` | a persistent handle for the FAIRsharing *record*, not the source's operator — do not put it in `identity.operator.identifiers` |
| subjects / domains | `scope.topics` (mapped) + `coverage.sectors` | topics MUST exist in the registry's `topics.json`; unmapped ones are listed in-band, never silently dropped |
| supported standards | `content.artifacts[].notes` / `relations[]` | a `companion_of` or `catalogs` edge when the standard is itself profiled |
| data-access / licence | `access[].auth` + `access[].robots` + `access[].notes` | "open/restricted/closed" seeds `auth.required`; licence text is metadata, not a core field |
| resource type (database, repository, …) | `source_role` + `content.artifacts[].kind` | triage only; a human confirms structural role |

`inherited_fields[]` for a FAIRsharing import is typically
`["identity.name", "identity.homepage_url", "identity.description",
"scope.topics", "content.artifacts"]` — the exact ASR paths whose values were
taken from the record, so a later reviewer sees which fields are upstream-derived
and which are locally authored.

### The `discovery.upstream[0]` stamp

```json
{
  "registry": "fairsharing",
  "record_id": "FAIRsharing.abc123",
  "record_url": "https://fairsharing.org/FAIRsharing.abc123",
  "retrieved_at": "2026-08-18T00:00:00Z",
  "upstream_updated_at": "2026-06-01T00:00:00Z",
  "mapping_version": "fairsharing-asr@1",
  "inherited_fields": ["identity.name", "identity.homepage_url",
                       "identity.description", "scope.topics",
                       "content.artifacts"]
}
```

## What ASR adds beyond FAIRsharing

FAIRsharing can say a database exists, serves a domain, and claims open access.
It cannot say any of the following — and these are why ASR exists:

- **Whether access works.** `access[].verification.state` is derived from probe
  evidence (spec/04), never from a description. FAIRsharing's access field is a
  claim; ASR's probe gate is the evidence.
- **Adjudicated authority.** `authority.asserted` (machine triage) is quarantined
  from `authority.adjudicated` (human judgment, null until scored). FAIRsharing
  has no trust model.
- **Executable recipes.** `access[].endpoints[]` `{path_template, params[]}` carry
  what an agent or `authority fetch` needs to *call* the source; FAIRsharing stops
  at the descriptive record.
- **Coverage completeness.** `coverage.completeness` `{claim, basis}` makes
  absence-as-evidence explicit — a dimension a descriptive registry lacks.
- **Routing and pitfalls.** `guidance.routing` and `guidance.pitfalls[]` say how
  an agent should *use* the source per task.

## Why FAIRsharing is a documented adapter, not the reference importer

FAIRsharing's API is login- and token-gated: retrieving records at scale
requires an account and a bearer token. ASR therefore ships `fairsharing-asr@1`
as a **documented crosswalk** — the mapping is authoritative and an operator with
credentials can run it against exported records — but the *reference* importer
proof-of-concept is re3data (crosswalks/re3data.md), whose REST API is open and
needs no credential wall. The mapping shape is identical; only the fetch path
differs.

ASR specializes in the layer FAIRsharing lacks: evidence-backed verification,
adjudicated authority, executable access, and the epistemic distinction between
an imported claim and a locally established one.
