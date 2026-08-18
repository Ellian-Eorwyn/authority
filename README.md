# Authoritative Source Registry (ASR)

**A tool-independent standard for per-domain registries of authoritative
sources, profiled operationally: what each source is, why it is authoritative,
and exactly how its data is accessed.** Version **0.1.0**.

An ASR registry is a folder in which both humans and software can always
answer: *Which sources should be consulted for this domain? Why are they
trusted? What content do they hold? Which access methods actually work — API,
bulk download, plain fetch, rendering required, or blocked — and what evidence
backs that claim?*

It is designed to be **machine-managed, human-browsable, and LLM-renderable to
any format** at the same time — the same three co-equal audiences as its
sibling standard, the [Universal Provenance Corpus](https://github.com/Ellian-Eorwyn/provenance).
Where UPC guarantees the integrity of material *after* collection, ASR
guarantees the honesty of the map that says *where and how to collect*.

## The one hard promise

**Every access claim is backed by stored evidence, or it says so.** An access
method marked `verified` was actually executed: a timestamped probe record with
hashed evidence sits beside the profile, and the validator recomputes the claim
from that evidence. A claim with no evidence, non-matching evidence bytes, or
evidence older than its staleness window is flagged. `verified`, `stale`,
`asserted`, `broken`, and `blocked` are explicit states — never absorbed, never
silently upgraded.

```
state = verified  ⇔  last probe outcome = ok
                     ∧ evidence bytes hash-match
                     ∧ age ≤ staleness window
```

An agent reading a registry always knows the difference between "verified 12
days ago", "asserted, never probed", and "known blocked". See
[spec/04](spec/04-probes-and-verification.md).

## The model in one picture

```
REGISTRY ──▶ SOURCE ──▶ ACCESS METHOD ──▶ ENDPOINT
                │             ▲               ▲
                │           PROBE           FETCH ──▶ artifact + sidecar
                └── relations (aggregates / mirror_of / supersedes / part_of)
```

- **Registry** — a per-domain folder of source profiles with a topic taxonomy
  and a machine-owned manifest.
- **Source** — an authoritative service (an agency, encyclopedia, database,
  archive), profiled once: identity, authority basis, scope, content model,
  lifecycle, guidance for agents.
- **Access method** — one way in: `api_rest`, `bulk_download`, `oai_pmh`,
  `web_fetch`, `web_render`, … with auth (by credential *reference*, never a
  value), limits, and robots posture.
- **Endpoint** — an operational recipe under an access method: path template,
  params, pagination, response shape, a ready-to-run example.
- **Probe** — the evidence record behind a verification state (the hard
  promise).
- **Fetch** — an exercised recipe: real data pulled through a profile, with a
  UPC-compatible retrieval sidecar so the result can seed a provenance corpus.

## Registry at a glance

```text
<registry>/
  registry.json               # machine-owned manifest (regenerable)
  topics.json                 # per-registry topic taxonomy (hand-authored)
  sources.csv                 # spreadsheet mirror (a projection)
  index.html                  # generated static browser (a projection)
  credentials.example.json    # tracked: credential refs + placeholders, no values
  credentials.json            # GITIGNORED local secret store (chmod 600)
  sources/
    <source-slug>/            # human-readable slug; canonical id inside source.json
      source.json             # the profile
      probes.jsonl            # append-only probe records (tracked)
      evidence/               # hashed probe artifacts (tracked — the proof)
      fetches.jsonl           # append-only fetch records (tracked)
      samples/                # small, capped, hashed response samples (tracked)
  fetched/                    # full fetch payloads + sidecars (GITIGNORED)
  .authority/                 # tool-private scratch, budget ledgers (GITIGNORED)
```

Secrets never enter tracked files: profiles carry a `credential_ref`, and the
value resolves locally through a chain — environment variable → gitignored
`credentials.json` → macOS Keychain ([spec/05](spec/05-credentials.md)).

## Core principles

1. The unit is an operational source profile, not a bookmark.
2. Authority is human-adjudicated; machine assertion is recorded separately and
   never contaminates it.
3. What a source *holds* (content model) and how it is *reached* (access model)
   are separate concerns.
4. **Access claims are evidence-backed** — the hard promise.
5. Secrets never enter tracked files; profiles carry references, resolution is
   a local chain.
6. Politeness is a format property: limits, robots posture, and budgets are
   recorded and enforced. Blocked is a recorded state, not a challenge.
7. Content-addressed identity by fully specified recipes; the validator
   recomputes every id.
8. Structured objects are the single source of truth; every human/consumer
   format is a regenerable projection.
9. Registries are per-domain, self-contained, and location-independent.
10. Storage is crash-safe and portable (atomic writes, portable filenames).

## Conformance levels

- **L0 Browsable** — valid manifest + profiles; paths contained; portable
  filenames; every source has at least one access method.
- **L1 Verified** — + recomputed ids + **no unverified access claims** (the
  promise) + no secrets in tracked files + robots posture recorded. L1
  guarantees *the registry never overstates what works*.
- **L2 Operational** — + endpoints exercised with fetch records + agent
  guidance + lifecycle declared. A separate `operational_here` flag reports
  whether credentials resolve on *this* machine (machine-local, deliberately
  not part of the level).

See [spec/08-conformance.md](spec/08-conformance.md) for the numbered rule
registry and error-code table; independent implementations can self-test
against `tests/conformance/`.

## Repository layout

| Path | What |
|---|---|
| `spec/` | The normative specification (`00`–`09` + appendices). Self-contained. |
| `vocab/vocab.json` | Single source of truth for closed enums; schemas `$ref` it. |
| `schemas/` | JSON Schema (2020-12) for every object type. |
| `examples/` | A fictional example registry, regenerated by `examples/build-examples.mjs` with true ids and truly hashed evidence. |
| `tests/` | `selftest.mjs` (library units) and `conformance/` (per-rule fixtures). |
| `crosswalks/` | Field-by-field mappings for UPC and pi-forge. |
| `skill/authoritative-sources/` | Portable zero-dep skill: `authority.mjs` CLI, common lib, references. |
| `registries/` | Real registries: `energy/`, `philosophy/`, `naturalism/`. |
| `CHANGELOG.md` | Version history. |

## Quickstart

Validate a registry (schema + integrity + the access-claim gate):

```bash
node skill/authoritative-sources/scripts/authority.mjs validate registries/energy
```

Probe a source's access methods and record the evidence:

```bash
node skill/authoritative-sources/scripts/authority.mjs probe registries/naturalism gbif
```

Fetch through a profiled endpoint (auth injected from the credential chain):

```bash
node skill/authoritative-sources/scripts/authority.mjs fetch registries/naturalism gbif species-search --param q=Amanita
```

Regenerate manifests, the CSV mirror, and the browser; then open `index.html`:

```bash
node skill/authoritative-sources/scripts/authority.mjs regen registries/energy
```

Create a new registry for any topic area:

```bash
node skill/authoritative-sources/scripts/authority.mjs init ~/registries/my-domain --title "My Domain"
```

Rebuild the examples and run the tests:

```bash
node examples/build-examples.mjs
node tests/selftest.mjs
node tests/conformance/build-fixtures.mjs && node tests/conformance/run-conformance.mjs
```

## Adopting ASR in a tool

Read the crosswalk for your tool ([pi-forge](crosswalks/pi-forge.md),
[UPC](crosswalks/upc.md)). Drop the `skill/authoritative-sources/` directory
into your skills folder to get the CLI; emit objects per the schemas; run
`authority validate`. Fetch sidecars are UPC-retrieval-compatible by
construction, so fetched material can seed a provenance corpus directly.

## License

[PolyForm Noncommercial License 1.0.0](LICENSE.md) — free for **any
noncommercial purpose** (personal use, research, education, nonprofits, public
institutions). Adopt the standard, implement it, fork it, extend it, share it,
all at no cost. **Commercial use requires a separate license** from the
copyright holder; `SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0`.
