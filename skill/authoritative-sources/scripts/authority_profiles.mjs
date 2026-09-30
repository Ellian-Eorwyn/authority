// authority_profiles.mjs — research profiles (spec/11): list / show / validate,
// and query --profile across a profile's registries. A research profile is a
// named, ordered selection of registries; it says where to look and nothing
// else. Same zero-dep constraints as the rest of the skill.

import fs from "node:fs";
import path from "node:path";
import {
  readJSON, validateWithSchema, findStandardDirs, mintPrfId,
  loadRegistry, toolResult, printResult,
} from "./authority_common.mjs";
import { nowDate, facetMap, selectSources } from "./authority_cmds.mjs";

function fail(msg, code = 2) {
  process.stderr.write("authority: " + msg + "\n");
  process.exit(code);
}

/** Where named profiles live: --profiles <dir>, else $AUTHORITY_PROFILES_DIR,
 *  else profiles/ beside the standard's schemas/ (spec/11.2). */
export function profilesDir(ctx, flags = {}) {
  if (typeof flags.profiles === "string") return path.resolve(flags.profiles);
  if (process.env.AUTHORITY_PROFILES_DIR) return path.resolve(process.env.AUTHORITY_PROFILES_DIR);
  const { schemaDir } = findStandardDirs(ctx.SCRIPT_DIR);
  return path.join(path.dirname(schemaDir), "profiles");
}

/** A profile reference is a path (contains a separator or ends in .json) or a name. */
export function resolveProfilePath(ref, ctx, flags = {}) {
  if (ref.endsWith(".json") || ref.includes("/") || ref.includes(path.sep)) return path.resolve(ref);
  return path.join(profilesDir(ctx, flags), ref + ".json");
}

/** Topic ids plus all their descendants in a registry's topics.json. */
export function expandTopics(topicsDoc, ids) {
  const children = new Map();
  for (const t of topicsDoc?.topics || []) {
    if (!children.has(t.parent)) children.set(t.parent, []);
    children.get(t.parent).push(t.id);
  }
  const out = new Set();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) || []));
  }
  return out;
}

/** Members a research profile must never carry on a registry entry: they belong
 *  to source profiles, and a profile that restated them could quietly loosen
 *  robots, limits or credentials (spec/11.3). */
const SOURCE_OWNED = ["access", "auth", "credential_ref", "limits", "robots", "endpoints", "routing", "guidance", "authority", "verification"];

function declaredTopics(reg) {
  return new Set((reg.topics?.topics || []).map((t) => t.id));
}

function declaredFacets(reg) {
  const m = new Map();
  for (const f of reg.facets?.facets || []) m.set(f.id, new Set((f.values || []).map((v) => v.id)));
  return m;
}

/**
 * Load and check one profile (spec/11.4). Returns
 * {abs, profile, errors: [{code, object, detail}], entries: [{entry, root, reg}]}.
 * A registry that cannot be loaded leaves reg = null and an error.
 */
export function checkProfile(abs, ctx) {
  const errors = [];
  const E = (code, object, detail) => errors.push({ code, object, detail });
  let profile;
  try { profile = readJSON(abs); }
  catch (e) { return { abs, profile: null, errors: [{ code: "profile_invalid", object: abs, detail: e.message }], entries: [] }; }

  const { schemaDir } = findStandardDirs(ctx.SCRIPT_DIR);
  for (const msg of validateWithSchema(schemaDir, "profile.schema.json", profile, "profile")) E("profile_schema", path.basename(abs), msg);

  const base = path.basename(abs, ".json");
  if (profile.name !== base) E("profile_name_mismatch", path.basename(abs), `name "${profile.name}" but file is ${base}.json`);
  if (typeof profile.name === "string" && profile.profile_id !== mintPrfId(profile.name)) {
    E("id_mismatch", path.basename(abs), `profile_id ${profile.profile_id} should be ${mintPrfId(profile.name)}`);
  }

  const entries = [];
  const seen = new Set();
  for (const [i, entry] of (Array.isArray(profile.registries) ? profile.registries : []).entries()) {
    const at = `registries[${i}]`;
    if (!entry || typeof entry.path !== "string") continue; // schema already reported
    for (const k of SOURCE_OWNED) if (k in entry) E("profile_overrides_source", at, `"${k}" belongs to source profiles, not a research profile`);
    if (path.isAbsolute(entry.path)) { E("profile_path_absolute", at, entry.path); entries.push({ entry, root: null, reg: null }); continue; }
    const root = path.resolve(path.dirname(abs), entry.path);
    if (seen.has(root)) E("profile_registry_duplicate", at, entry.path);
    seen.add(root);
    let reg = null;
    if (!fs.existsSync(path.join(root, "registry.json"))) {
      E("profile_registry_missing", at, `no registry.json at ${entry.path}`);
    } else {
      try { reg = loadRegistry(root); }
      catch (e) { E("profile_registry_missing", at, e.message); }
    }
    if (reg) {
      if (reg.registry.registry_id !== entry.registry_id) {
        E("profile_registry_mismatch", at, `${entry.path} is ${reg.registry.registry_id}, profile says ${entry.registry_id}`);
      }
      const topics = declaredTopics(reg);
      for (const t of entry.topics || []) if (!topics.has(t)) E("unknown_topic", at, `topic "${t}" is not declared in ${entry.path}/topics.json`);
      const facets = declaredFacets(reg);
      for (const [axis, values] of Object.entries(entry.facets || {})) {
        if (!facets.has(axis)) { E("unknown_facet_value", at, `facet "${axis}" is not declared in ${entry.path}/facets.json`); continue; }
        for (const v of values) if (!facets.get(axis).has(v)) E("unknown_facet_value", at, `${axis}=${v} is not declared in ${entry.path}/facets.json`);
      }
    }
    entries.push({ entry, root, reg });
  }
  return { abs, profile, errors, entries };
}

function summary(checked) {
  const p = checked.profile || {};
  return {
    profile_id: p.profile_id || null,
    name: p.name || path.basename(checked.abs, ".json"),
    title: p.title || null,
    path: checked.abs,
    valid: checked.errors.length === 0,
    registries: checked.entries.map(({ entry, reg }) => ({
      path: entry.path,
      registry_id: entry.registry_id,
      title: reg?.registry?.title || null,
      sources: reg ? reg.sources.filter((s) => s.obj).length : null,
      use: entry.use || "",
      topics: entry.topics || [],
      facets: entry.facets || {},
    })),
  };
}

export function cmdProfile(args, ctx) {
  const [sub, ref] = args.pos;
  const usage = "usage: authority profile list [--profiles <dir>]\n       authority profile show|validate <name|path> [--profiles <dir>]";
  if (sub === "list") {
    const dir = profilesDir(ctx, args.flags);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort() : [];
    const profiles = files.map((f) => {
      const c = checkProfile(path.join(dir, f), ctx);
      const s = summary(c);
      return { name: s.name, title: s.title, valid: s.valid, registries: s.registries.map((r) => r.path) };
    });
    printResult(toolResult({ status: "ok", data: { profiles_dir: dir, count: profiles.length, profiles } }));
    return;
  }
  if ((sub === "show" || sub === "validate") && ref) {
    const abs = resolveProfilePath(ref, ctx, args.flags);
    if (!fs.existsSync(abs)) fail(`no research profile at ${abs}`);
    const c = checkProfile(abs, ctx);
    const ok = c.errors.length === 0;
    if (sub === "show") {
      printResult(toolResult({ status: ok ? "ok" : "error", data: { ...summary(c), description: c.profile?.description || "", contact: c.profile?.contact ?? null }, errors: c.errors }));
    } else {
      printResult(toolResult({ status: ok ? "ok" : "error", data: { name: summary(c).name, valid: ok, error_count: c.errors.length }, errors: c.errors }));
    }
    if (!ok) process.exitCode = 1;
    return;
  }
  fail(usage);
}

/**
 * query --profile (spec/11.5). Each registry in the profile is queried with
 * its own defaults; a caller's --facet replaces the default on that axis and a
 * caller's --topic replaces the profile's topic narrowing. Facets and topics
 * are registry-local, so a registry that does not declare a requested facet
 * axis or topic cannot answer that filter: it is skipped and says why, never
 * silently widened. Results stay grouped in the profile's priority order.
 */
export function cmdProfileQuery(args, ctx) {
  const abs = resolveProfilePath(args.flags.profile, ctx, args.flags);
  if (!fs.existsSync(abs)) fail(`no research profile at ${abs}`);
  const c = checkProfile(abs, ctx);
  if (c.errors.length) {
    printResult(toolResult({ status: "error", data: { profile: summary(c).name }, errors: c.errors }));
    process.exitCode = 1;
    return;
  }
  const now = nowDate();
  const cli = facetMap(args.facets);
  const topic = typeof args.flags.topic === "string" ? args.flags.topic : null;
  const region = typeof args.flags.region === "string" ? args.flags.region : null;
  const task = typeof args.flags.task === "string" ? args.flags.task : null;

  const groups = [];
  let count = 0;
  for (const { entry, reg } of c.entries) {
    const group = {
      registry_id: reg.registry.registry_id,
      title: reg.registry.title || "",
      path: entry.path,
      use: entry.use || "",
      applied: { facets: {}, topics: null },
      skipped: null,
      results: [],
    };
    const facets = declaredFacets(reg);
    const missing = [...cli.keys()].filter((axis) => !facets.has(axis));
    const topics = declaredTopics(reg);
    if (missing.length) group.skipped = `does not declare facet ${missing.join(", ")}`;
    else if (topic && !topics.has(topic)) group.skipped = `does not declare topic ${topic}`;
    if (!group.skipped) {
      const wanted = facetMap(Object.entries(entry.facets || {}).flatMap(([k, vs]) => vs.map((v) => [k, v])));
      for (const [axis, values] of cli) wanted.set(axis, values);
      const topicSet = topic ? expandTopics(reg.topics, [topic])
        : (entry.topics?.length ? expandTopics(reg.topics, entry.topics) : null);
      group.applied = {
        facets: Object.fromEntries([...wanted].map(([k, v]) => [k, [...v]])),
        topics: topicSet ? [...topicSet].sort() : null,
      };
      group.results = selectSources(reg, { wanted, topics: topicSet, region, task }, now);
      count += group.results.length;
    }
    groups.push(group);
  }

  printResult(toolResult({
    status: "ok",
    data: {
      profile: c.profile.name,
      profile_id: c.profile.profile_id,
      query: { facets: Object.fromEntries([...cli].map(([k, v]) => [k, [...v]])), topic, region, task },
      count,
      groups,
    },
  }));
}
