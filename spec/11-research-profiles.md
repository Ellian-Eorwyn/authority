# ASR 11 — Research Profiles

*(0.4.0)* A **research profile** is a named, ordered selection of registries
for one line of work: "for EEI work, consult the scholarly registry, then the
energy registry"; "for an orchestra, consult music writing, orchestras, then
nonprofit filings". It answers *where to look* and nothing else.

It is not a **source profile** (`source.json`, §02). A source profile describes
one source and owns everything about reaching it; a research profile only
chooses registries and may narrow each to some of its own topics and facet
values.

## 11.1 Why a layer above registries

A registry is deliberately one domain (§01): energy axes and mycology axes do
not share a vocabulary. Real work crosses domains. A consumer that hardcodes
registry names ("scholarly", "energy") cannot be pointed at new work without
code changes. The research profile is where that choice is recorded, versioned
and checked.

## 11.2 Files and location

```text
<standard or project root>/
  profiles/
    <name>.json        # one research profile (schemas/profile.schema.json)
  registries/
    <registry>/        # §01
```

- A profile is one JSON file named `<name>.json`. Its `name` MUST equal that
  basename (`profile_name_mismatch`).
- `profile_id` is content-addressed: `prf-` + the first 12 hex of
  `sha256("prf\n" + name)` (§06.1). A stored id that disagrees is `id_mismatch`.
- Each registry entry names its registry by a **relative** `path` from the
  profile file (location independence, §01.1). An absolute path is
  `profile_path_absolute`.
- Tools find named profiles in `profiles/` beside the standard's `schemas/`,
  unless told otherwise (`--profiles <dir>`, or `AUTHORITY_PROFILES_DIR`). A
  reference containing a path separator or ending in `.json` is a path.

## 11.3 What a profile may and may not say

Per registry entry, in priority order:

| Member | Meaning |
|---|---|
| `path` | Relative path to the registry folder (required). |
| `registry_id` | The registry's own id, as a check that the path still means the intended registry (required; `profile_registry_mismatch`). |
| `use` | One line: what this registry contributes to the work. |
| `topics` | Optional narrowing to topic ids declared in *that* registry's `topics.json`. A topic includes its descendants. |
| `facets` | Optional default facet filter `{axis: [values]}` using *that* registry's `facets.json` (facets are registry-local, §01.5). |
| `notes` | Free text. |

A profile MUST NOT restate or override anything a source profile owns: access
methods, auth and credential references, limits, robots posture, endpoints,
routing, guidance, authority or verification. A registry entry carrying one of
those members is the error `profile_overrides_source`. A profile can make a
consumer look in fewer places; it can never make any source easier to reach
than its own profile allows.

A profile carries nothing about a client, a person or a question. That
belongs to the consumer (a research brief, a project folder).

## 11.4 Validation

`authority profile validate <name|path>` reports errors in the §08 result
shape. A profile is valid when all of the following hold:

| Rule | Code |
|---|---|
| parses and validates against `schemas/profile.schema.json` | `profile_invalid`, `profile_schema` |
| `name` equals the file's basename | `profile_name_mismatch` |
| `profile_id` recomputes | `id_mismatch` |
| every `path` is relative, resolves to a folder with `registry.json`, and appears once | `profile_path_absolute`, `profile_registry_missing`, `profile_registry_duplicate` |
| every `registry_id` matches the registry at that path | `profile_registry_mismatch` |
| every narrowing topic and facet value is declared by that registry | `unknown_topic`, `unknown_facet_value` |
| no entry carries a source-owned member (§11.3) | `profile_overrides_source` |

Validating a profile does not validate its registries; run `authority validate`
on each for that. Conformance levels (§08) stay a property of registries.

## 11.5 Querying through a profile

`authority query --profile <name|path> [--facet a=b ...] [--topic t] [--region R] [--task k]`
runs the §09 query against each registry of the profile, in order:

1. The registry's defaults from the profile apply first (its `facets`, and its
   `topics` with descendants).
2. A caller's `--facet` on an axis **replaces** that axis's default; a caller's
   `--topic` replaces the topic narrowing.
3. Facets and topics are registry-local. A registry that does not declare a
   requested facet axis or topic cannot answer that filter: it is **skipped**,
   and the result says why (`skipped: "does not declare facet …"`). It is never
   silently widened to "everything".
4. Within a registry, ranking is exactly §09's (routing disposition for the
   task, then tier, then verification state, then name). Results stay
   **grouped by registry in the profile's order**; a consumer that wants one
   list merges them itself and should keep the grouping visible.

The result carries `profile`, `profile_id`, the caller's query, a total
`count`, and `groups[]` with each registry's id, title, path, `use`, the
filters actually `applied`, `skipped`, and its `results`.

## 11.6 Commands

```bash
authority profile list [--profiles <dir>]
authority profile show <name|path>
authority profile validate <name|path>
authority query --profile <name|path> [filters]
authority mint prf  < {"name": "<name>"}
```
