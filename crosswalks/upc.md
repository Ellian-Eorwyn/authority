# Crosswalk: ASR ⇄ UPC

ASR and UPC are siblings: ASR is the upstream map (*where and how to
collect*), UPC the downstream custody chain (*what was collected, verified
byte-for-byte*). The bridge is a **copy, not a translation**: an ASR fetch
record's `retrieval` block uses UPC's field names and its `fetch_status`
enum verbatim, by construction (spec/07.3), so material collected through a
registry enters a provenance corpus with its retrieval metadata already in
UPC shape.

## Seeding a UPC source from an ASR fetch

Given an ASR fetch record `F` (a `fetches.jsonl` line or a
`<payload>.fetch.json` sidecar) and its payload bytes:

| UPC (`source.json`) | From ASR | Notes |
|---|---|---|
| `source_id` | `mintSrcId({canonicalUrl})` over `F.retrieval.final_url ?? original_url` | UPC's recipe, UPC's prefix — never reuse the `asc-` id (Appendix C) |
| `source_kind` | `"url"` (or `"dataset"`/`"document"` by content type) | |
| `title` | caller-supplied; default the profile's `identity.name` + endpoint name | |
| `retrieval.original_url` | `F.retrieval.original_url` | identical field names from here down |
| `retrieval.final_url` | `F.retrieval.final_url` | |
| `retrieval.fetch_status` | `F.retrieval.fetch_status` | **identical enum, verbatim** |
| `retrieval.http_status` | `F.retrieval.http_status` | |
| `retrieval.content_type` | `F.retrieval.content_type` | |
| `retrieval.fetch_method` | `F.retrieval.fetch_method` (`"http"`) | |
| `retrieval.fetched_at` | `F.retrieval.fetched_at` | |
| `retrieval.sha256` | `F.retrieval.sha256` | already computed over the stored bytes |
| representation (`role:"original"`) | the payload file; `sha256` = `F.retrieval.sha256`, `bytes` = `F.retrieval.bytes` | `rep-` id = first 12 hex of the byte hash (UPC §06) — no rehashing needed beyond UPC's own recompute |
| `bibliographic.publisher` | profile `identity.publisher ?? identity.name` | |
| `bibliographic.title` | as `title` | |
| `discovery.discovered_from` | `"authority:" + F.source_id` | the explicit bridge (Appendix C) |
| `ext["authority"]` | `{registry_id, source_id, access_id, endpoint_id, fetch_id, params: F.request.params}` | under UPC's must-ignore rule; params are already secret-redacted |
| `aliases["authority"]` | `F.fetch_id` | |

Multi-page fetches (`F.payload.pages > 1`): each page file becomes its own
representation of the one source, or the concatenation becomes a single
representation — UPC permits either; record which in the representation
`notes`.

## What already matches (no work)

- **`fetch_status`** — ASR imports UPC's enum unchanged
  (`vocab.json#/$defs/fetch_status`).
- **Hashing and canonical JSON** — both standards use sha256 + JCS (RFC
  8785) with the same id form `<prefix>-<12hex>`; one implementation family
  serves both (ASR §06 restates UPC §06's URL and slug algorithms verbatim).
- **Timestamps** — RFC 3339 UTC everywhere.
- **Extension discipline** — both use `additionalProperties: true` +
  must-ignore + namespaced `ext` + `aliases`, so each standard's ids travel
  safely inside the other's objects.

## Direction: UPC → ASR

A UPC corpus can seed registry *discovery*: each distinct
`retrieval.original_url` host is a candidate source (`authority add
<origin>`), with `discovery.retrieved_via` set from the UPC source's own
`discovery` and `import_ref` = the UPC `source_id`. Authority tiering,
access profiling, and probing remain human/tool work — a UPC corpus records
what was fetched once, not what a service is.

## Gaps (deliberate)

- ASR does not emit UPC `extraction`/`generation`/`synthesis` objects —
  nothing in a registry is quotable evidence; that pipeline starts after
  collection.
- UPC's byte-exact quotation gate has no ASR analogue and needs none: ASR's
  gate is the probe-evidence gate (spec/04). The two gates compose: a claim
  cited from fetched material is covered by UPC; the claim that the fetch
  recipe works is covered by ASR.

## Dry run

```bash
node examples/build-examples.mjs
# take the example fetch record and its payload:
cat examples/example-registry/sources/meadowlark-observatory-data-service/fetches.jsonl
ls examples/example-registry/fetched/meadowlark-observatory-data-service/
# → copy retrieval.* into a UPC source.json, point a representation at the
#   payload file, run `upc validate` in the provenance repo: the hashes
#   recompute because they were UPC-shaped from birth.
```
