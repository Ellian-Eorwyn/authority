// builder-lib.mjs — shared helpers for the deterministic builders
// (examples/build-examples.mjs and tests/conformance/build-fixtures.mjs).
// Fixtures must never lie: every id is computed by the real recipes, every
// evidence hash is the hash of bytes actually written, and probe records say
// tool.method "fixture". Timestamps are fixed; builders set AUTHORITY_NOW to
// TS so regen/validate see a deterministic clock.

import fs from "node:fs";
import path from "node:path";
import {
  mintAscId, mintAccId, mintEndId, mintPrbId, mintFchId,
  canonicalUrl, slugify, sha256Hex, tsCompact,
  writeJsonAtomic, appendJsonl,
} from "../skill/authoritative-sources/scripts/authority_common.mjs";

export const TS = "2026-08-17T12:00:00.000Z";
export const FIXTURE_TOOL = { name: "authority-fixtures", version: "0.2.0", method: "fixture" };

export function stamp() {
  return {
    produced_by: { tool: "authority-fixtures", tool_version: "0.2.0", model: null, method: "fixture", person: null },
    created_at: TS,
    modified_at: null,
  };
}

/** Skeleton profile with sensible L2-complete defaults; override per test. */
export function makeSource({ name, homepage, role = "publisher", cls = "primary", tier = 1, basis = ["primary_dataset"], topics = ["general"], description = "" }) {
  const canon = canonicalUrl(homepage);
  const source_id = mintAscId(canon);
  return {
    source_id,
    aliases: {},
    identity: { name, publisher: "", homepage_url: homepage, canonical_url: canon, description, languages: ["en"] },
    source_role: role,
    source_class: cls,
    authority: {
      asserted: { tier, basis, rationale: "fixture", asserted_by: "authority-fixtures", asserted_at: TS },
      adjudicated: { tier: null, score: null, scored_by: null, scored_at: null, method: null, notes: "" },
    },
    scope: { topics, jurisdiction: { level: "not_applicable", regions: [], notes: "" }, temporal: { coverage_start: null, coverage_end: "present", notes: "" } },
    content: { artifacts: [{ kind: "structured_record", formats: ["json"], notes: "" }], landing_pattern: "direct", notes: "" },
    access: [],
    verification: { state: "asserted", summary: "" },
    guidance: {
      best_for: ["Exercising the ASR reference implementation."],
      query_shapes: [],
      pitfalls: ["This is a fixture on a reserved .test domain; it answers no real requests."],
      llm_notes: "",
    },
    lifecycle: { status: "active", update_cadence: "static", cadence_notes: "", effective_date: null },
    relations: [],
    discovery: { discovered_via: "fixture", retrieved_via: "", first_added: TS, added_by: "authority-fixtures", import_ref: null },
    provenance: stamp(),
    ext: {},
    notes: "",
  };
}

/** Add an access method (ids computed) and return it. */
export function addAccess(source, { name, type, base_url, auth = null, robots = null, limits = null, windowDays = 3650, endpoints = [] }) {
  const access_id = mintAccId(source.source_id, type, base_url);
  const acc = {
    access_id,
    name,
    type,
    base_url,
    docs_url: null,
    auth: auth || { required: false, scheme: "none", credential_ref: null, signup_url: null, notes: "" },
    limits: limits || { requests_per_second: 1, politeness_delay_ms: null, daily_budget: null, monthly_budget: null, concurrency: 1, notes: "" },
    robots: robots || { applies: false, posture: "not_applicable", checked_path: null, tos_url: null, tos_notes: "" },
    endpoints: endpoints.map((e) => ({
      endpoint_id: mintEndId(access_id, e.http_method || "GET", e.path_template),
      name: e.name,
      description: e.description || "",
      http_method: e.http_method || "GET",
      path_template: e.path_template,
      params: e.params || [],
      pagination: e.pagination || { style: "none", page_param: null, size_param: null, cursor_path: null, max_page_size: null, notes: "" },
      response: e.response || { format: "json", record_path: null, notes: "" },
      probe_hint: e.probe_hint || { params: {} },
      example_request: e.example_request || "",
      notes: "",
    })),
    // Long fixture window so examples stay `verified` for years of calendar
    // time; real registries default to 90 (spec/04.6).
    verification: { state: "asserted", last_probe_id: null, last_verified_at: null, window_days: windowDays, notes: "" },
    notes: "",
  };
  source.access.push(acc);
  return acc;
}

/** Write evidence bytes and return the evidence entry (hash of real bytes). */
export function writeEvidence(root, slugName, kind, bytes, ext, extra = {}) {
  const rel = `sources/${slugName}/evidence/${tsCompact(TS)}-${kind}.${ext}`;
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
  return { kind, path: rel, sha256: sha256Hex(bytes), bytes: bytes.length, truncated_at: null, full_sha256: sha256Hex(bytes), full_bytes: bytes.length, ...extra };
}

/** Append an ok (or overridden) probe record for an access method. */
export function addProbe(root, slugName, source, acc, { outcome = "ok", checks = null, evidence = [], response = null, probedAt = TS, credential = null } = {}) {
  const record = {
    probe_id: mintPrbId(acc.access_id, probedAt),
    access_id: acc.access_id,
    source_id: source.source_id,
    probed_at: probedAt,
    tool: FIXTURE_TOOL,
    outcome,
    checks: checks || [
      { check: "http", result: outcome === "ok" ? "pass" : "fail", detail: outcome === "ok" ? "HTTP 200" : outcome },
    ],
    request: { method: "GET", url: acc.base_url, user_agent: "authority-fixtures/0.2.0" },
    response: response || { http_status: outcome === "ok" ? 200 : null, final_url: acc.base_url, content_type: "application/json", elapsed_ms: 10, headers_subset: {} },
    evidence,
    credential: credential || { ref: null, resolved_via: "none" },
    notes: "",
  };
  appendJsonl(path.join(root, `sources/${slugName}/probes.jsonl`), record);
  if (outcome === "ok") {
    acc.verification.state = "verified";
    acc.verification.last_probe_id = record.probe_id;
    acc.verification.last_verified_at = probedAt;
  } else {
    acc.verification.last_probe_id = record.probe_id;
  }
  return record;
}

/** Append a successful fetch record; writes the payload into fetched/ (which
 *  is gitignored — the tracked record keeps the durable facts) and optionally
 *  a tracked sample. */
export function addFetch(root, slugName, source, acc, ep, { bodyText, params = {}, keepSample = false } = {}) {
  const body = Buffer.from(bodyText, "utf8");
  let tpl = ep.path_template;
  for (const [k, v] of Object.entries(params)) tpl = tpl.split("{" + k + "}").join(encodeURIComponent(v));
  const url = acc.base_url.replace(/\/+$/, "") + (tpl.startsWith("/") ? tpl : "/" + tpl);
  const payloadRel = `fetched/${slugName}/${tsCompact(TS)}-${ep.name}.json`;
  const payloadAbs = path.join(root, payloadRel);
  fs.mkdirSync(path.dirname(payloadAbs), { recursive: true });
  fs.writeFileSync(payloadAbs, body);
  const record = {
    fetch_id: mintFchId(ep.endpoint_id, url, TS),
    endpoint_id: ep.endpoint_id,
    access_id: acc.access_id,
    source_id: source.source_id,
    fetched_at: TS,
    tool: FIXTURE_TOOL,
    request: { method: ep.http_method, url, params, user_agent: "authority-fixtures/0.2.0" },
    retrieval: {
      original_url: url, final_url: url, fetch_status: "success", http_status: 200,
      content_type: "application/json", fetch_method: "http", fetched_at: TS,
      sha256: sha256Hex(body), bytes: body.length, elapsed_ms: 15,
    },
    payload: { path: payloadRel, pages: null },
    credential: { ref: null, resolved_via: "none" },
    skip_reason: null,
    notes: "",
  };
  if (keepSample) {
    const sampleRel = `sources/${slugName}/samples/${ep.name}.json`;
    const sampleAbs = path.join(root, sampleRel);
    fs.mkdirSync(path.dirname(sampleAbs), { recursive: true });
    fs.writeFileSync(sampleAbs, body);
    record.sample = { path: sampleRel, sha256: sha256Hex(body), bytes: body.length, truncated_at: null };
  }
  appendJsonl(path.join(root, `sources/${slugName}/fetches.jsonl`), record);
  return record;
}

/** Write registry scaffolding (manifest with FIXED nonce id, topics,
 *  credentials example, .gitignore) and the profiles. */
export function writeRegistry(root, { registryId, title, description = "", topics, sources }) {
  fs.mkdirSync(path.join(root, "sources"), { recursive: true });
  for (const { slugName, source } of sources) {
    const dir = path.join(root, "sources", slugName);
    fs.mkdirSync(path.join(dir, "evidence"), { recursive: true });
    writeJsonAtomic(path.join(dir, "source.json"), source);
  }
  writeJsonAtomic(path.join(root, "topics.json"), {
    asr_spec_version: "0.2.0",
    topics,
    provenance: stamp(),
    notes: "",
  });
  writeJsonAtomic(path.join(root, "credentials.example.json"), { version: 1, credentials: {} });
  fs.writeFileSync(path.join(root, ".gitignore"), "credentials.json\nfetched/\n.authority/\n*.tmp\n.*.tmp\n.DS_Store\n");
  writeJsonAtomic(path.join(root, "registry.json"), {
    registry_id: registryId,
    asr_spec_version: "0.2.0",
    title,
    description,
    readme:
      "Authoritative Source Registry. Source profiles under sources/, one directory per source; " +
      "resolve objects through this manifest's sections and source index, never by guessing paths. " +
      "Access claims are verified against stored probe evidence (see rules_note); credentials are " +
      "referenced by name and never stored in tracked files.",
    rules_note: "spec/00-overview.md",
    defaults: { verification_window_days: 90, politeness_delay_ms: 1000, user_agent_contact: "mailto:fixtures@example.test" },
    sections: { sources: "sources/", topics: "topics.json", sources_csv: "sources.csv", index_html: "index.html", credentials_example: "credentials.example.json", fetched: "fetched/" },
    sources: sources.map(({ slugName, source }) => ({
      source_id: source.source_id, slug: slugName, name: source.identity.name,
      path: `sources/${slugName}/`, verification_state: source.verification.state,
    })),
    counts: { sources: 0, access_methods: 0, endpoints: 0, probes: 0, fetches: 0 },
    integrity: {},
    provenance: stamp(),
    ext: {},
    notes: "",
  });
}
