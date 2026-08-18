#!/usr/bin/env node
// run-conformance.mjs — validate every fixture and compare against its
// expected.json (spec/08.3). Per fixture: run `authority validate` at the
// fixture's declared target level (AUTHORITY_NOW fixed so clock-dependent
// rules are deterministic), then assert:
//   - every expected code appears among the reported ERROR codes,
//   - an empty expect list means zero errors,
//   - min_level, when declared, matches the computed level exactly.
// Exit 0 = all fixtures conform.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { TS } from "../../examples/builder-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "fixtures");
const CLI = path.join(HERE, "..", "..", "skill", "authoritative-sources", "scripts", "authority.mjs");

if (!fs.existsSync(FIXTURES)) {
  console.error("no fixtures/ — run: node tests/conformance/build-fixtures.mjs");
  process.exit(2);
}

let pass = 0, failCount = 0;
const names = fs.readdirSync(FIXTURES).filter((n) => fs.existsSync(path.join(FIXTURES, n, "expected.json"))).sort();

for (const name of names) {
  const dir = path.join(FIXTURES, name);
  const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
  const argsList = [CLI, "validate", dir, "--level", expected.target || "L1"];
  if (expected.strict) argsList.push("--strict");
  const r = spawnSync("node", argsList, { encoding: "utf8", env: { ...process.env, AUTHORITY_NOW: TS } });
  let report = null;
  try {
    report = JSON.parse(r.stdout).data;
  } catch {
    // load_error path prints a report too; a hard crash is a runner failure
  }
  const problems = [];
  if (!report) {
    problems.push("validator produced no parseable report (exit " + r.status + "): " + (r.stderr || r.stdout).slice(0, 200));
  } else {
    const codes = new Set(report.errors.map((e) => e.code));
    for (const want of expected.expect) {
      if (!codes.has(want)) problems.push(`expected error code "${want}" not reported (got: ${[...codes].join(", ") || "none"})`);
    }
    if (expected.expect.length === 0 && report.errors.length) {
      problems.push(`expected clean, got: ${report.errors.map((e) => e.code).join(", ")}`);
    }
    if (expected.expect.length === 0 && r.status !== 0) problems.push("expected exit 0, got " + r.status);
    if (expected.expect.length > 0 && r.status === 0) problems.push("expected nonzero exit");
    if (expected.min_level && report.level !== expected.min_level) {
      problems.push(`expected level ${expected.min_level}, got ${report.level}`);
    }
  }
  if (problems.length) {
    failCount++;
    console.error(`FAIL ${name}`);
    for (const p of problems) console.error("   - " + p);
  } else {
    pass++;
    console.log(`ok   ${name}${expected.expect.length ? "  [" + expected.expect.join(", ") + "]" : "  [clean @ " + (expected.target || "L1") + "]"}`);
  }
}

console.log(`\nconformance: ${pass}/${names.length} fixtures pass`);
process.exit(failCount ? 1 : 0);
