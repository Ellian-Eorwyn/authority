# Changelog

All notable changes to the ASR standard are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
standard adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-08-17

Initial release of the Authoritative Source Registry standard.

### Added

- The hard promise: **every access claim is backed by stored evidence, or it
  says so** — verification states are recomputable from hashed probe artifacts.
- Object model: `REGISTRY → SOURCE → ACCESS METHOD → ENDPOINT`, with `PROBE`
  evidence records and `FETCH` exercise records.
- Normative specification `spec/00`–`09` plus appendix ADRs (credential-chain
  choice; evidence tracked vs payloads gitignored; `asc-` vs UPC `src-`
  identity).
- `vocab/vocab.json` — controlled vocabularies with `x-` escape hatches.
- JSON Schemas (2020-12) for registry, topics, source (with access-method and
  endpoint `$defs`), probe, fetch record, and the provenance stamp.
- Conformance levels **L0 Browsable / L1 Verified / L2 Operational**, a
  numbered rule registry with stable error codes, and per-rule fixtures.
- Zero-dependency reference CLI (`authority.mjs`, Node ≥ 18): `init`, `add`,
  `validate`, `probe`, `fetch`, `creds`, `regen`, `export`, `build-index`,
  `mint`.
- Credential resolution chain: `AUTHORITY_CRED_<REF>` / `FORGE_API_KEY_<REF>`
  environment variables → gitignored `credentials.json` → macOS Keychain.
- Crosswalks: UPC (fetch sidecar ⇄ `source.retrieval`) and pi-forge
  (canonical-sources / domain-strategies / provider-stub exports, credential
  mapping, pi package seam).
- Seed registries: `registries/energy`, `registries/philosophy`,
  `registries/naturalism` (23 profiles chosen to exercise every access
  pattern), plus a fictional example registry regenerated deterministically.
- Skill packaging: `skill/authoritative-sources/` (SKILL.md, manifest.json,
  references, scripts).
