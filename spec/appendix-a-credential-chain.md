# ASR Appendix A — ADR: The credential resolution chain

**Status:** accepted (0.1.0). **Owner section:** §05.

## Context

Profiles must let an agent use per-source API keys on the user's behalf, but
a registry must be publishable — even accidentally — without leaking a
secret. Ellie's harness (pi-forge) already resolves data-provider keys as
`explicit option → FORGE_API_KEY_<ID> env → settings file`, with null
meaning "provider unavailable, skip with reason". macOS offers a real secret
store (Keychain via `security(1)`).

## Options

1. **Reference indirection + pluggable chain: env → gitignored file →
   Keychain.**
2. **Keychain only.** Strongest at-rest story; macOS-only; nothing works on
   another platform or in a bare CI shell.
3. **Gitignored file only.** Simplest; plaintext at rest with no
   OS-protected option; no process-scoped override for turning a key off.

## Evaluation

| Criterion | Chain | Keychain-only | File-only |
|---|---|---|---|
| Secret can exist in tracked file | never (refs only) | never | never |
| Works cross-platform | yes (keychain step skipped) | no | yes |
| OS-protected storage available | yes | yes | no |
| Harness compatibility (pi-forge env) | automatic | no | no |
| Per-process disable | yes (empty env) | no | no |
| Zero-dependency implementation | yes | yes (`security`) | yes |

## Decision

Option 1. Order is env (`AUTHORITY_CRED_*`, then `FORGE_API_KEY_*`) → file →
Keychain: the most explicit, most ephemeral store wins, and an operator can
override or disable without touching stored values. Empty-string-disables and
null-means-skip-with-reason are adopted verbatim from pi-forge because
consumers there already treat them as contract. Keychain entries are
registry-agnostic (service `authority`, account = ref): a key is a fact about
a provider, not about a registry.

## Consequences

- A registry is publishable wholesale; the format has no slot where a secret
  could legally sit (§05, rule 1.7).
- Resolution is machine-local, so conformance cannot depend on it — hence the
  separate `operational_here` report (§08.4).
- OAuth flows and token refresh are out of scope; a harness with a richer
  secret manager integrates by exporting `AUTHORITY_CRED_*` to the process.
