# Submissions setup — Google Form + Apps Script (no login for players)

The bracket page lets anyone submit **without a GitHub account**. It posts each
bracket to a **Google Form**; a **Google Apps Script** bound to the form's
response sheet commits `wc2026/data/submissions.json` to this repo, which triggers
the leaderboard workflow to re-score. All free, no backend you host.

```
Player clicks Submit (no login)
  → silent POST to your Google Form
  → response row in the linked Google Sheet
  → Apps Script (onFormSubmit) commits wc2026/data/submissions.json
  → leaderboard.yml workflow scores → commits wc2026/leaderboard.json
  → page shows the updated leaderboard
```

You only set this up **once**. ~15 minutes.

---

## 1. Create the Google Form

Create a form (forms.google.com) with **exactly these short-answer questions**,
in any order. The question titles must match the names below (they're what the
Apps Script reads):

| Question title | What it holds |
|----------------|---------------|
| `Name`         | player name |
| `Label`        | optional bracket label |
| `Picks`        | encoded picks string |
| `Bracket id`   | stable bracket id |
| `Official`     | `Yes` / `No` |
| `Submitted at` | ISO timestamp |

In the form: **Settings → Responses → turn OFF “Limit to 1 response”** and
**“Collect email addresses”** (so players don't need to sign in).

## 2. Get the POST URL and field ids (for the website)

- **POST URL:** click **Send → link (🔗)**, copy the form URL. It ends in
  `/viewform`. Replace that with **`/formResponse`**. That's `FORM.action`.
- **Field ids:** click the **⋮ menu → Get pre-filled link**, fill each question
  with its own name as a dummy value (type `Name` in Name, `Picks` in Picks, …),
  click **Get link → Copy link**. The link contains `entry.NNNNNNNNN=Name`,
  `entry.MMMMMMMMM=Picks`, etc. Each `entry.XXXXX` is that field's id.

Open [`wc2026/src/bracket.js`](wc2026/src/bracket.js), find the `FORM` config near
the top of the SUBMIT section, and fill it in:

```js
const FORM = {
  action: "https://docs.google.com/forms/d/e/<YOUR_FORM_ID>/formResponse",
  fields: {
    name:        "entry.__________",
    label:       "entry.__________",
    picks:       "entry.__________",
    bid:         "entry.__________",
    official:    "entry.__________",
    submittedAt: "entry.__________"
  }
};
```

(Until you fill this in, the Submit button copies a paste-able record to the
clipboard instead of posting — handy for testing, but nothing reaches the form.)

## 3. Link the form to a sheet + add the Apps Script

1. Form → **Responses → Link to Sheets** → create a new spreadsheet.
2. In that sheet: **Extensions → Apps Script**.
3. Delete the starter code, paste the contents of
   [`google-apps-script/Code.gs`](google-apps-script/Code.gs).
4. If your question titles differ from the table above, update `FIELD_TITLES` at
   the top of the script to match.

## 4. Give the script a GitHub token

The script commits to this repo, so it needs a token:

1. GitHub → **Settings → Developer settings → Fine-grained personal access
   tokens → Generate new token.**
   - **Repository access:** only `samueldmcdermott/samueldmcdermott.github.io`.
   - **Permissions:** *Repository permissions → Contents → Read and write*.
     (Nothing else.)
2. In Apps Script: **Project Settings (⚙) → Script properties → Add property**,
   three times:
   | Property | Value |
   |----------|-------|
   | `GITHUB_TOKEN`  | the token you just made |
   | `GITHUB_REPO`   | `samueldmcdermott/samueldmcdermott.github.io` |
   | `GITHUB_BRANCH` | `master` |

> Keep the token in Script Properties only — never commit it.

## 5. Install the trigger

In the Apps Script editor, choose the function **`installTrigger`** and click
**Run**. Authorize when prompted (it'll warn the app is unverified — that's your
own script; continue). This wires `onFormSubmit` to run on every response.

Optionally run **`selfTest`** once; the execution log should read
`OK — read N submissions`.

## 6. Test end-to-end

Submit a bracket from the site. Within a minute you should see:
- a new commit to `wc2026/data/submissions.json` (author: your token's user),
- the **leaderboard** workflow run, then a commit to `wc2026/leaderboard.json`,
- your entry on the page's Leaderboard tab.

---

## Notes & limits

- **First bracket is official automatically.** A player's first submission is
  their scored entry; later ones aren't unless they tick *Make this my official
  entry* (which then demotes the previous official). Enforced in the Apps Script.
- **No labels?** Blank labels become the submission time `YYMMDD_HHMMSS`.
- **Trust:** lookups are by name only — anyone who knows a name can load/edit that
  name's brackets. Tell players to pick a not-easily-guessed name.
- **Quota:** Apps Script free `UrlFetchApp` is ~20k calls/day and Forms responses
  are unlimited — far beyond a friend pool.
- **Silent POST caveat:** the page posts with `no-cors`, so it can't read Google's
  response; it optimistically shows “submitted.” If a player closes the tab the
  instant they click, the post may not complete — practically a non-issue.
- **Recording results** is unchanged: edit
  [`wc2026/data/results.json`](wc2026/data/results.json) and commit; the workflow
  re-scores. See the bracket [README](wc2026/README.md#leaderboard).
