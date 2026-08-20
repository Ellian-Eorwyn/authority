# ASR 01 — Registry, Manifest, and Topics

## 1.1 A registry is a folder

A registry is a directory holding everything about one domain's authoritative
sources. It is self-contained (no references outside its root except the
schemas it names by version) and location-independent (no absolute paths; a
registry moved or cloned elsewhere remains valid).

```text
<registry>/
  registry.json               # machine-owned manifest (regenerable, §1.3)
  topics.json                 # topic taxonomy (hand-authored, §1.5)
  facets.json                 # facet vocabularies (hand-authored, optional, §1.5)
  sources.csv                 # projection (§09)
  index.html                  # projection (§09)
  credentials.example.json    # tracked: refs + placeholders, never values (§05)
  credentials.json            # NOT TRACKED, chmod 600 (§05)
  sources/
    <source-slug>/
      source.json             # the profile (§02)
      probes.jsonl            # append-only probe records (§04)
      evidence/               # hashed probe artifacts (§04)
      fetches.jsonl           # append-only fetch records (§07)
      samples/                # small tracked response samples (§07)
  fetched/                    # NOT TRACKED: full payloads + sidecars (§07)
  .authority/                 # NOT TRACKED: tool-private scratch (§1.7)
```

Rules:

- Paths named by any object MUST resolve inside the registry root
  (`path_escape`), through no symlink that leaves it (`symlink_escape`).
- Filenames MUST be portable: UTF-8, no characters from `<>:"/\|?*`, no
  control characters, no Windows reserved names (CON, PRN, AUX, NUL, COM1–9,
  LPT1–9), no trailing dot or space, ≤ 200 bytes per segment
  (`filename_illegal`).
- A tracking boundary is part of the format: `credentials.json`, `fetched/`,
  and `.authority/` MUST NOT be tracked when the registry lives in a version-
  control repository (§05, §07). Probe evidence and samples MUST be tracked —
  they are the proof behind the hard promise.

## 1.2 Writes are atomic; journals are append-only

Every JSON file write MUST be atomic: write to a temporary sibling
(`.<name>.tmp`), fsync, rename over the target. `probes.jsonl` and
`fetches.jsonl` are append-only journals: one JSON object per line, appended
with fsync; a torn final line (crash mid-append) is tolerated by readers and
reported as the advisory `jsonl_torn_tail`; any other malformed line is the
error `jsonl_invalid`. Tools MUST NOT rewrite journal history; corrections are
new records.

## 1.3 The manifest (`registry.json`)

The manifest is **machine-owned and regenerable**: `authority regen` rebuilds
its derived parts — the source index, counts, integrity — from the profiles on
disk, atomically. Hand-set fields (title, description, defaults, contact)
survive regen. Because regen rebuilds derived state from the objects, it is
also the crash-recovery move: after any interrupted operation, run regen.

Schema: `schemas/registry.schema.json`. Required members: `registry_id`
(`reg-<12hex>`, an opaque nonce minted at init — format-checked, not
content-addressed), `asr_spec_version`, `title`, `sections`, `sources`,
`provenance`.

The manifest is self-describing. `readme` carries one paragraph a tool with no
ASR knowledge can read; `rules_note` points at this specification. `authority
init` seeds:

> Authoritative Source Registry. Source profiles under sources/, one directory
> per source; resolve objects through this manifest's sections and source
> index, never by guessing paths. Access claims are verified against stored
> probe evidence (see rules_note); credentials are referenced by name and never
> stored in tracked files.

## 1.4 Sections and resolution

`sections` maps logical section names to physical paths relative to the
registry root; a value ending in `/` is a directory. Standard sections:
`sources`, `topics`, `sources_csv`, `index_html`, `credentials_example`,
`fetched`. Tools MUST resolve through `sections` and the source index rather
than hard-coding layout, and MUST tolerate unknown extra sections.

The source index (`sources[]`) carries `{source_id, slug, name, path,
verification_state}` per profile. The index is a cache of the profiles
(regenerable); on disagreement the profiles govern and the finding is
`counts_mismatch` / `csv_stale` class, repaired by regen.

## 1.5 Topics and facets (`topics.json`, `facets.json`)

The topic taxonomy is **hand-authored, not regenerable** — it encodes human
curation. Schema: `schemas/topics.schema.json`. Each topic has a kebab-case
`id`, a `label`, optionally a `parent` (shallow hierarchy), and optionally an
`objective` tying the topic back to the research question or contract clause
that motivated it.

Every topic id a profile claims in `scope.topics` MUST exist in `topics.json`
(`unknown_topic`). Taxonomies are per-registry by design: a registry maps its
topics onto consumer vocabularies (e.g. an agent harness's router topics) in
its export configuration (§09), not by flattening its own taxonomy.

**Facets** (`facets.json`, schema `schemas/facets.schema.json`) are the
complementary hand-authored file: where `topics` is one single-parent subject
tree, facets are **independent classification axes** a source carries at once
(governance domain, sector, policy stage, …). The file declares an array of
facet axes, each `{id, label, values:[{id, label}]}`; axis and value ids are
slugs. A profile's `scope.facets` (§02.4) references them, and every axis id and
value it uses MUST be declared here (`unknown_facet_value`). Like topics, facet
vocabularies are **registry-local** — never part of the universal core — and the
file is optional: a registry with no facet axes simply omits it, and the
manifest points at it through `sections.facets` (default `facets.json`). Keeping
facets a separate file from the single-parent `topics.json` keeps the two shapes
— tree vs. orthogonal axes — from being conflated.

## 1.6 Integrity

`integrity.schema_hash` is `"sha256:" + sha256hex(JCS({filename: sha256hex
(bytes)}))` over every file in `schemas/` plus `vocab/vocab.json` of the spec
version the registry was written against, filenames sorted lexicographically
(JCS per RFC 8785, §06). Readers use it to detect schema skew within a minor
version; regen recomputes it.

## 1.7 Tool-private scratch (`.authority/`)

Tools MAY keep caches, budget ledgers (§07.5), and cursors under `.authority/`.
Nothing under it is part of the registry: validators MUST ignore it, and
deleting it MUST lose nothing that cannot be recomputed or re-earned. It is
never tracked.
