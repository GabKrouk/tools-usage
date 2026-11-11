// tools-usage — shared usage tracker for the tools of https://gabkrouk.github.io (Régine, GeneCloud, and any new tool).
//
//   import { usage } from "https://gabkrouk.github.io/tools-usage/usage.js";
//   const u = usage("regine", { version: "2026.2" });          // counts one page view
//   u.consent(document.querySelector("#share-slot"));           // optional: the "share my list" tick box
//   u.run({ genes, source: "paste", params: { kernel: "auto" } });   // counts one analysis (+ the list if shared)
//
// A new tool only needs these three lines: it appears on the dashboard by itself.
// No cookie, no IP, no persistent identifier: a random id lives in sessionStorage (one tab = one session).
// Lists are sent only when the box is ticked. Nothing is sent from localhost / file:// pages.

export const ENDPOINT = "https://script.google.com/macros/s/REPLACE_WITH_DEPLOYMENT_ID/exec";
export const SHARE_DEFAULT = true;            // initial state of the "share my list" box (the visitor's choice is remembered)
const SHARE_KEY = "tools-usage-share";

const offline = () => !/^https?:$/.test(location.protocol) || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname)
  || ENDPOINT.includes("REPLACE_WITH");

function session() {
  try {
    let s = sessionStorage.getItem("tools-usage-session");
    if (!s) { s = Math.random().toString(36).slice(2, 12); sessionStorage.setItem("tools-usage-session", s); }
    return s;
  } catch { return ""; }
}

function referrer() {
  try {
    if (!document.referrer) return "";
    const r = new URL(document.referrer);
    if (r.host === location.host) {                 // from another tool of the same site: keep the tool's folder
      const tool = r.pathname.split("/").filter(Boolean)[0];
      return tool ? location.host + "/" + tool : r.host;
    }
    return r.host;
  } catch { return ""; }
}

export function sharing() {
  try { const v = localStorage.getItem(SHARE_KEY); return v === null ? SHARE_DEFAULT : v === "1"; } catch { return SHARE_DEFAULT; }
}
export function setSharing(on) { try { localStorage.setItem(SHARE_KEY, on ? "1" : "0"); } catch {} }

async function listId(genes) {
  const txt = [...new Set(genes.map(g => String(g).trim().toUpperCase()))].sort().join(",");
  try {
    const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt)));
    return [...h.slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("");
  } catch { return ""; }
}

function send(payload) {
  if (offline()) { console.debug("[tools-usage] not sent (offline/dev):", payload); return; }
  const body = JSON.stringify(payload);
  try {
    // text/plain avoids a CORS preflight; Apps Script reads e.postData.contents
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }))) return;
  } catch {}
  fetch(ENDPOINT, { method: "POST", mode: "no-cors", body, keepalive: true, headers: { "Content-Type": "text/plain" } }).catch(() => {});
}

export function usage(tool, { version = "", visit = true } = {}) {
  const base = () => ({ tool, version, session: session(), lang: navigator.language || "",
    tz: (Intl.DateTimeFormat().resolvedOptions().timeZone || ""), referrer: referrer() });
  if (visit) send({ ...base(), event: "visit" });
  return {
    // genes: array of identifiers; source: "paste" | "example:<name>" | "from:<tool>" | …; name: optional label
    async run({ genes = [], source = "", name = "", params = {} } = {}) {
      const share = sharing() && genes.length > 0;
      send({ ...base(), event: "run", genes: share ? genes : [], list_id: genes.length ? await listId(genes) : "",
        n_genes: genes.length, share, source, name, params });
    },
    // inserts the opt-out box into `el` (a <div> near the Run button)
    consent(el, { label = "Share my gene list anonymously for usage statistics", more = "" } = {}) {
      if (!el) return;
      const id = "tu-share-" + tool;
      el.innerHTML = `<label for="${id}" style="display:inline-flex;gap:.4em;align-items:center;font-size:.85em;opacity:.8;cursor:pointer">
        <input type="checkbox" id="${id}"${sharing() ? " checked" : ""}> ${label}${more ? ` <a href="${more}" target="_blank" rel="noopener">(?)</a>` : ""}</label>`;
      el.querySelector("input").addEventListener("change", e => setSharing(e.target.checked));
    },
  };
}
