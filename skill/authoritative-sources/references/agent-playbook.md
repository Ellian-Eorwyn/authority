# Agent playbook: researching WITH a registry

The short path for consuming a registry, in order. (Authoring is
`profile-authoring.md`; mechanics are `probe-and-fetch.md`.)

## 1. Load the map

Read `registry.json` (title, defaults, source index) and `topics.json`. For
anything deeper, read the profiles the index points at — **guidance first**
(`guidance.best_for`, `query_shapes`, `pitfalls`): that block exists so you
spend requests well. `sources.csv` is the one-glance overview; per-endpoint
`samples/` show real response shapes without a live call. To find *which*
sources fit before reading any profile, run `authority query <registry>
--facet <axis>=<value> [--topic …] [--region …] [--task …]` against the axes in
`facets.json` — it returns the matching sources ranked, each with its routing.

## 2. Trust the states, and say what they mean

`access[].verification.state` is evidence-backed (that is the standard's hard
promise). Interpret and relay honestly:

| State | Meaning | Your move |
|---|---|---|
| `verified` | probed, evidence hashed, fresh | use it |
| `stale` | was verified; window lapsed | usable; suggest a re-probe |
| `asserted` | recorded, never successfully probed | may work; flag the uncertainty; a waiver note often says why (usually a missing key) |
| `degraded` | works with warning signs | use carefully; expect slowness/quirks |
| `broken` | last probe failed (network/5xx/moved) | don't rely on it; the probe note says what happened |
| `blocked` | the source refuses automation (403/robots/login) | do NOT work around it; use the profile's suggested alternative (usually the rendering harness or a human) |
| `retired` | closed on purpose | ignore |

Prefer earlier entries in `access[]` (preference order). If every method is
blocked/broken, the profile's pitfalls usually name the sanctioned path.

## 3. Fetch through profiles, not around them

```bash
node scripts/authority.mjs fetch <registry> <source> <endpoint> --param k=v [--keep-sample]
```

- Required params are declared in the endpoint (`params[].required`); the
  error message lists what's missing.
- Credentials resolve automatically (env → registry file → Keychain). If the
  fetch reports `skipped` with a tried-chain, the honest answer is "no key on
  this machine" — say that, point at `auth.signup_url`, and offer
  `authority creds set <ref>`. Never paste a literal secret into a command.
- The payload lands in `fetched/<slug>/` with a `.fetch.json` sidecar whose
  `retrieval` block is UPC-compatible — hand both to any provenance pipeline.
- Respect what the record says: `blocked`/`paywall`/`login_required` are
  terminal facts to report, not obstacles to route around.

## 4. Keep the registry honest as you go

- A surprising failure? `authority probe <registry> <source> --force` updates
  the state with fresh evidence — that IS the repair.
- Learned something operational (a landing-page quirk, a rate-limit surprise,
  a better query shape)? Add it to the profile's `guidance` — that is the
  block future agents read. Never touch `authority.adjudicated`.
- After any hand-edit: `authority regen <registry>`, then
  `authority validate <registry>`.

## 5. Answer with provenance

When you cite fetched material, carry the sidecar facts (URL, fetched_at,
sha256) forward. `operational_here: false` in a validate report means some
credential refs don't resolve on this machine — report which (from
`creds check`), don't improvise.
