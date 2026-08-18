# Crosswalk: ASR ⇄ pi-forge

pi-forge already splits the authority problem the way ASR does — and says so
in its own comments: `canonical-sources.json` is *"editorial policy — who to
trust"*, deliberately separate from the search-provider registry, which is
about *"how to reach a given source"*. ASR formalizes both halves in one
profile. Adoption is **generation, not rewrite**: registries become the
upstream source of truth, and the pi-forge files become exports refreshed by
`authority export`. Field names below are verified against the real files:
`forge/skills/vault-wiki/references/canonical-sources.json`,
`forge/skills/web-research/scripts/search-providers.mjs`,
`forge/skills/web-research/references/domain-strategies.json`,
`forge/lib/connected-services.mjs`.

## What already matches (no work)

- **Credential semantics.** ASR's chain honors `FORGE_API_KEY_<REF>` as its
  second env step (spec/05.2), adopts empty-string-disables, and treats an
  unresolved key as *"unavailable — skip with reason, never an error"* —
  pi-forge's exact contract. Name each `credential_ref` after the pi-forge
  provider id (`sep`, `guardian`, …) or provider-style slug and the env
  compatibility is automatic, with no mapping table.
- **Authority-as-ordinal.** `canonical-sources.json` `authority` (1 = try
  first) and ASR `authority_tier` share the 1..3 shape; ASR exports
  `adjudicated.tier ?? asserted.tier`.
- **Topic vocabularies are per-registry by design** on the ASR side; the
  export applies `registry.json.ext["pi-forge"].topic_map` and lists any
  unmapped topics in-band (spec/09.5), so drift is visible, not silent.
- **Grounding doctrine.** forge's "model knowledge is an index, not a
  source" is ASR's hard promise applied to access claims; profiles carry
  URL + access date + sha256 natively.

## The three exports

### 1. `authority export --format pi-canonical-sources`

→ drop-in for `forge/skills/vault-wiki/references/canonical-sources.json`.

| canonical-sources field | From ASR |
|---|---|
| `schemaVersion` | `1` (fixed) |
| `updatedAt` | export date |
| `sources[].id` | `ext["pi-forge"].provider ?? slug` |
| `sources[].label` | `identity.name` |
| `sources[].site` | host of `identity.canonical_url` |
| `sources[].authority` | `authority.adjudicated.tier ?? authority.asserted.tier` |
| `sources[].kinds` | `ext["pi-forge"].kinds ?? ["*"]` |
| `sources[].topics` | `scope.topics` mapped through `topic_map` |
| `sources[].notes` | first `guidance.best_for` entry (fallback: description) |
| `sources[].provider` | `ext["pi-forge"].provider ?? null` |

Output is deterministic (sorted by id) because `vault-wiki.py`
`load_source_policy()` sha256-hashes the file for provenance. Extra members
(`generated_by`, `registry`, `unmapped_topics`) are additive; the consumer
reads only the fields it knows.

### 2. `authority export --format pi-domain-strategies`

→ merge into `forge/skills/web-research/references/domain-strategies.json`.
One entry per web-transport access method: `preferred_strategy`
(`web_fetch`/`bulk_download` → `direct_http`, `web_render` → browser
strategy), `rate_limit.requests_per_second` from `limits`, `last_verified`
from the verification block (**probe-backed, not hand-dated** — the point of
the exercise), selector passthrough from `ext["pi-forge"].selectors`, and
notes composed from the landing pattern + pitfalls.

### 3. `authority export --format pi-provider-stub`

→ the human's worksheet for adding a `SEARCH_PROVIDERS` entry in
`forge/skills/web-research/scripts/search-providers.mjs`. Prefills what a
profile knows: `capabilities()` fields (`authRequired`, scheme, the exact
`FORGE_API_KEY_*` env var, rate limits, `dailyBudget` for
`provider-budget.mjs`'s `DECLARED_BUDGETS`, strengths/limits from
guidance), plus every endpoint recipe (method, path template, params,
response format, pagination style). `search()`/`resolve()` remain human
work — they encode result-shape judgment, not access facts.

## Loading registries into pi-forge as a skill

The authority repo is a **pi package**: its `package.json` carries
`"pi": {"skills": ["skill"]}`. Append the repo path to `packages` in
`~/.pi-forge/agent/settings.json` and `skill/authoritative-sources/` loads
like any forge skill — `configure-pi-forge.mjs` preserves appended package
entries across `pi-forge-update`. Alternatively, symlink or copy the skill
directory to `~/.agents/skills/authoritative-sources/` (the harness-agnostic
convention). No pi-forge changes either way.

An agent-facing tool wrapper, if wanted later, follows the
`forge/extensions/web-research.ts` pattern: a thin `pi.registerTool` whose
`execute` spawns `authority.mjs <cmd>` — every command already prints the
`SCRIPT_TOOL_CONTRACT` shape `{status, artifacts, warnings, errors, data}`,
so the wrapper is a schema, not a parser. Budget the tool's prompt tokens;
the skill's SKILL.md is written to stay small for the same reason.

## Gaps pi-forge must close (only if full generation is wanted)

- `canonical-sources.json` currently hand-carries a few sources with no
  operational profile (pure editorial entries); either profile them in a
  registry or keep a small hand-merged remainder.
- `search-providers.mjs` provider modules embed result-parsing code ASR
  does not model; stubs prefill capabilities only.
- forge's per-domain selector knowledge lives in `domain-strategies.json`
  today; migrating it upstream means copying selectors into each profile's
  `ext["pi-forge"].selectors` once.

## Dry run

```bash
node examples/build-examples.mjs
node skill/authoritative-sources/scripts/authority.mjs export examples/example-registry --format pi-canonical-sources
# → shape-compare with forge/skills/vault-wiki/references/canonical-sources.json
node skill/authoritative-sources/scripts/authority.mjs export registries/philosophy --format pi-canonical-sources
# → the philosophy registry names sep/iep/inpho providers in ext["pi-forge"],
#   so ids and providers line up with forge's existing entries.
```
