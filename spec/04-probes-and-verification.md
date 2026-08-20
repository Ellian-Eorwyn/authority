# ASR 04 — Probes and Verification (the gate)

This section is the hard promise made operational. A **probe** is one
execution of the verification gate against one access method; its record and
evidence are what make a `verified` badge recomputable rather than
aspirational.

## 4.1 The probe record

Schema: `schemas/probe.schema.json`. One JSON object appended to the source's
`probes.jsonl` (append-only, §01.2), carrying: `probe_id` (§06), the
`access_id`/`source_id` it verifies, `probed_at` (RFC 3339 UTC, millisecond
precision — feeds identity), the executing `tool` ({name, version, method —
`tool` for real probes, `fixture` for deterministic example builders}),
`outcome`, ordered `checks[]`, the redacted `request`, the `response` summary,
`evidence[]`, and `credential` ({ref, resolved_via} — never a value).

Skipped checks are recorded as `skip` with a reason. **Skips are visible,
never silently dropped**: a probe that could not check auth says so in-band.

## 4.2 What a probe does, per access type

All probes: apply the effective politeness delay before each request
(§03.3), send the registry User-Agent
(`authority-probe/<version> (+<user_agent_contact>)`), time out at 20 s, retry
once on pure network errors, and never retry on 4xx.

- **`web_fetch` / `bulk_download`** — (1) fetch `<origin>/robots.txt`, store
  the full bytes as evidence, evaluate the method's `checked_path` against it
  (§4.3). **If disallowed: outcome `robots_disallowed`, no further request is
  made.** (2) Otherwise HEAD the base URL (falling back to a bounded GET when
  HEAD is rejected), recording status, headers subset, and final URL. Bulk
  endpoints get a HEAD recording `content-length`; a probe never downloads the
  file.
- **`api_rest` / `api_graphql` / `oai_pmh` / `feed`** — (1) resolve the
  credential when `auth.required`; if nothing resolves, outcome
  `auth_required`, the state stays `asserted`, and the record says which chain
  steps were tried — an unresolvable credential is a fact, not an error. (2)
  Execute the cheapest declared invocation: an endpoint's `probe_hint`, or for
  OAI-PMH the `Identify` verb. (3) Check the response parses as the declared
  `response.format` (the `api_parse` check). (4) Store a truncated body sample
  (64 KiB cap) as evidence, recording both the stored bytes' hash and the full
  body's hash/length when known.
- **`web_render`** — robots + plain GET only; the `render` check is recorded
  `skip` (§03.6).
- **`ftp` / `offline`** — not probed by the reference CLI; methods hold
  whatever state their records support, usually `asserted`.

## 4.3 robots.txt evaluation

The probe parses the captured robots.txt per RFC 9309 for user-agent `*` and
the registry's own product token, longest-match rule, and records `posture`:
`allowed`, `partial` (relevant sibling paths disallowed), `disallowed` (the
checked path itself), or `no_robots` (404/empty — treated as allowed,
recorded distinctly). Posture is copied into the method's `robots` block.
Fetch (§07) consults the latest recorded posture and refuses disallowed paths.

## 4.4 Redaction

Before any probe or fetch record is written, every occurrence of a resolved
credential value in URLs, headers, or params is replaced with `***`. The
`headers_subset` whitelist (server, retry-after, the rate-limit family,
deprecation/sunset) exists so nothing token-bearing (set-cookie,
authorization echoes) is ever recorded. **A record that would need the secret
to be reproduced is misdesigned; a record that contains it is the error
`credential_in_profile`.**

## 4.5 Evidence

Evidence files live under the source's `evidence/` directory, named
`<probed_at compact>-<kind>[-n].<ext>` (portable, §01.1), and are **tracked**:
they are the proof. Each `evidence[]` entry records `kind`, `path`, `sha256`
**of the stored bytes exactly** (the recomputable claim), `bytes`, and for
truncated samples `truncated_at` + `full_sha256`/`full_bytes`. Validators
recompute stored-byte hashes (`probe_evidence_hash_mismatch`) and require the
files to exist (`probe_evidence_missing`).

Evidence is deliberately small: full robots.txt, a headers snapshot, a capped
body sample. Payload-scale data belongs to fetch (§07), not probes.

## 4.6 The state machine

`verification.state` on an access method is **derived** from its probe
history and the clock; the stored value is a cache for browsability, and a
mismatch is `state_drift` (repaired by regen). Derivation, given the latest
probe P and window W (= method `window_days` ?? registry
`verification_window_days` ?? 90):

```
no P (and not manually retired)              → asserted
P.outcome = ok            ∧ age(P) ≤ W       → verified
P.outcome = ok            ∧ age(P) > W       → stale
P.outcome = degraded                          → degraded
P.outcome ∈ {failed, timeout, dns_error,
             tls_error, moved}                → broken
P.outcome ∈ {blocked, robots_disallowed,
             auth_invalid}                    → blocked
P.outcome = auth_required                     → asserted   (honestly untested)
manual close                                  → retired
```

Transitions happen mechanically at probe time, at `regen` (which applies the
clock: verified → stale on window lapse), and at `validate` (which recomputes
and flags drift). No tool may set `verified` by hand: L1's `unverified_claim`
requires a matching `ok` probe record, present evidence, matching hashes, and
fresh age — the gate line from §0.2.

The window is deliberately independent of `lifecycle.update_cadence` **and of
`freshness` (§02.11)**: access stability, content rhythm, and content currency
are different clocks. Static archives can carry long per-method windows (e.g.
365); volatile APIs shorter ones. Critically, a successful probe verifies only
that the endpoint *works* — it says nothing about whether the data behind it is
current. `freshness.content_current_through` MUST therefore never be derived
from a probe outcome: a working API can serve stale data, and a static archive
can be perfectly current for its scope. Content currency is recorded separately,
with its own `content_freshness_basis`.

## 4.7 Probing discipline

`authority probe` skips methods whose state is fresh `verified` unless
`--force` — re-verifying what is already proven wastes the source's goodwill.
Probes are polite by construction (delay, UA, timeout, single retry) and
low-volume by design: one robots fetch and at most one or two requests per
method. A registry-wide `probe --all` is a maintenance action, not a loop.
