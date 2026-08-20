// authority_import.mjs — federation / import (spec/10). Converts ONE upstream
// registry record into a CANDIDATE ASR source profile and writes it to a
// staging path (never registry.json). By construction it performs only the
// first two of the four epistemic events (§10.1): the upstream says it, and
// ASR imported it. It never probes (every access stays `asserted`) and never
// adjudicates (`authority.adjudicated` stays null); promotion, probing, and
// adjudication are separate, later steps. Zero-dep, same constraints as the
// rest of the CLI.

import fs from "node:fs";
import path from "node:path";
import {
  mintAscId, mintAccId, canonicalUrl, slugify, slugifyWithCollision,
  isoMs, writeJsonAtomic, readJSON, loadRegistry, toolResult, printResult,
} from "./authority_common.mjs";

function fail(msg, code = 2) {
  process.stderr.write("authority: " + msg + "\n");
  process.exit(code);
}

function nowIso() {
  return process.env.AUTHORITY_NOW ? isoMs(new Date(process.env.AUTHORITY_NOW)) : isoMs();
}

// ---------------------------------------------------------------------------
// Adapter registry. Each adapter is { normalize(raw, {id}) -> record }, where
// `record` is the normalized upstream shape the mapper below consumes. Keeping
// the network/XML mess in `normalize` lets the ASR mapping stay one function.
// ---------------------------------------------------------------------------

const ADAPTERS = {
  // re3data — Registry of Research Data Repositories. Open REST API
  // (https://www.re3data.org/api/v1), which is why it is the reference PoC.
  // The live API returns r3d XML; --from consumes a normalized JSON record
  // (the canonical, deterministic path). See crosswalks/re3data.md.
  re3data: {
    mapping_version: "re3data-asr@1",
    registry: "re3data",
    liveUrl: (id) => `https://www.re3data.org/api/v1/repository/${encodeURIComponent(id)}`,
    recordUrl: (id) => `https://www.re3data.org/repository/${encodeURIComponent(id)}`,
    normalize(raw, { id, isXml }) {
      if (!isXml) return { re3data_id: raw.re3data_id || raw.id || id, ...raw };
      // Best-effort r3d XML extraction (no XML dependency). The JSON path is
      // canonical; --live is a convenience.
      const one = (re) => (String(raw).match(re) || [])[1]?.trim() || null;
      const many = (re) => [...String(raw).matchAll(re)].map((m) => m[1].trim()).filter(Boolean);
      return {
        re3data_id: one(/<r3d:re3data\.orgIdentifier>([^<]*)</i) || id,
        repositoryName: one(/<r3d:repositoryName[^>]*>([^<]*)</i),
        repositoryURL: one(/<r3d:repositoryURL>([^<]*)</i),
        description: one(/<r3d:description[^>]*>([\s\S]*?)<\/r3d:description>/i),
        subjects: many(/<r3d:subject[^>]*>([^<]*)</gi),
        api: many(/<r3d:api[^>]*>([^<]*)</gi).map((url) => ({ url })),
        institutions: many(/<r3d:institutionName[^>]*>([^<]*)</gi).map((name) => ({ name })),
        lastUpdate: one(/<r3d:lastUpdate>([^<]*)</i),
      };
    },
    // Map a normalized re3data record -> ASR profile fields (crosswalks/re3data.md).
    toProfile(rec, ctx) {
      const homepage = rec.repositoryURL;
      if (!homepage) fail("re3data record has no repositoryURL — cannot mint an identity", 1);
      const canon = canonicalUrl(homepage);
      if (!canon) fail("re3data repositoryURL is not a parseable URL: " + homepage, 1);
      const inst = (rec.institutions || [])[0];
      const inherited = ["identity.name", "identity.homepage_url"];
      if (rec.description) inherited.push("identity.description");
      if (inst) inherited.push("identity.operator");
      if ((rec.api || []).length) inherited.push("access");
      const artifacts = [{ kind: "dataset_file", formats: [], notes: "research datasets held by the repository" }];
      if ((rec.api || []).length) artifacts.push({ kind: "structured_record", formats: ["json"], notes: "repository metadata/records via API" });
      return {
        canonical_url: canon,
        homepage_url: homepage,
        name: rec.repositoryName || new URL(canon).hostname,
        description: rec.description || "",
        operator: inst ? { name: inst.name, identifiers: { ror: inst.ror || null, wikidata: inst.wikidata || null, other: [] } } : null,
        role: "repository",
        cls: "primary",
        basis: ["primary_dataset"],
        artifacts,
        api: (rec.api || [])[0]?.url || null,
        record_id: rec.re3data_id,
        inherited,
      };
    },
  },
};

// ---------------------------------------------------------------------------
// cmdImport
// ---------------------------------------------------------------------------

export async function cmdImport(args, ctx) {
  const [root, adapterName, posId] = args.pos;
  if (!root || !adapterName) {
    fail("usage: authority import <registry> <adapter> <record-id | --from file.json> [--live] [--out <dir>]");
  }
  const adapter = ADAPTERS[adapterName];
  if (!adapter) fail(`unknown adapter "${adapterName}" (have: ${Object.keys(ADAPTERS).join(", ")})`);

  const reg = loadRegistry(root); // resolves defaults + existing slugs; import never mutates the manifest
  const fromFile = typeof args.flags.from === "string" ? args.flags.from : null;
  const live = !!args.flags.live;
  const recordId = posId || (fromFile ? null : null);

  // --- obtain the raw upstream record ---
  let raw, isXml = false, id = recordId;
  if (fromFile) {
    raw = readJSON(path.resolve(fromFile));
    id = id || raw.re3data_id || raw.id || null;
  } else if (live) {
    if (!recordId) fail("--live needs a <record-id>");
    const url = adapter.liveUrl(recordId);
    const res = await fetch(url, { headers: { "user-agent": `authority-import/${ctx.TOOL_VERSION}`, accept: "application/xml, application/json" } });
    if (!res.ok) fail(`upstream fetch failed: HTTP ${res.status} for ${url}`, 1);
    const text = await res.text();
    isXml = /^\s*</.test(text);
    raw = isXml ? text : JSON.parse(text);
  } else {
    fail("provide a record id with --live, or a captured record with --from file.json");
  }

  const rec = adapter.normalize(raw, { id, isXml });
  const p = adapter.toProfile(rec, ctx);
  const recId = rec.re3data_id || p.record_id || id;
  if (!recId) fail("could not determine the upstream record id", 1);

  const ts = nowIso();
  const sourceId = mintAscId(p.canonical_url);
  const existing = new Set(reg.sources.map((s) => path.basename(s.dirRel).toLowerCase()));
  const slug = slugifyWithCollision(p.name, sourceId, existing);

  // --- build access methods (all `asserted` — import never probes, §10.3) ---
  const origin = new URL(p.canonical_url).origin;
  const access = [{
    access_id: mintAccId(sourceId, "web_fetch", origin + "/"),
    name: "site",
    type: "web_fetch",
    base_url: origin + "/",
    docs_url: null,
    auth: { required: false, scheme: "none", credential_ref: null, signup_url: null, notes: "" },
    limits: { requests_per_second: null, politeness_delay_ms: null, daily_budget: null, monthly_budget: null, concurrency: null, notes: "" },
    robots: { applies: true, posture: null, checked_path: "/", tos_url: null, tos_notes: "" },
    endpoints: [],
    verification: { state: "asserted", last_probe_id: null, last_verified_at: null, window_days: null, notes: "imported — never probed (spec/10)" },
    notes: "",
  }];
  if (p.api) {
    const apiBase = p.api;
    access.push({
      access_id: mintAccId(sourceId, "api_rest", apiBase),
      name: "api",
      type: "api_rest",
      base_url: apiBase,
      docs_url: null,
      auth: { required: false, scheme: "none", credential_ref: null, signup_url: null, notes: "" },
      limits: { requests_per_second: null, politeness_delay_ms: null, daily_budget: null, monthly_budget: null, concurrency: null, notes: "" },
      robots: { applies: false, posture: "not_applicable", checked_path: null, tos_url: null, tos_notes: "" },
      endpoints: [],
      verification: { state: "asserted", last_probe_id: null, last_verified_at: null, window_days: null, notes: "imported — endpoint recipe unknown; probe before use (spec/10)" },
      notes: "",
    });
  }

  const identity = {
    name: p.name,
    publisher: p.operator?.name || "",
    homepage_url: p.homepage_url,
    canonical_url: p.canonical_url,
    description: p.description,
    languages: [],
  };
  if (p.operator) identity.operator = p.operator;

  const profile = {
    source_id: sourceId,
    aliases: {},
    identity,
    source_role: p.role,
    source_class: p.cls,
    // asserted triage is explicitly non-authoritative; adjudicated stays null.
    authority: {
      asserted: {
        tier: 2,
        basis: p.basis,
        rationale: `Imported from ${adapter.registry} record ${recId}; triage only, pending review.`,
        asserted_by: `authority import (${adapter.mapping_version})`,
        asserted_at: ts,
      },
      adjudicated: { tier: null, score: null, scored_by: null, scored_at: null, method: null, notes: "" },
    },
    scope: { topics: [], jurisdiction: { level: "not_applicable", regions: [], notes: "" }, temporal: { coverage_start: null, coverage_end: "present", notes: "" } },
    content: { artifacts: p.artifacts, landing_pattern: "search_then_record", notes: "" },
    access,
    verification: { state: "asserted", summary: "imported — never probed" },
    guidance: {
      best_for: [`Locating datasets held by ${p.name}.`],
      query_shapes: [],
      pitfalls: [`Imported from ${adapter.registry}; access is unverified and topics/authority are unreviewed — probe and adjudicate before relying on it (spec/10).`],
      llm_notes: "",
    },
    lifecycle: { status: "active", update_cadence: "unknown", cadence_notes: "", effective_date: null },
    relations: [{ type: "derived_from_registry", target: { name: adapter.registry, url: `https://www.${adapter.registry}.org/` }, notes: "profile federated from this upstream registry" }],
    discovery: {
      discovered_via: "registry_import",
      retrieved_via: "",
      first_added: ts,
      added_by: "authority import",
      import_ref: recId,
      upstream: [{
        registry: adapter.registry,
        record_id: recId,
        record_url: adapter.recordUrl(recId),
        retrieved_at: ts,
        upstream_updated_at: rec.lastUpdate || null,
        mapping_version: adapter.mapping_version,
        inherited_fields: p.inherited || ["identity.name", "identity.homepage_url"],
      }],
    },
    provenance: {
      produced_by: { tool: ctx.TOOL_NAME, tool_version: ctx.TOOL_VERSION, model: null, method: "import", person: null },
      created_at: ts,
      modified_at: null,
    },
    ext: {},
    notes: `Candidate profile imported from ${adapter.registry} ${recId}. Not yet listed in registry.json — promote via probe + adjudication before it becomes active (spec/10).`,
  };
  // inherited_fields was computed in toProfile; thread it through.
  profile.discovery.upstream[0].inherited_fields = p.inherited || profile.discovery.upstream[0].inherited_fields;

  // --- write to a STAGING path, never the live index (§10.4) ---
  const outDir = typeof args.flags.out === "string"
    ? path.resolve(args.flags.out)
    : path.join(reg.root, "_candidates", slug);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "source.json");
  writeJsonAtomic(outFile, profile);

  printResult(toolResult({
    status: "ok",
    artifacts: [outFile],
    warnings: ["candidate only: not added to registry.json — probe and adjudicate, then promote (spec/10)"],
    data: {
      source_id: sourceId,
      slug,
      candidate_path: outFile,
      upstream: { registry: adapter.registry, record_id: recId },
      verification: "asserted (never probed)",
      adjudicated: null,
    },
  }));
}
