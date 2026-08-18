#!/usr/bin/env node
// build-examples.mjs — regenerates examples/example-registry deterministically.
// Fixtures must never lie: ids are computed by the real recipes, evidence
// hashes are hashes of bytes actually written, probe/fetch records carry
// tool.method "fixture", and all timestamps are the fixed TS. Content lives on
// RFC 2606 .test domains so no real-world claim is ever made. Run it twice:
// the output is byte-identical.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { slugify } from "../skill/authoritative-sources/scripts/authority_common.mjs";
import { TS, makeSource, addAccess, addProbe, addFetch, writeEvidence, writeRegistry } from "./builder-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "example-registry");
const CLI = path.join(HERE, "..", "skill", "authoritative-sources", "scripts", "authority.mjs");

fs.rmSync(ROOT, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// Source 1 — Meadowlark Observatory Data Service: keyless JSON API, probed
// and exercised (the L2 exemplar).
// ---------------------------------------------------------------------------

const meadowlark = makeSource({
  name: "Meadowlark Observatory Data Service",
  homepage: "https://data.meadowlark.test/",
  role: "publisher",
  cls: "primary",
  tier: 1,
  basis: ["primary_dataset"],
  topics: ["bird-sightings"],
  description: "Fictional observatory publishing structured bird-sighting records through a keyless JSON API and yearly bulk snapshots.",
});
meadowlark.identity.publisher = "Meadowlark Observatory (fictional)";
meadowlark.scope.jurisdiction = { level: "subnational", regions: ["US-VT"], notes: "" };
meadowlark.scope.temporal = { coverage_start: "1998", coverage_end: "present", notes: "" };
meadowlark.content = {
  artifacts: [
    { kind: "structured_record", formats: ["json"], notes: "individual sighting records via the API" },
    { kind: "dataset_file", formats: ["csv", "zip"], notes: "yearly bulk snapshots" },
  ],
  landing_pattern: "direct",
  notes: "",
};
meadowlark.lifecycle = { status: "active", update_cadence: "daily", cadence_notes: "new sightings nightly", effective_date: null };
meadowlark.guidance = {
  best_for: ["Sighting counts and dates for a species", "Seasonal presence questions"],
  query_shapes: [
    { task: "find sightings of a species", access: "api", endpoint: "sightings-search", recipe: "Query q with the common or scientific name; page with the offset param.", example: "q=eastern-meadowlark" },
  ],
  pitfalls: ["The API caps page size at 50; ask for more and it silently clamps."],
  llm_notes: "Fictional exemplar: shows what a fully verified, exercised profile looks like.",
};

const mlApi = addAccess(meadowlark, {
  name: "api",
  type: "api_rest",
  base_url: "https://api.meadowlark.test/v2",
  limits: { requests_per_second: 2, politeness_delay_ms: null, daily_budget: 5000, monthly_budget: null, concurrency: 2, notes: "published fair-use limits" },
  endpoints: [{
    name: "sightings-search",
    description: "Search sighting records.",
    path_template: "/sightings?q={q}&offset={offset}",
    params: [
      { name: "q", required: true, type: "string", description: "species common or scientific name", example: "eastern-meadowlark" },
      { name: "offset", required: false, type: "integer", description: "record offset", example: 0 },
    ],
    pagination: { style: "offset_limit", page_param: "offset", size_param: "limit", cursor_path: null, max_page_size: 50, notes: "" },
    response: { format: "json", record_path: "results", notes: "" },
    probe_hint: { params: { q: "meadowlark", offset: 0 } },
    example_request: "https://api.meadowlark.test/v2/sightings?q=eastern-meadowlark&offset=0",
  }],
});
const mlBulk = addAccess(meadowlark, {
  name: "bulk",
  type: "bulk_download",
  base_url: "https://data.meadowlark.test/snapshots/",
  robots: { applies: true, posture: null, checked_path: "/snapshots/", tos_url: null, tos_notes: "" },
});

// Probe the API (ok, with a truly hashed body sample).
const mlBody = Buffer.from(JSON.stringify({ results: [{ species: "Sturnella magna", date: "2026-06-01", count: 3 }], total: 1 }) + "\n");
addProbe(ROOT, "meadowlark-observatory-data-service", meadowlark, mlApi, {
  checks: [
    { check: "http", result: "pass", detail: "HTTP 200 in 12ms" },
    { check: "api_parse", result: "pass", detail: "parses as json" },
  ],
  evidence: [writeEvidence(ROOT, "meadowlark-observatory-data-service", "body_sample", mlBody, "json")],
});
// Probe the bulk endpoint: robots.txt captured (allowed) + HEAD.
const mlRobots = Buffer.from("User-agent: *\nDisallow: /internal/\nAllow: /\n");
const bulkProbe = addProbe(ROOT, "meadowlark-observatory-data-service", meadowlark, mlBulk, {
  checks: [
    { check: "robots", result: "pass", detail: "Allow: /; /snapshots/ allowed" },
    { check: "http", result: "pass", detail: "HTTP 200 (HEAD)" },
  ],
  evidence: [writeEvidence(ROOT, "meadowlark-observatory-data-service", "robots_txt", mlRobots, "txt")],
  response: { http_status: 200, final_url: "https://data.meadowlark.test/snapshots/", content_type: "text/html", elapsed_ms: 9, headers_subset: { "content-length": "1204" } },
});
mlBulk.robots.posture = "allowed";

// Exercise the API endpoint (fetch record + tracked sample) — L2.
addFetch(ROOT, "meadowlark-observatory-data-service", meadowlark, mlApi, mlApi.endpoints[0], {
  bodyText: JSON.stringify({ results: [{ species: "Sturnella magna", date: "2026-06-01", count: 3 }, { species: "Sturnella magna", date: "2026-06-02", count: 1 }], total: 2 }, null, 1) + "\n",
  params: { q: "eastern-meadowlark", offset: "0" },
  keepSample: true,
});

// ---------------------------------------------------------------------------
// Source 2 — Orchard Gazette Archive: plain web + render-delegated portal,
// human-adjudicated authority, landing-page pattern.
// ---------------------------------------------------------------------------

const gazette = makeSource({
  name: "Orchard Gazette Archive",
  homepage: "https://archive.orchardgazette.test/",
  role: "archive",
  cls: "secondary",
  tier: 2,
  basis: ["trade_press", "curated_reference"],
  topics: ["orchard-trade-press"],
  description: "Fictional digitized archive of a regional horticulture newspaper; article pages are plain HTML, issue scans sit behind a landing page per issue.",
});
gazette.identity.publisher = "Orchard Gazette Trust (fictional)";
gazette.authority.adjudicated = { tier: 2, score: 0.7, scored_by: "E. Fixture (human review)", scored_at: TS, method: "editorial rubric v1", notes: "Reliable for dates and cultivar names; opinion pieces need corroboration." };
gazette.scope.jurisdiction = { level: "subnational", regions: ["US-VT"], notes: "" };
gazette.scope.temporal = { coverage_start: "1911", coverage_end: "1974", notes: "digitized run" };
gazette.content = {
  artifacts: [
    { kind: "html_page", formats: ["html"], notes: "article transcriptions" },
    { kind: "pdf_document", formats: ["pdf"], notes: "issue scans" },
  ],
  landing_pattern: "landing_then_file",
  notes: "Each issue page fronts the scan PDF; follow the 'full scan' link.",
};
gazette.lifecycle = { status: "archived", update_cadence: "static", cadence_notes: "digitization complete 2019", effective_date: null };
gazette.guidance = {
  best_for: ["Historical orchard practice and cultivar naming, 1911–1974"],
  query_shapes: [
    { task: "find an article by topic and year", access: "site", endpoint: null, recipe: "Browse /year/<yyyy>/ indexes; article slugs contain the headline.", example: "https://archive.orchardgazette.test/year/1952/" },
  ],
  pitfalls: ["Issue landing pages are thin; the scan PDF is behind the 'full scan' link (landing_then_file)."],
  llm_notes: "",
};
gazette.relations = [{ type: "companion_of", target: { source_id: meadowlark.source_id }, notes: "fictional sibling fixture" }];

const gzSite = addAccess(gazette, {
  name: "site",
  type: "web_fetch",
  base_url: "https://archive.orchardgazette.test/",
  robots: { applies: true, posture: null, checked_path: "/", tos_url: null, tos_notes: "" },
});
const gzPortal = addAccess(gazette, {
  name: "scan-portal",
  type: "web_render",
  base_url: "https://archive.orchardgazette.test/scans/",
  robots: { applies: true, posture: null, checked_path: "/scans/", tos_url: null, tos_notes: "" },
});

const gzRobots = Buffer.from("User-agent: *\nDisallow: /admin/\n");
addProbe(ROOT, "orchard-gazette-archive", gazette, gzSite, {
  checks: [
    { check: "robots", result: "pass", detail: "no matching rule for /" },
    { check: "http", result: "pass", detail: "HTTP 200 (HEAD)" },
  ],
  evidence: [writeEvidence(ROOT, "orchard-gazette-archive", "robots_txt", gzRobots, "txt")],
  response: { http_status: 200, final_url: "https://archive.orchardgazette.test/", content_type: "text/html", elapsed_ms: 21, headers_subset: {} },
});
gzSite.robots.posture = "allowed";
addProbe(ROOT, "orchard-gazette-archive", gazette, gzPortal, {
  checks: [
    { check: "robots", result: "pass", detail: "no matching rule for /scans/" },
    { check: "http", result: "pass", detail: "HTTP 200" },
    { check: "render", result: "skip", detail: "rendering delegated to harness (spec/03.6); transport claim only" },
  ],
  evidence: [writeEvidence(ROOT, "orchard-gazette-archive", "robots_txt", gzRobots, "txt", {})],
  response: { http_status: 200, final_url: "https://archive.orchardgazette.test/scans/", content_type: "text/html", elapsed_ms: 25, headers_subset: {} },
});
gzPortal.robots.posture = "allowed";

// ---------------------------------------------------------------------------
// Write the registry and run the real regen (fixed clock) so the manifest,
// CSV, and browser are produced by the same code paths users run.
// ---------------------------------------------------------------------------

writeRegistry(ROOT, {
  registryId: "reg-00c0ffee0001",
  title: "Example Registry",
  description: "Fictional two-source registry exercising the ASR object model end to end (.test domains; every id and hash is real).",
  topics: [
    { id: "bird-sightings", label: "Bird sightings", description: "Observational records of birds.", parent: null },
    { id: "orchard-trade-press", label: "Orchard trade press", description: "Historical horticulture journalism.", parent: null },
    { id: "general", label: "General", description: "", parent: null },
  ],
  sources: [
    { slugName: "meadowlark-observatory-data-service", source: meadowlark },
    { slugName: "orchard-gazette-archive", source: gazette },
  ],
});

execFileSync("node", [CLI, "regen", ROOT], { env: { ...process.env, AUTHORITY_NOW: TS }, stdio: ["ignore", "ignore", "inherit"] });

// Sanity: validate at L2 with the fixed clock; the example must be exemplary.
const out = execFileSync("node", [CLI, "validate", ROOT, "--level", "L2"], { env: { ...process.env, AUTHORITY_NOW: TS }, encoding: "utf8" });
const rep = JSON.parse(out).data;
if (rep.errors.length) {
  console.error("example registry has errors:", JSON.stringify(rep.errors, null, 2));
  process.exit(1);
}
console.log(`example-registry rebuilt: level=${rep.level}, sources=${rep.counts.sources}, probes=${rep.counts.probes}, fetches=${rep.counts.fetches}`);
