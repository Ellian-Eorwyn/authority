// authority_cmds.mjs — init / add / regen / probe / fetch / creds / export.
// Split from authority.mjs (dispatcher + validate) to keep each file readable;
// loaded on demand. Same zero-dep constraints.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  mintRegId, mintAscId, mintAccId, mintEndId, mintPrbId, mintFchId,
  isoMs, tsCompact, canonicalUrl, slugify, slugifyWithCollision,
  writeJsonAtomic, appendJsonl, readJSON, sha256Hex, atomicWriteFile,
  findStandardDirs, computeSchemaHash, resolveInside,
  deriveState, rollupState, latestProbeFor,
  resolveCredential, credEnvName, credentialsFilePath, CRED_REF_PATTERN,
  redactSecret, loadRegistry, toolResult, printResult, writeCsv,
} from "./authority_common.mjs";

/** Clock override for deterministic builds/tests: AUTHORITY_NOW=ISO. */
export function nowDate() {
  return process.env.AUTHORITY_NOW ? new Date(process.env.AUTHORITY_NOW) : new Date();
}

function fail(msg, code = 2) {
  process.stderr.write("authority: " + msg + "\n");
  process.exit(code);
}

function stampTool(ctx, method = "tool") {
  return {
    produced_by: { tool: ctx.TOOL_NAME, tool_version: ctx.TOOL_VERSION, model: null, method, person: null },
    created_at: isoMs(nowDate()),
    modified_at: null,
  };
}

// ---------------------------------------------------------------------------
// init (spec/01)
// ---------------------------------------------------------------------------

const REGISTRY_README =
  "Authoritative Source Registry. Source profiles under sources/, one directory per source; " +
  "resolve objects through this manifest's sections and source index, never by guessing paths. " +
  "Access claims are verified against stored probe evidence (see rules_note); credentials are " +
  "referenced by name and never stored in tracked files.";

export function cmdInit(args, ctx) {
  const dir = args.pos[0];
  if (!dir) fail("usage: authority init <dir> --title <t> [--topics a,b,c] [--contact <url|mailto>]");
  const title = typeof args.flags.title === "string" ? args.flags.title : path.basename(path.resolve(dir));
  const abs = path.resolve(dir);
  const regFile = path.join(abs, "registry.json");
  if (fs.existsSync(regFile)) {
    printResult(toolResult({ status: "ok", data: { registry: abs, note: "already initialized; left untouched" } }));
    return;
  }
  fs.mkdirSync(path.join(abs, "sources"), { recursive: true });

  const topicsList = (typeof args.flags.topics === "string" ? args.flags.topics.split(",") : ["general"])
    .map((t) => t.trim()).filter(Boolean);
  const stamp = stampTool(ctx);
  writeJsonAtomic(path.join(abs, "topics.json"), {
    asr_spec_version: ctx.TOOL_VERSION,
    topics: topicsList.map((t) => ({ id: slugify(t), label: t, description: "", parent: null })),
    provenance: stamp,
    notes: "Hand-authored taxonomy: profiles may only claim topics listed here (spec/01.5).",
  });

  writeJsonAtomic(path.join(abs, "credentials.example.json"), {
    version: 1,
    note: "Tracked file: refs and placeholders ONLY. Real values go in credentials.json (gitignored, chmod 600), AUTHORITY_CRED_* env vars, or the macOS Keychain (see spec/05).",
    credentials: {},
  });

  // Registry-local .gitignore so a registry is safe even when it becomes its
  // own repository later (the standard repo's root .gitignore also covers it).
  const gi = path.join(abs, ".gitignore");
  if (!fs.existsSync(gi)) {
    atomicWriteFile(gi, "credentials.json\nfetched/\n.authority/\n*.tmp\n.*.tmp\n.DS_Store\n");
  }

  const registry = {
    registry_id: mintRegId(),
    asr_spec_version: ctx.TOOL_VERSION,
    title,
    description: "",
    readme: REGISTRY_README,
    rules_note: "spec/00-overview.md",
    defaults: {
      verification_window_days: 90,
      politeness_delay_ms: 1000,
      user_agent_contact: typeof args.flags.contact === "string" ? args.flags.contact : "",
    },
    sections: {
      sources: "sources/",
      topics: "topics.json",
      sources_csv: "sources.csv",
      index_html: "index.html",
      credentials_example: "credentials.example.json",
      fetched: "fetched/",
    },
    sources: [],
    counts: { sources: 0, access_methods: 0, endpoints: 0, probes: 0, fetches: 0 },
    integrity: {},
    provenance: stamp,
    ext: {},
    notes: "",
  };
  writeJsonAtomic(regFile, registry);
  regenInto(abs, ctx); // fills integrity, csv, index.html
  printResult(toolResult({
    status: "ok",
    artifacts: [regFile],
    data: { registry: abs, registry_id: registry.registry_id, title, topics: topicsList },
  }));
}

// ---------------------------------------------------------------------------
// add (spec/02) — skeleton profile born honest (state: asserted)
// ---------------------------------------------------------------------------

export async function cmdAdd(args, ctx) {
  const [root, homepage] = args.pos;
  if (!root || !homepage) fail("usage: authority add <registry> <homepage-url> [--name <n>] [--role <r>] [--class <c>] [--tier 1|2|3] [--topics a,b] [--publisher <p>] [--retrieved-via <q>] [--no-probe]");
  const reg = loadRegistry(root);
  const canon = canonicalUrl(homepage);
  if (!canon) fail("not a parseable URL: " + homepage);
  const sourceId = mintAscId(canon);
  if (reg.sources.some((s) => s.obj?.source_id === sourceId)) {
    fail(`source already in registry (${sourceId}); profiles are updated by editing, not re-adding`, 1);
  }
  const name = typeof args.flags.name === "string" ? args.flags.name : new URL(canon).hostname;
  const existing = new Set(reg.sources.map((s) => path.basename(s.dirRel).toLowerCase()));
  const slug = slugifyWithCollision(name, sourceId, existing);
  const origin = new URL(canon).origin;
  const tier = args.flags.tier ? parseInt(args.flags.tier, 10) : 2;
  const topics = typeof args.flags.topics === "string" ? args.flags.topics.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const ts = isoMs(nowDate());
  const stamp = stampTool(ctx);
  stamp.created_at = ts;

  const accessId = mintAccId(sourceId, "web_fetch", origin + "/");
  const profile = {
    source_id: sourceId,
    aliases: {},
    identity: {
      name,
      publisher: typeof args.flags.publisher === "string" ? args.flags.publisher : "",
      homepage_url: homepage,
      canonical_url: canon,
      description: "",
      languages: [],
    },
    source_role: typeof args.flags.role === "string" ? args.flags.role : "publisher",
    source_class: typeof args.flags.class === "string" ? args.flags.class : "primary",
    authority: {
      asserted: { tier: [1, 2, 3].includes(tier) ? tier : 2, basis: [], rationale: "", asserted_by: "authority add", asserted_at: ts },
      adjudicated: { tier: null, score: null, scored_by: null, scored_at: null, method: null, notes: "" },
    },
    scope: { topics, jurisdiction: { level: "not_applicable", regions: [], notes: "" }, temporal: { coverage_start: null, coverage_end: "present", notes: "" } },
    content: { artifacts: [], landing_pattern: "direct", notes: "" },
    access: [{
      access_id: accessId,
      name: "site",
      type: "web_fetch",
      base_url: origin + "/",
      docs_url: null,
      auth: { required: false, scheme: "none", credential_ref: null, signup_url: null, notes: "" },
      limits: { requests_per_second: null, politeness_delay_ms: null, daily_budget: null, monthly_budget: null, concurrency: null, notes: "" },
      robots: { applies: true, posture: null, checked_path: "/", tos_url: null, tos_notes: "" },
      endpoints: [],
      verification: { state: "asserted", last_probe_id: null, last_verified_at: null, window_days: null, notes: "" },
      notes: "",
    }],
    verification: { state: "asserted", summary: "never probed" },
    guidance: { best_for: [], query_shapes: [], pitfalls: [], llm_notes: "" },
    lifecycle: { status: "active", update_cadence: "unknown", cadence_notes: "", effective_date: null },
    relations: [],
    discovery: {
      discovered_via: typeof args.flags["discovered-via"] === "string" ? args.flags["discovered-via"] : "manual",
      retrieved_via: typeof args.flags["retrieved-via"] === "string" ? args.flags["retrieved-via"] : "",
      first_added: ts,
      added_by: "authority add",
      import_ref: typeof args.flags["import-ref"] === "string" ? args.flags["import-ref"] : null,
    },
    provenance: stamp,
    ext: {},
    notes: "",
  };

  const dir = path.join(reg.root, "sources", slug);
  fs.mkdirSync(path.join(dir, "evidence"), { recursive: true });
  writeJsonAtomic(path.join(dir, "source.json"), profile);
  await regenAll(reg.root, ctx);

  let probeNote = "skipped (--no-probe)";
  if (!args.flags["no-probe"]) {
    const res = await probeSource(reg.root, slug, { ctx, force: true });
    probeNote = res.map((r) => `${r.access}: ${r.outcome}`).join("; ") || "no probeable access";
    await regenAll(reg.root, ctx);
  }
  printResult(toolResult({
    status: "ok",
    artifacts: [path.join(dir, "source.json")],
    data: { source_id: sourceId, slug, canonical_url: canon, first_probe: probeNote },
  }));
}

// ---------------------------------------------------------------------------
// regen (spec/09.6) — derived state, rollups, manifest, csv, browser
// ---------------------------------------------------------------------------

export function regenInto(root, ctx) {
  const reg = loadRegistry(root);
  const now = nowDate();
  const { schemaDir, vocabDir } = findStandardDirs(ctx.SCRIPT_DIR);

  let accessCount = 0, endpointCount = 0, probeCount = 0, fetchCount = 0;
  const index = [];
  const sorted = [...reg.sources].filter((s) => s.obj).sort((a, b) => (a.dirRel < b.dirRel ? -1 : 1));
  for (const s of sorted) {
    const o = s.obj;
    let changed = false;
    const states = [];
    for (const acc of o.access || []) {
      accessCount++;
      endpointCount += (acc.endpoints || []).length;
      const derived = deriveState(acc, s.probes, reg.registry, now);
      states.push(derived);
      const latest = latestProbeFor(s.probes, acc.access_id);
      const v = acc.verification || (acc.verification = { state: "asserted", last_probe_id: null, last_verified_at: null, window_days: null, notes: "" });
      if (v.state !== "retired") {
        if (v.state !== derived) { v.state = derived; changed = true; }
        const lastOk = [...s.probes].filter((p) => p.access_id === acc.access_id && p.outcome === "ok").sort((a, b) => (a.probed_at < b.probed_at ? -1 : 1)).pop();
        const wantVerifiedAt = lastOk ? lastOk.probed_at : null;
        if ((v.last_verified_at || null) !== wantVerifiedAt) { v.last_verified_at = wantVerifiedAt; changed = true; }
        const wantProbe = latest ? latest.probe_id : null;
        if ((v.last_probe_id || null) !== wantProbe) { v.last_probe_id = wantProbe; changed = true; }
      }
    }
    probeCount += s.probes.length;
    fetchCount += s.fetches.length;
    const roll = rollupState(states);
    const want = { state: roll, summary: summarizeRollup(o, states) };
    if (!o.verification || o.verification.state !== want.state || o.verification.summary !== want.summary) {
      o.verification = want;
      changed = true;
    }
    if (changed) writeJsonAtomic(s.file, o);
    index.push({
      source_id: o.source_id,
      slug: path.basename(s.dirRel),
      name: o.identity?.name || "",
      path: s.dirRel.replace(/\/?$/, "/"),
      verification_state: roll,
    });
  }

  const registry = reg.registry;
  registry.sources = index;
  registry.counts = { sources: index.length, access_methods: accessCount, endpoints: endpointCount, probes: probeCount, fetches: fetchCount };
  registry.integrity = { schema_hash: computeSchemaHash(schemaDir, vocabDir) };
  writeJsonAtomic(path.join(reg.root, "registry.json"), registry);

  const fresh = loadRegistry(root);
  const csvRel = registry.sections?.sources_csv || "sources.csv";
  atomicWriteFile(path.join(reg.root, csvRel), ctx.renderSourcesCsv(fresh, now));
  return fresh;
}

async function regenAll(root, ctx) {
  const fresh = regenInto(root, ctx);
  const { cmdBuildIndex } = await import("./build-index.mjs");
  cmdBuildIndex({ pos: [root], flags: { quiet: true }, params: {} }, ctx);
  return fresh;
}

function summarizeRollup(o, states) {
  const parts = [];
  for (let i = 0; i < (o.access || []).length; i++) {
    parts.push(`${o.access[i].name}: ${states[i]}`);
  }
  return parts.join("; ");
}

export async function cmdRegen(args, ctx) {
  const root = args.pos[0];
  if (!root) fail("usage: authority regen <registry>");
  const fresh = await regenAll(root, ctx);
  printResult(toolResult({
    status: "ok",
    artifacts: [path.join(fresh.root, "registry.json"), path.join(fresh.root, "sources.csv"), path.join(fresh.root, "index.html")],
    data: { registry: fresh.registry.registry_id, counts: fresh.registry.counts },
  }));
}

// ---------------------------------------------------------------------------
// probe (spec/04) — Phase 4
// ---------------------------------------------------------------------------

export async function cmdProbe(args, ctx) {
  const root = args.pos[0];
  if (!root) fail("usage: authority probe <registry> [<source>] [--access <name>] [--all] [--force]");
  const reg = loadRegistry(root);
  const sourceSel = args.pos[1] || null;
  if (!sourceSel && !args.flags.all) fail("name a source or pass --all");
  const targets = reg.sources.filter((s) => s.obj && (!sourceSel || path.basename(s.dirRel) === sourceSel || s.obj.source_id === sourceSel));
  if (sourceSel && !targets.length) fail("no such source: " + sourceSel, 1);
  const results = [];
  for (const s of targets) {
    const r = await probeSource(reg.root, path.basename(s.dirRel), {
      ctx,
      access: typeof args.flags.access === "string" ? args.flags.access : null,
      force: !!args.flags.force,
    });
    results.push(...r.map((x) => ({ source: path.basename(s.dirRel), ...x })));
  }
  await regenAll(root, ctx);
  const worst = results.some((r) => ["failed", "blocked", "robots_disallowed", "timeout", "dns_error", "tls_error", "auth_invalid", "moved"].includes(r.outcome));
  printResult(toolResult({
    status: worst ? "warning" : "ok",
    warnings: results.filter((r) => r.outcome !== "ok" && r.outcome !== "skipped_fresh").map((r) => `${r.source}/${r.access}: ${r.outcome}${r.note ? " — " + r.note : ""}`),
    data: { probed: results },
  }));
}

/** Probe every (or one named) access method of one source. Returns
 *  [{access, outcome, note?, skipped?}]. Implements spec/04.2. */
export async function probeSource(root, slug, { ctx, access = null, force = false } = {}) {
  const reg = loadRegistry(root);
  const s = reg.sources.find((x) => path.basename(x.dirRel) === slug);
  if (!s || !s.obj) fail("no such source: " + slug, 1);
  const o = s.obj;
  const now = nowDate();
  const out = [];
  const delayMs = (acc) => acc.limits?.politeness_delay_ms ?? reg.registry.defaults?.politeness_delay_ms ?? 1000;
  const contact = reg.registry.defaults?.user_agent_contact || "";
  const userAgent = `authority-probe/${ctx.TOOL_VERSION}${contact ? " (+" + contact + ")" : ""}`;

  for (const acc of o.access || []) {
    if (access && acc.name !== access) continue;
    if (acc.verification?.state === "retired") { out.push({ access: acc.name, outcome: "skipped_retired" }); continue; }
    if (["ftp", "offline"].includes(acc.type)) { out.push({ access: acc.name, outcome: "skipped_unprobeable", note: acc.type + " is recorded, not probed (spec/04.2)" }); continue; }
    if (!force && deriveState(acc, s.probes, reg.registry, now) === "verified") {
      out.push({ access: acc.name, outcome: "skipped_fresh", note: "already verified within window; --force to re-probe" });
      continue;
    }
    const rec = await executeProbe(reg, s, acc, { userAgent, delayMs: delayMs(acc), ctx });
    bumpBudget(reg.root, acc.access_id); // probes spend the same budget fetch pages do (spec/07.5)
    appendJsonl(path.join(reg.root, s.dirRel, "probes.jsonl"), rec.record);
    // copy robots posture onto the method (spec/04.3)
    if (rec.posture && acc.robots) {
      acc.robots.posture = rec.posture;
      writeJsonAtomic(s.file, o);
    }
    out.push({ access: acc.name, outcome: rec.record.outcome, note: rec.note });
    s.probes.push(rec.record);
  }
  return out;
}

// --- probe execution helpers ---

const PROBE_TIMEOUT_MS = 20000;
const BODY_SAMPLE_CAP = 65536;

/** Substitute params into an endpoint's path_template. Query pairs whose
 *  placeholder names an OPTIONAL, unsupplied param are dropped whole (the
 *  natural URL semantics for optional query params); remaining placeholders
 *  are returned in `unresolved` for the caller to reject (fetch) or
 *  blank-fill (probe). */
export function buildEndpointPath(ep, params) {
  let tpl = ep.path_template;
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    tpl = tpl.split("{" + k + "}").join(encodeURIComponent(String(v)));
  }
  const optional = new Set((ep.params || []).filter((p) => !p.required).map((p) => p.name));
  const qIdx = tpl.indexOf("?");
  if (qIdx !== -1) {
    const head = tpl.slice(0, qIdx);
    const toks = tpl.slice(qIdx + 1).split("&").filter((t) => {
      const m = t.match(/\{([a-z0-9_]+)\}/i);
      return !(m && optional.has(m[1]));
    });
    tpl = head + (toks.length ? "?" + toks.join("&") : "");
  }
  const unresolved = [...new Set((tpl.match(/\{[a-z0-9_]+\}/gi) || []))];
  return { path: tpl, unresolved };
}

async function timedFetch(url, opts = {}, timeoutMs = PROBE_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: "follow", ...opts, signal: ctrl.signal });
    return { res, elapsed: Date.now() - started, error: null };
  } catch (e) {
    const kind = e.name === "AbortError" ? "timeout"
      : /ENOTFOUND|EAI_AGAIN/.test(String(e.cause?.code || e.message)) ? "dns_error"
      : /CERT|TLS|SSL/i.test(String(e.cause?.code || e.message)) ? "tls_error"
      : "failed";
    return { res: null, elapsed: Date.now() - started, error: kind, detail: String(e.cause?.code || e.message) };
  } finally {
    clearTimeout(timer);
  }
}

const HEADERS_WHITELIST = ["server", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "ratelimit-limit", "ratelimit-remaining", "deprecation", "sunset", "content-length"];

function headersSubset(res) {
  const out = {};
  for (const h of HEADERS_WHITELIST) {
    const v = res.headers.get(h);
    if (v != null) out[h] = v;
  }
  return out;
}

function evidenceDirFor(reg, s) {
  const dir = path.join(reg.root, s.dirRel, "evidence");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeEvidence(reg, s, probedAt, kind, bytes, ext, extra = {}) {
  const name = `${tsCompact(probedAt)}-${kind}.${ext}`;
  const abs = path.join(evidenceDirFor(reg, s), name);
  fs.writeFileSync(abs, bytes);
  const rel = path.relative(reg.root, abs).replace(/\\/g, "/");
  return { kind, path: rel, sha256: sha256Hex(bytes), bytes: bytes.length, truncated_at: null, full_sha256: null, full_bytes: null, ...extra };
}

/** RFC 9309-lite robots evaluation for UA * and our token: longest match of
 *  Allow/Disallow prefixes against the path. */
export function evaluateRobots(robotsText, checkPath, productToken = "authority-probe") {
  const groups = [];
  let current = null;
  for (const rawLine of String(robotsText).split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === "user-agent") {
      if (!current || current.done) { current = { agents: [], rules: [], done: false }; groups.push(current); }
      current.agents.push(value.toLowerCase());
    } else if (field === "allow" || field === "disallow") {
      if (current) { current.rules.push({ allow: field === "allow", prefix: value }); current.done = true; }
    } else if (current) {
      current.done = true;
    }
  }
  const pick = (pred) => groups.filter((g) => g.agents.some(pred));
  let applicable = pick((a) => a.includes(productToken.toLowerCase()));
  if (!applicable.length) applicable = pick((a) => a === "*");
  if (!applicable.length) return { posture: "allowed", matched: null };
  let best = null;
  for (const g of applicable) {
    for (const r of g.rules) {
      if (r.prefix === "") continue; // empty Disallow = allow all
      const re = new RegExp("^" + r.prefix.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*"));
      if (re.test(checkPath)) {
        if (!best || r.prefix.length > best.prefix.length || (r.prefix.length === best.prefix.length && r.allow && !best.allow)) best = r;
      }
    }
  }
  if (!best) return { posture: "allowed", matched: null };
  return { posture: best.allow ? "allowed" : "disallowed", matched: (best.allow ? "Allow: " : "Disallow: ") + best.prefix };
}

async function executeProbe(reg, s, acc, { userAgent, delayMs, ctx }) {
  const probedAt = isoMs(nowDate());
  const checks = [];
  const evidence = [];
  let outcome = "ok";
  let note = "";
  let posture = null;
  let request = { method: "HEAD", url: acc.base_url, user_agent: userAgent };
  let response = {};
  let credInfo = { ref: null, resolved_via: "none" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const finish = () => ({
    record: {
      probe_id: mintPrbId(acc.access_id, probedAt),
      access_id: acc.access_id,
      source_id: s.obj.source_id,
      probed_at: probedAt,
      tool: { name: ctx.TOOL_NAME, version: ctx.TOOL_VERSION, method: "tool" },
      outcome,
      checks,
      request,
      response,
      evidence,
      credential: credInfo,
      notes: note,
    },
    posture,
    note,
  });

  // --- robots (web transports) ---
  if (acc.robots?.applies) {
    const origin = new URL(acc.base_url).origin;
    const robotsUrl = origin + "/robots.txt";
    const r = await timedFetch(robotsUrl, { method: "GET", headers: { "user-agent": userAgent } });
    if (r.error) {
      checks.push({ check: "robots", result: "skip", detail: `robots.txt unreachable (${r.error}); treating as no_robots` });
      posture = "no_robots";
    } else if (r.res.status >= 400) {
      checks.push({ check: "robots", result: "pass", detail: `robots.txt HTTP ${r.res.status} — no_robots` });
      posture = "no_robots";
    } else {
      const body = Buffer.from(await r.res.arrayBuffer());
      evidence.push(writeEvidence(reg, s, probedAt, "robots_txt", body, "txt"));
      const checkPath = acc.robots.checked_path || new URL(acc.base_url).pathname || "/";
      const verdict = evaluateRobots(body.toString("utf8"), checkPath);
      posture = verdict.posture;
      if (verdict.posture === "disallowed") {
        checks.push({ check: "robots", result: "fail", detail: `${verdict.matched} covers ${checkPath}` });
        outcome = "robots_disallowed";
        note = "robots.txt disallows " + checkPath + "; no request made (spec/04.2)";
        return finish();
      }
      checks.push({ check: "robots", result: "pass", detail: verdict.matched ? `${verdict.matched}; ${checkPath} allowed` : "no matching rule" });
    }
    await sleep(delayMs);
  } else {
    posture = acc.robots ? "not_applicable" : null;
  }

  // --- credential (auth-required APIs) ---
  let credValue = null;
  if (acc.auth?.required && acc.auth.scheme !== "none") {
    if (["oauth2", "session_cookie"].includes(acc.auth.scheme)) {
      checks.push({ check: "auth", result: "skip", detail: acc.auth.scheme + " is never automated (spec/03.2)" });
      outcome = "auth_required";
      note = acc.auth.scheme + " access recorded; reference CLI does not authenticate it";
      return finish();
    }
    const resolved = resolveCredential(acc.auth.credential_ref, reg.root);
    credInfo = { ref: acc.auth.credential_ref, resolved_via: resolved.via };
    if (resolved.value == null) {
      checks.push({ check: "auth", result: "skip", detail: `credential unresolved (tried: ${resolved.tried.join(", ")})` });
      outcome = "auth_required";
      note = resolved.reason || "credential unresolved";
      return finish();
    }
    credValue = resolved.value;
    checks.push({ check: "auth", result: "pass", detail: "credential resolved via " + resolved.via });
  }

  // --- transport / API ping ---
  const isApi = ["api_rest", "api_graphql", "oai_pmh", "feed"].includes(acc.type);
  let url, method = "HEAD";
  if (isApi) {
    method = "GET";
    const ep = (acc.endpoints || []).find((e) => e.probe_hint) || (acc.endpoints || [])[0] || null;
    if (acc.type === "oai_pmh") {
      url = acc.base_url.replace(/\?.*$/, "") + "?verb=Identify";
    } else if (ep) {
      const hint = ep.probe_hint?.params || {};
      const merged = {};
      for (const p of ep.params || []) {
        const v = hint[p.name] ?? p.example;
        if (v != null) merged[p.name] = v;
      }
      let { path: tpl, unresolved } = buildEndpointPath(ep, merged);
      for (const ph of unresolved) tpl = tpl.split(ph).join(""); // blank-fill leftovers: a probe pings, it does not demand
      url = acc.base_url.replace(/\/+$/, "") + (tpl.startsWith("/") ? tpl : "/" + tpl);
      request.endpoint = ep.name;
    } else {
      url = acc.base_url;
    }
  } else {
    url = acc.base_url;
  }

  const headers = { "user-agent": userAgent, accept: "*/*" };
  if (credValue && acc.auth) {
    const scheme = acc.auth.scheme;
    if (scheme === "api_key_query") {
      const u = new URL(url);
      u.searchParams.set(acc.auth.location?.name || "api_key", credValue);
      url = u.toString();
    } else if (scheme === "api_key_header") {
      headers[acc.auth.location?.name || "x-api-key"] = credValue;
    } else if (scheme === "bearer_token") {
      headers["authorization"] = "Bearer " + credValue;
    } else if (scheme === "http_basic") {
      headers["authorization"] = "Basic " + Buffer.from(credValue).toString("base64");
    }
  }
  request = { ...request, method, url: redactSecret(url, credValue) };

  let r = await timedFetch(url, { method, headers });
  if (!r.error && r.res && method === "HEAD" && [405, 501].includes(r.res.status)) {
    await sleep(delayMs);
    method = "GET";
    request.method = "GET";
    r = await timedFetch(url, { method, headers });
  }
  if (r.error) {
    // one retry on pure network errors (spec/04.2)
    if (["timeout", "dns_error", "tls_error", "failed"].includes(r.error)) {
      await sleep(delayMs);
      r = await timedFetch(url, { method, headers });
    }
  }
  if (r.error) {
    checks.push({ check: "http", result: "fail", detail: r.error + (r.detail ? ": " + r.detail : "") });
    outcome = r.error === "failed" ? "failed" : r.error;
    note = r.detail || r.error;
    return finish();
  }

  const res = r.res;
  response = {
    http_status: res.status,
    final_url: redactSecret(res.url, credValue),
    content_type: res.headers.get("content-type"),
    elapsed_ms: r.elapsed,
    headers_subset: headersSubset(res),
  };

  if (res.status === 401 || res.status === 403) {
    checks.push({ check: "http", result: "fail", detail: "HTTP " + res.status });
    outcome = credValue ? "auth_invalid" : "blocked";
    note = credValue ? "credential rejected (HTTP " + res.status + ")" : "refused with HTTP " + res.status;
    return finish();
  }
  if (res.status === 429) {
    checks.push({ check: "http", result: "fail", detail: "HTTP 429 rate limited" });
    outcome = "degraded";
    note = "rate limited during probe; declared limits may be too aggressive";
    return finish();
  }
  if (res.status >= 400) {
    checks.push({ check: "http", result: "fail", detail: "HTTP " + res.status });
    outcome = "failed";
    note = "HTTP " + res.status;
    return finish();
  }
  checks.push({ check: "http", result: "pass", detail: `HTTP ${res.status} in ${r.elapsed}ms` });
  const origHost = new URL(acc.base_url).host;
  if (new URL(res.url).host !== origHost) {
    outcome = "moved";
    note = `redirected off ${origHost} to ${new URL(res.url).host} — update base_url`;
    return finish();
  }

  // --- body sample + parse check ---
  if (method === "GET") {
    const full = Buffer.from(await res.arrayBuffer());
    const truncated = full.length > BODY_SAMPLE_CAP;
    const sampleBytes = truncated ? full.subarray(0, BODY_SAMPLE_CAP) : full;
    const sampleText = sampleBytes.toString("utf8");
    const redacted = credValue ? Buffer.from(redactSecret(sampleText, credValue), "utf8") : sampleBytes;
    const extByFormat = { json: "json", xml: "xml", rss: "xml", atom: "xml", csv: "csv", tsv: "tsv", html: "html" };
    const declared = isApi ? ((acc.endpoints || []).find((e) => request.endpoint && e.name === request.endpoint)?.response?.format
      ?? (acc.type === "oai_pmh" ? "xml" : acc.type === "feed" ? "rss" : "json")) : "html";
    evidence.push(writeEvidence(reg, s, probedAt, "body_sample", redacted, extByFormat[declared] || "txt", {
      truncated_at: truncated ? BODY_SAMPLE_CAP : null,
      full_sha256: credValue ? null : sha256Hex(full),
      full_bytes: full.length,
    }));
    if (isApi) {
      let parsed = false, detail = "";
      try {
        if (declared === "json") { JSON.parse(full.toString("utf8")); parsed = true; }
        else if (["xml", "rss", "atom"].includes(declared)) { parsed = /^\s*(<\?xml|<[A-Za-z])/.test(sampleText); detail = parsed ? "" : "no XML prolog/root"; }
        else if (["csv", "tsv"].includes(declared)) { parsed = sampleText.includes("\n"); }
        else parsed = true;
      } catch (e) {
        detail = truncated ? "parse failed on truncated sample" : e.message;
        parsed = truncated; // a truncated JSON body legitimately fails to parse
      }
      checks.push({ check: "api_parse", result: parsed ? "pass" : "fail", detail: detail || `parses as ${declared}` });
      if (!parsed) {
        outcome = "degraded";
        note = "response did not parse as declared " + declared;
      }
    }
  }

  if (acc.type === "web_render") {
    checks.push({ check: "render", result: "skip", detail: "rendering delegated to harness (spec/03.6); transport claim only" });
  }
  return finish();
}

// ---------------------------------------------------------------------------
// creds (spec/05) — Phase 4
// ---------------------------------------------------------------------------

export function cmdCreds(args, ctx) {
  const sub = args.pos[0];
  if (sub === "set") return credsSet(args, ctx);
  if (sub === "list") return credsList(args, ctx);
  if (sub === "check") return credsCheck(args, ctx);
  fail("usage: authority creds <set|list|check> [<ref>] [--registry <r>] [--keychain]");
}

function readSecretFromStdin() {
  // Hidden read when a TTY; plain read otherwise (pipes, scripts).
  if (process.stdin.isTTY) {
    process.stderr.write("value (input hidden): ");
    const r = spawnSync("sh", ["-c", "stty -echo; head -n 1; stty echo"], { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" });
    process.stderr.write("\n");
    return String(r.stdout || "").replace(/\n$/, "");
  }
  return fs.readFileSync(0, "utf8").replace(/\n$/, "");
}

function credsSet(args, ctx) {
  const ref = args.pos[1];
  if (!ref) fail("usage: authority creds set <ref> [--registry <r>] [--keychain]");
  if (!CRED_REF_PATTERN.test(ref)) fail("ref must match ^[a-z][a-z0-9_]*$");
  if (args.flags.keychain) {
    if (process.platform !== "darwin") fail("--keychain requires macOS");
    // -U updates in place; omitting -w's value makes security(1) prompt so the
    // secret never appears in argv or shell history (spec/05.3).
    const r = spawnSync("security", ["add-generic-password", "-U", "-s", "authority", "-a", ref, "-w"], { stdio: "inherit" });
    if (r.status !== 0) fail("security add-generic-password failed", 1);
    printResult(toolResult({ status: "ok", data: { ref, stored: "keychain(service=authority)" } }));
    return;
  }
  const root = typeof args.flags.registry === "string" ? path.resolve(args.flags.registry) : process.cwd();
  if (!fs.existsSync(path.join(root, "registry.json"))) fail("not a registry (no registry.json): " + root + " — pass --registry or --keychain");
  const value = readSecretFromStdin();
  if (!value) fail("empty value; nothing stored", 1);
  const file = credentialsFilePath(root);
  let doc = { version: 1, credentials: {} };
  if (fs.existsSync(file)) { try { doc = readJSON(file); } catch { /* rewrite corrupt file */ } }
  doc.credentials = doc.credentials || {};
  doc.credentials[ref] = { value, notes: doc.credentials[ref]?.notes || "" };
  writeJsonAtomic(file, doc);
  fs.chmodSync(file, 0o600);
  printResult(toolResult({ status: "ok", data: { ref, stored: "credentials.json (0600)", registry: root } }));
}

function collectRefs(reg) {
  const refs = new Set();
  for (const s of reg.sources) {
    for (const acc of s.obj?.access || []) {
      if (acc.auth?.credential_ref) refs.add(acc.auth.credential_ref);
    }
  }
  return [...refs].sort();
}

function credsList(args, ctx) {
  const root = typeof args.flags.registry === "string" ? args.flags.registry : args.pos[1] || process.cwd();
  const reg = loadRegistry(root);
  const rows = collectRefs(reg).map((ref) => {
    const r = resolveCredential(ref, reg.root);
    return { ref, resolves_via: r.via, available: r.value != null };
  });
  printResult(toolResult({ status: "ok", data: { registry: reg.registry.registry_id, credentials: rows } }));
}

function credsCheck(args, ctx) {
  const root = args.pos[1] || (typeof args.flags.registry === "string" ? args.flags.registry : process.cwd());
  const reg = loadRegistry(root);
  const rows = [];
  const neededBy = {};
  for (const s of reg.sources) {
    for (const acc of s.obj?.access || []) {
      if (acc.auth?.credential_ref) {
        (neededBy[acc.auth.credential_ref] ||= []).push(path.basename(s.dirRel) + "#" + acc.name);
      }
    }
  }
  let allResolve = true;
  for (const ref of Object.keys(neededBy).sort()) {
    const r = resolveCredential(ref, reg.root);
    if (r.value == null) allResolve = false;
    rows.push({ ref, needed_by: neededBy[ref], resolves_via: r.via, available: r.value != null, ...(r.value == null ? { tried: r.tried } : {}) });
  }
  printResult(toolResult({
    status: allResolve ? "ok" : "warning",
    warnings: rows.filter((r) => !r.available).map((r) => `${r.ref} unresolved (needed by ${r.needed_by.join(", ")})`),
    data: { registry: reg.registry.registry_id, operational_here: allResolve, credentials: rows },
  }));
}

// ---------------------------------------------------------------------------
// fetch (spec/07) — Phase 5
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 60000;
const SAMPLE_CAP = 262144;

function budgetPath(root) {
  const day = isoMs(nowDate()).slice(0, 10);
  return path.join(root, ".authority", "budget", day + ".json");
}

function readBudget(root) {
  const p = budgetPath(root);
  if (fs.existsSync(p)) { try { return readJSON(p); } catch { return {}; } }
  return {};
}

function bumpBudget(root, accessId, n = 1) {
  const p = budgetPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const b = readBudget(root);
  b[accessId] = (b[accessId] || 0) + n;
  writeJsonAtomic(p, b);
  return b[accessId];
}

export async function cmdFetch(args, ctx) {
  const [root, sourceSel, endpointSel] = args.pos;
  if (!root || !sourceSel || !endpointSel) {
    fail("usage: authority fetch <registry> <source> <endpoint> [--param k=v ...] [--max-pages N] [--keep-sample] [--out <dir>]");
  }
  const reg = loadRegistry(root);
  const s = reg.sources.find((x) => x.obj && (path.basename(x.dirRel) === sourceSel || x.obj.source_id === sourceSel));
  if (!s) fail("no such source: " + sourceSel, 1);
  const o = s.obj;

  let acc = null, ep = null;
  for (const a of o.access || []) {
    const found = (a.endpoints || []).find((e) => e.name === endpointSel || e.endpoint_id === endpointSel);
    if (found) { acc = a; ep = found; break; }
  }
  if (!ep) fail(`no endpoint "${endpointSel}" on ${sourceSel} (endpoints: ${(o.access || []).flatMap((a) => (a.endpoints || []).map((e) => e.name)).join(", ") || "none"})`, 1);

  const fetchedAt = isoMs(nowDate());
  const slug = path.basename(s.dirRel);
  const record = {
    fetch_id: null,
    endpoint_id: ep.endpoint_id,
    access_id: acc.access_id,
    source_id: o.source_id,
    fetched_at: fetchedAt,
    tool: { name: ctx.TOOL_NAME, version: ctx.TOOL_VERSION, method: "tool" },
    request: { method: ep.http_method, url: "", params: {}, user_agent: "" },
    retrieval: { original_url: "", final_url: null, fetch_status: "queued", http_status: null, content_type: null, fetch_method: "http", fetched_at: fetchedAt, sha256: null, bytes: null, elapsed_ms: null },
    payload: { path: null, pages: null },
    credential: { ref: null, resolved_via: "none" },
    skip_reason: null,
    notes: "",
  };
  const finishSkip = (status, reason, exitWarning = false) => {
    record.retrieval.fetch_status = status;
    record.skip_reason = reason;
    record.request.url = record.request.url || acc.base_url;
    record.retrieval.original_url = record.retrieval.original_url || record.request.url;
    record.fetch_id = mintFchId(ep.endpoint_id, record.request.url, fetchedAt);
    appendJsonl(path.join(reg.root, s.dirRel, "fetches.jsonl"), record);
    printResult(toolResult({
      status: exitWarning ? "warning" : "ok",
      warnings: [`fetch ${status}: ${reason}`],
      data: { fetch_id: record.fetch_id, fetch_status: status, skip_reason: reason },
    }));
    process.exit(0); // skipped/refused is a successful, honest run (spec/07.1)
  };

  // 1-2. params + substitution
  const params = { ...args.params };
  for (const p of ep.params || []) {
    if (p.required && !(p.name in params)) fail(`missing required --param ${p.name}=…  (${p.description || p.type || "no description"})`);
  }
  const { path: tpl, unresolved } = buildEndpointPath(ep, params);
  if (unresolved.length) fail("unresolved placeholders after substitution: " + unresolved.join(", "));
  let url = acc.base_url.replace(/\/+$/, "") + (tpl.startsWith("/") ? tpl : "/" + tpl);
  record.request.params = params;

  // 3. credential
  let credValue = null;
  if (acc.auth?.required && acc.auth.scheme !== "none") {
    if (["oauth2", "session_cookie"].includes(acc.auth.scheme)) {
      finishSkip("not_applicable", acc.auth.scheme + " is never automated by the reference CLI (spec/03.2)");
    }
    const resolved = resolveCredential(acc.auth.credential_ref, reg.root);
    record.credential = { ref: acc.auth.credential_ref, resolved_via: resolved.via };
    if (resolved.value == null) {
      finishSkip("not_applicable", `credential "${acc.auth.credential_ref}" unresolved — tried: ${resolved.tried.join(", ")}`);
    }
    credValue = resolved.value;
  }

  // 4. robots posture from the profile (latest probe wrote it)
  if (acc.robots?.applies && acc.robots.posture === "disallowed") {
    finishSkip("blocked", "robots.txt posture is disallowed; a conforming tool never bypasses it (spec/07.1)", true);
  }
  const derived = deriveState(acc, s.probes, reg.registry, nowDate());
  if (derived === "blocked") {
    finishSkip("blocked", "access method state is blocked; refusing (spec/07.1)", true);
  }

  // 5. budget
  const spent = readBudget(reg.root)[acc.access_id] || 0;
  if (acc.limits?.daily_budget != null && spent >= acc.limits.daily_budget) {
    finishSkip("not_applicable", `daily budget exhausted (${spent}/${acc.limits.daily_budget})`, true);
  }

  // 6. execute (+7. paginate)
  const contact = reg.registry.defaults?.user_agent_contact || "";
  const userAgent = `authority-fetch/${ctx.TOOL_VERSION}${contact ? " (+" + contact + ")" : ""}`;
  record.request.user_agent = userAgent;
  const delay = acc.limits?.politeness_delay_ms ?? reg.registry.defaults?.politeness_delay_ms ?? 1000;
  const maxPages = Math.max(1, parseInt(args.flags["max-pages"] || "1", 10) || 1);
  const headers = { "user-agent": userAgent, accept: "*/*" };
  if (credValue) {
    const scheme = acc.auth.scheme;
    if (scheme === "api_key_query") {
      const u = new URL(url);
      u.searchParams.set(acc.auth.location?.name || "api_key", credValue);
      url = u.toString();
    } else if (scheme === "api_key_header") headers[acc.auth.location?.name || "x-api-key"] = credValue;
    else if (scheme === "bearer_token") headers["authorization"] = "Bearer " + credValue;
    else if (scheme === "http_basic") headers["authorization"] = "Basic " + Buffer.from(credValue).toString("base64");
  }
  record.request.url = redactSecret(url, credValue);
  record.retrieval.original_url = record.request.url;
  record.fetch_id = mintFchId(ep.endpoint_id, record.request.url, fetchedAt);

  const outDir = typeof args.flags.out === "string"
    ? path.resolve(args.flags.out)
    : path.join(reg.root, reg.registry.sections?.fetched || "fetched/", slug);
  fs.mkdirSync(outDir, { recursive: true });

  const extFor = (contentType) => {
    const ct = String(contentType || "").split(";")[0].trim();
    return {
      "application/json": "json", "text/csv": "csv", "text/html": "html", "application/xml": "xml",
      "text/xml": "xml", "application/rss+xml": "xml", "application/atom+xml": "xml", "application/pdf": "pdf",
      "application/zip": "zip", "text/plain": "txt", "text/tab-separated-values": "tsv",
    }[ct] || "bin";
  };

  const pages = [];
  let pageUrl = url;
  let totalElapsed = 0;
  for (let page = 1; page <= maxPages && pageUrl; page++) {
    if (page > 1) await new Promise((r) => setTimeout(r, delay));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res, body, errKind = null, errDetail = "";
    const started = Date.now();
    try {
      res = await fetch(pageUrl, { method: ep.http_method, headers, redirect: "follow", signal: ctrl.signal });
      body = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      errKind = e.name === "AbortError" ? "timeout" : "network";
      errDetail = String(e.cause?.code || e.message);
    } finally {
      clearTimeout(timer);
    }
    totalElapsed += Date.now() - started;
    bumpBudget(reg.root, acc.access_id);
    if (errKind) {
      record.retrieval.fetch_status = "failed";
      record.notes = `${errKind} on page ${page}: ${errDetail}`;
      break;
    }
    record.retrieval.http_status = res.status;
    record.retrieval.final_url = redactSecret(res.url, credValue);
    record.retrieval.content_type = res.headers.get("content-type");
    if (res.status === 401 || res.status === 403) {
      record.retrieval.fetch_status = credValue ? "failed" : "blocked";
      record.notes = credValue ? "credential rejected (HTTP " + res.status + ")" : "refused (HTTP " + res.status + ")";
      break;
    }
    if (res.status === 402) { record.retrieval.fetch_status = "paywall"; record.notes = "HTTP 402"; break; }
    if (res.status >= 400) { record.retrieval.fetch_status = "failed"; record.notes = "HTTP " + res.status; break; }
    pages.push({ url: pageUrl, body, contentType: res.headers.get("content-type"), linkHeader: res.headers.get("link") });
    record.retrieval.fetch_status = "success";
    // spec/07.1: a body that does not match the endpoint's declared format is
    // partial, not success — catches WAF block pages served with HTTP 200.
    if (page === 1) {
      const declared = ep.response?.format;
      const head = body.subarray(0, 4096).toString("utf8");
      if (declared === "json") {
        try { JSON.parse(body.toString("utf8")); } catch { record.retrieval.fetch_status = "partial"; record.notes = "HTTP 200 but body is not the declared json"; }
      } else if (["xml", "rss", "atom"].includes(declared) && !/^\s*(<\?xml|<[A-Za-z][^>]*>)/.test(head.replace(/^<!--[\s\S]*?-->/, ""))) {
        record.retrieval.fetch_status = "partial"; record.notes = "HTTP 200 but body is not the declared " + declared;
      } else if (["xml", "rss", "atom"].includes(declared) && /<html[\s>]/i.test(head.slice(0, 200))) {
        record.retrieval.fetch_status = "partial"; record.notes = "HTTP 200 but body is HTML, not the declared " + declared + " (block page?)";
      }
    }

    // next page per declared style
    pageUrl = null;
    const pg = ep.pagination;
    if (pg && pg.style !== "none" && page < maxPages) {
      if (pg.style === "page_number" && pg.page_param) {
        const u = new URL(pages[page - 1].url);
        const cur = parseInt(u.searchParams.get(pg.page_param) || String(page), 10);
        u.searchParams.set(pg.page_param, String(cur + 1));
        pageUrl = u.toString();
      } else if (pg.style === "offset_limit" && pg.page_param) {
        const u = new URL(pages[page - 1].url);
        const size = parseInt(u.searchParams.get(pg.size_param || "limit") || String(pg.max_page_size || 100), 10);
        const cur = parseInt(u.searchParams.get(pg.page_param) || "0", 10);
        u.searchParams.set(pg.page_param, String(cur + size));
        pageUrl = u.toString();
      } else if ((pg.style === "cursor" || pg.style === "token") && pg.cursor_path) {
        try {
          const doc = JSON.parse(pages[page - 1].body.toString("utf8"));
          let node = doc;
          for (const part of pg.cursor_path.split(".")) node = node?.[part];
          if (node) {
            const u = new URL(pages[page - 1].url);
            u.searchParams.set(pg.page_param || "cursor", String(node));
            pageUrl = u.toString();
          }
        } catch { /* no next page */ }
      } else if (pg.style === "link_header" && pages[page - 1].linkHeader) {
        const m = /<([^>]+)>\s*;\s*rel="next"/.exec(pages[page - 1].linkHeader);
        if (m) pageUrl = m[1];
      }
    }
  }

  // 8. store + record
  if (pages.length) {
    const ext = extFor(pages[0].contentType);
    const base = `${tsCompact(fetchedAt)}-${ep.name}`;
    let payloadAbs;
    if (pages.length === 1) {
      payloadAbs = path.join(outDir, `${base}.${ext}`);
      fs.writeFileSync(payloadAbs, pages[0].body);
    } else {
      payloadAbs = path.join(outDir, `${base}.p1.${ext}`);
      pages.forEach((p, i) => fs.writeFileSync(path.join(outDir, `${base}.p${i + 1}.${ext}`), p.body));
    }
    const all = Buffer.concat(pages.map((p) => p.body));
    record.retrieval.sha256 = sha256Hex(pages.length === 1 ? pages[0].body : all);
    record.retrieval.bytes = pages.length === 1 ? pages[0].body.length : all.length;
    record.retrieval.elapsed_ms = totalElapsed;
    record.payload = {
      path: path.relative(reg.root, payloadAbs).replace(/\\/g, "/"),
      pages: pages.length > 1 ? pages.length : null,
    };
    writeJsonAtomic(payloadAbs + ".fetch.json", record); // sidecar beside payload (may be outside registry with --out)

    if (args.flags["keep-sample"]) {
      const sampleDir = path.join(reg.root, s.dirRel, "samples");
      fs.mkdirSync(sampleDir, { recursive: true });
      const first = pages[0].body;
      const truncated = first.length > SAMPLE_CAP;
      let sampleBytes = truncated ? first.subarray(0, SAMPLE_CAP) : first;
      if (credValue) sampleBytes = Buffer.from(redactSecret(sampleBytes.toString("utf8"), credValue), "utf8");
      const sampleAbs = path.join(sampleDir, `${ep.name}.${ext}`);
      fs.writeFileSync(sampleAbs, sampleBytes);
      record.sample = {
        path: path.relative(reg.root, sampleAbs).replace(/\\/g, "/"),
        sha256: sha256Hex(sampleBytes),
        bytes: sampleBytes.length,
        truncated_at: truncated ? SAMPLE_CAP : null,
      };
      writeJsonAtomic(payloadAbs + ".fetch.json", record); // rewrite sidecar with sample block
    }
  }
  appendJsonl(path.join(reg.root, s.dirRel, "fetches.jsonl"), record);

  const okish = record.retrieval.fetch_status === "success";
  printResult(toolResult({
    status: okish ? "ok" : "warning",
    artifacts: record.payload?.path ? [path.join(reg.root, record.payload.path)] : [],
    warnings: okish ? [] : [`fetch_status: ${record.retrieval.fetch_status}${record.notes ? " — " + record.notes : ""}`],
    data: {
      fetch_id: record.fetch_id,
      fetch_status: record.retrieval.fetch_status,
      http_status: record.retrieval.http_status,
      bytes: record.retrieval.bytes,
      sha256: record.retrieval.sha256,
      payload: record.payload?.path || null,
      sample: record.sample?.path || null,
      pages: pages.length,
    },
  }));
  process.exit(okish ? 0 : 1);
}

// ---------------------------------------------------------------------------
// export (spec/09) — Phase 6
// ---------------------------------------------------------------------------

export function cmdExport(args, ctx) {
  const root = args.pos[0];
  const format = typeof args.flags.format === "string" ? args.flags.format : null;
  if (!root || !format) fail("usage: authority export <registry> --format csv|json|markdown|pi-canonical-sources|pi-domain-strategies|pi-provider-stub [-o <file>]");
  const reg = loadRegistry(root);
  const now = nowDate();
  let text;
  if (format === "csv") text = ctx.renderSourcesCsv(reg, now);
  else if (format === "json") text = JSON.stringify(exportJson(reg, now), null, 2) + "\n";
  else if (format === "markdown") text = exportMarkdown(reg, now);
  else if (format === "pi-canonical-sources") text = JSON.stringify(exportPiCanonicalSources(reg, now), null, 2) + "\n";
  else if (format === "pi-domain-strategies") text = JSON.stringify(exportPiDomainStrategies(reg, now), null, 2) + "\n";
  else if (format === "pi-provider-stub") text = JSON.stringify(exportPiProviderStub(reg, now), null, 2) + "\n";
  else fail("unknown format: " + format);
  const out = typeof args.flags.o === "string" ? args.flags.o : (typeof args.flags.output === "string" ? args.flags.output : null);
  if (out) {
    atomicWriteFile(path.resolve(out), text);
    printResult(toolResult({ status: "ok", artifacts: [path.resolve(out)], data: { format, bytes: Buffer.byteLength(text) } }));
  } else {
    process.stdout.write(text);
  }
}

function sortedSources(reg) {
  return [...reg.sources].filter((s) => s.obj).sort((a, b) => (a.dirRel < b.dirRel ? -1 : 1));
}

function exportJson(reg, now) {
  return {
    asr_spec_version: reg.registry.asr_spec_version,
    registry_id: reg.registry.registry_id,
    title: reg.registry.title,
    generated_from: "authority export --format json",
    topics: reg.topics?.topics || [],
    sources: sortedSources(reg).map((s) => s.obj),
  };
}

function exportMarkdown(reg, now) {
  const L = [];
  L.push(`# ${reg.registry.title}`);
  L.push("");
  L.push(`> Generated projection of registry \`${reg.registry.registry_id}\` (ASR ${reg.registry.asr_spec_version}). The JSON objects are the source of truth (spec/09.3).`);
  L.push("");
  for (const s of sortedSources(reg)) {
    const o = s.obj;
    const states = (o.access || []).map((a) => deriveState(a, s.probes, reg.registry, now));
    L.push(`## ${o.identity.name}`);
    L.push("");
    L.push(`**${o.source_role}** · class ${o.source_class} · tier ${o.authority?.adjudicated?.tier ?? o.authority?.asserted?.tier}${o.authority?.adjudicated?.tier == null ? " (asserted)" : ""} · ${rollupState(states)} · ${o.identity.homepage_url}`);
    L.push("");
    if (o.identity.description) { L.push(o.identity.description); L.push(""); }
    const g = o.guidance || {};
    if ((g.best_for || []).length) {
      L.push("**Best for:** " + g.best_for.join(" · "));
      L.push("");
    }
    for (const q of g.query_shapes || []) {
      L.push(`- **${q.task}**${q.endpoint ? ` (\`${q.endpoint}\`)` : ""}: ${q.recipe}${q.example ? ` — e.g. \`${q.example}\`` : ""}`);
    }
    for (const p of g.pitfalls || []) L.push(`- ⚠ ${p}`);
    if ((g.query_shapes || []).length || (g.pitfalls || []).length) L.push("");
    for (const a of o.access || []) {
      const st = deriveState(a, s.probes, reg.registry, now);
      L.push(`- \`${a.name}\` (${a.type}) — ${st}${a.auth?.required ? `, auth: ${a.auth.scheme} (ref \`${a.auth.credential_ref}\`)` : ""} — ${a.base_url}`);
      for (const e of a.endpoints || []) {
        L.push(`  - \`${e.name}\`: ${e.http_method} \`${e.path_template}\`${e.description ? " — " + e.description : ""}`);
      }
    }
    L.push("");
  }
  return L.join("\n");
}

function exportPiCanonicalSources(reg, now) {
  // Shape verified against pi-forge vault-wiki/references/canonical-sources.json
  // (crosswalks/pi-forge.md). Deterministic ordering: by id.
  const topicMap = reg.registry.ext?.["pi-forge"]?.topic_map || {};
  const unmapped = new Set();
  const sources = sortedSources(reg).map((s) => {
    const o = s.obj;
    const pf = o.ext?.["pi-forge"] || {};
    const topics = [];
    for (const t of o.scope?.topics || []) {
      if (topicMap[t]) topics.push(...topicMap[t]);
      else { topics.push(t); unmapped.add(t); }
    }
    return {
      id: pf.provider || path.basename(s.dirRel),
      label: o.identity.name,
      site: new URL(o.identity.canonical_url).host,
      authority: o.authority?.adjudicated?.tier ?? o.authority?.asserted?.tier ?? 3,
      kinds: pf.kinds || ["*"],
      topics: [...new Set(topics)].sort(),
      notes: (o.guidance?.best_for || [])[0] || o.identity.description || "",
      provider: pf.provider || null,
    };
  }).sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    schemaVersion: 1,
    updatedAt: isoMs(now).slice(0, 10),
    generated_by: "authority export --format pi-canonical-sources",
    registry: reg.registry.registry_id,
    ...(unmapped.size ? { unmapped_topics: [...unmapped].sort() } : {}),
    sources,
  };
}

function exportPiDomainStrategies(reg, now) {
  const domains = {};
  for (const s of sortedSources(reg)) {
    const o = s.obj;
    for (const a of o.access || []) {
      if (!["web_fetch", "web_render", "bulk_download"].includes(a.type)) continue;
      const domain = new URL(a.base_url).host;
      const pf = o.ext?.["pi-forge"] || {};
      domains[domain] = {
        preferred_strategy: a.type === "web_render" ? "browser_dom" : "direct_http",
        ...(a.limits?.requests_per_second != null ? { rate_limit: { requests_per_second: a.limits.requests_per_second } } : {}),
        ...(a.verification?.last_verified_at ? { last_verified: a.verification.last_verified_at.slice(0, 10) } : {}),
        ...(pf.selectors ? { main_selectors: pf.selectors } : {}),
        notes: [o.content?.landing_pattern && o.content.landing_pattern !== "direct" ? `landing pattern: ${o.content.landing_pattern}` : "", ...(o.guidance?.pitfalls || [])].filter(Boolean).join(" | "),
      };
    }
  }
  return {
    schemaVersion: 1,
    updatedAt: isoMs(now).slice(0, 10),
    generated_by: "authority export --format pi-domain-strategies",
    registry: reg.registry.registry_id,
    domains: Object.fromEntries(Object.entries(domains).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

function exportPiProviderStub(reg, now) {
  const providers = [];
  for (const s of sortedSources(reg)) {
    const o = s.obj;
    for (const a of o.access || []) {
      if (!["api_rest", "api_graphql", "oai_pmh", "feed"].includes(a.type)) continue;
      const pf = o.ext?.["pi-forge"] || {};
      providers.push({
        id: pf.provider || path.basename(s.dirRel),
        label: o.identity.name,
        kind: a.type,
        base: a.base_url,
        site: new URL(o.identity.canonical_url).host,
        topics: o.scope?.topics || [],
        authority: o.authority?.adjudicated?.tier ?? o.authority?.asserted?.tier ?? 3,
        capabilities: {
          authRequired: !!a.auth?.required,
          ...(a.auth?.required ? { authScheme: a.auth.scheme, credentialRef: a.auth.credential_ref, envVar: "FORGE_API_KEY_" + String(a.auth.credential_ref || "").toUpperCase().replace(/[^A-Z0-9]+/g, "_") } : {}),
          ...(a.limits?.requests_per_second != null ? { rateLimit: a.limits.requests_per_second + " rps" } : {}),
          ...(a.limits?.daily_budget != null ? { dailyBudget: { calls: a.limits.daily_budget } } : {}),
          strengths: o.guidance?.best_for || [],
          limits: o.guidance?.pitfalls || [],
        },
        endpoints: (a.endpoints || []).map((e) => ({
          name: e.name, method: e.http_method, path: e.path_template,
          params: (e.params || []).map((p) => ({ name: p.name, required: p.required, example: p.example })),
          response: e.response, pagination: e.pagination?.style || "none",
        })),
        todo: "search()/resolve() are human work: wire these fields into a SEARCH_PROVIDERS entry (see crosswalks/pi-forge.md).",
      });
    }
  }
  return {
    schemaVersion: 1,
    updatedAt: isoMs(now).slice(0, 10),
    generated_by: "authority export --format pi-provider-stub",
    registry: reg.registry.registry_id,
    providers: providers.sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}
