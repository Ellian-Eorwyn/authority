# ASR 03 — Access Methods and Endpoints

## 3.1 An access method is one way in

Each entry of a profile's `access[]` array describes one independent transport
into the source (schema: `source.schema.json#/$defs/access_method`). Required:
`access_id`, `name` (a CLI-addressable slug, unique in the profile), `type`,
`base_url`, `auth`, `robots`, `verification`.

`type` comes from `vocab.json#/$defs/access_type`:

| Type | Meaning | Probe semantics (§04) |
|---|---|---|
| `api_rest`, `api_graphql` | structured request/response API | ping + parse check |
| `oai_pmh` | OAI-PMH harvesting | `Identify` verb + parse |
| `feed` | RSS/Atom | fetch + parse |
| `bulk_download` | whole files by URL | robots + HEAD (never download) |
| `web_fetch` | plain HTTP pages, no JS needed | robots + HEAD/bounded GET |
| `web_render` | JS rendering required | transport-only (§3.6) |
| `ftp` | FTP/SFTP | recorded; reference CLI does not probe |
| `offline` | out-of-band material | recorded; never probed |

Order in `access[]` is preference order: an agent tries the first viable
method whose state permits (`verified`/`stale`/`degraded` before `asserted`;
never `blocked`/`broken`/`retired` without saying so).

## 3.2 Auth — references, never values

`auth.required` + `auth.scheme` declare whether and how the method
authenticates. When `required` is true and the scheme involves a secret, the
method MUST declare `credential_ref` (a registry-unique slug matching
`^[a-z][a-z0-9_]*$`) and, for `api_key_query`/`api_key_header`, a `location`
({in, name}) saying where the key travels (`auth_underspecified` otherwise).
`signup_url` tells a human where to obtain a key.

**A secret value anywhere in a tracked file is the error
`credential_in_profile`** — the validator scans for it (§08). Resolution of
refs to values is §05. The convention of naming refs after an existing
consumer's provider ids (e.g. pi-forge's) makes environment-variable
compatibility automatic (§05.2).

`oauth2` and `session_cookie` are recorded for completeness so a blocked or
login-walled state is explainable; the reference CLI never automates either.

## 3.3 Limits and politeness

`limits` records declared or observed request discipline:
`requests_per_second`, `politeness_delay_ms` (overrides the registry default),
`daily_budget`, `monthly_budget`, `concurrency`. Absent fields mean
**unknown, not unlimited**. Tools MUST respect declared limits: probe and
fetch space consecutive same-host requests by the effective politeness delay
and check budgets (§07.5) before spending.

## 3.4 Robots posture and terms

`robots.applies` says whether robots.txt governs this transport (false for
authenticated APIs, ftp, offline). Where it applies, probes capture robots.txt
in full as evidence and record `posture` (allowed / partial / disallowed /
no_robots) for the method's `checked_path` (§04.3). A `disallowed` posture
makes the method's derived state `blocked`, and conforming tools MUST NOT
request past it — blocked is a recorded state, not a challenge. `tos_url` is
metadata for humans; tools never auto-fetch it.

L1 requires a recorded posture for every method where robots applies
(`robots_unrecorded`).

## 3.5 Endpoints

An endpoint (schema: `source.schema.json#/$defs/endpoint`) is an executable
recipe: `name` (slug, unique in the method), `http_method` (GET or POST),
`path_template` relative to `base_url` with `{param}` placeholders, `params[]`
({name, required, type, description, example}), `pagination` ({style,
page_param, size_param, cursor_path, max_page_size}), `response` ({format,
record_path}), `probe_hint` (the cheapest real invocation — used as the §04
API ping; for OAI-PMH conventionally the `Identify` verb), and
`example_request` (ready-to-read, with `$CREDENTIAL` placeholders where a
secret would go — never a real value).

Execution (`authority fetch`, §07) substitutes params into the template,
injects the credential per `auth.location`, and follows the declared
pagination style. A template MUST NOT embed a credential placeholder of its
own; injection is the auth block's job, so redaction (§04.4) has one thing to
redact.

## 3.6 `web_render` — the delegation boundary

ASR profiles record that rendering is required; they do not render. For a
`web_render` method the reference CLI probes the *transport claim only*
(robots + plain GET reachability) and records the `render` check as `skip`.
The method can therefore reach `verified` — meaning "reachable; rendering
required and delegated" — and projections mark it as transport-only. A
rendering harness that actually drives the page MAY append its own probe
record through the same schema with a `render` check of `pass`/`fail` and
`tool.name` identifying itself; the record then carries the full-render
claim. This keeps one evidence trail regardless of who probes.

## 3.7 Machine-readable API descriptions

When an access method's API already has an OpenAPI (or equivalent) description,
declare it with `access[].openapi` (`{url, version}`) rather than duplicating
the operation catalog: it is the OpenAPI / DCAT `endpointDescription` seam
(`crosswalks/openapi.md`, `crosswalks/dcat.md`). Declaring `openapi.url`
changes **nothing** about verification — a description that exists is not a
method that works; only a probe (§04) moves a method to `verified`, and the
validator's state derivation ignores `openapi` entirely. ASR's value sits on
top of the description: whether it actually works, credentials by reference
(§05), politeness and rate limits (§3.3), a `probe_hint` strategy, preferred
operations and task guidance (§02), known pitfalls, and content freshness
(§02.11). Where no machine-readable description exists, ASR's endpoint recipes
(§3.5) stand on their own.
