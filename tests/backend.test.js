// node tests/backend.test.js — tests the pure parts of apps-script/Code.gs
const fs = require("fs"), vm = require("vm"), assert = require("assert");
const ctx = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(__dirname + "/../apps-script/Code.gs", "utf8"), ctx);
const { cleanEvent, aggregate, upsertAccount, accountStats } = ctx.module.exports;
const now = d => new Date(d + "T12:00:00Z");
const rows = { events: [], lists: [] };
const post = (d, day) => { const r = cleanEvent(d, now(day)); rows.events.push(r.event); if (r.list) rows.lists.push(r.list); return r; };

assert.throws(() => cleanEvent({ tool: "Bad Tool!", event: "visit" }, new Date()));
assert.throws(() => cleanEvent({ tool: "regine", event: "hack" }, new Date()));
post({ tool: "regine", event: "visit", session: "s1", tz: "Europe/Paris" }, "2026-11-01");
post({ tool: "regine", event: "visit", session: "s1", tz: "Europe/Paris" }, "2026-11-01");
let r = post({ tool: "regine", event: "run", session: "s1", share: true, list_id: "L1", source: "paste",
  genes: ["at1g08090", "AT1G12110", "AT1G12110", "<script>", "AT4G24020"] }, "2026-11-01");
assert.equal(r.list[6], "AT1G08090,AT1G12110,AT4G24020");          // cleaned, dedup, sorted
assert.equal(r.event[8], 3);
r = post({ tool: "regine", event: "run", session: "s1", share: false, list_id: "L2", genes: ["AT1G01010"] }, "2026-11-01");
assert.equal(r.list, null);                                         // not shared -> not stored
post({ tool: "genecloud", event: "run", session: "s2", share: true, list_id: "L1", genes: ["AT1G08090", "AT1G12110", "AT4G24020"] }, "2026-11-02");
post({ tool: "genecloud", event: "run", session: "s2", share: true, list_id: "L3", genes: ["AT1G08090", "AT1G12110", "AT5G67420"] }, "2026-11-02");
post({ tool: "genecloud", event: "run", session: "s2", share: true, list_id: "EX", source: "example:nitrate", genes: ["AT1G08090", "AT1G12110"] }, "2026-11-02");
post({ tool: "nouvel-outil", event: "visit", session: "s9", tz: "Asia/Tokyo", referrer: "gabkrouk.github.io/regine" }, "2026-11-03");

const pub = aggregate(rows.events, rows.lists, {});
assert.deepEqual(pub.tools.map(t => t.tool), ["regine", "genecloud", "nouvel-outil"]);   // new tool discovered, ordered by first use
assert.equal(pub.genes, undefined);                                                       // no gene data without key
const d1 = pub.daily.find(x => x.d === "2026-11-01" && x.tool === "regine");
assert.deepEqual([d1.visits, d1.runs, d1.sessions], [2, 2, 1]);
const G = aggregate(rows.events, rows.lists, { admin: true }).genes;
assert.equal(G.submitted, 4); assert.equal(G.examples, 1); assert.equal(G.distinct, 2);  // L1 run in 2 tools counts once
assert.deepEqual(G.top[0], { gene: "AT1G08090", lists: 2, tools: ["regine", "genecloud"] });
assert.deepEqual(G.pairs[0], { a: "AT1G08090", b: "AT1G12110", lists: 2, jaccard: 1 });

// accounts (Fiole sign-ins): upsert per (tool, email), admin-only stats
const acc = [];
const login = (d, day) => { const r = upsertAccount(acc, d, now(day)); if (r.index < 0) acc.push(r.row); else acc[r.index] = r.row; return r; };
assert.throws(() => upsertAccount(acc, { tool: "fiole", email: "not-an-email" }, new Date()));
assert.throws(() => upsertAccount(acc, { tool: "Bad!", email: "a@b.org" }, new Date()));
login({ tool: "fiole", email: " Ana@Lab.FR " }, "2026-10-01");
login({ tool: "fiole", email: "ana@lab.fr" }, "2026-11-10");
login({ tool: "fiole", email: "bob@lab.fr" }, "2026-11-12");
assert.deepEqual(acc[0], ["ana@lab.fr", "fiole", "2026-10-01T12:00:00.000Z", "2026-11-10T12:00:00.000Z", 2]);
assert.equal(acc.length, 2);
assert.deepEqual(accountStats(acc, now("2026-11-14")), [{ tool: "fiole", accounts: 2, active30: 2, new30: 1, logins: 3 }]);
console.log("backend: all tests passed");
