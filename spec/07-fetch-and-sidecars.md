# ASR 07 — Fetch, Sidecars, Samples, Budgets

A **fetch** exercises a profiled endpoint for real: it is how a registry
proves its recipes work (L2), how agents pull data through profiles instead
of searching, and how collected material enters a UPC corpus with provenance
already attached.

## 7.1 Execution

`authority fetch <registry> <source> <endpoint> [--param k=v …]` proceeds:

1. **Resolve** the endpoint through the manifest and profile; validate that
   every `required` param is supplied (missing → error before any network).
2. **Substitute** params into `path_template`. Unknown `{placeholders}`
   remaining after substitution are an error.
3. **Resolve the credential** when `auth.required` (§05). Null resolution →
   the fetch is **skipped, exit 0**: a fetch record is appended with
   `retrieval.fetch_status: "not_applicable"` and `skip_reason` naming the
   chain steps tried. Unavailable is a fact, not a failure.
4. **Consult robots**: for methods where robots applies, the latest recorded
   posture governs; `disallowed` (or method state `blocked`) → the fetch is
   **refused**, recorded with `fetch_status: "blocked"`. A conforming tool
   never bypasses robots directives, paywalls, or login walls; those are
   recorded terminal states.
5. **Check the budget** (§7.5); exhausted → skipped with reason.
6. **Execute** with the effective politeness delay, registry User-Agent, and
   a 60 s timeout, injecting the credential per `auth.location`
   (query parameter, header, bearer, or basic). Redirects are followed
   (chain recorded); the payload streams to
   `fetched/<slug>/<utc-compact>-<endpoint-name>.<ext>` with the extension
   inferred from the response Content-Type.
7. **Paginate** when the endpoint declares a style and `--max-pages > 1`
   (default 1): `page_number`/`offset_limit` advance the declared params;
   `cursor`/`token` follow `cursor_path` into each response; `link_header`
   follows `rel="next"`. Pages are stored as sibling files and counted in
   the record; the politeness delay applies between pages.
8. **Record**: compute sha256/bytes of the payload, write the sidecar, append
   the fetch record, update the budget ledger.

HTTP outcomes map to `fetch_status`: 2xx → `success` (a parse-failing or
truncated body → `partial`); 401/403 with credential → `failed` + note
(auth_invalid); 402/paywall signature → `paywall`; login redirect →
`login_required`; robots/4xx-refusal → `blocked`; network/5xx → `failed`.

## 7.2 The record and the sidecar

Schema: `schemas/fetch-record.schema.json`. The identical object is written
twice, by design:

- appended to the source's **tracked** `fetches.jsonl` — the durable memory
  of every exercised recipe (with `retrieval.sha256`/`bytes`), which survives
  payload cleanup; and
- beside the payload as `<payload>.fetch.json` — the **sidecar** that makes
  the gitignored `fetched/` directory self-describing.

Recorded URLs and params are secret-redacted (§04.4) before either copy is
written.

## 7.3 UPC compatibility

The record's `retrieval` block uses UPC's field names and its `fetch_status`
enum verbatim: `original_url`, `final_url`, `fetch_status`, `http_status`,
`content_type`, `fetch_method` (`"http"` for the reference CLI), `fetched_at`,
`sha256`, `bytes`. Seeding a UPC source from an ASR fetch is a copy, not a
translation — the payload bytes become a representation whose hash is already
computed, and the profile supplies bibliographic publisher fields. The full
bridge, including how the ASR ids travel in UPC's `ext`/`discovery`, is
`crosswalks/upc.md`.

## 7.4 Samples

With `--keep-sample`, fetch also writes a **tracked** sample to
`sources/<slug>/samples/<endpoint-name>.<ext>`: the payload truncated to a
256 KiB cap (`truncated_at` recorded; smaller payloads stored whole,
`truncated_at: null`), hash of the stored bytes in the record's `sample`
block. One sample per endpoint (a re-fetch with `--keep-sample` overwrites,
the newest wins — history lives in `fetches.jsonl`).

Samples exist for one reason: an agent reading the registry can see each
endpoint's real response shape without spending a live request. Samples are
reference material, not archives; anything payload-scale stays in `fetched/`.

## 7.5 Budget ledger

Tools maintain a per-registry daily ledger at
`.authority/budget/<UTC-date>.json` mapping `access_id → requests made`
(probes and fetch pages both count). Before spending, fetch and probe compare
the ledger against the method's `limits.daily_budget`; at the limit the
action is skipped with reason `budget_exhausted`. The ledger is tool-private
scratch (§01.7): deleting it loses nothing but today's counts — the
politeness guarantee degrades gracefully to delays and declared rates.
