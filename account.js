// account.js — one account for the tools of https://gabkrouk.github.io (Régine, GeneCloud) and Fiole:
// users sign in with their Fiole account (https://fiole.onrender.com), and each sign-in is reported by Fiole's server
// to tools-usage with the email and the tool name (the "accounts" sheet).
//
//   const ACCOUNT = import("https://gabkrouk.github.io/tools-usage/account.js")
//     .then(m => m.account("regine", { mount: document.querySelector("#account") })).catch(() => null);
//   // before an analysis (keep the page state in location.hash: it is restored after signing in):
//   const a = await ACCOUNT; if (a && !a.ensure()) return;
//
// How it works: "Sign in" opens fiole.onrender.com/connect?tool=…&return=<this page>; after signing in (or creating an
// account) there, Fiole sends the user back to <this page>#fiole_token=<token>. The token is kept in localStorage, which
// all tools of the site share: signing in on Régine also signs in on GeneCloud. The token only says who the user is
// (GET /api/sso/me); it gives no access to Fiole projects. No password ever reaches the tools.

export const FIOLE = "https://fiole.onrender.com";
const KEY = "krouk-account";              // localStorage: {token, email, name}
const HASH_KEY = "krouk-account-hash";    // sessionStorage: the page's #state, restored after the sign-in round trip
const TOOL_NAMES = { regine: "Régine", genecloud: "GeneCloud" };

const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
const save = v => { try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch {} };
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// back from Fiole: take the token out of the URL and put the page's own #state back (runs once, when imported)
(function comingBack() {
  const m = /^#fiole_token=([A-Za-z0-9_-]{20,})$/.exec(location.hash);
  if (!m) return;
  save({ token: m[1], email: "", name: "" });
  let h = "";
  try { h = sessionStorage.getItem(HASH_KEY) || ""; sessionStorage.removeItem(HASH_KEY); } catch {}
  history.replaceState(null, "", location.pathname + location.search + h);
})();

function style() {
  if (document.getElementById("krouk-account-css")) return;
  const s = document.createElement("style");
  s.id = "krouk-account-css";
  s.textContent = `
.ka-w{display:inline-flex;gap:8px;align-items:center;font:600 12px var(--sans,system-ui,sans-serif);text-transform:none;letter-spacing:0}
.ka-w .ka-who{color:var(--sub,#666);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ka-b{background:none;border:1px solid var(--rule,#ccc);color:var(--fg,inherit);border-radius:6px;font:600 12px var(--sans,system-ui,sans-serif);padding:2px 8px;cursor:pointer}
.ka-b.ka-p{background:var(--brand2,#6d42a8);border-color:var(--brand2,#6d42a8);color:#fff}
.ka-o{position:fixed;inset:0;background:rgba(0,0,0,.45);display:grid;place-items:center;z-index:9999;padding:16px}
.ka-d{background:var(--card,#fff);color:var(--fg,#111);border:1px solid var(--rule,#ccc);border-radius:10px;max-width:420px;width:100%;padding:22px;font:15px/1.45 var(--sans,system-ui,sans-serif);box-shadow:0 10px 40px rgba(0,0,0,.3)}
.ka-d h3{margin:0 0 8px;font-size:18px}.ka-d p{margin:0 0 12px}.ka-d .ka-n{font-size:13px;color:var(--sub,#666)}
.ka-d .ka-r{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}.ka-d .ka-b{font-size:14px;padding:6px 12px}`;
  document.head.appendChild(s);
}

export function account(tool, { mount = null, fiole = FIOLE } = {}) {
  const name = TOOL_NAMES[tool] || tool;
  const listeners = new Set();
  let user = load();

  function signIn() {
    try { sessionStorage.setItem(HASH_KEY, location.hash || ""); } catch {}
    const ret = location.origin + location.pathname + location.search;
    location.href = `${fiole}/connect?tool=${encodeURIComponent(tool)}&return=${encodeURIComponent(ret)}`;
  }
  // Fiole sleeps after 15 min without visits (free hosting): wake it up as soon as a sign-in looks likely
  let woken = false;
  function wake() { if (woken) return; woken = true; fetch(`${fiole}/api/health`, { mode: "no-cors" }).catch(() => {}); }

  function signOut() {
    const t = user?.token;
    user = null; save(null); render();
    if (t) fetch(`${fiole}/api/sso/logout`, { method: "POST", headers: { Authorization: "Bearer " + t } }).catch(() => {});
  }

  function render() {
    listeners.forEach(f => { try { f(api.user()); } catch {} });
    if (!mount) return;
    style();
    if (user) {
      mount.innerHTML = `<span class="ka-w"><span class="ka-who" title="Signed in with your Fiole account">👤 ${esc(user.email || "signed in")}</span><button type="button" class="ka-b">Sign out</button></span>`;
      mount.querySelector("button").onclick = signOut;
    } else {
      mount.innerHTML = `<span class="ka-w"><button type="button" class="ka-b ka-p" title="One free account for Régine, GeneCloud and Fiole">Sign in</button></span>`;
      const b = mount.querySelector("button");
      b.onclick = signIn; b.onmouseenter = wake; b.onfocus = wake;
    }
  }

  function dialog() {
    if (document.querySelector(".ka-o")) return;
    style(); wake();
    const o = document.createElement("div");
    o.className = "ka-o";
    o.innerHTML = `<div class="ka-d" role="dialog" aria-modal="true" aria-labelledby="ka-t">
      <h3 id="ka-t">Sign in to run ${esc(name)}</h3>
      <p>A free account is needed to run an analysis. The same account works for Régine, GeneCloud and Fiole.</p>
      <p class="ka-n">You sign in (or create your account) on Fiole, then come straight back here; your list is kept.
      Your email is used for your account and to count the use of these tools; it is never sold or passed on.
      The first sign-in after a quiet period can take up to a minute while the server wakes up.</p>
      <div class="ka-r"><button type="button" class="ka-b" data-x>Cancel</button><button type="button" class="ka-b ka-p" data-go>Sign in or create an account</button></div></div>`;
    document.body.appendChild(o);
    const close = () => o.remove();
    o.querySelector("[data-x]").onclick = close;
    o.onclick = e => { if (e.target === o) close(); };
    o.querySelector("[data-go]").onclick = signIn;
    o.querySelector("[data-go]").focus();
  }

  const api = {
    user: () => (user ? { email: user.email, name: user.name } : null),
    signedIn: () => !!user,
    signIn, signOut,
    // true when signed in; otherwise asks the user to sign in and returns false
    ensure() { if (user) return true; dialog(); return false; },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };

  // check the token (and get the email) in the background; a stale token signs the user out
  if (user) {
    fetch(`${fiole}/api/sso/me?tool=${encodeURIComponent(tool)}`, { headers: { Authorization: "Bearer " + user.token } })
      .then(r => {
        if (r.status === 401) { user = null; save(null); render(); return null; }
        return r.ok ? r.json() : null;
      })
      .then(u => { if (u && user) { user = { ...user, email: u.email, name: u.display_name }; save(user); render(); } })
      .catch(() => {});              // offline or Fiole asleep: keep the cached sign-in
  }
  render();
  return api;
}
