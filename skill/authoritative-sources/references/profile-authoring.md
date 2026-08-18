# Profile authoring: the working contract

How to add and edit source profiles without breaking the promise. Normative
detail lives in spec/02–03 and spec/06; this is the condensed write-time
contract.

## Adding a source

```bash
node scripts/authority.mjs add <registry> <homepage-url> \
  --name "<Common Name>" --tier 1|2|3 --topics a,b \
  [--role publisher|aggregator|…] [--class primary|secondary|tertiary] \
  [--publisher "<Operating Org>"] [--retrieved-via "<the exact query that surfaced it>"] \
  [--import-ref <corpus-id>] [--no-probe]
```

This mints the id from the canonical homepage URL, slugs the directory,
writes a skeleton (one `web_fetch` access on the origin, state `asserted`),
records discovery, and runs a first polite probe. Then EDIT the profile —
the skeleton is honest but thin.

## What to fill in, in value order

1. **guidance** — the payoff block. `best_for` (what this source settles),
   `query_shapes` ({task, access, endpoint, recipe, example} — what actually
   works against this source), `pitfalls` (what wastes requests: landing-page
   hops, rate quirks, blocked paths). L2 requires it.
2. **access[] beyond the skeleton** — one entry per genuine way in
   (`api_rest`, `bulk_download`, `oai_pmh`, `web_render`, …), ordered by
   preference. For APIs, declare endpoints fully: `path_template` with
   `{param}` placeholders, `params[]` (required flags + examples),
   `pagination`, `response.format` (+ `record_path`), a cheap `probe_hint`,
   and an `example_request` using `$CREDENTIAL` where a secret would travel.
3. **auth** — `scheme` + `credential_ref` (+ `location` for api_key schemes)
   + `signup_url`. The ref is a name (`^[a-z][a-z0-9_]*$`), ideally the
   provider's pi-forge id, so `FORGE_API_KEY_*` compatibility is automatic.
   **A literal secret anywhere in the profile is the error
   `credential_in_profile`.**
4. **content vs access** — keep them separate: `content.artifacts` says what
   exists; `content.landing_pattern` says how many hops
   (`direct` / `landing_then_file` / `landing_then_viewer` /
   `search_then_record` / `portal_query`).
5. **lifecycle** — `status` + `update_cadence` are required; put what the
   enum can't say in `cadence_notes` ("updated as filed").
6. **scope** — topics MUST exist in `topics.json` (add them there first);
   jurisdiction as `{level, regions: ["US","US-CA"], notes}`.
7. **relations** — `aggregates` (and guidance saying "entries are pointers —
   cite the underlying document") for aggregator-role sources; `part_of` /
   `api_for` / `companion_of` / `supersedes` as facts warrant.

## Hard rules

- **Never set `verification.state` by hand.** Probes and `regen` own it.
  Long-term `asserted` methods get a waiver in `verification.notes` (why
  untested, e.g. "awaiting free key") — that silences the `asserted_remaining`
  nag honestly.
- **Never fill `authority.adjudicated`.** Models triage in `asserted`
  (attributed via `asserted_by`); adjudication is a human's, with
  `scored_by`/`scored_at` (the validator enforces attribution and warns on
  model-stamped profiles).
- **Identity is the canonical homepage URL.** A moved domain is a NEW source
  + `supersedes` relation. A moved base_url is a new access method — re-mint
  ids (`authority mint acc`/`end`), reset that method's verification to
  `asserted`, and let old probe records stand (they become the advisory
  `orphaned_record`, which is history, not an error).
- **Journals are append-only.** Never edit `probes.jsonl`/`fetches.jsonl`;
  corrections are new records.
- **Tool-specific extras** go in `ext.<tool>` (e.g. `ext["pi-forge"]:
  {provider, kinds, selectors}`) and `aliases` — never as new top-level
  members.

## After every editing session

```bash
node scripts/authority.mjs regen <registry>      # derived state, manifest, csv, browser
node scripts/authority.mjs validate <registry>   # must exit 0 before you're done
```

The validator's findings carry repair hints; `state_drift`-class warnings are
fixed by regen, `unverified_claim`-class errors by probing (or by honesty —
set nothing you haven't earned).
