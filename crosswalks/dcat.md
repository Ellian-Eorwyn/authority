# Crosswalk: ASR ⇄ DCAT 3

W3C DCAT 3 and ASR both describe *where data lives*, but at different layers.
DCAT is a **catalog interchange vocabulary** — how to publish a machine-readable
listing of datasets and the services that serve them. ASR is the **epistemic and
operational layer DCAT deliberately omits**: whether an access method actually
works (probe evidence), why a source is trusted (adjudicated authority), how an
agent should *use* it for a given task (routing), and how complete its coverage
is. The two compose cleanly: emit DCAT for catalog interop, keep ASR for the
questions DCAT has no vocabulary for. **ASR does not replace DCAT** — a DCAT
`Catalog` is even a legitimate `discovery.upstream.registry` value
(`dcat`, `datagov`) to import *from*.

## Field-by-field

ASR's `content` block (what the source holds) and `access[]` block (how it is
reached) map onto the DCAT `Dataset`/`Distribution`/`DataService` triad.

| ASR | DCAT 3 | Notes |
|---|---|---|
| the registry (`registry.json`) | `dcat:Catalog` | a per-domain catalog of records |
| a source profile (`source.json`) | `dcat:Dataset` (or `dcat:DataService` when the source *is* a service) | the profiled unit; ASR keeps content and access as one profile that DCAT splits across resources |
| `content.artifacts[]` `{kind, formats[]}` | `dcat:Distribution` (one per format edition) | `formats[]` → `dcat:mediaType`/`dct:format`; `officiality` has no DCAT peer |
| `content.landing_pattern` | `dcat:landingPage` | `landing_then_file`/`landing_then_viewer` name the hop DCAT flattens into one `landingPage`; ASR tells the agent to follow to the file, not scrape the page |
| `access[]` with `type` = `bulk_download` | `dcat:Distribution` + `dcat:downloadURL` | a directly fetchable file |
| `access[]` with `type` = `web_fetch`/`web_render` | `dcat:Distribution` + `dcat:accessURL` | reachable resource that is not a direct download |
| `access[]` with `type` = `api_rest`/`api_graphql`/`oai_pmh`/`feed` | `dcat:DataService` | a service endpoint, not a file |
| `access[].base_url` | `dcat:endpointURL` (service) / `dcat:accessURL` (distribution) | the root you actually call |
| `access[].openapi.url` | `dcat:endpointDescription` | the machine-readable description seam (crosswalks/openapi.md) |
| `access[].docs_url` | `dcat:endpointDescription` (human) / `dct:page` | where the interface is documented |
| a `dcat:Distribution` served by a `dcat:DataService` | `dcat:accessService` | ASR carries both in one profile, so the link is implicit; on export it becomes an explicit `accessService` edge |
| `access[].endpoints[]` `{path_template, params[]}` | *(no DCAT term)* | DCAT stops at the service; ASR carries executable recipes below it |
| `scope`, `coverage.temporal`, `coverage.jurisdictions[]` | `dct:spatial`, `dct:temporal`, `dcat:theme` | partial overlap; ASR adds completeness (below) |
| `lifecycle.update_cadence` | `dct:accrualPeriodicity` | same intent |
| `relations[]` | `dct:relation` / `dct:isPartOf` | ASR's edges are typed (`api_for`, `official_source_for`, …) where DCAT's are generic |

`access.type` is the switch that decides **distribution vs data service**: a
`bulk_download` is a `Distribution` with a `downloadURL`; an `api_rest` method is
a `DataService` with an `endpointURL` and an `endpointDescription`. A source that
offers both (a portal that also publishes a bulk file) maps to a `Dataset` with
one `Distribution` and one `accessService` — exactly ASR's two `access[]` entries.

## What ASR adds beyond DCAT

DCAT can say a `DataService` exists at an `endpointURL` with an
`endpointDescription`. It cannot say any of the following, and these are the
reason ASR exists:

- **Whether the access claim is true.** ASR's `access[].verification.state` is
  *derived from stored probe evidence* (spec/04), never asserted by publishing.
  A DCAT record asserting a `DataService` is, in ASR terms, `asserted` — an
  honest "not actually tried" — until a probe backs it.
- **Adjudicated authority.** `authority.asserted` (machine triage) is quarantined
  from `authority.adjudicated` (human judgment, null until scored). DCAT has no
  trust model at all.
- **Officiality.** `officiality` and per-artifact `content.artifacts[].officiality`
  record institutional status (`source_of_record`, `official_representation`, …) —
  official is not the same as true, a distinction DCAT does not draw.
- **Routing guidance.** `guidance.routing` maps a task (`citation`, `legal_status`)
  to a `routing_disposition`, capturing the **discovery-vs-substantive-authority**
  split: a catalog can be `preferred` for discovery yet `follow_primary` for
  citation. DCAT lists resources; it never says how to use one.
- **Coverage completeness.** `coverage.completeness` `{claim, basis}` makes
  absence-as-evidence explicit — a dimension DCAT's presence-only listing lacks.
- **Agent query shapes.** `guidance.query_shapes[]` and `guidance.pitfalls[]` are
  the token-frugal payload DCAT was never meant to carry.
- **Politeness and credentials.** `access[].limits` and `access[].auth`
  (`credential_ref` only, spec/05) — request discipline and secret *references*,
  neither of which DCAT models.

## Direction: DCAT → ASR (import)

A DCAT catalog is an upstream discovery source. `discovery.upstream[]` accepts
`registry: "dcat"` or `"datagov"`; a `Dataset` becomes a candidate profile with
`identity.*` from `dct:title`/`dcat:landingPage`, `content.artifacts` from its
`Distribution`s, and `access[]` from its `DataService`s — all landing `asserted`,
never verified, with `provenance.produced_by.method = "import"` (spec/10). DCAT
tells you a service is *claimed to exist*; ASR's probe gate tells you it *works*.

ASR specializes in the layer DCAT lacks: evidence-backed verification, adjudicated
authority, routing, and the epistemic distinctions a catalog format cannot express.
