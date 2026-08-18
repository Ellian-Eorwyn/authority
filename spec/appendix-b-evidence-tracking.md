# ASR Appendix B — ADR: Evidence tracked, payloads gitignored

**Status:** accepted (0.1.0). **Owner sections:** §01.1, §04.5, §07.

## Context

The hard promise makes verification states recomputable from stored probe
evidence — so that evidence must travel with the registry. But fetch payloads
are arbitrary-size working data (a bulk CSV can be gigabytes), and a registry
that balloons stops being clonable. Where is the tracking boundary?

## Options

1. **Track everything.** Maximal reproducibility; registries balloon;
   payload churn swamps diffs.
2. **Track nothing but profiles.** Lean; the promise dies — a `verified`
   badge would rest on evidence that only ever existed on one machine.
3. **Track small proof, ignore bulk data: evidence/ + samples/ + journals
   tracked; fetched/ + .authority/ ignored.**

## Evaluation

Evidence files are bounded by construction (full robots.txt, a headers
snapshot, a 64 KiB body sample); samples are capped at 256 KiB and one per
endpoint. Journals are append-only text. All diff cleanly and total a few MB
for a large registry. Payloads are unbounded and reproducible by re-running
the recorded recipe — and their durable facts (sha256, bytes, status) live
in the tracked `fetches.jsonl` line regardless.

## Decision

Option 3. The boundary is drawn by *role*: proof travels, working data
stays local. `fetches.jsonl` carries the full retrieval block inline so an
exercised recipe remains demonstrable (L2) after its payload is cleaned up —
`fetch_payload_missing` is deliberately a warning, not an error.

## Consequences

- Cloning a registry gives you every claim and every proof, not the data
  lake (§01.1 tracking rules; rule 2.2).
- A fresh machine can re-earn payloads by re-running recipes; it cannot
  re-earn evidence without probing, which is exactly the semantics probing
  should have.
- Samples give agents response shapes without live calls (§07.4) at a
  bounded, explicit cost — the only payload bytes that ever enter tracking,
  capped and hash-recorded.
