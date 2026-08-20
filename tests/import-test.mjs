#!/usr/bin/env node
// import-test.mjs — the federation proof-of-concept invariants (spec/10). Runs
// the re3data adapter over a captured fixture and asserts import performs only
// the first two epistemic events (§10.1): it records where the profile came
// from, and it manufactures NEITHER verification NOR adjudication. Zero-dep,
// no framework; exit 0 = pass.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { mintAscId, canonicalUrl, validateWithSchema, findStandardDirs } from "../skill/authoritative-sources/scripts/authority_common.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const CLI = path.join(ROOT, "skill", "authoritative-sources", "scripts", "authority.mjs");
const FIXTURE = path.join(HERE, "fixtures", "re3data-r3d100010371.json");
const TS = "2026-08-18T12:00:00.000Z";

let pass = 0, failCount = 0;
const ok = (cond, name) => cond ? pass++ : (failCount++, console.error("FAIL: " + name));
const eq = (g, w, name) => ok(JSON.stringify(g) === JSON.stringify(w), `${name} — got ${JSON.stringify(g)}, want ${JSON.stringify(w)}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asr-import-"));
const r = spawnSync("node", [CLI, "import", path.join(ROOT, "registries", "energy"), "re3data", "--from", FIXTURE, "--out", tmp], {
  encoding: "utf8",
  env: { ...process.env, AUTHORITY_NOW: TS },
});
ok(r.status === 0, "import exits 0 — got " + r.status + (r.stderr ? " (" + r.stderr.slice(0, 200) + ")" : ""));

const candidate = path.join(tmp, "source.json");
ok(fs.existsSync(candidate), "candidate source.json written to staging --out");

if (fs.existsSync(candidate)) {
  const o = JSON.parse(fs.readFileSync(candidate, "utf8"));

  // (2) ASR imported it — provenance + upstream recorded.
  eq(o.provenance.produced_by.method, "import", "provenance method = import");
  eq(o.discovery.discovered_via, "registry_import", "discovered_via = registry_import");
  eq(o.discovery.upstream[0].registry, "re3data", "upstream registry = re3data");
  eq(o.discovery.upstream[0].record_id, "r3d100010371", "upstream record_id retained");
  eq(o.discovery.upstream[0].mapping_version, "re3data-asr@1", "mapping_version recorded");
  ok((o.discovery.upstream[0].inherited_fields || []).includes("identity.name"), "inherited_fields lists identity.name");

  // (3) NOT probed — every access stays asserted; no probe fabricated.
  ok((o.access || []).length >= 1, "at least one access method");
  ok((o.access || []).every((a) => a.verification.state === "asserted"), "every access verification.state = asserted (never verified)");
  ok((o.access || []).every((a) => a.verification.last_probe_id === null), "no probe references fabricated");

  // (4) NOT adjudicated — import never fills adjudication.
  eq(o.authority.adjudicated.tier, null, "adjudicated.tier stays null");
  eq(o.authority.adjudicated.score, null, "adjudicated.score stays null");
  ok(o.authority.asserted && o.authority.asserted.tier != null, "asserted triage present (non-authoritative)");

  // identity/id integrity — the source_id recomputes from canonical_url (§06).
  eq(o.source_id, mintAscId(o.identity.canonical_url), "source_id recomputes from canonical_url");
  eq(o.identity.canonical_url, canonicalUrl(o.identity.homepage_url), "canonical_url = normalize(homepage_url)");
  ok(o.identity.operator && o.identity.operator.identifiers.ror === "https://ror.org/01bj3aw27", "operator ROR inherited");

  // the candidate is a schema-valid source.json.
  const { schemaDir } = findStandardDirs(ROOT);
  const errs = validateWithSchema(schemaDir, "source.schema.json", o, "candidate");
  eq(errs.length, 0, "candidate validates against source.schema.json" + (errs.length ? " — " + errs.join("; ") : ""));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`import-test: ${pass} passed, ${failCount} failed`);
process.exit(failCount ? 1 : 0);
