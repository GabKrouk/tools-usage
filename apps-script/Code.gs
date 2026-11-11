/**
 * tools-usage — backend (Google Apps Script, attached to a Google Sheet).
 *
 * Receives the events sent by usage.js from every tool of https://gabkrouk.github.io
 * (Régine, GeneCloud and any future tool: the tool name is just a field) and stores them in two sheets:
 *
 *   events : one row per page view ("visit") or analysis ("run")
 *   lists  : one row per gene list submitted, when the user left "share my list" ticked
 *
 * GET ?action=stats                -> public aggregates (daily views/runs/sessions per tool, time zones, referrers)
 * GET ?action=stats&key=ADMIN_KEY  -> + gene-list statistics (top genes, co-queried pairs, list sizes, recent lists)
 * GET ?action=export&key=ADMIN_KEY -> every stored list (JSON, or TSV with &format=tsv)
 *
 * Setup: see README.md (Extensions > Apps Script, paste this file, run setup(), Deploy > Web app, access "Anyone").
 */

var EVENTS = "events", LISTS = "lists";
var EVENT_COLS = ["ts", "tool", "event", "version", "session", "tz", "lang", "referrer", "n_genes", "list_id"];
var LIST_COLS = ["ts", "tool", "list_id", "n", "source", "name", "genes", "params"];
var MAX_GENES = 20000;                       // larger lists are counted but not stored
var TOOL_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
var GENE_RE = /^[A-Za-z0-9._:-]{2,40}$/;     // AGI (AT1G01010) and other species' identifiers

// ------------------------------------------------------------------------------------------ setup (run once)
function setup() {
  var ss = SpreadsheetApp.getActive();
  [[EVENTS, EVENT_COLS], [LISTS, LIST_COLS]].forEach(function (s) {
    var sh = ss.getSheetByName(s[0]) || ss.insertSheet(s[0]);
    if (sh.getLastRow() === 0) { sh.appendRow(s[1]); sh.setFrozenRows(1); }
  });
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty("ADMIN_KEY")) p.setProperty("ADMIN_KEY", Utilities.getUuid().replace(/-/g, "").slice(0, 20));
  Logger.log("ADMIN_KEY = " + p.getProperty("ADMIN_KEY") + "  (paste it in the dashboard to see the gene-list statistics)");
}

// ------------------------------------------------------------------------------------------ write
function doPost(e) {
  var rows;
  try { rows = cleanEvent(JSON.parse(e.postData.contents), new Date()); }
  catch (err) { return json({ ok: false, error: String(err.message || err) }); }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = SpreadsheetApp.getActive();
    ss.getSheetByName(EVENTS).appendRow(rows.event);
    if (rows.list) ss.getSheetByName(LISTS).appendRow(rows.list);
  } finally { lock.releaseLock(); }
  return json({ ok: true });
}

// validates one payload from usage.js and returns the rows to append (pure: testable outside Apps Script)
function cleanEvent(d, now) {
  if (!d || typeof d !== "object") throw new Error("bad payload");
  var tool = String(d.tool || "").toLowerCase();
  if (!TOOL_RE.test(tool)) throw new Error("bad tool");
  var ev = d.event === "run" ? "run" : d.event === "visit" ? "visit" : null;
  if (!ev) throw new Error("bad event");
  var s = function (v, n) { return String(v == null ? "" : v).replace(/[\t\r\n]/g, " ").slice(0, n); };
  var ts = now.toISOString();
  var genes = [], listId = "";
  if (ev === "run" && Array.isArray(d.genes)) {
    var seen = {};
    d.genes.forEach(function (g) { g = String(g).trim().toUpperCase(); if (GENE_RE.test(g) && !seen[g]) { seen[g] = 1; genes.push(g); } });
    genes.sort();
    listId = s(d.list_id, 16);
  }
  var event = [ts, tool, ev, s(d.version, 20), s(d.session, 16), s(d.tz, 40), s(d.lang, 12), s(d.referrer, 80),
    ev === "run" ? genes.length : "", listId];
  var list = null;
  if (ev === "run" && d.share === true && genes.length >= 1 && genes.length <= MAX_GENES)
    list = [ts, tool, listId, genes.length, s(d.source, 60), s(d.name, 120), genes.join(","), s(JSON.stringify(d.params || {}), 500)];
  return { event: event, list: list };
}

// ------------------------------------------------------------------------------------------ read
function doGet(e) {
  var q = (e && e.parameter) || {};
  var admin = !!q.key && q.key === PropertiesService.getScriptProperties().getProperty("ADMIN_KEY");
  var ss = SpreadsheetApp.getActive();
  var ev = values(ss.getSheetByName(EVENTS)), li = admin ? values(ss.getSheetByName(LISTS)) : [];
  if (q.action === "export") {
    if (!admin) return json({ ok: false, error: "key required" });
    if (q.format === "tsv") return ContentService.createTextOutput([LIST_COLS.join("\t")].concat(li.map(function (r) { return r.join("\t"); })).join("\n"))
      .setMimeType(ContentService.MimeType.TEXT);
    return json({ ok: true, columns: LIST_COLS, rows: li });
  }
  var out = aggregate(ev, li, { admin: admin });
  out.ok = true; out.admin = admin; out.generated = new Date().toISOString();
  return json(out, q.callback);
}

function values(sh) {
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues().map(function (r) {
    return r.map(function (v) { return v instanceof Date ? v.toISOString() : v; });
  });
}

function json(o, callback) {
  var t = JSON.stringify(o);
  if (callback && /^[A-Za-z_$][\w$]*$/.test(callback))
    return ContentService.createTextOutput(callback + "(" + t + ")").setMimeType(ContentService.MimeType.JAVASCRIPT);
  return ContentService.createTextOutput(t).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------------------------------------ statistics (pure)
// events rows follow EVENT_COLS, lists rows follow LIST_COLS. Returns plain JSON.
function aggregate(events, lists, opt) {
  opt = opt || {};
  var daily = {}, tools = {}, tz = {}, ref = {}, sess = {};
  events.forEach(function (r) {
    var ts = String(r[0]), d = ts.slice(0, 10), tool = r[1], ev = r[2];
    if (!d || !tool) return;
    var t = tools[tool] || (tools[tool] = { tool: tool, first: d, last: d, visits: 0, runs: 0 });
    if (d < t.first) t.first = d; if (d > t.last) t.last = d;
    var k = d + "|" + tool, x = daily[k] || (daily[k] = { d: d, tool: tool, visits: 0, runs: 0, sessions: 0 });
    if (ev === "visit") { x.visits++; t.visits++; } else if (ev === "run") { x.runs++; t.runs++; }
    var sk = k + "|" + r[4];
    if (r[4] && !sess[sk]) { sess[sk] = 1; x.sessions++; }
    if (ev === "visit") {
      var z = r[5] || "unknown", rf = r[7] || "direct";
      tz[tool + "|" + z] = (tz[tool + "|" + z] || 0) + 1;
      ref[tool + "|" + rf] = (ref[tool + "|" + rf] || 0) + 1;
    }
  });
  var split = function (o) { return Object.keys(o).map(function (k) { var i = k.indexOf("|"); return { tool: k.slice(0, i), key: k.slice(i + 1), n: o[k] }; }); };
  var out = {
    tools: Object.keys(tools).map(function (k) { return tools[k]; }).sort(function (a, b) { return a.first < b.first ? -1 : a.first > b.first ? 1 : a.tool < b.tool ? -1 : 1; }),
    daily: Object.keys(daily).sort().map(function (k) { return daily[k]; }),
    tz: split(tz), referrers: split(ref),
  };
  if (opt.admin) out.genes = geneStats(lists, opt);
  return out;
}

// gene-list statistics. A list re-run several times counts once (by list_id); example lists are kept apart.
function geneStats(lists, opt) {
  var topN = opt.topN || 100, maxPairGenes = opt.maxPairGenes || 400;
  var byId = {}, examples = 0, sizes = {}, perTool = {};
  lists.forEach(function (r) {
    var tool = r[1], id = r[2] || r[6], src = String(r[4] || "");
    perTool[tool] = (perTool[tool] || 0) + 1;
    if (src.indexOf("example") === 0) { examples++; return; }
    var L = byId[id] || (byId[id] = { id: id, genes: String(r[6]).split(",").filter(String), tools: {}, runs: 0, first: r[0], last: r[0], name: r[5], source: src });
    L.tools[tool] = 1; L.runs++; if (r[0] > L.last) L.last = r[0];
  });
  var ls = Object.keys(byId).map(function (k) { return byId[k]; });
  var gc = {}, gt = {};
  ls.forEach(function (L) {
    var b = L.genes.length <= 5 ? "1-5" : L.genes.length <= 20 ? "6-20" : L.genes.length <= 50 ? "21-50" : L.genes.length <= 200 ? "51-200" : L.genes.length <= 1000 ? "201-1000" : ">1000";
    sizes[b] = (sizes[b] || 0) + 1;
    L.genes.forEach(function (g) { gc[g] = (gc[g] || 0) + 1; (gt[g] || (gt[g] = {})); Object.keys(L.tools).forEach(function (t) { gt[g][t] = 1; }); });
  });
  var ranked = Object.keys(gc).sort(function (a, b) { return gc[b] - gc[a] || (a < b ? -1 : 1); });
  // co-queried pairs among the genes found in >= 2 distinct lists (the most frequent maxPairGenes of them)
  var pool = {}, pc = {};
  ranked.filter(function (g) { return gc[g] >= 2; }).slice(0, maxPairGenes).forEach(function (g) { pool[g] = 1; });
  ls.forEach(function (L) {
    var g = L.genes.filter(function (x) { return pool[x]; });
    for (var i = 0; i < g.length; i++) for (var j = i + 1; j < g.length; j++) { var k = g[i] + "|" + g[j]; pc[k] = (pc[k] || 0) + 1; }
  });
  var pairs = Object.keys(pc).filter(function (k) { return pc[k] >= 2; }).map(function (k) {
    var p = k.split("|"), n = pc[k];
    return { a: p[0], b: p[1], lists: n, jaccard: Math.round(1000 * n / (gc[p[0]] + gc[p[1]] - n)) / 1000 };
  }).sort(function (x, y) { return y.lists - x.lists || y.jaccard - x.jaccard; }).slice(0, topN);
  var recent = ls.slice().sort(function (a, b) { return a.last < b.last ? 1 : -1; }).slice(0, 50).map(function (L) {
    return { id: L.id, last: L.last, n: L.genes.length, runs: L.runs, tools: Object.keys(L.tools), name: L.name, source: L.source, genes: L.genes.slice(0, 30), more: Math.max(0, L.genes.length - 30) };
  });
  return {
    submitted: lists.length, distinct: ls.length, nGenes: ranked.length, examples: examples, perTool: perTool,
    sizes: ["1-5", "6-20", "21-50", "51-200", "201-1000", ">1000"].map(function (b) { return { bin: b, n: sizes[b] || 0 }; }),
    top: ranked.slice(0, topN).map(function (g) { return { gene: g, lists: gc[g], tools: Object.keys(gt[g]) }; }),
    pairs: pairs, recent: recent,
  };
}

if (typeof module !== "undefined") module.exports = { cleanEvent: cleanEvent, aggregate: aggregate, geneStats: geneStats };
