/* ============================================================
   WC2026 bracket — Google Apps Script ingestion
   ------------------------------------------------------------
   Bind this to the Google Form's response spreadsheet. On each
   form submit it reads the new bracket, applies the same rules as
   the old server-side ingest (upsert by bracket id; one official
   bracket per name; the FIRST bracket a name submits is official
   automatically), and commits wc2026/data/submissions.json to the
   GitHub repo. The push triggers the leaderboard workflow, which
   re-scores and commits wc2026/leaderboard.json.

   ONE-TIME SETUP (see SETUP.md):
   1. Form ▸ Responses ▸ link to a Google Sheet.
   2. In that Sheet: Extensions ▸ Apps Script, paste this file.
   3. Script ▸ Project Settings ▸ Script Properties, add:
        GITHUB_TOKEN  = a fine-grained PAT with Contents:read+write
                        on the repo (no other scope needed)
        GITHUB_REPO   = samueldmcdermott/samueldmcdermott.github.io
        GITHUB_BRANCH = master            (or your default branch)
   4. Map the form's questions to the column titles below in
      FIELD_TITLES (must match the Form question text exactly).
   5. Run installTrigger() once and authorize. Done.
   ============================================================ */

// Form question titles -> our field names. Edit the right-hand
// strings to match your Form's question text exactly.
var FIELD_TITLES = {
  name:        "Name",
  label:       "Label",
  picks:       "Picks",
  bid:         "Bracket id",
  official:    "Official",
  submittedAt: "Submitted at"
};

var SUBMISSIONS_PATH = "wc2026/data/submissions.json";

/* ---- entry point: install once, runs on every form submit ---- */
function installTrigger() {
  // remove any existing triggers for this function, then add one
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "onFormSubmit") ScriptApp.deleteTrigger(t);
  });
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.newTrigger("onFormSubmit").forSpreadsheet(ss).onFormSubmit().create();
}

function onFormSubmit(e) {
  var values = rowFromEvent(e);            // { "Name": "...", "Picks": "...", ... }
  var entry = buildEntry(values);
  if (!entry) return;                       // missing name/picks -> ignore

  var gh = ghConfig_();
  var current = ghGetSubmissions_(gh);      // { list, sha }
  var list = upsert_(current.list, entry);
  ghPutSubmissions_(gh, list, current.sha,
    "chore: bracket submission from " + entry.user + " [skip ci]");
}

/* ---- read the just-submitted row as a title->value map ---- */
function rowFromEvent(e) {
  // e.namedValues is the most robust: { "Question title": ["answer"], ... }
  var out = {};
  if (e && e.namedValues) {
    Object.keys(e.namedValues).forEach(function (k) {
      out[k] = String((e.namedValues[k] || [""])[0] || "").trim();
    });
    return out;
  }
  // Fallback: read header row + the event range (manual runs / older events)
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = e && e.range ? e.range.getValues()[0]
                         : sheet.getRange(sheet.getLastRow(), 1, 1, sheet.getLastColumn()).getValues()[0];
  headers.forEach(function (h, i) { out[String(h).trim()] = String(row[i] || "").trim(); });
  return out;
}

/* ---- shape one submission record ---- */
function buildEntry(v) {
  var T = FIELD_TITLES;
  var name = (v[T.name] || "").trim();
  var picks = cleanPicks_(v[T.picks] || "");
  if (!name || !picks) return null;

  var label = (v[T.label] || "").trim();
  var bid = cleanBid_(v[T.bid] || "");
  if (!bid) bid = "form-" + Date.now().toString(36);

  var official = parseOfficial_(v[T.official] || "");
  var submittedAt = (v[T.submittedAt] || "").trim() || new Date().toISOString();

  return {
    user: name, bid: bid, label: label, official: official,
    picks: picks, submittedAt: submittedAt, source: "google-form"
  };
}

function cleanPicks_(raw) {
  return String(raw).replace(/\n/g, ",").split(",")
    .map(function (t) { return t.trim(); })
    .filter(function (t) { return /^\d+[ab]$/.test(t); })
    .join(",");
}
function cleanBid_(raw) {
  var m = String(raw).match(/[A-Za-z0-9]{4,16}/);
  return m ? m[0] : "";
}
function parseOfficial_(raw) {
  return ["yes", "y", "true", "on", "1"].indexOf(String(raw).trim().toLowerCase()) >= 0;
}

/* ---- merge: upsert by bid; one official per name; first = official ---- */
function upsert_(list, entry) {
  list = Array.isArray(list) ? list : [];
  var nl = entry.user.toLowerCase();
  var hadAny = list.some(function (s) { return (s.user || "").toLowerCase() === nl; });
  var hadOfficial = list.some(function (s) {
    return (s.user || "").toLowerCase() === nl && s.official;
  });

  // drop the previous version of this exact bracket
  list = list.filter(function (s) { return s.bid !== entry.bid; });

  // The first bracket a name ever submits is official automatically.
  if (!hadAny) entry.official = true;

  if (entry.official) {
    // exclusivity: demote any other official bracket for this name
    list.forEach(function (s) {
      if ((s.user || "").toLowerCase() === nl) s.official = false;
    });
  } else if (!hadOfficial) {
    // they unchecked official but have none on record -> keep one official
    entry.official = true;
  }

  list.push(entry);
  return list;
}

/* ---- GitHub Contents API helpers ---- */
function ghConfig_() {
  var p = PropertiesService.getScriptProperties();
  var token = p.getProperty("GITHUB_TOKEN");
  var repo = p.getProperty("GITHUB_REPO");
  var branch = p.getProperty("GITHUB_BRANCH") || "master";
  if (!token || !repo) throw new Error("Set GITHUB_TOKEN and GITHUB_REPO in Script Properties.");
  return { token: token, repo: repo, branch: branch };
}
function ghHeaders_(gh) {
  return {
    Authorization: "Bearer " + gh.token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}
function ghGetSubmissions_(gh) {
  var url = "https://api.github.com/repos/" + gh.repo + "/contents/" +
    encodeURI(SUBMISSIONS_PATH) + "?ref=" + encodeURIComponent(gh.branch);
  var res = UrlFetchApp.fetch(url, { headers: ghHeaders_(gh), muteHttpExceptions: true });
  if (res.getResponseCode() === 404) return { list: [], sha: null };
  if (res.getResponseCode() >= 300) throw new Error("GitHub GET failed: " + res.getContentText());
  var data = JSON.parse(res.getContentText());
  var json = Utilities.newBlob(Utilities.base64Decode(data.content)).getDataAsString();
  var list = [];
  try { list = JSON.parse(json) || []; } catch (err) { list = []; }
  return { list: list, sha: data.sha };
}
function ghPutSubmissions_(gh, list, sha, message) {
  var url = "https://api.github.com/repos/" + gh.repo + "/contents/" + encodeURI(SUBMISSIONS_PATH);
  var content = Utilities.base64Encode(
    Utilities.newBlob(JSON.stringify(list, null, 2) + "\n").getBytes());
  var payload = { message: message, content: content, branch: gh.branch };
  if (sha) payload.sha = sha;
  var res = UrlFetchApp.fetch(url, {
    method: "put", headers: ghHeaders_(gh), contentType: "application/json",
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error("GitHub PUT failed: " + res.getContentText());
}

/* ---- optional: run by hand to test config + a fake submission ---- */
function selfTest() {
  var gh = ghConfig_();
  var cur = ghGetSubmissions_(gh);
  Logger.log("OK — read %s submissions (sha=%s)", cur.list.length, cur.sha);
}
