# Crosswalk: ASR ⇄ OpenAPI

An access method's `access[].openapi` block `{url, version}` is a **reference to
an existing OpenAPI 3.x description**, not a copy of it. ASR does not duplicate,
re-host, or paraphrase the OpenAPI document: where a machine-readable description
already exists, ASR points at it and adds the operational layer OpenAPI omits.
Declaring `access[].openapi.url` does **not** make the method `verified` — the
probe gate (spec/04) remains the sole authority on whether access works.

## Field-by-field

| OpenAPI 3.x | ASR | Notes |
|---|---|---|
| the document URL | `access[].openapi.url` | the pointer; ASR stores the location, not the bytes |
| `openapi: "3.1.0"` | `access[].openapi.version` | version string, when known |
| `servers[].url` | `access[].base_url` | the root the recipes are relative to |
| a path item, e.g. `/v2/…/data` | `access[].endpoints[].path_template` | `{param}` placeholders resolved from `params[]` (§03.5) |
| an operation (`get`/`post`) | `access[].endpoints[].http_method` + the endpoint | ASR endpoints declare `GET` or `POST` only |
| `parameters[]` | `access[].endpoints[].params[]` `{name, required, type, example}` | informal type hints, not JSON Schema |
| response `content` media type | `access[].endpoints[].response.format` | checked by the `api_parse` probe |
| (JSON path to the records array — not in OpenAPI) | `access[].endpoints[].response.record_path` | ASR adds where the records actually live |
| `components.securitySchemes` | `access[].auth` `{scheme, location}` | scheme + where the key travels |
| `security` requirement | `access[].auth.required` | whether a credential is needed |
| `externalDocs` / `info.contact` | `access[].docs_url` | human documentation |
| pagination (ad hoc across specs) | `access[].endpoints[].pagination` `{style, page_param, cursor_path, …}` | ASR normalizes what OpenAPI leaves to prose |

The mapping is deliberately lossy in ASR's favor: ASR carries only what an agent
needs to *execute and probe* one preferred operation, and defers everything else
(full schemas, every operation, every response code) to the referenced document.

## What ASR adds on top of OpenAPI

OpenAPI describes the shape of an API. It says nothing about whether that API is
reachable today, what it costs to call politely, or which operation to reach for.
ASR fills exactly those gaps:

- **Whether it actually works — the probe gate.** A declared `openapi.url` is
  *never* `verified` just by existing. `access[].verification.state` is derived
  from `probes.jsonl` (spec/04); an unprobed method with a perfect OpenAPI doc is
  `asserted` — an honest "not tried." OpenAPI is a claim; the probe is evidence.
- **Credentials by reference.** `access[].auth.credential_ref` names a secret the
  §05 chain resolves locally (env → gitignored file → keychain); the value never
  enters a tracked file. OpenAPI names a `securityScheme` but has no story for
  obtaining, holding, or resolving the secret.
- **Politeness and budgets.** `access[].limits` `{requests_per_second,
  politeness_delay_ms, daily_budget, …}` — request discipline tools MUST respect
  (§03.3). OpenAPI has no rate-limit or budget model.
- **Probe strategy.** `access[].endpoints[].probe_hint` `{params, expect_status}`
  is the cheapest real invocation, used as the §04 API ping — how to check the
  endpoint is alive without spending a full query.
- **Preferred operations and task guidance.** OpenAPI lists every operation as an
  equal. `guidance.query_shapes[]` says *which* operation serves *which* task and
  how to shape the call; `guidance.routing` says whether to trust the result for
  citation vs discovery.
- **Known pitfalls and freshness.** `guidance.pitfalls[]` records what wastes
  round-trips; the `freshness` block tracks whether the profile and its content
  are still current — clocks independent of any successful probe (spec/04).

## When there is no OpenAPI document

Most sources profiled by ASR have *no* machine-readable description. ASR degrades
gracefully: `access[].openapi` is simply absent, and the endpoint recipes stand
alone. `path_template`, `params[]`, `pagination`, `response.record_path`, and
`example_request` (with `$CREDENTIAL` placeholders, never real secrets) carry
everything an agent or `authority fetch` needs to execute the call without any
external description. The OpenAPI reference is an optimization when one exists,
not a dependency.

ASR specializes in the layer OpenAPI lacks: evidence that the interface works,
credential resolution, politeness, probe strategy, and per-task routing guidance.
