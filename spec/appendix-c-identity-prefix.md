# ASR Appendix C — ADR: `asc-` identity, distinct from UPC `src-`

**Status:** accepted (0.1.0). **Owner section:** §06.

## Context

ASR and UPC are sibling standards by the same author, designed to
interoperate: an ASR fetch seeds a UPC source. UPC already mints
`src-<12hex>` = sha256 of `"src\n" + canonical_url`. Should an ASR source
profile reuse that scheme, so the same URL yields the same id in both?

## Options

1. **Reuse `src-` and its key.** One id per URL everywhere; no mapping.
2. **Same recipe family, distinct prefix and key-domain: `asc-` over
   `"asc\n" + canonical_url`.**

## Evaluation

The two objects are not the same thing. A UPC source is a *captured object*
(an article, a PDF — often keyed on a deep URL or content hash); an ASR
source is a *service profile* (keyed on a homepage). Where both exist for
one URL, they still mean differently: UPC's answers "what did I collect?",
ASR's answers "what service is this and how do I use it?". Sharing a prefix
would make ids collide *in meaning* while rarely colliding in value —
`src-a1b2…` in a mixed pipeline would not say which standard's semantics
apply, and tooling that resolves ids by prefix could not route. The
domain-prefixed key (`"asc\n"`) guarantees the hashes differ even for an
identical URL, making accidental cross-standard equality impossible rather
than merely unlikely.

## Decision

Option 2. Same recipe *family* (§06 intentionally matches UPC §06 so one
implementation serves both), disjoint namespace. The bridge is explicit
instead: a UPC source born from an ASR fetch records
`discovery.discovered_from: "authority:<asc-id>"` and may carry the ASR ids
in `ext` (crosswalks/upc.md).

## Consequences

- Prefix-routing works in mixed pipelines; no id ever needs context to
  interpret.
- The crosswalk carries one explicit mapping line instead of an implicit
  identity pun.
- Cost: a tool wanting "the ASR profile for this UPC source" resolves
  through the recorded bridge rather than by recomputing a shared hash —
  accepted, because the bridge also survives the cases where the URLs
  genuinely differ (deep link vs homepage).
