# tools-usage

Usage statistics for the online tools of <https://gabkrouk.github.io> (Régine, GeneCloud, and any tool added later):
page views, analyses, sessions, time zones, referrers, and the gene lists users choose to share, to study later which
genes are queried together.

* **Dashboard:** <https://gabkrouk.github.io/tools-usage/> (open it with `?demo` to see simulated data)
* **Tracker:** `usage.js`, one shared file imported by every tool
* **Backend:** `apps-script/Code.gs`, a Google Apps Script attached to a Google Sheet (free, no server to run)

```
tool page ──usage.js──POST──▶ Apps Script ──▶ Google Sheet  (events, lists)
dashboard ◀──GET ?action=stats────────┘      (gene statistics only with the admin key)
```

## Setup (once, ~5 min)

1. Create a Google Sheet (e.g. *tools-usage*), then **Extensions → Apps Script**.
2. Replace the content of `Code.gs` with [`apps-script/Code.gs`](apps-script/Code.gs); save.
3. Select the function `setup` and **Run** (authorise the script). It creates the sheets `events` and `lists` and an
   admin key, printed in the execution log (also in *Project settings → Script properties → ADMIN_KEY*).
4. **Deploy → New deployment → Web app**: *Execute as*: Me; *Who has access*: **Anyone**. Copy the URL
   (`https://script.google.com/macros/s/…/exec`).
5. Paste that URL in `ENDPOINT` at the top of [`usage.js`](usage.js), commit, and enable GitHub Pages for this repository
   (*Settings → Pages → Deploy from branch → main / root*).
6. Open the dashboard, paste the admin key in *Clé admin*: the gene-list statistics appear.

When `Code.gs` changes: *Deploy → Manage deployments → edit → New version* (the URL stays the same).

## Adding a new tool

Three lines in the tool's JavaScript; it then appears on the dashboard by itself, with the next colour:

```js
let USAGE = null;
import("https://gabkrouk.github.io/tools-usage/usage.js")             // dynamic: the tool keeps working if this fails
  .then(m => { USAGE = m.usage("mytool", { version: "1" }); USAGE.consent(document.querySelector("#usage-consent")); })
  .catch(() => {});
// after each analysis:
USAGE?.run({ genes, source: "paste", params: { /* the options worth counting */ } });
```

`source` tells real lists from demos: `"paste"`, `"example:<name>"` (excluded from the gene statistics),
`"from:<tool>"` (a list sent by another tool). Tool names: lower case, digits, `-` or `_`.

## What is stored

| sheet | one row per | columns |
|---|---|---|
| `events` | page view or analysis | time, tool, event, version, tab session id, time zone, language, referrer host, list size, list id |
| `lists` | analysis whose user left *share my list* ticked | time, tool, list id, size, source, name, sorted gene identifiers, options |

No IP address, no cookie, no persistent identifier (the session id lives in `sessionStorage`, one browser tab).
The list id is a SHA-256 prefix of the sorted genes: the same list run twice, or in two tools, has the same id.
The *share my list* box is ticked by default (`SHARE_DEFAULT` in `usage.js`); the visitor's choice is remembered for all
tools of the site. Nothing is sent from `localhost` or `file://` pages.

Raw data: the Google Sheet itself, or `ENDPOINT?action=export&format=tsv&key=ADMIN_KEY`.

## Tests

`node tests/backend.test.js` (validation and statistics of `Code.gs`).
