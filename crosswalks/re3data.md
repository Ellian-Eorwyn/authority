# Crosswalk: ASR ⇄ re3data

re3data (the Registry of Research Data Repositories) is a curated meta-registry
of research data repositories, describing *that a repository exists, who runs
it, and how its data may be accessed* — descriptive metadata, no evidential or
routing layer. ASR imports a re3data record as a **candidate source profile**.
Crucially, re3data exposes an **open REST API** at
`https://www.re3data.org/api/v1` — a list endpoint plus per-repository metadata
keyed by the re3data `orgIdentifier` — with no credential wall. That openness is
why re3data, not FAIRsharing, is ASR's **reference importer proof-of-concept**:

```
authority import <registry> re3data <id|--from file.json> [--live]
```

`--live` fetches the record straight from the open API; `--from` maps a
previously saved response. A re3data catalog is a legitimate
`discovery.upstream.registry` value (`re3data`) to import *from*.

## The import invariant (read this first)

Importing a record is **copying descriptive claims, not establishing them.**
An imported profile lands in a deliberately humble state (spec/10):

- **Every `access[].verification.state` is `asserted`, never `verified`.** Only a
  stored `ok` probe record (spec/04) moves a method to `verified`. A re3data
  `dataAccess: open` note is a claim; ASR records it as `asserted` — an honest
  "not actually tried."
- **`authority.adjudicated` stays `null`.** Import may write `authority.asserted`
  (machine triage), but adjudication is a human or explicitly-attributed pass.
  The `adjudication_by_import` advisory (spec/08, rule 1.10) fires if an imported
  profile ships a non-null adjudication.
- **`provenance.produced_by.method = "import"`.** A machine adapter produced this,
  not a human.
- **`discovery.upstream[]` records where it came from**, making every inherited
  field auditable.

## Field-by-field

| re3data metadata | ASR | Notes |
|---|---|---|
| `orgIdentifier` (`r3d100010218`) | `discovery.upstream[0].record_id` | the stable upstream key; never the ASR `source_id` (content-addressed from `canonical_url`, §06) |
| `repositoryName` | `identity.name` | the source's common name; the slug derives from it |
| `repositoryURL` | `identity.homepage_url` → `identity.canonical_url` | canonical form via the §06 URL algorithm feeds the id |
| `description` | `identity.description` | descriptive prose, copied verbatim |
| `subject[]` (DFG subject scheme) | `scope.topics` (mapped) + `coverage.sectors` | topics MUST exist in `topics.json`; unmapped ones are listed in-band |
| `dataAccess` `{type, restrictions}` | `access[].auth.required` + `access[].robots` + `access[].notes` | `open`/`restricted`/`closed` seeds `auth.required`; restriction text is metadata |
| `api[]` `{api, apiType}` | `access[]` `{base_url, type}` | one `access[]` method per API; `apiType` maps to `access.type` (below) |
| `institution[]` `{institutionName, …}` | `identity.operator.name` + `relations[]` (`operated_by`) | the ORGANIZATION that runs the repository, distinct from the source |
| institution identifiers (ROR, other) | `identity.operator.identifiers.ror` / `.other[]` | ROR ids land in `.ror`; others as `"scheme:id"` strings (crosswalks/ror.md) |

`apiType` → `access[].type`: `OAI-PMH` → `oai_pmh`, `REST` → `api_rest`,
`SPARQL` → `api_graphql` (nearest peer), `FTP` → `ftp`, and a plain download URL
→ `bulk_download`. `inherited_fields[]` for a re3data import is typically
`["identity.name", "identity.homepage_url", "identity.description",
"identity.operator", "scope.topics", "content.artifacts", "access"]`.

### The `discovery.upstream[0]` stamp

```json
{
  "registry": "re3data",
  "record_id": "r3d100010218",
  "record_url": "https://www.re3data.org/repository/r3d100010218",
  "retrieved_at": "2026-08-18T00:00:00Z",
  "upstream_updated_at": "2026-05-20T00:00:00Z",
  "mapping_version": "re3data-asr@1",
  "inherited_fields": ["identity.name", "identity.operator", "scope.topics",
                       "content.artifacts", "access"]
}
```

## Operator identity from `institution[]`

re3data records the operating institution and often a machine identifier for it.
That maps to the ASR ORGANIZATION/SOURCE split: the institution is the
`identity.operator`, the repository is the source it operates. When the
institution carries a ROR id, it lands in `identity.operator.identifiers.ror`;
the validator checks its shape (`external_id_shape`, spec/08) but never requires
it. Link a separately profiled operating org to the imported service with an
`operated_by` relation (crosswalks/ror.md).

## What ASR adds beyond re3data

re3data can say a repository exists, who runs it, and that it exposes an OAI-PMH
endpoint. It cannot say:

- **Whether the endpoint works today.** `access[].verification.state` is derived
  from probe evidence (spec/04); an imported `api[]` entry is `asserted` until an
  OAI-PMH `Identify` probe backs it.
- **Adjudicated authority.** `authority.asserted` is quarantined from
  `authority.adjudicated` (null until a human scores it). re3data has no trust
  model.
- **Executable recipes.** `access[].endpoints[]` `{path_template, params[],
  pagination}` carry what an agent needs to call the API; re3data records only
  that an API exists at a URL.
- **Coverage completeness and routing.** `coverage.completeness` `{claim, basis}`
  and `guidance.routing` capture absence-as-evidence and per-task use, neither of
  which re3data models.

ASR specializes in the layer re3data lacks: evidence-backed verification,
adjudicated authority, executable access, and the epistemic distinction between
an imported claim and a locally established one.
