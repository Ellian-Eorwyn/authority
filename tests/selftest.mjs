#!/usr/bin/env node
// ASR library self-test: unit checks of the correctness-critical primitives.
// Zero deps, no framework; exit 0 = pass. Sections mirror the spec sections
// they exercise.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  jcs, sha256Hex,
  mintAscId, mintAccId, mintEndId, mintPrbId, mintFchId,
  canonicalUrl, slugify, slugifyWithCollision, checkFilename,
  deriveState, rollupState, latestProbeFor, effectiveWindowDays, OUTCOME_TO_STATE,
  redactSecret, scanForSecrets, resolveCredential, credEnvName,
  appendJsonl, readJSONLSafe, writeCsv, atomicWriteFile,
} from "../skill/authoritative-sources/scripts/authority_common.mjs";

let pass = 0, failCount = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { failCount++; console.error("FAIL: " + name); }
}
function eq(got, want, name) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(g === w, `${name} — got ${g}, want ${w}`);
}

// --- JCS (RFC 8785) — spec/06.1 ---
eq(jcs({ b: 1, a: [true, null, "x"] }), '{"a":[true,null,"x"],"b":1}', "jcs sorts keys");
eq(jcs("ab\nc"), '"a\\bb\\nc"', "jcs escapes controls");
eq(jcs({ "€": "€", "a": 0 }), '{"a":0,"€":"€"}', "jcs code-unit sort with non-ASCII");
eq(jcs(1234567890), "1234567890", "jcs integer plain");

// --- URL normalization — spec/06.4 ---
eq(canonicalUrl("HTTPS://Example.COM:443/A/b/?utm_source=x&b=2&a=1#f"), "https://example.com/A/b?a=1&b=2", "url: case, port, utm, sort, fragment, trailing slash");
eq(canonicalUrl("http://example.com:80/"), "http://example.com/", "url: root slash kept, default port dropped");
eq(canonicalUrl("https://example.com/p?gclid=1&ref=keep"), "https://example.com/p?ref=keep", "url: tracking closed set only — ref kept");
eq(canonicalUrl("https://example.com/%7Euser/%2fx"), "https://example.com/~user/%2Fx", "url: percent normalization (decode unreserved, uppercase hex)");
eq(canonicalUrl("not a url"), null, "url: unparseable is null");

// --- Slugs & filenames — spec/06.5, 01.1 ---
eq(slugify("Café — Über Data! (2026)"), "cafe-uber-data-2026", "slug folds accents & punctuation");
eq(slugify(""), "untitled", "slug empty -> untitled");
eq(slugify("A".repeat(80)), "a".repeat(60), "slug caps at 60");
{
  const takenSet = new Set(["gbif"]);
  const s = slugifyWithCollision("GBIF", "asc-a1b2c3d4e5f6", takenSet);
  eq(s, "gbif--a1b2c3", "slug collision suffix");
  eq(slugifyWithCollision("con", "asc-a1b2c3d4e5f6", new Set()), "con--a1b2c3", "slug reserved-name suffix");
}
ok(checkFilename("sources/foo-bar/source.json").ok, "filename: slug path ok");
ok(!checkFilename("../escape").ok, "filename: .. rejected");
ok(!checkFilename("a*b").ok, "filename: star rejected");
ok(!checkFilename("con.txt").ok, "filename: reserved rejected");
ok(!checkFilename("trailing. ").ok, "filename: trailing dot/space rejected");

// --- Id recipes — spec/06.1: deterministic and domain-separated ---
{
  const asc = mintAscId("https://example.com/data");
  eq(asc, mintAscId("https://example.com/data"), "asc deterministic");
  ok(/^asc-[0-9a-f]{12}$/.test(asc), "asc format");
  // Domain separation: an UPC src- id over the same URL must differ in value.
  const upcStyle = "src-" + sha256Hex(Buffer.from("src\nhttps://example.com/data", "utf8")).slice(0, 12);
  ok(asc.slice(4) !== upcStyle.slice(4), "asc hash differs from src hash for same URL (key-domain prefix)");
  const acc = mintAccId(asc, "api_rest", "https://api.example.com/v1");
  const end = mintEndId(acc, "GET", "/things?q={q}");
  const prb = mintPrbId(acc, "2026-08-17T12:00:00.000Z");
  const fch = mintFchId(end, "https://api.example.com/v1/things?q=x", "2026-08-17T12:00:00.000Z");
  ok(/^acc-/.test(acc) && /^end-/.test(end) && /^prb-/.test(prb) && /^fch-/.test(fch), "prefixes correct");
  ok(mintPrbId(acc, "2026-08-17T12:00:00.001Z") !== prb, "probe id changes with timestamp");
  // base_url normalization feeds acc identity
  eq(mintAccId(asc, "api_rest", "https://API.example.com:443/v1"), acc, "acc id normalizes base_url");
}

// --- State machine — spec/04.6 ---
{
  const registry = { defaults: { verification_window_days: 90 } };
  const acc = { access_id: "acc-000000000001", verification: {} };
  const now = new Date("2026-08-17T12:00:00Z");
  const probeAt = (iso, outcome) => ({ access_id: "acc-000000000001", probed_at: iso, outcome });
  eq(deriveState(acc, [], registry, now), "asserted", "state: no probes -> asserted");
  eq(deriveState(acc, [probeAt("2026-08-10T00:00:00.000Z", "ok")], registry, now), "verified", "state: fresh ok -> verified");
  eq(deriveState(acc, [probeAt("2026-01-01T00:00:00.000Z", "ok")], registry, now), "stale", "state: old ok -> stale");
  eq(deriveState(acc, [probeAt("2026-08-10T00:00:00.000Z", "robots_disallowed")], registry, now), "blocked", "state: robots -> blocked");
  eq(deriveState(acc, [probeAt("2026-08-10T00:00:00.000Z", "timeout")], registry, now), "broken", "state: timeout -> broken");
  eq(deriveState(acc, [probeAt("2026-08-10T00:00:00.000Z", "auth_required")], registry, now), "asserted", "state: auth_required stays asserted");
  eq(deriveState({ ...acc, verification: { state: "retired" } }, [probeAt("2026-08-10T00:00:00.000Z", "ok")], registry, now), "retired", "state: retired sticky");
  // window override
  const accW = { access_id: "acc-000000000001", verification: { window_days: 365 } };
  eq(deriveState(accW, [probeAt("2026-01-01T00:00:00.000Z", "ok")], registry, now), "verified", "state: per-method window honored");
  // latest probe wins
  eq(
    deriveState(acc, [probeAt("2026-08-01T00:00:00.000Z", "failed"), probeAt("2026-08-10T00:00:00.000Z", "ok")], registry, now),
    "verified", "state: latest probe governs"
  );
  eq(effectiveWindowDays({}, {}), 90, "window default 90");
  ok(Object.values(OUTCOME_TO_STATE).every((s) => ["verified", "degraded", "broken", "blocked", "asserted"].includes(s)), "outcome map closed");
}
eq(rollupState(["verified", "asserted", "broken"]), "broken", "rollup: worst wins");
eq(rollupState(["verified", "degraded"]), "degraded", "rollup: degraded over verified");
eq(rollupState(["retired", "verified"]), "verified", "rollup: retired excluded");
eq(rollupState(["retired"]), "retired", "rollup: all retired");

// --- Redaction & secret scanning — spec/04.4, rule 1.7 ---
{
  const secret = "sk_live_ABC123xyz+/=";
  const url = "https://api.example.com/v1?q=x&api_key=" + encodeURIComponent(secret);
  const red = redactSecret(url, secret);
  ok(!red.includes("ABC123xyz"), "redact: url-encoded occurrence removed");
  ok(red.includes("api_key=***"), "redact: replaced with ***");
  eq(redactSecret("no secret here", null), "no secret here", "redact: null secret no-op");

  const clean = {
    source_id: "asc-abcdefabcdef",
    auth: { credential_ref: "eia_api_key", location: { in: "query", name: "api_key" } },
    evidence: [{ sha256: "a".repeat(64) }],
    request: { url: "https://x.example/v?api_key=***" },
  };
  eq(scanForSecrets(clean).length, 0, "scan: refs, location names, hashes, *** are clean");
  const dirty1 = { auth: { api_key: "AKIAIOSFODNN7RQ2K9ZW41" } };
  ok(scanForSecrets(dirty1).length === 1, "scan: secret-named member caught");
  const dirty2 = { request: { url: "https://x.example/v?api_key=realvalue123456" } };
  ok(scanForSecrets(dirty2).length === 1, "scan: url query secret caught");
  const placeholder = { auth: { api_key: "YOUR_KEY_HERE" } };
  eq(scanForSecrets(placeholder).length, 0, "scan: placeholder tolerated");
  const exampleReq = { example_request: "https://api.x.test/v1/things?q=owl&api_key=$CREDENTIAL" };
  eq(scanForSecrets(exampleReq).length, 0, "scan: $CREDENTIAL example convention tolerated");
  const tplReq = { example_request: "https://api.x.test/v1/{id}?token={token}" };
  eq(scanForSecrets(tplReq).length, 0, "scan: {placeholder} tolerated");
}

// --- Credential chain — spec/05.2 (env steps; file/keychain exercised in
//     conformance/e2e, not here) ---
{
  eq(credEnvName("eia_api_key", "AUTHORITY_CRED_"), "AUTHORITY_CRED_EIA_API_KEY", "env name transform");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asr-selftest-"));
  process.env.AUTHORITY_CRED_SELFTEST_KEY = "v1";
  let r = resolveCredential("selftest_key", tmp);
  eq([r.value, r.via], ["v1", "env"], "chain: AUTHORITY_CRED wins");
  delete process.env.AUTHORITY_CRED_SELFTEST_KEY;
  process.env.FORGE_API_KEY_SELFTEST_KEY = "v2";
  r = resolveCredential("selftest_key", tmp);
  eq([r.value, r.via], ["v2", "env_forge"], "chain: FORGE_API_KEY honored");
  process.env.AUTHORITY_CRED_SELFTEST_KEY = "";
  r = resolveCredential("selftest_key", tmp);
  ok(r.value === null && /disabled/.test(r.reason), "chain: empty string disables");
  delete process.env.AUTHORITY_CRED_SELFTEST_KEY;
  delete process.env.FORGE_API_KEY_SELFTEST_KEY;
  fs.writeFileSync(path.join(tmp, "credentials.json"), JSON.stringify({ version: 1, credentials: { selftest_key: { value: "v3" } } }));
  r = resolveCredential("selftest_key", tmp);
  eq([r.value, r.via], ["v3", "file"], "chain: file step resolves");
  fs.rmSync(tmp, { recursive: true, force: true });
}

// --- JSONL & atomic writes — spec/01.2 ---
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asr-selftest-"));
  const j = path.join(tmp, "j.jsonl");
  appendJsonl(j, { a: 1 });
  appendJsonl(j, { b: 2 });
  let r = readJSONLSafe(j);
  eq(r.records.length, 2, "jsonl round-trip");
  fs.appendFileSync(j, '{"torn": tr'); // torn tail, no newline
  r = readJSONLSafe(j);
  eq([r.records.length, r.warnings.length, r.errors.length], [2, 1, 0], "jsonl torn tail is a warning");
  fs.appendFileSync(j, "\n");
  r = readJSONLSafe(j);
  eq([r.records.length, r.errors.length], [2, 1], "jsonl interior bad line is an error");
  const f = path.join(tmp, "x.json");
  atomicWriteFile(f, "data");
  eq(fs.readFileSync(f, "utf8"), "data", "atomic write lands");
  ok(!fs.readdirSync(tmp).some((n) => n.endsWith(".tmp")), "atomic write leaves no temp file");
  fs.rmSync(tmp, { recursive: true, force: true });
}

// --- CSV — spec/09.1 ---
eq(writeCsv([["a", 'b"c', "d,e"], ["1", "", "x\ny"]]), 'a,"b""c","d,e"\n1,,"x\ny"\n', "csv RFC 4180 quoting");

// --- 0.2.0/0.3.0 vocab & schema extension contract (spec/00.7, spec/02) ---
{
  const vocab = JSON.parse(fs.readFileSync(new URL("../vocab/vocab.json", import.meta.url), "utf8"));
  const defs = vocab.$defs;
  eq(vocab.asr_spec_version, "0.3.0", "vocab stamps 0.3.0");
  for (const name of ["officiality", "routing_disposition", "completeness", "completeness_basis", "content_freshness_basis", "resolution_strategy", "upstream_registry"]) {
    const d = defs[name];
    ok(d && Array.isArray(d.anyOf) && d.anyOf.some((s) => s.pattern === "^x-[a-z0-9-]+$"), `vocab: ${name} present and extensible`);
  }
  for (const rel of ["indexes", "operated_by", "official_source_for", "discovery_for", "resolves_to", "publishes", "catalogs", "derived_from_registry"]) {
    ok(defs.relation_type.anyOf[0].enum.includes(rel), `vocab: relation_type has ${rel}`);
  }
  const src = JSON.parse(fs.readFileSync(new URL("../schemas/source.schema.json", import.meta.url), "utf8"));
  // officiality is a SIBLING of authority (never nested) — official is not true; officiality must not set tier.
  ok(src.properties.officiality && !("officiality" in (src.properties.authority.properties || {})), "schema: officiality separate from authority (must not set tier)");
  // content freshness never derives from a successful probe — no probe-shaped basis value exists.
  ok(src.properties.freshness && !defs.content_freshness_basis.anyOf[0].enum.some((v) => /probe|verified_access/.test(v)), "schema: content_freshness_basis has no probe-derived value");
  ok(src.properties.coverage && src.properties.discovery.properties.upstream && src.properties.guidance.properties.routing, "schema: coverage + discovery.upstream + guidance.routing present");
  ok(src.$defs.access_method.properties.openapi && src.properties.identity.properties.operator, "schema: access.openapi + identity.operator present");
  // 0.3.0 facets: scope.facets present, and the migrated coverage free-strings are GONE.
  ok(src.properties.scope.properties.facets, "schema: scope.facets present (0.3.0)");
  ok(!src.properties.coverage.properties.policy_states && !src.properties.coverage.properties.sectors, "schema: coverage.policy_states/sectors removed (migrated to facets)");
  const facetsSchema = JSON.parse(fs.readFileSync(new URL("../schemas/facets.schema.json", import.meta.url), "utf8"));
  ok(facetsSchema.properties.facets && facetsSchema.required.includes("facets"), "schema: facets.schema.json declares a required facets array");
}

console.log(`selftest: ${pass} passed, ${failCount} failed`);
process.exit(failCount ? 1 : 0);
