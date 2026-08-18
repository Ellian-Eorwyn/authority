# ASR 05 — Credentials

ASR defines credential **resolution**, not storage. Profiles carry a
`credential_ref` — a name — and the value materializes only at execution time,
on the local machine, through a fixed chain. Nothing in a registry's tracked
files ever holds a secret; that is the L1 error `credential_in_profile`, and
the design goal is stronger: a registry can be published wholesale without a
secrets audit, because there is no place in the format where a secret could
legally sit.

## 5.1 References

A `credential_ref` matches `^[a-z][a-z0-9_]*$` (`credential_ref_invalid`
otherwise). One ref names one underlying secret: the same ref appearing on
several access methods — or in several registries — deliberately shares that
secret. Refs SHOULD be named after the provider, not the registry
(`eia_api_key`, `ebird_api_key`): keys are per-provider facts, and one key
serves every registry that profiles the provider. When a consumer harness already names the provider (e.g. a pi-forge
provider id), naming the ref identically makes §5.2's environment
compatibility automatic.

`credentials.example.json` (tracked) lists every ref the registry's profiles
mention, with placeholder values and signup notes, so a human can see at a
glance what the registry *can* use. The validator cross-checks it (advisory)
and scans it like any tracked file for real-looking values.

## 5.2 The resolution chain

For ref `R`, uppercased with every non-alphanumeric run replaced by `_` as
`R'`, resolution tries, in order, first hit wins:

1. **Environment: `AUTHORITY_CRED_<R'>`** — ASR's own namespace.
2. **Environment: `FORGE_API_KEY_<R'>`** — pi-forge's namespace, honored for
   zero-config compatibility with harnesses that already export it.
   - In both: a variable set to the **empty string explicitly disables** the
     ref for this process — the chain stops and resolves to null with reason
     `disabled`. (An operator can turn a key off without deleting it.)
3. **File: `<registry>/credentials.json`** — shape
   `{"version": 1, "credentials": {"<ref>": {"value": "…", "notes": ""}}}`.
   MUST be untracked (validator: `credential_file_unignored`, checked via
   `git ls-files` when inside a git repository, else by `.gitignore`
   inspection) and SHOULD be mode 0600 (warning when group/other-readable).
   Tools that write it create it 0600.
4. **macOS Keychain** — `security find-generic-password -s authority -a <ref>
   -w`. Service is the fixed string `authority`; the account is the bare ref,
   registry-agnostic (one `eia_api_key` entry serves all registries). On
   non-macOS platforms this step is skipped.

Failure to resolve is **null, never an error**: "this provider is not
available right now." A probe records outcome `auth_required` with the tried
chain; a fetch exits 0 with `skip_reason` naming the steps tried. Consumers
treat null as *skip with a stated reason* (the same semantics pi-forge gives a
missing provider key).

## 5.3 Handling rules

- Values are never printed, logged, or recorded — not in probe/fetch records
  (§04.4 redaction), not in error messages, not in `creds list` output (which
  shows refs and *which chain step* resolves each, only).
- `creds set` reads the value from hidden stdin (no value in argv, no shell
  history); keychain writes go through `security add-generic-password -U`
  prompting for the secret so it never appears in the process list.
- Tools MUST NOT copy resolved values into any file inside the registry, and
  MUST redact them from any URL or header they record (§04.4).
- `creds check` walks the chain for every ref the registry mentions and
  reports a resolution table plus the machine-local `operational_here`
  boolean surfaced by `validate` (§08.4). Credential resolvability is
  deliberately not part of a conformance level: it is a property of this
  machine, not of the registry.

## 5.4 What ASR does not do

No OAuth flows, no token refresh, no secret sync, no encryption of its own.
The chain terminates in stores the platform already provides (environment,
filesystem permissions, Keychain). A harness with a richer secret manager
plugs in by exporting `AUTHORITY_CRED_*` variables to the process — the chain
is the interface.
