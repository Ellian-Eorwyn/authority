# ASR 00 — Overview

**Authoritative Source Registry (ASR), version 0.3.0.** This specification
defines a tool-independent format for per-domain registries of authoritative
sources, profiled operationally. The key words MUST, MUST NOT, SHOULD, SHOULD
NOT, and MAY are to be interpreted as described in RFC 2119.

## 0.1 What ASR is for

Research tooling knows how to *search the web*; it rarely knows *which sources
settle a question in a given domain, and exactly how to pull from each*. That
knowledge — this agency publishes the statute text, that database has a keyless
JSON API, this encyclopedia blocks plain fetches but permits its own search,
that portal fronts every report with a landing page — usually lives in a
researcher's head or in ad-hoc notes, and evaporates between projects.

An ASR registry makes that knowledge durable, checkable, and loadable. It is a
folder of **source profiles** for one domain (energy policy, philosophy,
natural history…), where each profile records:

- **identity, authority, and officiality** — what the source is, why it is
  trusted (machine triage quarantined from human adjudication), and its
  institutional status — official is not the same as true (§02);
- **scope, content, and coverage** — topics, jurisdiction, the kinds of
  artifacts the source holds (separate from how they are reached), and how
  completely it covers its domain (§02);
- **access** — every viable way in (API, bulk download, plain fetch, rendering
  required, blocked), down to endpoint recipes an agent can execute (§03);
- **verification and freshness** — the evidence behind every access claim, and
  separately whether the profile and the source's own content are still current
  (§04);
- **guidance and routing** — what the source is best for, query shapes that
  work, pitfalls that waste requests, and — per task — whether to search here,
  cite here, or follow the record to a primary source of record (§02);
- **federation provenance** — for imported profiles, which external registry a
  claim came from, kept distinct from local verification and adjudication (§10).

ASR is the upstream sibling of the **Universal Provenance Corpus** (UPC). UPC
guarantees the integrity of research material *after* collection — every
quotation traces byte-exactly to source. ASR guarantees the honesty of the map
that says *where and how to collect* — every access claim traces to stored
probe evidence. An ASR fetch emits a UPC-compatible retrieval sidecar (§07), so
material collected through a registry can enter a provenance corpus without
translation.

More precisely, ASR is a machine-readable **source-selection and retrieval-
routing layer**. Authority to help *discover* information is not the same as
authority to *establish* it: a high-quality aggregator can be the best place to
find a document while being the wrong thing to cite for its legal status. ASR
models the whole routing chain — research question → domain/jurisdiction →
discovery source → responsible institution → source of record → access method →
artifact → UPC — rather than collapsing every question into one flat authority
score. It can federate existing catalogs and registries while preserving the
provenance of imported claims and keeping discovery utility, institutional
officiality, evidential authority, operational access, and human adjudication
explicitly distinct.

## 0.2 The one hard promise

**Every access claim is backed by stored evidence, or it says so.** An access
method marked `verified` was actually executed: a timestamped probe record with
hashed evidence sits beside the profile, and a validator recomputes the claim
from that evidence. A claim with no evidence, non-matching evidence bytes, or
evidence older than its staleness window is flagged. `verified`, `stale`,
`asserted`, `broken`, and `blocked` are explicit states — never absorbed, never
silently upgraded.

```
state = verified  ⇔  last probe outcome = ok
                     ∧ evidence bytes hash-match
                     ∧ age ≤ staleness window
```

Everything else in this specification is justified by whether it serves that
gate. The payoff is the same one UPC buys with its quotation gate: an agent —
even a small one — can lean its trustworthiness on a dumb, recomputable check.
If it only acts on `verified` claims, it cannot act on a fabricated one; if it
acts on an `asserted` claim, it *knows* it is acting on an untested assertion
and can say so.

## 0.3 Three co-equal audiences

A registry serves three audiences, and none may win at the expense of another:

1. **Machine-managed.** Structured JSON objects with content-addressed ids,
   schemas, and a validator; tools resolve through manifests, never by guessing
   paths.
2. **Human-browsable.** Slug-named directories; a generated CSV mirror and a
   static HTML browser with verification badges; profiles readable top-to-
   bottom as prose-annotated JSON.
3. **LLM-renderable.** Profiles carry a guidance block written for agents;
   the skill packaging (SKILL.md + references) gives a language model the
   contract in loadable layers; any consumer format is a regenerable
   projection.

## 0.4 Principles

1. **The unit is an operational source profile, not a bookmark.** A URL with a
   title is a lead; a profile says what the source is, why it is trusted, what
   it holds, how it is reached, and what evidence backs each claim. (§02, §03)
2. **Authority is human-adjudicated; machine assertion is recorded separately
   and never contaminates it.** `authority.asserted` may be model-written
   triage; `authority.adjudicated` is null until a person fills it, and
   requires attribution. (§02)
3. **Content model and access model are separate concerns.** What a source
   holds and how it is reached vary independently; conflating them (as
   "doc_format" fields tend to) loses both. (§02, §03)
4. **Access claims are evidence-backed** — the hard promise. (§04)
5. **Secrets never enter tracked files.** Profiles carry a `credential_ref`;
   values resolve through a local chain (environment → gitignored file →
   keychain). (§05)
6. **Politeness is a format property.** Limits, robots posture, and budgets are
   recorded in profiles and enforced by tools. Blocked is a recorded state, not
   a challenge; a conforming tool never bypasses robots directives, paywalls,
   or login walls. (§03, §04, §07)
7. **Content-addressed identity by fully specified recipes.** Ids are computed,
   not invented, and the validator recomputes every one. (§06)
8. **Structured objects are the single source of truth.** The CSV mirror, the
   HTML browser, exports, and any LLM-produced view are regenerable
   projections; when they disagree with the objects, they are stale, not
   authoritative. (§09)
9. **Registries are per-domain, self-contained, and location-independent.** A
   registry resolves everything through its own manifest and travels as a
   folder; nothing binds it to a parent repository or absolute path. (§01)
10. **Storage is crash-safe and portable.** Atomic writes, append-only
    journals, portable filenames. (§01, §06)
11. **Discovery is not establishment; officiality is not truth; provenance is
    not adjudication.** A source can be the best place to *find* material
    without being the source that *supports the claim*; institutional status
    (`officiality`) records provenance, not correctness; an imported profile
    records where it came from, not that its authority was judged. Routing
    guidance, officiality, and federation provenance keep these apart, and none
    may set the authority tier. (§02, §10)
12. **Federation preserves the provenance of imported claims.** A registry MAY
    ingest profiles from external catalogs, but an imported claim is never
    silently upgraded: import records where a field came from; only a probe
    makes access `verified`, and only a human (or an attributed process) makes
    authority `adjudicated`. (§10)

## 0.5 The object model

```
REGISTRY ──contains──▶ SOURCE ──offers──▶ ACCESS METHOD ──exposes──▶ ENDPOINT
                          │                     ▲                       ▲
                          │                  PROBE (§04)             FETCH (§07)
                          │                evidence records        exercise records
                          └── relations: aggregates / mirror_of / supersedes /
                              superseded_by / part_of / api_for / companion_of /
                              indexes / operated_by / official_source_for /
                              discovery_for / resolves_to / publishes / catalogs
```

| Object | File | Section |
|---|---|---|
| Registry manifest | `registry.json` | §01 |
| Topic taxonomy | `topics.json` | §01 |
| Source profile | `sources/<slug>/source.json` | §02 |
| Access method | inline in the profile, `access[]` | §03 |
| Endpoint | inline in an access method, `endpoints[]` | §03 |
| Probe record | `sources/<slug>/probes.jsonl` + `evidence/` | §04 |
| Fetch record | `sources/<slug>/fetches.jsonl` + sidecars | §07 |

Credentials are references resolved outside the registry's tracked files (§05).
Identifiers and their recipes are specified in §06; conformance levels, rules,
and error codes in §08; projections and exports in §09; federation, upstream
provenance, and import in §10.

## 0.6 Self-containment and governance

This specification is self-contained: every algorithm a conforming
implementation needs — URL normalization, slugs, id recipes, the verification
state machine, the redaction rule, the conformance registry — is written out
here, so a registry can be produced and read without this repository's
reference code. Where the reference code and this document disagree, **the
document governs and the code is the bug**.

## 0.7 Versioning and extension

- `asr_spec_version` is semver. Within a major line, a reader for `x.y` MUST
  accept a registry stamped `x.z` for any `z ≥ y`: minor versions are additive.
- Every object schema sets `additionalProperties: true`, and a reader MUST
  ignore unknown members rather than reject them. Writers MUST NOT invent
  top-level members: tool-specific data goes in the namespaced `ext` object
  (`"ext": {"pi-forge": {…}}`), and per-tool identifiers go in `aliases`.
  Validators surface unknown members as the advisory `unknown_field` warning
  (an error only under `--strict`), so drift stays visible without breaking
  interchange.
- Closed enums live in `vocab/vocab.json` and nowhere else; schemas `$ref`
  them. Extensible enums accept an `x-`-prefixed escape hatch
  (`^x-[a-z0-9-]+$`), reported as the advisory `x_extension` warning so
  non-standard vocabulary stays visible.
- `registry.json.integrity.schema_hash` records a hash of the schema set the
  registry was written against (§01), so readers can detect skew within a
  minor version.

## 0.8 What ASR deliberately excludes

- **No fetching machinery beyond plain HTTP.** JavaScript rendering, browser
  automation, and CAPTCHA-adjacent behavior are the harness's concern; ASR
  records *that* rendering is required (`web_render`) and hands off. A
  rendering harness MAY append its own probe records through the same schema
  (§04.6).
- **No secret storage.** ASR defines resolution, not storage; the chain
  terminates in stores the platform already provides (§05).
- **No trust computation.** ASR records authority bases, tiers, and human
  adjudication; it does not compute reputation scores.
- **No harvesting orchestration.** Budgets and cadences are recorded and
  respected per call; scheduling recurring collection is a consumer concern.
- **No content archival.** Fetch payloads are working data (gitignored);
  durable archival of collected material is UPC's job, via the crosswalk.
