---
name: authoritative-sources
description: Read, query, verify, and fetch from an ASR registry — the Authoritative Source Registry format for per-domain collections of operationally profiled sources (what each source is, why it is trusted, how its data is accessed, with probe-evidence-backed verification states and per-source credential references). Use when researching a domain that has a registry (consult profiles before searching the web), pulling data through a profiled API endpoint, probing or validating access claims, adding or updating source profiles, storing per-source API keys, or exporting a registry for pi-forge or UPC.
---

# Authoritative Source Registry (ASR) skill

This skill lets an agent consume, verify, and extend an **ASR registry**: a
per-domain folder of authoritative-source profiles where every access claim is
backed by stored probe evidence, credentials are referenced by name and
resolved locally, and fetched data carries UPC-compatible provenance sidecars.

The normative specification is in `spec/` at the root of the ASR standard.
Before writing profiles, read `references/profile-authoring.md`; before
probing or fetching, `references/probe-and-fetch.md`; to *use* a registry for
research, `references/agent-playbook.md` is the short path.

## Object model (one line)

`REGISTRY → SOURCE → ACCESS METHOD → ENDPOINT`, with **PROBE** records
(hashed evidence) backing every verification state and **FETCH** records
(UPC-compatible retrieval sidecars) proving recipes work.

## The one rule that matters most

**Every access claim is backed by stored evidence, or it says so.** States are
explicit: `verified` (probed, evidence hashed, fresh), `stale`, `asserted`
(honestly untested), `degraded`, `broken`, `blocked`, `retired`. Never set
`verified` by hand — run a probe. Never bypass a `blocked` state, robots
directive, paywall, or login wall — blocked is a recorded fact, not a
challenge. An unresolved credential means *skip with a stated reason*, never
an error and never a workaround.

## When to use

- Researching a domain with a registry → **read profiles first** (guidance,
  query shapes, pitfalls), fetch through verified endpoints instead of
  searching the web (`references/agent-playbook.md`).
- Not sure *which* sources settle a question → **`authority query`**
  (e.g. `--facet governance_domain=utility --facet sector=electricity --region
  US-CA --task legal_status`): faceted selection, ranked by routing, without
  knowing source names first. Axes AND, values within an axis OR — a narrow
  query over sparsely-tagged axes can legitimately return nothing.
- Pulling data from a profiled source → **`authority fetch`** (auth injected
  from the credential chain; payload + sidecar + optional tracked sample).
- Checking what works right now → **`authority validate`** (levels L0/L1/L2 +
  `operational_here`) or **`creds check`**.
- A claim looks stale or a source moved → **`authority probe`** (re-verify
  with evidence; state transitions are mechanical).
- Adding a source → **`authority add`** then edit the profile
  (`references/profile-authoring.md`); machine-written authority stays in
  `asserted`; never fill `adjudicated` yourself.
- Storing a key → **`authority creds set`** (env / gitignored file / macOS
  Keychain; never in tracked files).
- Feeding other tools → **`authority export`** (pi-forge canonical-sources,
  domain-strategies, provider stubs; markdown; CSV) and the UPC bridge
  (`crosswalks/upc.md`).

## Tools (`scripts/authority.mjs`, zero-dep Node ≥ 18)

Resolve this skill's directory from the loaded SKILL.md path, then shell out.
Machine-facing commands print `{status, artifacts, warnings, errors, data}`.

```bash
node scripts/authority.mjs init <dir> --title <t> [--topics a,b] [--contact <mailto>]
node scripts/authority.mjs add <registry> <homepage-url> [--name --role --tier --topics --no-probe]
node scripts/authority.mjs validate <registry> [--strict] [--level L0|L1|L2]
node scripts/authority.mjs probe <registry> [<source>] [--access <name>] [--all] [--force]
node scripts/authority.mjs fetch <registry> <source> <endpoint> [--param k=v ...] [--max-pages N] [--keep-sample]
node scripts/authority.mjs creds <set|list|check> [<ref>] [--registry <r>] [--keychain]
node scripts/authority.mjs regen <registry>
node scripts/authority.mjs query <registry> [--facet name=value ...] [--topic <id>] [--region <ISO>] [--task <t>]
node scripts/authority.mjs query --profile <name|path> [--facet name=value ...] [--topic <id>] [--task <t>]
node scripts/authority.mjs profile list|show|validate [<name|path>] [--profiles <dir>]
node scripts/authority.mjs export <registry> --format csv|json|markdown|agent-card|pi-canonical-sources|pi-domain-strategies|pi-provider-stub [-o <file>]
node scripts/authority.mjs build-index <registry>
node scripts/authority.mjs mint <asc|acc|end|prb|fch|prf>  < object.json
```

- **validate** — the spec/08 rule engine: schemas, recomputed ids, the
  evidence gate, secret scanning. Default target L1 (the promise level);
  `--level L2` also demands exercised endpoints. Reports `operational_here`
  (do this machine's credentials resolve?). Exit 0/1/2.
- **probe** — polite verification per access type (robots.txt captured as
  evidence, HEAD/GET, API ping via `probe_hint`, credentials resolved and
  REDACTED from records). Skips fresh `verified` methods unless `--force`.
- **fetch** — executes an endpoint recipe: param substitution, auth
  injection, robots/budget respected, pagination by declared style, payload
  to gitignored `fetched/` + sidecar, `--keep-sample` for a tracked capped
  response sample.
- **regen** — recomputes derived state (verified→stale on window lapse,
  rollups), manifest, CSV, browser. Crash-recovery move; run after hand-edits.
- **query** — faceted source selection over `scope.facets` + topic/region: AND
  across axes, OR within one; `--task` ranks by routing disposition then tier
  then verification. Read-only; each hit carries the agent-card fields.
- **profile / query --profile** — research profiles (spec/11): a named,
  ordered set of registries for a line of work (`profiles/<name>.json`, e.g.
  `eei`). `query --profile` runs the query per registry in profile order,
  results grouped; a registry that does not declare a requested facet axis or
  topic is skipped with the reason, never widened. A profile only chooses
  where to look; it can never loosen a source's access, limits or robots.
- **build-index** — self-contained offline `index.html` browser with
  verification badges and credential coverage.

`AUTHORITY_NOW=<ISO>` overrides the clock (deterministic tests);
`AUTHORITY_SCHEMA_DIR`/`AUTHORITY_VOCAB_DIR` override schema discovery when
the skill directory is vendored away from the standard repo.

## Writing to a registry — the rules that matter

1. **Ids are computed, never invented** — `authority add` and `mint` compute
   them; the validator recomputes every one (`id_mismatch` otherwise).
2. **States are derived** — probes and `regen` set `verification.state`; a
   hand-set state is `state_drift`/`unverified_claim`.
3. **Secrets never enter tracked files** — profiles carry `credential_ref`
   only; resolution is env (`AUTHORITY_CRED_*`, `FORGE_API_KEY_*`) →
   `credentials.json` (gitignored, 0600) → macOS Keychain.
4. **`authority.asserted` vs `authority.adjudicated` stay quarantined** — a
   model may triage (asserted); only an attributed human pass fills
   adjudicated.
5. **Journals are append-only** — corrections are new probe/fetch records,
   never rewrites.
6. **Politeness is enforced, not aspirational** — declared limits, delays,
   budgets, and robots postures are honored by probe/fetch; `blocked` ends
   the conversation.

## Adoption

pi-forge: this repo is a pi package (`package.json` → `"pi"`), or copy this
directory to `~/.agents/skills/`; exports regenerate its source registries —
see `crosswalks/pi-forge.md`. UPC: fetch sidecars are retrieval-compatible by
construction — see `crosswalks/upc.md`.
