# Probe and fetch: mechanics and etiquette

What actually happens on the wire, and the rules the tools enforce. Normative
detail: spec/04 (probes), spec/05 (credentials), spec/07 (fetch).

## Probe (`authority probe <registry> [<source>] [--access <name>] [--all] [--force]`)

Per access method, by type:

- **web transports** (`web_fetch`, `web_render`, `bulk_download`): fetch
  `/robots.txt` (stored WHOLE as hashed evidence), evaluate the method's
  `checked_path` — **disallowed means outcome `robots_disallowed`, state
  `blocked`, and no further request is made**. Otherwise HEAD (GET fallback),
  recording status/headers-subset/final URL. `web_render` verifies transport
  only (`render` check = `skip`); a rendering harness may append its own
  probe record through the same schema.
- **APIs** (`api_rest`, `api_graphql`, `oai_pmh`, `feed`): resolve the
  credential first — unresolved = outcome `auth_required`, state stays
  `asserted`, tried chain recorded, **not an error**. Then the cheapest real
  call (`probe_hint` params; OAI uses `Identify`), a parse check against the
  declared format, and a capped (64 KiB) body sample as evidence.
- Politeness: the registry delay between requests (default 1000–1200 ms),
  identifying UA with the registry contact, 20 s timeout, ONE retry on pure
  network errors, never on 4xx. Probes skip fresh `verified` methods unless
  `--force` — re-proving what's proven wastes goodwill.
- Every recorded URL/header is secret-REDACTED (`***`) before writing.

State transitions are mechanical (spec/04.6): `ok` → verified (until the
staleness window lapses → stale); `robots_disallowed`/403/`auth_invalid` →
blocked; network failures → broken; `auth_required` → asserted. `regen`
applies the clock; `validate` recomputes everything from evidence.

## Credentials (spec/05)

Resolution chain, first hit wins: `AUTHORITY_CRED_<REF>` →
`FORGE_API_KEY_<REF>` (pi-forge compatibility) → `<registry>/credentials.json`
(gitignored, 0600) → macOS Keychain (`security`, service `authority`,
account = ref). Empty env string DISABLES a ref for the process. Store keys:

```bash
node scripts/authority.mjs creds set <ref> --registry <r>   # value via hidden stdin
node scripts/authority.mjs creds set <ref> --keychain        # security(1) prompts
node scripts/authority.mjs creds check <r>                   # chain walk + operational_here
```

Values are never printed, never recorded, never in tracked files. If a
credential doesn't resolve: report it, point at the profile's
`auth.signup_url` — don't improvise and NEVER paste a literal key into a URL.

## Fetch (`authority fetch <registry> <source> <endpoint> --param k=v … [--max-pages N] [--keep-sample] [--out <dir>]`)

Order of operations, each a recorded, honest stopping point:

1. required params validated; `{placeholders}` substituted (optional
   unsupplied query params are dropped whole);
2. credential resolved (null → record `not_applicable` + `skip_reason` with
   the tried chain, **exit 0**);
3. robots posture + method state consulted (`disallowed`/`blocked` → record
   `blocked` and refuse — never bypass robots, paywalls, or login walls);
4. daily budget checked (`.authority/budget/`; probes and pages both count);
5. request executed (60 s timeout, politeness delay between pages), auth
   injected per scheme (query key / header key / bearer / basic);
6. pagination by the declared style (`page_number`, `offset_limit`, `cursor`,
   `token`, `link_header`) up to `--max-pages` (default 1);
7. payload streamed to `fetched/<slug>/` + `.fetch.json` sidecar; the same
   record appended to tracked `fetches.jsonl` (the durable memory — the
   `retrieval` block is UPC-compatible verbatim);
8. **format check**: an HTTP 200 whose body isn't the declared format is
   `partial`, not success (catches WAF block pages);
9. `--keep-sample` writes a capped (256 KiB), hashed, TRACKED sample to
   `samples/<endpoint>.<ext>` — newest wins; agents read samples to learn
   response shapes without spending a request.

`fetch_status` speaks UPC: `success` / `partial` / `blocked` / `paywall` /
`login_required` / `failed` / `not_applicable`. Exit 0 covers success AND
honest skips; exit 1 means the recipe genuinely failed — probe the method or
fix the profile.
