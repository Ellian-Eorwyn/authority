# ASR 06 — Identifiers

Ids are computed, never invented. Every content-addressed id below is
recomputed by the validator (`id_mismatch` when a stored id disagrees;
`id_format` when it is malformed; `id_duplicate` when two objects claim one).
This section is self-contained: the hashing, canonical-JSON, URL, and slug
algorithms are fully specified here (they intentionally match UPC §06, so one
implementation serves both standards).

## 6.1 Form and recipes

An id is `<prefix>-<first 12 hex of sha256(key)>`, where `key` is a UTF-8
string built by the recipes below. Embedded JSON is serialized with **JCS
(RFC 8785)**: object members sorted by code unit, no insignificant
whitespace, shortest-form numbers, minimal string escapes.

| Object | Prefix | Key |
|---|---|---|
| Registry | `reg-` | none — an opaque nonce minted at init (12 random hex); format-checked only, because a registry has no canonical content to key on |
| Source | `asc-` | `"asc\n" + canonical_url` (§6.4) |
| Access method | `acc-` | `"acc\n" + source_id + "\n" + type + "\n" + normalize_url(base_url)` |
| Endpoint | `end-` | `"end\n" + access_id + "\n" + http_method + "\n" + path_template` (the template verbatim, placeholders included) |
| Probe | `prb-` | `"prb\n" + access_id + "\n" + probed_at` (RFC 3339 UTC, millisecond precision) |
| Fetch | `fch-` | `"fch\n" + endpoint_id + "\n" + request_url_redacted + "\n" + fetched_at` |

The `asc-` prefix and `"asc\n"` key-domain are deliberately distinct from
UPC's `src-`/`"src\n"`: an ASR source is a *service profile*, a UPC source is
a *captured object*, and two interoperating sibling standards must not share
an id namespace (Appendix C).

Credential refs are NOT ids: they are human-chosen slugs (`^[a-z][a-z0-9_]*$`,
§05.1).

## 6.2 Source identity

A source is keyed on its **canonical homepage URL** — not its name (names
drift and cannot be checked) and not its publisher (one publisher operates
many sources). Consequences:

- Distinct domains are distinct sources, even inside one organization
  (energy.gov vs osti.gov vs nrel.gov); relate them with `part_of` /
  `api_for`.
- A moved homepage is a **new source**; relate old and new with `supersedes`
  / `superseded_by`. Ids are stable or they are worthless.
- Per-tool ids (a FORGE manifest row, a pi-forge provider id) go in
  `aliases`, never into identity.

## 6.3 Timestamps in identity

Probe and fetch ids are event ids: the same access method probed twice yields
two records with two ids. `probed_at`/`fetched_at` MUST be RFC 3339 UTC with
millisecond precision (`2026-08-17T12:00:00.000Z`) and MUST equal the value
stored in the record — the validator recomputes the id from the stored
fields. Deterministic builders (examples, fixtures) use fixed timestamps and
say so via `tool.method: "fixture"`.

## 6.4 URL normalization

`canonical_url` (identity) and every normalized URL in a key is produced by
this closed, ordered algorithm; it depends only on the URL string, never on
page content:

1. **Parse** per the WHATWG URL standard. A string that does not parse cannot
   feed identity.
2. **Lowercase scheme and host**; punycode an internationalized host to
   ASCII, lowercased.
3. **Drop default ports** (`:80` http, `:443` https).
4. **Normalize percent-encoding** (RFC 3986 §6.2.2): uppercase `%XX` hex;
   decode `%XX` that encodes an unreserved character (`A–Z a–z 0–9 - . _ ~`).
5. **Drop the fragment.**
6. **Trailing slash**: remove a single trailing `/` from a non-root path
   (leave `https://host/` as-is).
7. **Remove tracking parameters** — exactly this closed set, matched
   case-insensitively by key: every key prefixed `utm_`, plus `gclid`,
   `fbclid`, `msclkid`, `twclid`, `igshid`, `mc_cid`, `mc_eid`, `wbraid`,
   `gbraid`. Generic keys such as `ref` are NOT stripped.
8. **Sort remaining query parameters** by (key, value) bytewise ascending,
   preserving duplicates; re-encode as `k=v&…`; drop a bare `?`.

A site's advertised `rel=canonical` never feeds identity — a page cannot
dictate its own registry id.

## 6.5 Slugs

The on-disk source directory is named with a human-readable slug of
`identity.name`, for browsability only — `source.json` carries the canonical
id, and the manifest maps id ↔ path; a tool MUST resolve by id, never by
parsing folder names. Algorithm (deterministic, portable, collision-safe):

1. Basis = `identity.name`.
2. NFKD-normalize; strip combining marks (Unicode `Mn`), folding accents to
   ASCII.
3. Lowercase.
4. Replace every run outside `[a-z0-9]` with a single `-`.
5. Trim leading/trailing `-`.
6. Cap at 60 characters, trimming a trailing `-` left by the cut.
7. Empty → `untitled`.
8. On case-insensitive collision with another source in the registry, or a
   Windows reserved name (`con`, `prn`, `aux`, `nul`, `com1`–`com9`,
   `lpt1`–`lpt9`), append `--<first 6 hex of the source id's hash>`; still
   colliding → first 12 hex.

## 6.6 Stability rules

- `asc-` is stable while the canonical URL is stable; a changed URL is a new
  source (§6.2).
- `acc-` changes when the transport genuinely changes (new base URL or type)
  — that is correct: a moved API is a new access method, and its old probe
  history stays attached to the old id.
- `end-` changes when the recipe's method or template changes; parameter
  *documentation* edits (descriptions, examples) do not touch identity.
- Probe/fetch records are immutable events: never rewritten, only appended
  (§01.2). Corrections are new records.
- Per-run sequential ids MAY be used internally by tools, carried in
  `aliases`; registry-level ids MUST be the content-addressed forms above.
