#!/usr/bin/env node
// authority.mjs — the ASR reference CLI (spec 0.3.0). Zero dependencies,
// Node >= 18. Commands: init, add, validate, probe, fetch, creds, regen,
// export, build-index, mint. The spec is normative; where this code and the
// spec disagree, the spec governs and this is the bug.
//
// Machine-facing commands print one JSON object in the harness tool-contract
// shape {status, artifacts, warnings, errors, data} (spec/09, pi-forge
// SCRIPT_TOOL_CONTRACT), so wrapping any command as an agent tool is a
// schema, not a parser.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  sha256Hex, sha256File, jcs,
  mintRegId, mintAscId, mintAccId, mintEndId, mintPrbId, mintFchId, ID_PATTERNS,
  isoMs, tsCompact, canonicalUrl, slugify, slugifyWithCollision, checkFilename,
  atomicWriteFile, writeJsonAtomic, appendJsonl, readJSON, readJSONLSafe, writeCsv,
  validateWithSchema, findStandardDirs, computeSchemaHash, resolveInside,
  STATE_ORDER, deriveState, rollupState, latestProbeFor, effectiveWindowDays,
  resolveCredential, credEnvName, credentialsFilePath, CRED_REF_PATTERN,
  redactSecret, scanForSecrets, checkUntracked,
  loadRegistry, toolResult, printResult,
} from "./authority_common.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOOL_NAME = "authority";
const TOOL_VERSION = "0.3.0";

// ---------------------------------------------------------------------------
// arg parsing: positional args + --flag / --flag value / repeated --param k=v
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  const params = {};
  const facets = []; // repeated --facet name=value pairs (query); accumulates like --param
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--param") {
      const kv = argv[++i] || "";
      const eq = kv.indexOf("=");
      if (eq === -1) throw new Error("--param expects k=v, got: " + kv);
      params[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a === "--facet") {
      const kv = argv[++i] || "";
      const eq = kv.indexOf("=");
      if (eq === -1) throw new Error("--facet expects name=value, got: " + kv);
      facets.push([kv.slice(0, eq), kv.slice(eq + 1)]);
    } else if (a.startsWith("--")) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { flags[name] = next; i++; }
      else flags[name] = true;
    } else {
      pos.push(a);
    }
  }
  return { pos, flags, params, facets };
}

function fail(msg, code = 2) {
  process.stderr.write("authority: " + msg + "\n");
  process.exit(code);
}

// ---------------------------------------------------------------------------
// mint — compute a content-addressed id from an object on stdin (spec/06)
// ---------------------------------------------------------------------------

function cmdMint(args) {
  const kind = args.pos[0];
  const input = fs.readFileSync(0, "utf8").trim();
  const obj = input ? JSON.parse(input) : {};
  let id;
  if (kind === "asc") {
    const url = obj.canonical_url || (obj.identity && obj.identity.canonical_url) ||
      canonicalUrl(obj.homepage_url || (obj.identity && obj.identity.homepage_url) || "");
    if (!url) fail("mint asc needs canonical_url or homepage_url");
    id = mintAscId(url);
  } else if (kind === "acc") {
    if (!obj.source_id || !obj.type || !obj.base_url) fail("mint acc needs {source_id, type, base_url}");
    id = mintAccId(obj.source_id, obj.type, obj.base_url);
  } else if (kind === "end") {
    if (!obj.access_id || !obj.http_method || !obj.path_template) fail("mint end needs {access_id, http_method, path_template}");
    id = mintEndId(obj.access_id, obj.http_method, obj.path_template);
  } else if (kind === "prb") {
    if (!obj.access_id || !obj.probed_at) fail("mint prb needs {access_id, probed_at}");
    id = mintPrbId(obj.access_id, obj.probed_at);
  } else if (kind === "fch") {
    if (!obj.endpoint_id || !obj.request_url || !obj.fetched_at) fail("mint fch needs {endpoint_id, request_url, fetched_at}");
    id = mintFchId(obj.endpoint_id, obj.request_url, obj.fetched_at);
  } else {
    fail("mint kind must be one of: asc acc end prb fch");
  }
  process.stdout.write(id + "\n");
}

// ---------------------------------------------------------------------------
// validate — the spec/08 rule engine
// ---------------------------------------------------------------------------

const EXERCISABLE_TYPES = new Set(["api_rest", "api_graphql", "oai_pmh", "feed"]);

const LEVEL_RANK = { L0: 0, L1: 1, L2: 2 };

function cmdValidate(args) {
  const root = args.pos[0];
  if (!root) fail("usage: authority validate <registry> [--strict] [--level L0|L1|L2]");
  const strict = !!args.flags.strict;
  const target = typeof args.flags.level === "string" ? args.flags.level.toUpperCase() : "L1";
  if (!(target in LEVEL_RANK)) fail("--level must be L0, L1, or L2");
  const { schemaDir } = findStandardDirs(SCRIPT_DIR);
  const now = new Date();

  const errors = [];
  const warnings = [];
  const E = (code, level, object, detail, hint) => errors.push({ code, level, object, detail, ...(hint ? { hint } : {}) });
  const W = (code, level, object, detail, hint) => warnings.push({ code, level, object, detail, ...(hint ? { hint } : {}) });

  // --- load (rule 0.1) ---
  let reg;
  try {
    reg = loadRegistry(root);
  } catch (e) {
    printResult(toolResult({
      status: "error",
      errors: [{ code: "load_error", message: e.message }],
      data: { status: "error", level: "none", errors: [{ code: "load_error", level: "L0", object: root, detail: e.message }], warnings: [] },
    }));
    process.exit(1);
  }
  const { registry, topics, facets, sources, diagnostics } = reg;
  const regName = path.basename(reg.root);

  for (const d of diagnostics) {
    const lvl = d.code === "jsonl_torn_tail" ? W : E;
    lvl(d.code, "L0", d.object || d.file || regName, d.detail || "");
  }

  const manErrs = validateWithSchema(schemaDir, "registry.schema.json", registry, "registry.json");
  for (const m of manErrs) E("schema_invalid", "L0", "registry.json", m);
  if (!registry.asr_spec_version) E("spec_version_missing", "L0", "registry.json", "no asr_spec_version");

  // --- topics (rule 0.7) ---
  const topicIds = new Set();
  if (!topics) {
    E("topics_invalid", "L0", "topics.json", "missing or unparseable", "create topics.json (authority init writes one)");
  } else {
    const tErrs = validateWithSchema(schemaDir, "topics.schema.json", topics, "topics.json");
    for (const m of tErrs) E("topics_invalid", "L0", "topics.json", m);
    for (const t of topics.topics || []) topicIds.add(t.id);
  }

  // --- facets (rule 0.8, 0.3.0, conditional) ---
  // facets.json is optional and registry-local; when present it must validate,
  // and every facet name/value a source claims must be declared here. When
  // absent, facetMap stays empty and the per-source check fires only if a source
  // actually carries scope.facets (so facet-free registries are unaffected).
  const facetMap = new Map(); // facet name -> Set(value id)
  if (facets) {
    const fErrs = validateWithSchema(schemaDir, "facets.schema.json", facets, "facets.json");
    for (const m of fErrs) E("facets_invalid", "L0", "facets.json", m);
    for (const f of facets.facets || []) facetMap.set(f.id, new Set((f.values || []).map((v) => v.id)));
  }

  // --- per-source structural rules ---
  const idSeen = new Map(); // id -> object label (rule 1.1 duplicates)
  const aliasSeen = new Map(); // "tool\nvalue" -> source label
  const allSourceIds = new Set(sources.map((s) => s.obj?.source_id).filter(Boolean));
  const credRefs = new Set();
  let accessCount = 0, endpointCount = 0, probeCount = 0, fetchCount = 0;

  const dupCheck = (id, label) => {
    if (!id) return;
    if (idSeen.has(id)) E("id_duplicate", "L1", label, `id ${id} already used by ${idSeen.get(id)}`);
    else idSeen.set(id, label);
  };

  // schema properties for unknown_field
  const sourceSchemaProps = new Set(Object.keys(readJSON(path.join(schemaDir, "source.schema.json")).properties || {}));

  for (const s of sources) {
    const o = s.obj;
    if (!o) continue;
    const label = s.dirRel;

    // 0.2 schema validity
    const sErrs = validateWithSchema(schemaDir, "source.schema.json", o, label + "/source.json");
    for (const m of sErrs) E("schema_invalid", "L0", label, m);

    // 0.4 declared/derived paths portable
    for (const rel of [s.dirRel + "/source.json"]) {
      const chk = checkFilename(rel);
      if (!chk.ok) E("filename_illegal", "L0", label, chk.reason);
    }

    // 0.6 access present
    if (!Array.isArray(o.access) || o.access.length === 0) {
      E("missing_access", "L0", label, "no access methods declared");
    }

    // 0.7 topics known
    for (const t of o.scope?.topics || []) {
      if (topics && !topicIds.has(t)) E("unknown_topic", "L0", label, `topic "${t}" not in topics.json`);
    }

    // 0.8 facets known (conditional: only sources that USE scope.facets are checked)
    for (const [fname, vals] of Object.entries(o.scope?.facets || {})) {
      if (!facets) {
        E("unknown_facet_value", "L0", label, `scope.facets.${fname} used but no facets.json is declared`,
          "add facets.json + a sections.facets entry, then: authority regen " + regName);
        continue;
      }
      if (!facetMap.has(fname)) {
        E("unknown_facet_value", "L0", label, `facet "${fname}" not declared in facets.json`);
        continue;
      }
      const allowed = facetMap.get(fname);
      for (const v of vals || []) {
        if (!allowed.has(v)) E("unknown_facet_value", "L0", label, `facet ${fname} value "${v}" not in facets.json`);
      }
    }

    // 1.1 ids recompute
    const sid = o.source_id;
    if (!ID_PATTERNS.asc.test(sid || "")) E("id_format", "L1", label, `source_id ${sid} malformed`);
    else {
      dupCheck(sid, label);
      const canon = o.identity?.canonical_url;
      if (canon) {
        const want = mintAscId(canon);
        if (want !== sid) E("id_mismatch", "L1", label, `source_id ${sid} != recomputed ${want} from canonical_url`, "recompute with: authority mint asc");
        const wantCanon = canonicalUrl(o.identity?.homepage_url || "");
        if (wantCanon && wantCanon !== canon) W("state_drift", "L1", label, `canonical_url ${canon} != normalize(homepage_url) ${wantCanon}`);
      }
    }

    // provenance (1.11)
    if (!o.provenance || !o.provenance.produced_by) E("missing_provenance", "L1", label, "no provenance stamp");

    // adjudication (1.10)
    const adj = o.authority?.adjudicated;
    if (adj && (adj.tier != null || adj.score != null)) {
      if (!adj.scored_by || !adj.scored_at) E("adjudication_unattributed", "L1", label, "adjudicated tier/score without scored_by + scored_at");
      if (o.provenance?.produced_by?.method === "model") W("adjudication_by_machine", "L1", label, "adjudication present on a model-written profile");
      if (o.provenance?.produced_by?.method === "import") W("adjudication_by_import", "L1", label, "adjudicated authority on an imported profile — an import must not manufacture adjudication (spec/10)");
    }

    // aliases (advisory)
    for (const [tool, val] of Object.entries(o.aliases || {})) {
      const k = tool + "\n" + val;
      if (aliasSeen.has(k)) W("alias_collision", "L0", label, `alias ${tool}:${val} also on ${aliasSeen.get(k)}`);
      else aliasSeen.set(k, label);
    }

    // x_extension (advisory)
    const xCheck = (v, where) => { if (typeof v === "string" && /^x-/.test(v)) W("x_extension", "L0", label, `${where}: ${v}`); };
    xCheck(o.source_role, "source_role");
    for (const b of o.authority?.asserted?.basis || []) xCheck(b, "authority.basis");
    for (const a of o.content?.artifacts || []) xCheck(a.kind, "content.artifacts.kind");
    for (const r of o.relations || []) xCheck(r.type, "relations.type");
    // 0.2.0 extensible fields (keep x- values visible)
    xCheck(o.officiality?.default, "officiality.default");
    for (const a of o.content?.artifacts || []) xCheck(a.officiality, "content.artifacts.officiality");
    for (const [k, v] of Object.entries(o.guidance?.routing || {})) xCheck(v, `guidance.routing.${k}`);
    xCheck(o.guidance?.resolution?.strategy, "guidance.resolution.strategy");
    xCheck(o.coverage?.completeness?.claim, "coverage.completeness.claim");
    xCheck(o.coverage?.completeness?.basis, "coverage.completeness.basis");
    xCheck(o.freshness?.content_freshness_basis, "freshness.content_freshness_basis");
    for (const u of o.discovery?.upstream || []) xCheck(u.registry, "discovery.upstream.registry");

    // unknown_field (advisory / strict error)
    for (const k of Object.keys(o)) {
      if (!sourceSchemaProps.has(k)) {
        (strict ? E : W)("unknown_field", "L0", label, `unknown top-level member "${k}" (use ext.<tool>)`);
      }
    }

    // relations resolve (1.2)
    for (const r of o.relations || []) {
      if (r.target?.source_id && !allSourceIds.has(r.target.source_id)) {
        E("dangling_relation", "L1", label, `relation ${r.type} -> ${r.target.source_id} not in registry`);
      }
    }

    // --- 0.2.0 semantic rules (conditional: each fires only when its field is
    //     present, so 0.1.0 profiles without these fields are unaffected) ---
    const comp = o.coverage?.completeness;
    if (comp) {
      // A strong completeness claim (absence = evidence) must state its basis.
      if ((comp.claim === "exhaustive" || comp.claim === "systematic") && !comp.basis) {
        E("coverage_basis_missing", "L1", label, `coverage completeness "${comp.claim}" requires a basis (spec/02)`);
      }
      if (comp.basis === "independently_assessed" && !(comp.notes && String(comp.notes).trim())) {
        W("coverage_assessment_unsupported", "L1", label, "completeness basis independently_assessed without supporting notes");
      }
    }
    // follow_primary routing must say HOW to reach the primary.
    const routing = o.guidance?.routing;
    if (routing && (routing.citation === "follow_primary" || routing.legal_status === "follow_primary")) {
      const res = o.guidance?.resolution;
      const hasResolution = !!(res && (res.strategy || (res.notes && String(res.notes).trim())));
      const hasResolvingRelation = (o.relations || []).some((r) => r.type === "resolves_to" || r.type === "official_source_for");
      if (!hasResolution && !hasResolvingRelation) {
        E("routing_primary_unresolved", "L1", label, "guidance.routing says follow_primary but nothing identifies the primary (need guidance.resolution or a resolves_to/official_source_for relation)");
      }
    }
    // External org-identifier shapes (advisory; external services are never
    // mandatory for conformance).
    const opIds = o.identity?.operator?.identifiers;
    if (opIds) {
      if (opIds.ror && !/^(https:\/\/ror\.org\/)?0[0-9a-z]{8}$/.test(opIds.ror)) W("external_id_shape", "L0", label, `operator.identifiers.ror "${opIds.ror}" is not a valid ROR id`);
      if (opIds.wikidata && !/^Q[1-9][0-9]*$/.test(opIds.wikidata)) W("external_id_shape", "L0", label, `operator.identifiers.wikidata "${opIds.wikidata}" is not a valid QID`);
    }

    // --- access methods ---
    const probesById = s.probes;
    const accessIds = new Set();
    const endpointIds = new Set();
    for (const acc of o.access || []) {
      accessCount++;
      const aLabel = label + "#" + (acc.name || acc.access_id);
      accessIds.add(acc.access_id);

      if (!ID_PATTERNS.acc.test(acc.access_id || "")) E("id_format", "L1", aLabel, `access_id ${acc.access_id} malformed`);
      else {
        dupCheck(acc.access_id, aLabel);
        if (sid && acc.type && acc.base_url) {
          const want = mintAccId(sid, acc.type, acc.base_url);
          if (want !== acc.access_id) E("id_mismatch", "L1", aLabel, `access_id != recomputed ${want}`, "recompute with: authority mint acc");
        }
      }
      xCheck(acc.type, "access.type");
      if (acc.auth?.scheme) xCheck(acc.auth.scheme, "auth.scheme");

      // 1.8 auth completeness
      if (acc.auth?.required) {
        const scheme = acc.auth.scheme;
        if (!scheme || scheme === "none") E("auth_underspecified", "L1", aLabel, "auth.required without a scheme");
        else if (scheme !== "oauth2" && scheme !== "session_cookie" && !acc.auth.credential_ref) {
          E("auth_underspecified", "L1", aLabel, `scheme ${scheme} without credential_ref`);
        }
        if ((scheme === "api_key_query" || scheme === "api_key_header") && !(acc.auth.location?.in && acc.auth.location?.name)) {
          E("auth_underspecified", "L1", aLabel, `scheme ${scheme} without location {in, name}`);
        }
      }
      if (acc.auth?.credential_ref) {
        if (!CRED_REF_PATTERN.test(acc.auth.credential_ref)) E("credential_ref_invalid", "L1", aLabel, `credential_ref "${acc.auth.credential_ref}" malformed`);
        else credRefs.add(acc.auth.credential_ref);
      }

      // 1.9 robots posture
      if (acc.robots?.applies) {
        if (!acc.robots.posture) E("robots_unrecorded", "L1", aLabel, "robots applies but no posture recorded", `run: authority probe ${regName} ${path.basename(s.dirRel)} --access ${acc.name}`);
        else if (["allowed", "partial", "disallowed"].includes(acc.robots.posture)) {
          const hasRobotsEvidence = probesById.some((p) => p.access_id === acc.access_id && (p.evidence || []).some((ev) => ev.kind === "robots_txt"));
          if (!hasRobotsEvidence) E("robots_evidence_missing", "L1", aLabel, `posture ${acc.robots.posture} with no captured robots.txt evidence`);
        }
      }

      // --- the gate: stored state vs derivation (1.3, 1.5, 1.6) ---
      const stored = acc.verification?.state;
      const derived = deriveState(acc, probesById, registry, now);
      const latest = latestProbeFor(probesById, acc.access_id);
      if (stored === "verified") {
        if (!latest || latest.outcome !== "ok") {
          E("unverified_claim", "L1", aLabel, "state verified with no ok probe record", `run: authority probe ${regName} ${path.basename(s.dirRel)} --access ${acc.name}`);
        } else if (derived === "stale") {
          E("stale_verification", "L1", aLabel, `verified on ${latest.probed_at} exceeds window ${effectiveWindowDays(acc, registry)}d — must read stale`, "run: authority regen " + regName);
        }
      }
      if ((stored === "broken" || stored === "blocked") && !acc.verification?.last_probe_id) {
        E("state_without_evidence", "L1", aLabel, `state ${stored} without last_probe_id`);
      }
      if (stored && stored !== derived && !(stored === "verified" && derived === "stale")) {
        W("state_drift", "L1", aLabel, `stored ${stored} != derived ${derived}`, "run: authority regen " + regName);
      }
      if (acc.verification?.last_probe_id && !probesById.some((p) => p.probe_id === acc.verification.last_probe_id)) {
        E("dangling_probe", "L1", aLabel, `last_probe_id ${acc.verification.last_probe_id} not in probes.jsonl`);
      }

      // 2.5 asserted_remaining
      if (derived === "asserted" && !acc.verification?.notes) {
        W("asserted_remaining", "L2", aLabel, "access still asserted with no waiver note");
      }

      // --- endpoints ---
      for (const ep of acc.endpoints || []) {
        endpointCount++;
        const eLabel = aLabel + "/" + (ep.name || ep.endpoint_id);
        endpointIds.add(ep.endpoint_id);
        if (!ID_PATTERNS.end.test(ep.endpoint_id || "")) E("id_format", "L1", eLabel, `endpoint_id ${ep.endpoint_id} malformed`);
        else {
          dupCheck(ep.endpoint_id, eLabel);
          if (acc.access_id && ep.http_method && ep.path_template) {
            const want = mintEndId(acc.access_id, ep.http_method, ep.path_template);
            if (want !== ep.endpoint_id) E("id_mismatch", "L1", eLabel, `endpoint_id != recomputed ${want}`, "recompute with: authority mint end");
          }
        }
      }

      // 2.1 endpoint exercised — applies to every non-retired API-family
      // method: L2 means the recipes demonstrably work, so an asserted API
      // blocks L2 just as an unexercised verified one does.
      if (EXERCISABLE_TYPES.has(acc.type) && derived !== "retired") {
        const exercised = s.fetches.some(
          (f) => f.access_id === acc.access_id && f.retrieval?.fetch_status === "success"
        );
        if (!exercised) {
          E("endpoint_unexercised", "L2", aLabel, `${derived} API access with no successful fetch record`, `run: authority fetch ${regName} ${path.basename(s.dirRel)} <endpoint>`);
        }
      }
    }

    // --- probe records (1.1 ids, 1.2 refs, 1.4 evidence, schema) ---
    probeCount += s.probes.length;
    for (const p of s.probes) {
      const pLabel = label + "/probes:" + (p.probe_id || "?");
      const pErrs = validateWithSchema(schemaDir, "probe.schema.json", p, pLabel);
      for (const m of pErrs) E("schema_invalid", "L1", pLabel, m);
      if (p.probe_id && p.access_id && p.probed_at) {
        const want = mintPrbId(p.access_id, p.probed_at);
        if (want !== p.probe_id) E("id_mismatch", "L1", pLabel, `probe_id != recomputed ${want}`);
        else dupCheck(p.probe_id, pLabel);
      }
      if (p.access_id && !accessIds.has(p.access_id)) {
        // History, not a lie: a changed base_url mints a new access id and the
        // journal keeps the old records (§6.6) — advisory, never an error.
        W("orphaned_record", "L1", pLabel, `probe references superseded access_id ${p.access_id}`);
      }
      for (const ev of p.evidence || []) {
        const { abs, contained, symlinkEscape } = resolveInside(reg.root, ev.path || "");
        if (!contained) { E(symlinkEscape ? "symlink_escape" : "path_escape", "L0", pLabel, ev.path); continue; }
        const chk = checkFilename(ev.path);
        if (!chk.ok) E("filename_illegal", "L0", pLabel, chk.reason);
        if (!fs.existsSync(abs)) {
          E("probe_evidence_missing", "L1", pLabel, `evidence file missing: ${ev.path}`);
        } else {
          const got = sha256File(abs);
          if (got !== ev.sha256) {
            E("probe_evidence_hash_mismatch", "L1", pLabel, `evidence ${ev.path} sha256 ${got.slice(0, 12)}… != recorded ${String(ev.sha256).slice(0, 12)}…`);
          }
        }
      }
      // secrets in probe records (1.7)
      for (const f of scanForSecrets(p, pLabel)) {
        E("credential_in_profile", "L1", pLabel, `possible secret at ${f.path} (${f.kind})`);
      }
    }

    // --- fetch records (2.2, ids, refs, secrets, samples) ---
    fetchCount += s.fetches.length;
    // Samples are newest-wins (spec/07.4): hash-check each sample path only
    // against the latest record referencing it; older blocks are history.
    const latestForSample = new Map();
    for (const f of s.fetches) {
      if (f.sample?.path) {
        const prev = latestForSample.get(f.sample.path);
        if (!prev || String(f.fetched_at) > String(prev.fetched_at)) latestForSample.set(f.sample.path, f);
      }
    }
    for (const f of s.fetches) {
      const fLabel = label + "/fetches:" + (f.fetch_id || "?");
      const fErrs = validateWithSchema(schemaDir, "fetch-record.schema.json", f, fLabel);
      for (const m of fErrs) E("fetch_record_invalid", "L2", fLabel, m);
      if (f.fetch_id && f.endpoint_id && f.request?.url && f.fetched_at) {
        const want = mintFchId(f.endpoint_id, f.request.url, f.fetched_at);
        if (want !== f.fetch_id) E("id_mismatch", "L1", fLabel, `fetch_id != recomputed ${want}`);
        else dupCheck(f.fetch_id, fLabel);
      }
      if (f.access_id && !accessIds.has(f.access_id)) W("orphaned_record", "L1", fLabel, `fetch references superseded access_id ${f.access_id}`);
      if (f.endpoint_id && !endpointIds.has(f.endpoint_id)) W("orphaned_record", "L1", fLabel, `fetch references superseded endpoint_id ${f.endpoint_id}`);
      if (f.payload?.path) {
        const { abs, contained } = resolveInside(reg.root, f.payload.path);
        if (contained && !fs.existsSync(abs)) W("fetch_payload_missing", "L2", fLabel, `payload cleaned up: ${f.payload.path}`);
      }
      if (f.sample?.path && latestForSample.get(f.sample.path) === f) {
        const { abs, contained, symlinkEscape } = resolveInside(reg.root, f.sample.path);
        if (!contained) E(symlinkEscape ? "symlink_escape" : "path_escape", "L0", fLabel, f.sample.path);
        else if (!fs.existsSync(abs)) (strict ? E : W)("sample_hash_mismatch", "L2", fLabel, `sample missing: ${f.sample.path}`);
        else if (sha256File(abs) !== f.sample.sha256) (strict ? E : W)("sample_hash_mismatch", "L2", fLabel, `sample bytes disagree with record: ${f.sample.path}`);
      }
      for (const sf of scanForSecrets(f, fLabel)) {
        E("credential_in_profile", "L1", fLabel, `possible secret at ${sf.path} (${sf.kind})`);
      }
    }

    // profile secrets (1.7)
    for (const f of scanForSecrets(o, label)) {
      E("credential_in_profile", "L1", label, `possible secret at ${f.path} (${f.kind})`);
    }

    // 2.3 guidance, 2.4 lifecycle
    const g = o.guidance;
    if (!g || !Array.isArray(g.best_for) || g.best_for.length === 0 ||
        !((g.query_shapes || []).length || (g.pitfalls || []).length)) {
      E("guidance_missing", "L2", label, "guidance needs best_for plus a query shape or pitfall");
    }
    if (!o.lifecycle?.status || !o.lifecycle?.update_cadence) {
      E("lifecycle_missing", "L2", label, "lifecycle.status + update_cadence required");
    }
  }

  // --- registry-wide 1.7: credentials hygiene ---
  {
    const exRel = registry.sections?.credentials_example || "credentials.example.json";
    const exAbs = path.join(reg.root, exRel);
    if (fs.existsSync(exAbs)) {
      try {
        const ex = readJSON(exAbs);
        for (const [ref, entry] of Object.entries(ex.credentials || {})) {
          if (!CRED_REF_PATTERN.test(ref)) E("credential_ref_invalid", "L1", exRel, `ref "${ref}" malformed`);
          const v = entry && entry.value;
          if (typeof v === "string" && v.length >= 16 && !/\*\*\*|your|placeholder|example|changeme|replace|<|xxx/i.test(v)) {
            E("credential_in_profile", "L1", exRel, `credentials.example.json value for "${ref}" looks like a real secret`);
          }
        }
      } catch (e) {
        E("schema_invalid", "L0", exRel, "unparseable: " + e.message);
      }
    }
    const untracked = checkUntracked(reg.root, "credentials.json");
    if (!untracked.ok) E("credential_file_unignored", "L1", "credentials.json", untracked.detail, "add credentials.json to .gitignore and git rm --cached it");
  }

  // --- counts vs manifest (advisory) ---
  const counts = { sources: sources.length, access_methods: accessCount, endpoints: endpointCount, probes: probeCount, fetches: fetchCount };
  if (registry.counts) {
    for (const [k, v] of Object.entries(counts)) {
      if (registry.counts[k] !== undefined && registry.counts[k] !== v) {
        W("counts_mismatch", "L0", "registry.json", `counts.${k}=${registry.counts[k]} but found ${v}`, "run: authority regen " + regName);
        break;
      }
    }
  }

  // --- csv staleness (advisory) ---
  {
    const csvRel = registry.sections?.sources_csv || "sources.csv";
    const csvAbs = path.join(reg.root, csvRel);
    if (fs.existsSync(csvAbs)) {
      const expected = renderSourcesCsv(reg, now);
      if (fs.readFileSync(csvAbs, "utf8") !== expected) {
        W("csv_stale", "L0", csvRel, "sources.csv disagrees with profiles", "run: authority regen " + regName);
      }
    }
  }

  // --- operational_here (spec/08.4) ---
  let operationalHere = true;
  const credReport = {};
  for (const ref of [...credRefs].sort()) {
    const r = resolveCredential(ref, reg.root);
    credReport[ref] = r.via;
    if (r.value == null) operationalHere = false;
  }

  // --- level computation: highest level whose rules all pass (from the full
  //     finding set, before target demotion) ---
  const errAt = (lvl) => errors.some((e) => e.level === lvl);
  let level = "none";
  if (!errAt("L0")) level = "L0";
  if (level === "L0" && !errAt("L1")) level = "L1";
  if (level === "L1" && !errAt("L2")) level = "L2";

  // --- target demotion (spec/08.2): rules above the target level are
  //     reported as warnings so exit reflects the level being asked for.
  //     L1 is the default bar — the promise level.
  const heldErrors = [], demoted = [];
  for (const e of errors) {
    if (LEVEL_RANK[e.level] !== undefined && LEVEL_RANK[e.level] > LEVEL_RANK[target]) demoted.push(e);
    else heldErrors.push(e);
  }
  const allWarnings = warnings.concat(demoted.map((e) => ({ ...e, above_target: true })));

  const report = {
    status: heldErrors.length ? "error" : allWarnings.length ? "warning" : "ok",
    registry: registry.registry_id || regName,
    asr_spec_version: registry.asr_spec_version || null,
    level,
    target,
    operational_here: operationalHere,
    credentials: credReport,
    counts,
    errors: heldErrors,
    warnings: allWarnings,
  };
  printResult(toolResult({
    status: report.status,
    data: report,
    errors: heldErrors.map((e) => ({ code: e.code, message: `${e.object}: ${e.detail}` })),
    warnings: allWarnings.map((w) => `${w.code} ${w.object}: ${w.detail}`),
  }));
  process.exit(heldErrors.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
// sources.csv projection (spec/09.1) — used by validate (staleness) and regen
// ---------------------------------------------------------------------------

function renderSourcesCsv(reg, now = new Date()) {
  const header = [
    "source_id", "slug", "name", "publisher", "role", "class", "officiality",
    "tier_asserted", "tier_adjudicated", "topics", "jurisdiction", "cadence",
    "lifecycle", "routing_citation", "completeness", "access_types", "verification_state", "last_verified_at", "homepage_url",
  ];
  const rows = [header];
  const sorted = [...reg.sources].filter((s) => s.obj).sort((a, b) => (a.dirRel < b.dirRel ? -1 : 1));
  for (const s of sorted) {
    const o = s.obj;
    const states = (o.access || []).map((a) => deriveState(a, s.probes, reg.registry, now));
    const lastVerified = (o.access || [])
      .map((a) => a.verification?.last_verified_at)
      .filter(Boolean)
      .sort()
      .pop() || "";
    const jur = o.scope?.jurisdiction
      ? [o.scope.jurisdiction.level, (o.scope.jurisdiction.regions || []).join(";")].filter(Boolean).join(" ")
      : "";
    rows.push([
      o.source_id,
      path.basename(s.dirRel),
      o.identity?.name || "",
      o.identity?.publisher || "",
      o.source_role || "",
      o.source_class || "",
      o.officiality?.default || "",
      o.authority?.asserted?.tier ?? "",
      o.authority?.adjudicated?.tier ?? "",
      (o.scope?.topics || []).join(";"),
      jur,
      o.lifecycle?.update_cadence || "",
      o.lifecycle?.status || "",
      o.guidance?.routing?.citation || "",
      o.coverage?.completeness?.claim || "",
      (o.access || []).map((a) => a.type).join(";"),
      rollupState(states),
      lastVerified,
      o.identity?.homepage_url || "",
    ]);
  }
  return writeCsv(rows);
}

// ---------------------------------------------------------------------------
// dispatcher
// ---------------------------------------------------------------------------

const USAGE = `authority.mjs — Authoritative Source Registry reference CLI (ASR ${TOOL_VERSION})

  authority init <dir> --title <t> [--topics a,b,c] [--contact <url|mailto>]
  authority add <registry> <homepage-url> [--name <n>] [--role <r>] [--tier 1|2|3]
                [--topics a,b] [--retrieved-via <q>] [--no-probe]
  authority validate <registry> [--strict]
  authority probe <registry> [<source>] [--access <name>] [--all] [--force]
  authority fetch <registry> <source> <endpoint> [--param k=v ...]
                [--max-pages N] [--keep-sample] [--out <dir>]
  authority creds <set|list|check> [<ref>] [--registry <r>] [--keychain]
  authority regen <registry>
  authority query <registry> [--facet name=value ...] [--topic <id>] [--region <ISO>] [--task <t>] [--json]
  authority export <registry> --format csv|json|markdown|agent-card|pi-canonical-sources|pi-domain-strategies|pi-provider-stub [-o <file>]
  authority import <registry> <adapter> <record-id|--from file.json> [--live] [--out <dir>]
  authority build-index <registry>
  authority mint <asc|acc|end|prb|fch>  < object.json
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  switch (cmd) {
    case "mint": return cmdMint(args);
    case "validate": return cmdValidate(args);
    case "init": return (await import("./authority_cmds.mjs")).cmdInit(args, ctx());
    case "add": return (await import("./authority_cmds.mjs")).cmdAdd(args, ctx());
    case "regen": return (await import("./authority_cmds.mjs")).cmdRegen(args, ctx());
    case "query": return (await import("./authority_cmds.mjs")).cmdQuery(args, ctx());
    case "probe": return (await import("./authority_cmds.mjs")).cmdProbe(args, ctx());
    case "fetch": return (await import("./authority_cmds.mjs")).cmdFetch(args, ctx());
    case "creds": return (await import("./authority_cmds.mjs")).cmdCreds(args, ctx());
    case "export": return (await import("./authority_cmds.mjs")).cmdExport(args, ctx());
    case "import": return (await import("./authority_import.mjs")).cmdImport(args, ctx());
    case "build-index": return (await import("./build-index.mjs")).cmdBuildIndex(args, ctx());
    case "--help":
    case "help":
    case undefined:
      process.stdout.write(USAGE);
      return;
    default:
      fail("unknown command: " + cmd + "\n\n" + USAGE);
  }
}

function ctx() {
  return {
    SCRIPT_DIR, TOOL_NAME, TOOL_VERSION,
    renderSourcesCsv,
  };
}

main().catch((e) => fail(e.stack || String(e)));
