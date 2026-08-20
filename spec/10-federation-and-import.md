# ASR 10 — Federation and Import

ASR registries are curated, not scraped. But much of what belongs in a registry
is already described somewhere — a research-data catalog, a government DCAT
feed, an organization registry. This section defines how a registry may
**federate** from those sources without ever laundering their claims into
guarantees ASR has not earned. The governing rule is one sentence: *an imported
claim is not a locally verified or adjudicated claim.*

## 10.1 Four epistemic events, kept distinct

Federation is only safe if four different things never collapse into one:

1. **The upstream says it.** "FAIRsharing lists this repository as having a REST
   API." A fact about an external record.
2. **ASR imported it.** ASR converted that record into a candidate profile and
   recorded where each field came from. A fact about provenance.
3. **ASR probed it.** ASR exercised the access method and stored evidence. A
   fact about operation — the only thing that makes a method `verified` (§04).
4. **A human adjudicated it.** A person (or an explicitly attributed process)
   judged the source's authority. The only thing that fills
   `authority.adjudicated` (§02.3).

Each is a separate record with separate provenance. Import performs (1)→(2)
only. It MUST NOT perform (3) or (4), and MUST NOT let an upstream assertion
masquerade as either.

## 10.2 Upstream provenance — `discovery.upstream[]`

A federated profile records each external record it drew from in
`discovery.upstream[]`, and sets `discovery.discovered_via` to
`"registry_import"`. Each entry:

| Field | Meaning |
|---|---|
| `registry` | which catalog (`fairsharing`, `re3data`, `datagov`, `ror`, `dcat`, `loc_law`, `opendoar`, `other`; extensible `x-`) |
| `record_id` | the upstream record's stable id (e.g. `FAIRsharing.abc123`, an re3data orgIdentifier) |
| `record_url` | where the record lives |
| `retrieved_at` | when ASR fetched it (RFC 3339 UTC) |
| `upstream_updated_at` | the record's own last-modified time, when known — feeds re-sync decisions |
| `mapping_version` | the adapter/crosswalk version, e.g. `re3data-asr@1` |
| `inherited_fields[]` | the ASR field paths whose values were taken from this record (e.g. `identity.name`, `content.artifacts`) |

`inherited_fields` is the honesty ledger: it says exactly which parts of the
profile are upstream-derived rather than locally established, so a later editor
knows what to re-check. A profile MAY carry several `upstream[]` entries when it
is enriched from more than one catalog. The field-by-field mappings per catalog
are in `crosswalks/` (`dcat.md`, `fairsharing.md`, `re3data.md`, `ror.md`).

## 10.3 What import sets — and what it must not

A conforming importer, converting an upstream record to a candidate profile:

- sets `provenance.produced_by.method = "import"`;
- sets `discovery.discovered_via = "registry_import"` and populates
  `discovery.upstream[0]` per §10.2;
- MAY set `authority.asserted` (triage — tier/basis inferred from the upstream
  record type), because assertion is explicitly non-authoritative (§02.3);
- MUST leave `authority.adjudicated` null — importing never adjudicates;
- MUST set every access method's `verification.state` to `asserted` — importing
  never probes, so nothing is `verified`;
- MUST NOT invent probe records or evidence.

The validator enforces the separation: an adjudication on an
`method: "import"` profile draws the advisory `adjudication_by_import` (rule
1.10), and a `verified` state without a matching `ok` probe is the L1 error
`unverified_claim` (§04) regardless of how the profile was produced. Upstream
metadata is never *silently upgraded* — promoting an imported access claim to
`verified` requires an actual probe; promoting authority to `adjudicated`
requires an attributed human pass.

## 10.4 The candidate lifecycle

ASR adds value through **selection**, not bulk mirroring: an upstream catalog
may hold tens of thousands of records, and a registry must not become a local
copy of it. Import is therefore a staging step, not a commit:

```
external registry
      │ search / fetch one record
      ▼
raw upstream record
      │ adapter (crosswalks/<registry>.md)
      ▼
candidate profile  ── written to a staging path, NOT registry.json
      │ human selects: relevant to this registry's scope?
      ▼
promote → probe (§04) → adjudicate (§02.3) → active profile
```

A candidate profile is a valid `source.json` that simply is not yet listed in
`registry.json.sources` — so it does not count toward the registry's conformance
or counts until promoted through the normal `add`/`probe` flow. 0.2.0 keeps the
candidate state **out of the core schema** deliberately: a candidate is
distinguished by *where it lives*, not by a new lifecycle field, so the schema
gains no state a 0.1.0 reader must understand. A future revision MAY formalize a
`candidate`/`active`/`rejected`/`retired` lifecycle if selection workflows
warrant it.

## 10.5 Respecting the upstream

Federation follows the same politeness the rest of ASR does (§03.3, §04.2): an
importer honors the upstream API's robots rules, rate limits, authentication,
and terms exactly as a probe would. An upstream that requires a credential is
recorded as such (the reference proof-of-concept targets re3data precisely
because its API is open); a login-gated catalog like FAIRsharing is a documented
adapter whose import step a human runs with their own credential. Import does
not fight the upstream any more than a probe fights a source.

## 10.6 Relationship to the reference CLI

`authority import <registry> <adapter> <record-id | --from file.json>` runs one
adapter over one upstream record and writes a candidate profile (default: a
staging directory, never the live index). It is deliberately narrow — one
record at a time, provenance retained, no probing, no adjudication — so that the
epistemic events of §10.1 stay separable in code as well as in prose.
