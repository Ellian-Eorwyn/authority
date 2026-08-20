// build-index.mjs — generate the registry's self-contained offline browser
// (spec/09.2). One HTML file, no external requests, read-only. Badges are
// computed with the same derivation the validator uses, so the page cannot
// show a promise the validator would reject.

import path from "node:path";
import {
  loadRegistry, deriveState, rollupState, latestProbeFor, effectiveWindowDays,
  atomicWriteFile, toolResult, printResult,
} from "./authority_common.mjs";

function nowDate() {
  return process.env.AUTHORITY_NOW ? new Date(process.env.AUTHORITY_NOW) : new Date();
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rorUrl = (r) => (String(r).startsWith("http") ? String(r) : "https://ror.org/" + r);

const STATE_META = {
  verified: { label: "verified", cls: "ok" },
  degraded: { label: "degraded", cls: "warn" },
  stale: { label: "stale", cls: "warn" },
  asserted: { label: "asserted — never probed", cls: "muted" },
  broken: { label: "broken", cls: "bad" },
  blocked: { label: "blocked", cls: "bad" },
  retired: { label: "retired", cls: "muted" },
};

function ageDays(iso, now) {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000);
}

function badge(state, lastVerifiedAt, now) {
  const m = STATE_META[state] || STATE_META.asserted;
  let text = m.label;
  if (state === "verified" && lastVerifiedAt) text = `verified ${ageDays(lastVerifiedAt, now)}d ago`;
  if (state === "stale" && lastVerifiedAt) text = `stale (last ok ${ageDays(lastVerifiedAt, now)}d ago)`;
  return `<span class="badge ${m.cls}">${esc(text)}</span>`;
}

export function cmdBuildIndex(args, ctx) {
  const root = args.pos[0];
  if (!root) {
    process.stderr.write("usage: authority build-index <registry>\n");
    process.exit(2);
  }
  const reg = loadRegistry(root);
  const now = nowDate();
  const R = reg.registry;

  // --- assemble view model ---
  const sources = [...reg.sources].filter((s) => s.obj).sort((a, b) => (a.dirRel < b.dirRel ? -1 : 1)).map((s) => {
    const o = s.obj;
    const access = (o.access || []).map((a) => ({
      a,
      state: deriveState(a, s.probes, reg.registry, now),
      probes: s.probes.filter((p) => p.access_id === a.access_id).sort((x, y) => (x.probed_at < y.probed_at ? 1 : -1)),
      fetches: s.fetches.filter((f) => f.access_id === a.access_id),
    }));
    return { s, o, access, roll: rollupState(access.map((x) => x.state)) };
  });

  const stateCounts = {};
  for (const v of sources) stateCounts[v.roll] = (stateCounts[v.roll] || 0) + 1;

  const credRows = {};
  for (const v of sources) {
    for (const x of v.access) {
      const ref = x.a.auth?.credential_ref;
      if (ref) (credRows[ref] ||= []).push(`${path.basename(v.s.dirRel)}#${x.a.name}`);
    }
  }

  const topicSet = new Set(), typeSet = new Set();
  for (const v of sources) {
    for (const t of v.o.scope?.topics || []) topicSet.add(t);
    for (const x of v.access) typeSet.add(x.a.type);
  }

  // --- render ---
  const rows = sources.map((v) => {
    const o = v.o;
    const slug = path.basename(v.s.dirRel);
    const tierAdj = o.authority?.adjudicated?.tier;
    const tierAss = o.authority?.asserted?.tier;
    const lastVerified = v.access.map((x) => x.a.verification?.last_verified_at).filter(Boolean).sort().pop();
    return `<tr data-topics="${esc((o.scope?.topics || []).join(" "))}" data-state="${esc(v.roll)}" data-tier="${esc(String(tierAdj ?? tierAss ?? ""))}" data-types="${esc(v.access.map((x) => x.a.type).join(" "))}" data-text="${esc((o.identity.name + " " + (o.identity.publisher || "") + " " + slug).toLowerCase())}">
      <td><a href="#src=${esc(o.source_id)}">${esc(o.identity.name)}</a><div class="sub">${esc(o.identity.publisher || "")}</div></td>
      <td><span class="chip">${esc(o.source_role)}</span>${o.officiality?.default ? `<div class="sub">${esc(o.officiality.default)}</div>` : ""}</td>
      <td>${tierAdj != null ? `<span class="chip tier adj" title="adjudicated by ${esc(o.authority.adjudicated.scored_by || "?")}">T${esc(String(tierAdj))}</span>` : `<span class="chip tier ass" title="asserted (triage) — not yet human-adjudicated">T${esc(String(tierAss ?? "?"))}?</span>`}</td>
      <td>${(o.scope?.topics || []).map((t) => `<span class="chip">${esc(t)}</span>`).join(" ")}</td>
      <td class="sub">${esc(o.scope?.jurisdiction?.level || "")}${(o.scope?.jurisdiction?.regions || []).length ? " · " + esc(o.scope.jurisdiction.regions.join(", ")) : ""}</td>
      <td class="sub">${esc(o.lifecycle?.update_cadence || "")}</td>
      <td>${v.access.map((x) => `<span class="chip">${esc(x.a.type)}</span>`).join(" ")}</td>
      <td>${badge(v.roll, lastVerified, now)}</td>
    </tr>`;
  }).join("\n");

  const details = sources.map((v) => {
    const o = v.o;
    const slug = path.basename(v.s.dirRel);
    const g = o.guidance || {};
    const routeKeys = Object.keys(g.routing || {});
    const routingHtml = routeKeys.length
      ? `<p class="routing"><strong>Routing:</strong> ${routeKeys.map((k) => `<span class="chip">${esc(k)}: ${esc(g.routing[k])}</span>`).join(" ")}${g.resolution?.strategy ? ` <span class="sub">→ resolve via ${esc(g.resolution.strategy)}${g.resolution.notes ? " (" + esc(g.resolution.notes) + ")" : ""}</span>` : ""}</p>`
      : "";
    const guidance = `
      ${(g.best_for || []).length ? `<p class="bestfor"><strong>Best for:</strong> ${g.best_for.map(esc).join(" · ")}</p>` : `<p class="bestfor muted">No guidance yet.</p>`}
      ${routingHtml}
      ${(g.query_shapes || []).map((q) => `<div class="shape"><strong>${esc(q.task)}</strong>${q.endpoint ? ` <code>${esc(q.endpoint)}</code>` : ""}<br>${esc(q.recipe)}${q.example ? `<br><code>${esc(q.example)}</code>` : ""}</div>`).join("")}
      ${(g.pitfalls || []).map((p) => `<div class="pitfall">⚠ ${esc(p)}</div>`).join("")}
      ${g.llm_notes ? `<p class="sub">${esc(g.llm_notes)}</p>` : ""}`;

    const accessHtml = v.access.map(({ a, state, probes, fetches }) => {
      const eps = (a.endpoints || []).map((e) => `
        <div class="endpoint">
          <code>${esc(e.http_method)} ${esc(e.path_template)}</code> <span class="sub">${esc(e.name)}</span>
          ${e.description ? `<div class="sub">${esc(e.description)}</div>` : ""}
          ${(e.params || []).length ? `<div class="sub">params: ${e.params.map((p) => `<code>${esc(p.name)}</code>${p.required ? "*" : ""}`).join(", ")}</div>` : ""}
          ${e.example_request ? `<div class="example"><code>${esc(e.example_request)}</code></div>` : ""}
          ${e.pagination && e.pagination.style !== "none" ? `<div class="sub">pagination: ${esc(e.pagination.style)}</div>` : ""}
        </div>`).join("");
      const probeRows = probes.slice(0, 8).map((p) => `<tr><td>${esc(p.probed_at)}</td><td><span class="badge ${esc((STATE_META[{ ok: "verified" }[p.outcome]] || {}).cls || (p.outcome === "ok" ? "ok" : ["degraded"].includes(p.outcome) ? "warn" : "bad"))}">${esc(p.outcome)}</span></td><td class="sub">${esc((p.checks || []).map((c) => `${c.check}:${c.result}`).join(" "))}</td><td class="sub">${esc(p.response?.http_status ?? "")}</td></tr>`).join("");
      return `
      <div class="access">
        <h4><code>${esc(a.name)}</code> <span class="chip">${esc(a.type)}</span> ${badge(state, a.verification?.last_verified_at, now)}${a.type === "web_render" && state === "verified" ? ' <span class="chip" title="reachability verified; JS rendering delegated to the harness (spec/03.6)">transport-only</span>' : ""}</h4>
        <div class="sub">${esc(a.base_url)}${a.docs_url ? ` · <a href="${esc(a.docs_url)}">docs</a>` : ""}</div>
        ${a.auth?.required ? `<div class="sub">auth: ${esc(a.auth.scheme)} · ref <code>${esc(a.auth.credential_ref || "?")}</code>${a.auth.signup_url ? ` · <a href="${esc(a.auth.signup_url)}">get a key</a>` : ""}</div>` : ""}
        ${a.robots?.applies ? `<div class="sub">robots: ${esc(a.robots.posture || "unrecorded")}</div>` : ""}
        ${a.limits && (a.limits.requests_per_second != null || a.limits.daily_budget != null) ? `<div class="sub">limits: ${a.limits.requests_per_second != null ? esc(a.limits.requests_per_second) + " rps " : ""}${a.limits.daily_budget != null ? "· " + esc(a.limits.daily_budget) + "/day" : ""}</div>` : ""}
        ${eps}
        ${probes.length ? `<details><summary>probe history (${probes.length})</summary><table class="mini"><tr><th>at</th><th>outcome</th><th>checks</th><th>http</th></tr>${probeRows}</table></details>` : `<div class="sub muted">never probed</div>`}
        ${fetches.length ? `<div class="sub">fetches: ${fetches.length} (${fetches.filter((f) => f.retrieval?.fetch_status === "success").length} ok)</div>` : ""}
      </div>`;
    }).join("");

    const rel = (o.relations || []).map((r) => `<span class="chip">${esc(r.type)} → ${esc(r.target?.source_id || r.target?.name || "?")}</span>`).join(" ");
    const cov = o.coverage;
    const c = cov?.completeness;
    const coverageHtml = cov ? `<p class="sub">${c ? `completeness: <strong>${esc(c.claim || "?")}</strong>${c.basis ? ` (${esc(c.basis)})` : ""}${c.notes ? " — " + esc(c.notes) : ""}` : ""}${(cov.jurisdictions || []).length ? `${c ? "<br>" : ""}jurisdictions: ${cov.jurisdictions.map(esc).join(", ")}${(cov.jurisdiction_levels || []).length ? " (" + cov.jurisdiction_levels.map(esc).join(", ") + ")" : ""}` : ""}${cov.temporal && (cov.temporal.coverage_start || cov.temporal.coverage_end) ? `<br>temporal: ${esc(cov.temporal.coverage_start || "?")} → ${esc(cov.temporal.coverage_end || "?")}` : ""}${(cov.policy_states || []).length ? `<br>policy states: ${cov.policy_states.map(esc).join(", ")}` : ""}${(cov.sectors || []).length ? `<br>sectors: ${cov.sectors.map(esc).join(", ")}` : ""}</p>` : "";
    const jur = o.scope?.jurisdiction;
    const jurHtml = jur && (jur.level || (jur.regions || []).length) ? `<p class="sub">${esc(jur.level || "")}${(jur.regions || []).length ? " · " + esc(jur.regions.join(", ")) : ""}${jur.notes ? " — " + esc(jur.notes) : ""}</p>` : "";
    const fr = o.freshness;
    const freshnessHtml = fr ? `<p class="sub">${fr.content_current_through ? `content current through <strong>${esc(fr.content_current_through)}</strong>${fr.content_freshness_basis ? ` (${esc(fr.content_freshness_basis)})` : ""}` : ""}${fr.content_last_checked_at ? `<br>content last checked: ${esc(String(fr.content_last_checked_at).slice(0, 10))}` : ""}${fr.profile_reviewed_at ? `<br>profile reviewed: ${esc(String(fr.profile_reviewed_at).slice(0, 10))}${fr.profile_reviewed_by ? " by " + esc(fr.profile_reviewed_by) : ""}${fr.review_interval_days ? " (every " + esc(fr.review_interval_days) + "d)" : ""}` : ""}</p>` : "";
    const ups = o.discovery?.upstream || [];
    const upstreamHtml = ups.length ? ups.map((u) => `<div class="sub">imported from <strong>${esc(u.registry)}</strong> <code>${esc(u.record_id)}</code>${u.record_url ? ` <a href="${esc(u.record_url)}">↗</a>` : ""}${u.retrieved_at ? ` · retrieved ${esc(String(u.retrieved_at).slice(0, 10))}` : ""}${u.mapping_version ? ` · ${esc(u.mapping_version)}` : ""}${(u.inherited_fields || []).length ? `<br>inherited: ${u.inherited_fields.map(esc).join(", ")}` : ""}</div>`).join("") : "";
    const op = o.identity.operator;
    return `
    <section class="detail" id="src=${esc(o.source_id)}" hidden>
      <p><a href="#" class="back">← all sources</a></p>
      <h2>${esc(o.identity.name)} <span class="chip">${esc(o.source_role)}</span> <span class="chip">${esc(o.source_class)}</span>${o.officiality?.default ? ` <span class="chip" title="officiality — institutional status, not authority">${esc(o.officiality.default)}</span>` : ""} ${badge(v.roll, null, now)}</h2>
      <div class="sub">${esc(o.identity.publisher || op?.name || "")}${op?.identifiers?.ror ? ` · <a href="${esc(rorUrl(op.identifiers.ror))}">ROR</a>` : ""} · <a href="${esc(o.identity.homepage_url)}">${esc(o.identity.homepage_url)}</a> · <code>${esc(o.source_id)}</code> · <code>sources/${esc(slug)}/</code></div>
      ${o.identity.description ? `<p>${esc(o.identity.description)}</p>` : ""}
      <h3>Guidance</h3>
      ${guidance}
      <h3>Authority</h3>
      <p class="sub">asserted: tier ${esc(String(o.authority?.asserted?.tier))} (${(o.authority?.asserted?.basis || []).map(esc).join(", ") || "no basis recorded"}) by ${esc(o.authority?.asserted?.asserted_by || "?")} — ${esc(o.authority?.asserted?.rationale || "")}<br>
      adjudicated: ${o.authority?.adjudicated?.tier != null || o.authority?.adjudicated?.score != null ? `tier ${esc(String(o.authority.adjudicated.tier ?? "—"))}${o.authority.adjudicated.score != null ? `, score ${esc(String(o.authority.adjudicated.score))}` : ""} by ${esc(o.authority.adjudicated.scored_by || "?")} at ${esc(o.authority.adjudicated.scored_at || "?")}` : "<em>pending human scoring pass</em>"}</p>
      ${cov ? `<h3>Coverage</h3>${coverageHtml}` : ""}
      ${jurHtml ? `<h3>Jurisdiction</h3>${jurHtml}` : ""}
      <h3>Content</h3>
      <p class="sub">${(o.content?.artifacts || []).map((a) => `${esc(a.kind)}${(a.formats || []).length ? " (" + a.formats.map(esc).join(", ") + ")" : ""}${a.officiality ? " [" + esc(a.officiality) + "]" : ""}`).join(" · ") || "—"} · landing: ${esc(o.content?.landing_pattern || "—")} · cadence: ${esc(o.lifecycle?.update_cadence || "?")} (${esc(o.lifecycle?.status || "?")})${o.lifecycle?.cadence_notes ? " — " + esc(o.lifecycle.cadence_notes) : ""}</p>
      <h3>Access</h3>
      ${accessHtml}
      ${fr ? `<h3>Freshness</h3>${freshnessHtml}` : ""}
      ${upstreamHtml ? `<h3>Upstream provenance</h3>${upstreamHtml}` : ""}
      ${rel ? `<h3>Relations</h3><p>${rel}</p>` : ""}
      <h3>Discovery</h3>
      <p class="sub">${esc(o.discovery?.discovered_via || "?")}${o.discovery?.retrieved_via ? ` — <code>${esc(o.discovery.retrieved_via)}</code>` : ""}${o.discovery?.import_ref ? ` · import ${esc(o.discovery.import_ref)}` : ""} · added ${esc((o.discovery?.first_added || "").slice(0, 10))}</p>
    </section>`;
  }).join("\n");

  const credHtml = Object.keys(credRows).sort().map((ref) =>
    `<tr><td><code>${esc(ref)}</code></td><td class="sub">${credRows[ref].map(esc).join(", ")}</td><td class="sub">env <code>AUTHORITY_CRED_${esc(ref.toUpperCase().replace(/[^A-Z0-9]+/g, "_"))}</code> / <code>FORGE_API_KEY_${esc(ref.toUpperCase().replace(/[^A-Z0-9]+/g, "_"))}</code> → credentials.json → keychain</td></tr>`
  ).join("\n");

  const banner = ["verified", "degraded", "stale", "asserted", "broken", "blocked", "retired"]
    .filter((k) => stateCounts[k])
    .map((k) => `<span class="stat ${esc(STATE_META[k].cls)}"><b>${stateCounts[k]}</b> ${esc(k)}</span>`)
    .join(" ");

  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(R.title)} — ASR registry</title>
<style>
  :root { --bg:#ffffff; --fg:#1a1d21; --muted:#6a737d; --line:#e1e4e8; --card:#f6f8fa;
          --ok:#116329; --okbg:#dafbe1; --warn:#7d4e00; --warnbg:#fff8c5; --bad:#a40e26; --badbg:#ffebe9; --chip:#eaeef2; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0d1117; --fg:#e6edf3; --muted:#8b949e; --line:#30363d; --card:#161b22;
            --ok:#3fb950; --okbg:#12261e; --warn:#d29922; --warnbg:#272115; --bad:#f85149; --badbg:#25171c; --chip:#21262d; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px; background:var(--bg); color:var(--fg);
         font:14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:18px; } h3 { font-size:14px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:20px 0 6px; }
  h4 { margin: 0 0 2px; font-size: 14px; }
  a { color:inherit; } .sub { color:var(--muted); font-size:12.5px; } .muted { color:var(--muted); }
  code { background:var(--chip); padding:1px 5px; border-radius:4px; font:12px ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap:anywhere; }
  .chip { display:inline-block; background:var(--chip); border-radius:10px; padding:0 8px; font-size:11.5px; white-space:nowrap; }
  .chip.tier.adj { background:var(--okbg); color:var(--ok); font-weight:600; }
  .chip.tier.ass { background:var(--warnbg); color:var(--warn); }
  .badge { display:inline-block; border-radius:6px; padding:1px 8px; font-size:11.5px; font-weight:600; white-space:nowrap; }
  .badge.ok { background:var(--okbg); color:var(--ok); } .badge.warn { background:var(--warnbg); color:var(--warn); }
  .badge.bad { background:var(--badbg); color:var(--bad); } .badge.muted { background:var(--chip); color:var(--muted); }
  .banner { margin:10px 0 16px; } .stat { margin-right:14px; } .stat.ok b { color:var(--ok); } .stat.warn b { color:var(--warn); } .stat.bad b { color:var(--bad); }
  .filters { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; }
  .filters input, .filters select { background:var(--card); color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:5px 8px; font-size:13px; }
  .tablewrap { overflow-x:auto; }
  table { border-collapse:collapse; width:100%; } th, td { text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-size:11.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  table.mini td, table.mini th { padding:3px 8px; font-size:12px; }
  .access, .shape { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin:8px 0; }
  .endpoint { border-top:1px dashed var(--line); margin-top:8px; padding-top:8px; }
  .example { margin-top:4px; }
  .pitfall { color:var(--warn); margin:4px 0; }
  .bestfor { font-size:15px; }
  footer { margin-top:28px; color:var(--muted); font-size:12px; border-top:1px solid var(--line); padding-top:10px; }
  details summary { cursor:pointer; color:var(--muted); font-size:12.5px; margin-top:6px; }
</style>
<h1>${esc(R.title)}</h1>
<div class="sub">${esc(R.description || "")} — ASR registry <code>${esc(R.registry_id)}</code>, spec ${esc(R.asr_spec_version)}. Generated projection (spec/09.2): the JSON objects are the source of truth.</div>
<div class="banner">${banner || '<span class="muted">empty registry</span>'}</div>

<main id="list">
  <div class="filters">
    <input id="q" type="search" placeholder="filter by name…">
    <select id="ftopic"><option value="">topic: all</option>${[...topicSet].sort().map((t) => `<option>${esc(t)}</option>`).join("")}</select>
    <select id="fstate"><option value="">state: all</option>${Object.keys(STATE_META).map((s) => `<option>${esc(s)}</option>`).join("")}</select>
    <select id="ftier"><option value="">tier: all</option><option>1</option><option>2</option><option>3</option></select>
    <select id="ftype"><option value="">access: all</option>${[...typeSet].sort().map((t) => `<option>${esc(t)}</option>`).join("")}</select>
  </div>
  <div class="tablewrap">
  <table id="tbl">
    <tr><th>Source</th><th>Role</th><th>Tier</th><th>Topics</th><th>Jurisdiction</th><th>Cadence</th><th>Access</th><th>Verification</th></tr>
    ${rows}
  </table>
  </div>

  ${credHtml ? `<h3>Credential coverage</h3><div class="tablewrap"><table><tr><th>ref</th><th>needed by</th><th>resolution chain (spec/05)</th></tr>${credHtml}</table></div>` : ""}
</main>

${details}

<footer>Authoritative Source Registry — every access claim is backed by stored evidence, or it says so. Built by authority build-index; regenerate with <code>authority regen</code>.</footer>
<script>
(function () {
  var q = document.getElementById("q"), ft = document.getElementById("ftopic"),
      fs = document.getElementById("fstate"), fr = document.getElementById("ftier"), fy = document.getElementById("ftype");
  function apply() {
    var text = q.value.toLowerCase(), topic = ft.value, st = fs.value, tier = fr.value, ty = fy.value;
    document.querySelectorAll("#tbl tr[data-text]").forEach(function (tr) {
      var show = (!text || tr.dataset.text.indexOf(text) !== -1)
        && (!topic || tr.dataset.topics.split(" ").indexOf(topic) !== -1)
        && (!st || tr.dataset.state === st)
        && (!tier || tr.dataset.tier === tier)
        && (!ty || tr.dataset.types.split(" ").indexOf(ty) !== -1);
      tr.style.display = show ? "" : "none";
    });
  }
  [q, ft, fs, fr, fy].forEach(function (el) { el.addEventListener("input", apply); });
  function route() {
    var hash = location.hash.replace(/^#/, "");
    var list = document.getElementById("list");
    var showList = !hash || hash.indexOf("src=") !== 0;
    list.hidden = !showList;
    document.querySelectorAll(".detail").forEach(function (d) { d.hidden = true; });
    if (!showList) {
      var el = document.getElementById(hash);
      if (el) el.hidden = false; else list.hidden = false;
    }
  }
  window.addEventListener("hashchange", route);
  document.querySelectorAll(".back").forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); location.hash = ""; }); });
  route();
})();
</script>
`;

  const outRel = R.sections?.index_html || "index.html";
  const outAbs = path.join(reg.root, outRel);
  atomicWriteFile(outAbs, html);
  if (!args.flags?.quiet) {
    printResult(toolResult({ status: "ok", artifacts: [outAbs], data: { sources: sources.length, bytes: Buffer.byteLength(html) } }));
  }
  return outAbs;
}
