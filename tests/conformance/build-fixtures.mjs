#!/usr/bin/env node
// build-fixtures.mjs — regenerates tests/conformance/fixtures/: one minimal
// registry per error code (named by the code), plus pass-l0/l1/l2 positive
// controls. Fixtures are a deliverable of the standard (spec/08.3): an
// independent implementation validates each fixture and compares codes with
// expected.json. Deterministic: fixed TS, fixed nonce ids, ids computed by
// the real recipes, evidence truly hashed, mutations applied surgically.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  mintAscId, mintAccId, mintPrbId, canonicalUrl, sha256Hex, writeJsonAtomic, appendJsonl,
} from "../../skill/authoritative-sources/scripts/authority_common.mjs";
import { TS, makeSource, addAccess, addProbe, addFetch, writeEvidence, writeRegistry } from "../../examples/builder-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");
const CLI = path.join(HERE, "..", "..", "skill", "authoritative-sources", "scripts", "authority.mjs");

fs.rmSync(FIXTURES, { recursive: true, force: true });
fs.mkdirSync(FIXTURES, { recursive: true });

let built = 0;

/** Build a one-source registry: keyless API, probed ok (with evidence),
 *  optionally exercised. Returns handles for mutation. */
function base(dir, { probed = true, fetched = true, webOnly = false, slug = "fixture-source", homepage = "https://fixture.example.test/" } = {}) {
  const source = makeSource({ name: "Fixture Source", homepage, topics: ["general"] });
  if (webOnly) {
    // The natural L0-and-no-further registry: a freshly added web source,
    // never probed — readable and honest, but robots posture unrecorded
    // (rule 1.9) keeps it below L1 until someone probes.
    addAccess(source, {
      name: "site",
      type: "web_fetch",
      base_url: homepage,
      robots: { applies: true, posture: null, checked_path: "/", tos_url: null, tos_notes: "" },
    });
    return { source, acc: source.access[0], probe: null, fetchRec: null, slug };
  }
  const acc = addAccess(source, {
    name: "api",
    type: "api_rest",
    base_url: "https://api.fixture.example.test/v1",
    endpoints: [{
      name: "things",
      path_template: "/things?q={q}",
      params: [{ name: "q", required: true, type: "string", description: "query", example: "x" }],
      probe_hint: { params: { q: "x" } },
      example_request: "https://api.fixture.example.test/v1/things?q=x",
    }],
  });
  let probe = null, fetchRec = null;
  if (probed) {
    const body = Buffer.from('{"things":[],"total":0}\n');
    probe = addProbe(dir, slug, source, acc, {
      checks: [
        { check: "http", result: "pass", detail: "HTTP 200" },
        { check: "api_parse", result: "pass", detail: "parses as json" },
      ],
      evidence: [writeEvidence(dir, slug, "body_sample", body, "json")],
    });
  }
  if (probed && fetched) {
    fetchRec = addFetch(dir, slug, source, acc, acc.endpoints[0], { bodyText: '{"things":[{"id":1}],"total":1}\n', params: { q: "x" } });
  }
  return { source, acc, probe, fetchRec, slug };
}

function finalize(dir, sources, { registryId = "reg-00f1c70de000" } = {}) {
  writeRegistry(dir, {
    registryId,
    title: "Conformance Fixture",
    topics: [{ id: "general", label: "General", description: "", parent: null }],
    sources,
  });
  execFileSync("node", [CLI, "regen", dir], { env: { ...process.env, AUTHORITY_NOW: TS }, stdio: ["ignore", "ignore", "inherit"] });
}

function readSource(dir, slug) {
  return JSON.parse(fs.readFileSync(path.join(dir, "sources", slug, "source.json"), "utf8"));
}
function writeSource(dir, slug, obj) {
  writeJsonAtomic(path.join(dir, "sources", slug, "source.json"), obj);
}
function readManifest(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "registry.json"), "utf8"));
}
function writeManifest(dir, obj) {
  writeJsonAtomic(path.join(dir, "registry.json"), obj);
}

/** Declare a one-axis facet vocabulary in a fixture registry (facets.json +
 *  sections.facets). validate reads facets.json directly, so no regen needed. */
function declareFacet(dir) {
  writeJsonAtomic(path.join(dir, "facets.json"), {
    asr_spec_version: "0.3.0",
    facets: [{ id: "governance_domain", label: "Governance domain", values: [{ id: "legislative", label: "Legislative" }, { id: "regulatory", label: "Regulatory" }] }],
    provenance: { produced_by: { tool: "build-fixtures", tool_version: "0.3.0", model: null, method: "fixture", person: null }, created_at: TS, modified_at: null },
    notes: "",
  });
  const m = readManifest(dir);
  m.sections.facets = "facets.json";
  writeManifest(dir, m);
}

/** Define one fixture. mutate(dir, handles) runs AFTER base+regen. */
function fixture(name, expect, { target = "L1", strict = false, minLevel = null, baseOpts = {}, mutate = null, skipBase = false, expectWarnings = null } = {}) {
  const dir = path.join(FIXTURES, name);
  fs.mkdirSync(dir, { recursive: true });
  let handles = null;
  if (!skipBase) {
    handles = base(dir, baseOpts);
    finalize(dir, [{ slugName: handles.slug, source: handles.source }]);
  }
  if (mutate) mutate(dir, handles);
  writeJsonAtomic(path.join(dir, "expected.json"), {
    fixture: name,
    target,
    ...(strict ? { strict: true } : {}),
    ...(minLevel ? { min_level: minLevel } : {}),
    expect,
    ...(expectWarnings ? { expect_warnings: expectWarnings } : {}),
  });
  built++;
}

// --- positive controls ---
fixture("pass-l0", [], { target: "L0", minLevel: "L0", baseOpts: { webOnly: true } });
fixture("pass-l1", [], { target: "L1", minLevel: "L1", baseOpts: { fetched: false } });
fixture("pass-l2", [], { target: "L2", minLevel: "L2" });

// --- L0 ---
fixture("load-error", ["load_error"], {
  mutate: (dir) => fs.writeFileSync(path.join(dir, "registry.json"), "{ this is not json"),
});
fixture("schema-invalid", ["schema_invalid"], {
  mutate: (dir) => { const m = readManifest(dir); delete m.title; writeManifest(dir, m); },
});
fixture("spec-version-missing", ["spec_version_missing"], {
  mutate: (dir) => { const m = readManifest(dir); delete m.asr_spec_version; writeManifest(dir, m); },
});
fixture("missing-source-json", ["missing_source_json"], {
  mutate: (dir, h) => fs.rmSync(path.join(dir, "sources", h.slug, "source.json")),
});
fixture("manifest-source-unlisted", ["manifest_source_unlisted"], {
  mutate: (dir, h) => {
    const other = makeSource({ name: "Unlisted Source", homepage: "https://unlisted.example.test/", topics: ["general"] });
    addAccess(other, { name: "site", type: "web_fetch", base_url: "https://unlisted.example.test/", robots: { applies: false, posture: "not_applicable", checked_path: null, tos_url: null, tos_notes: "" } });
    const d = path.join(dir, "sources", "unlisted-source");
    fs.mkdirSync(d, { recursive: true });
    writeJsonAtomic(path.join(d, "source.json"), other);
  },
});
fixture("path-escape", ["path_escape"], {
  mutate: (dir, h) => {
    const probesPath = path.join(dir, "sources", h.slug, "probes.jsonl");
    const lines = fs.readFileSync(probesPath, "utf8").trim().split("\n").map(JSON.parse);
    lines[0].evidence[0].path = "../../outside.json";
    fs.writeFileSync(probesPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  },
});
fixture("symlink-escape", ["symlink_escape"], {
  mutate: (dir, h) => {
    const outside = path.join(FIXTURES, "OUTSIDE-symlink-target.json");
    fs.writeFileSync(outside, "{}\n");
    const linkRel = `sources/${h.slug}/evidence/link.json`;
    fs.symlinkSync(outside, path.join(dir, linkRel));
    const probesPath = path.join(dir, "sources", h.slug, "probes.jsonl");
    const lines = fs.readFileSync(probesPath, "utf8").trim().split("\n").map(JSON.parse);
    lines[0].evidence[0].path = linkRel;
    fs.writeFileSync(probesPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  },
});
fixture("filename-illegal", ["filename_illegal"], {
  mutate: (dir, h) => {
    const probesPath = path.join(dir, "sources", h.slug, "probes.jsonl");
    const lines = fs.readFileSync(probesPath, "utf8").trim().split("\n").map(JSON.parse);
    const bad = `sources/${h.slug}/evidence/bad*name.json`;
    fs.writeFileSync(path.join(dir, bad), '{"things":[],"total":0}\n');
    lines[0].evidence[0].path = bad;
    fs.writeFileSync(probesPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  },
});
fixture("jsonl-invalid", ["jsonl_invalid"], {
  mutate: (dir, h) => {
    const p = path.join(dir, "sources", h.slug, "probes.jsonl");
    fs.writeFileSync(p, "{ not json }\n" + fs.readFileSync(p, "utf8"));
  },
});
fixture("missing-access", ["missing_access"], {
  mutate: (dir, h) => { const o = readSource(dir, h.slug); o.access = []; writeSource(dir, h.slug, o); },
});
fixture("topics-invalid", ["topics_invalid"], {
  mutate: (dir) => fs.writeFileSync(path.join(dir, "topics.json"), "nope"),
});
fixture("unknown-topic", ["unknown_topic"], {
  mutate: (dir, h) => { const o = readSource(dir, h.slug); o.scope.topics.push("not-in-taxonomy"); writeSource(dir, h.slug, o); },
});
fixture("unknown-facet-value", ["unknown_facet_value"], {
  mutate: (dir, h) => {
    declareFacet(dir);
    const o = readSource(dir, h.slug);
    o.scope.facets = { governance_domain: ["not-a-declared-value"] };
    writeSource(dir, h.slug, o);
  },
});
// positive control: a source carrying a DECLARED facet value validates clean.
fixture("pass-facets", [], {
  mutate: (dir, h) => {
    declareFacet(dir);
    const o = readSource(dir, h.slug);
    o.scope.facets = { governance_domain: ["legislative"] };
    writeSource(dir, h.slug, o);
  },
});

// --- L1: identity ---
fixture("id-format", ["id_format"], {
  mutate: (dir, h) => { const o = readSource(dir, h.slug); o.source_id = "asc-NOTHEX"; writeSource(dir, h.slug, o); },
});
fixture("id-mismatch", ["id_mismatch"], {
  mutate: (dir, h) => { const o = readSource(dir, h.slug); o.source_id = "asc-deadbeef0000"; writeSource(dir, h.slug, o); },
});
fixture("id-duplicate", ["id_duplicate"], {
  mutate: (dir, h) => {
    // A second directory profiling the SAME canonical URL computes the same id.
    const o = readSource(dir, h.slug);
    const d = path.join(dir, "sources", "fixture-source-copy");
    fs.mkdirSync(d, { recursive: true });
    writeJsonAtomic(path.join(d, "source.json"), o);
  },
});
fixture("dangling-relation", ["dangling_relation"], {
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.relations = [{ type: "aggregates", target: { source_id: "asc-000000000bad" }, notes: "" }];
    writeSource(dir, h.slug, o);
  },
});
fixture("dangling-probe", ["dangling_probe"], {
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.access[0].verification.last_probe_id = "prb-000000000bad";
    writeSource(dir, h.slug, o);
  },
});
// --- L1: the gate ---
fixture("unverified-claim", ["unverified_claim"], {
  mutate: (dir, h) => fs.rmSync(path.join(dir, "sources", h.slug, "probes.jsonl")),
});
fixture("probe-evidence-missing", ["probe_evidence_missing"], {
  mutate: (dir, h) => {
    const dirAbs = path.join(dir, "sources", h.slug, "evidence");
    for (const f of fs.readdirSync(dirAbs)) fs.rmSync(path.join(dirAbs, f));
  },
});
fixture("probe-evidence-hash-mismatch", ["probe_evidence_hash_mismatch"], {
  mutate: (dir, h) => {
    const dirAbs = path.join(dir, "sources", h.slug, "evidence");
    for (const f of fs.readdirSync(dirAbs)) fs.appendFileSync(path.join(dirAbs, f), "tamper");
  },
});
fixture("stale-verification", ["stale_verification"], {
  baseOpts: { probed: false, fetched: false },
  mutate: (dir, h) => {
    // An old ok probe + a short window + stored "verified" = must read stale.
    const o = readSource(dir, h.slug);
    const acc = o.access[0];
    acc.verification.window_days = 30;
    const oldTs = "2026-01-01T00:00:00.000Z";
    const body = Buffer.from('{"things":[],"total":0}\n');
    const ev = writeEvidence(dir, h.slug, "body_sample", body, "json");
    appendJsonl(path.join(dir, "sources", h.slug, "probes.jsonl"), {
      probe_id: mintPrbId(acc.access_id, oldTs),
      access_id: acc.access_id, source_id: o.source_id, probed_at: oldTs,
      tool: { name: "authority-fixtures", version: "0.2.0", method: "fixture" },
      outcome: "ok",
      checks: [{ check: "http", result: "pass", detail: "HTTP 200" }],
      request: { method: "GET", url: acc.base_url, user_agent: "authority-fixtures/0.2.0" },
      response: { http_status: 200, final_url: acc.base_url, content_type: "application/json", elapsed_ms: 10, headers_subset: {} },
      evidence: [ev], credential: { ref: null, resolved_via: "none" }, notes: "",
    });
    acc.verification.state = "verified";
    acc.verification.last_probe_id = mintPrbId(acc.access_id, oldTs);
    acc.verification.last_verified_at = oldTs;
    writeSource(dir, h.slug, o);
  },
});
fixture("state-without-evidence", ["state_without_evidence"], {
  baseOpts: { probed: false, fetched: false },
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.access[0].verification = { state: "broken", last_probe_id: null, last_verified_at: null, window_days: 3650, notes: "" };
    writeSource(dir, h.slug, o);
  },
});

// --- L1: credentials & robots & adjudication ---
fixture("credential-in-profile", ["credential_in_profile"], {
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.access[0].auth.api_key = "sk_live_9f8g7h6j5k4l3m2n";
    writeSource(dir, h.slug, o);
  },
});
fixture("credential-ref-invalid", ["credential_ref_invalid"], {
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.access[0].auth = { required: true, scheme: "api_key_query", credential_ref: "Bad-Ref", location: { in: "query", name: "api_key" }, signup_url: null, notes: "" };
    writeSource(dir, h.slug, o);
  },
});
fixture("auth-underspecified", ["auth_underspecified"], {
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.access[0].auth = { required: true, scheme: "api_key_query", credential_ref: null, signup_url: null, notes: "" };
    writeSource(dir, h.slug, o);
  },
});
fixture("robots-unrecorded", ["robots_unrecorded"], {
  baseOpts: { probed: false, fetched: false },
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.access[0].robots = { applies: true, posture: null, checked_path: "/", tos_url: null, tos_notes: "" };
    writeSource(dir, h.slug, o);
  },
});
fixture("robots-evidence-missing", ["robots_evidence_missing"], {
  mutate: (dir, h) => {
    // posture recorded, but no probe carries robots_txt evidence
    const o = readSource(dir, h.slug);
    o.access[0].robots = { applies: true, posture: "allowed", checked_path: "/", tos_url: null, tos_notes: "" };
    writeSource(dir, h.slug, o);
  },
});
fixture("adjudication-unattributed", ["adjudication_unattributed"], {
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.authority.adjudicated = { tier: 1, score: null, scored_by: null, scored_at: null, method: null, notes: "" };
    writeSource(dir, h.slug, o);
  },
});
fixture("missing-provenance", ["missing_provenance"], {
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    delete o.provenance;
    writeSource(dir, h.slug, o);
  },
});

// --- L2 ---
fixture("endpoint-unexercised", ["endpoint_unexercised"], {
  target: "L2",
  baseOpts: { fetched: false },
});
fixture("fetch-record-invalid", ["fetch_record_invalid"], {
  target: "L2",
  mutate: (dir, h) => {
    const p = path.join(dir, "sources", h.slug, "fetches.jsonl");
    const lines = fs.readFileSync(p, "utf8").trim().split("\n").map(JSON.parse);
    delete lines[0].retrieval;
    fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  },
});
fixture("guidance-missing", ["guidance_missing"], {
  target: "L2",
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.guidance = { best_for: [], query_shapes: [], pitfalls: [], llm_notes: "" };
    writeSource(dir, h.slug, o);
  },
});
fixture("lifecycle-missing", ["lifecycle_missing"], {
  target: "L2",
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.lifecycle = { status: "active" };
    writeSource(dir, h.slug, o);
  },
});
fixture("sample-hash-mismatch", ["sample_hash_mismatch"], {
  target: "L2",
  strict: true,
  mutate: (dir, h) => {
    // a fetch record claiming a sample whose bytes have drifted
    const p = path.join(dir, "sources", h.slug, "fetches.jsonl");
    const lines = fs.readFileSync(p, "utf8").trim().split("\n").map(JSON.parse);
    const sampleRel = `sources/${h.slug}/samples/things.json`;
    fs.mkdirSync(path.join(dir, "sources", h.slug, "samples"), { recursive: true });
    fs.writeFileSync(path.join(dir, sampleRel), "drifted bytes\n");
    lines[0].sample = { path: sampleRel, sha256: sha256Hex(Buffer.from("original bytes\n")), bytes: 15, truncated_at: null };
    fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  },
});

// --- 0.2.0 semantic rules (conditional; fire only when the new field is set) ---
fixture("coverage-basis-missing", ["coverage_basis_missing"], {
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.coverage = { completeness: { claim: "systematic", basis: "", notes: "" } };
    writeSource(dir, h.slug, o);
  },
});
fixture("routing-primary-unresolved", ["routing_primary_unresolved"], {
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    // follow_primary with no resolution strategy/notes and no resolves_to relation
    o.guidance.routing = { discovery: "preferred", citation: "follow_primary" };
    writeSource(dir, h.slug, o);
  },
});
fixture("adjudication-by-import", [], {
  expectWarnings: ["adjudication_by_import"],
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.provenance.produced_by.method = "import";
    // attributed (so adjudication_unattributed does NOT fire) — the point is that
    // an IMPORT wrote an adjudication at all.
    o.authority.adjudicated = { tier: 1, score: null, scored_by: "authority import", scored_at: TS, method: "import", notes: "" };
    o.discovery = { ...o.discovery, discovered_via: "registry_import", upstream: [{ registry: "re3data", record_id: "r3d1", record_url: "https://www.re3data.org/repository/r3d1", retrieved_at: TS, upstream_updated_at: null, mapping_version: "re3data-asr@1", inherited_fields: ["identity.name"] }] };
    writeSource(dir, h.slug, o);
  },
});
fixture("external-id-shape", [], {
  expectWarnings: ["external_id_shape"],
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.identity.operator = { name: "Org", identifiers: { ror: "not-a-ror", wikidata: null, other: [] } };
    writeSource(dir, h.slug, o);
  },
});
fixture("coverage-assessment-unsupported", [], {
  expectWarnings: ["coverage_assessment_unsupported"],
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.coverage = { completeness: { claim: "selective", basis: "independently_assessed", notes: "" } };
    writeSource(dir, h.slug, o);
  },
});
// positive control: a profile using the 0.2.0 fields correctly stays clean at L2.
fixture("pass-0-2-fields", [], {
  target: "L2", minLevel: "L2",
  mutate: (dir, h) => {
    const o = readSource(dir, h.slug);
    o.officiality = { default: "discovery_aggregator", basis: "operated by the fixture authority", notes: "" };
    o.coverage = { completeness: { claim: "systematic", basis: "provider_asserted", notes: "" }, jurisdictions: ["US"], jurisdiction_levels: ["national"], temporal: { coverage_start: "2020", coverage_end: "present" } };
    o.content.artifacts[0].officiality = "official_representation";
    o.identity.operator = { name: "Fixture Org", identifiers: { ror: "https://ror.org/01bj3aw27", wikidata: "Q1", other: [] } };
    o.guidance.routing = { discovery: "preferred", citation: "follow_primary" };
    o.guidance.resolution = { strategy: "originating_authority", notes: "follow the record to its issuing authority" };
    o.freshness = { profile_reviewed_at: TS, profile_reviewed_by: "fixtures", review_interval_days: 180, content_last_checked_at: TS, content_current_through: "2026-07-31", content_freshness_basis: "provider_metadata" };
    o.access[0].openapi = { url: "https://api.fixture.example.test/openapi.json", version: "3.1.0" };
    o.discovery = { ...o.discovery, discovered_via: "registry_import", upstream: [{ registry: "re3data", record_id: "r3d1", record_url: "https://www.re3data.org/repository/r3d1", retrieved_at: TS, upstream_updated_at: null, mapping_version: "re3data-asr@1", inherited_fields: ["identity.name"] }] };
    writeSource(dir, h.slug, o);
  },
});

console.log(`built ${built} fixtures in ${FIXTURES}`);
