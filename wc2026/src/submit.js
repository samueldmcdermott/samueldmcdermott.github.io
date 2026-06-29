/* ============================================================
   SUBMIT — no login required. Posts the bracket to a Google Form
   (silent, stays on the page); an Apps Script bound to the form's
   response sheet commits it to data/submissions.json and the
   leaderboard workflow re-scores. See SETUP.md to wire up the form.

   A name is paired with a PIN: the PIN is hashed in the browser
   (crypto.js) and only the hash is sent, so the maintainer never
   sees it. Once a name has submitted, further writes to that name
   require the matching PIN (enforced by the Apps Script).
   ============================================================ */
import {
  state, getName, nameInput, ensureBid, setActive, saveURL,
  encodePicks, showToast, TREE
} from "./state.js";
import { subsForName } from "./submissions.js";
import { pinHashFor } from "./crypto.js";

/* ------------------------------------------------------------
   Fill these in from your Google Form (Send ▸ link, and "Get
   pre-filled link" to read each field's entry.XXXXX id):
   ------------------------------------------------------------ */
const FORM = {
  // The form's POST endpoint: the form URL with /viewform replaced by
  // /formResponse. e.g. "https://docs.google.com/forms/d/e/FORM_ID/formResponse"
  action: "https://docs.google.com/forms/d/e/1FAIpQLSdWlPflsuHzFEnmxC3uWIZjtSSjXMKBqjWDF2zetyEGL1kcIQ/formResponse",
  // Map each bracket field to its Google Form entry id:
  fields: {
    name:       "entry.1041218534",
    label:      "entry.1326606238",
    picks:      "entry.220264991",
    bid:        "entry.572387553",
    official:   "entry.1591925697",
    submittedAt:"entry.1267483993",
    // ADD a "Pin hash" question to the form and paste its entry id here:
    pinHash:    "entry.1500950813"
  }
};
const formConfigured = () => !FORM.action.includes("REPLACE_WITH_FORM_ID");
const pinHashConfigured = () => !FORM.fields.pinHash.includes("REPLACE_WITH");

const submitDialog   = document.getElementById('submitDialog');
const submitLabelIn  = document.getElementById('submitLabel');
const submitOfficial = document.getElementById('submitOfficial');
const submitPinIn    = document.getElementById('submitPin');

/* YYMMDD_HHMMSS in local time — used as the label when none is given. */
function stampLabel(d){
  d = d || new Date();
  const p = n => String(n).padStart(2,"0");
  return p(d.getFullYear()%100)+p(d.getMonth()+1)+p(d.getDate())
    +"_"+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
}

/* Submissions already saved under a name (to drive defaults + the PIN check). */
function mySubs(nm){ return subsForName(nm); }
/* The PIN hash already established for this name, if any. */
export function establishedPinHash(nm){
  const s = mySubs(nm).find(x => x.pinHash);
  return s ? s.pinHash : "";
}

async function submitBracket(nm, label, pin, official){
  ensureBid();
  const finalLabel = label || stampLabel();
  setActive(state.activeBid, label);   // keep the user-typed label (may be blank) locally
  saveURL();
  const enc = encodePicks();
  const hash = await pinHashFor(nm, pin);

  if(!formConfigured()){
    // Not wired up yet: fall back to copying a paste-able record.
    const rec = JSON.stringify({user:nm, bid:state.activeBid, label:finalLabel,
      official:official, picks:enc, pinHash:hash, submittedAt:new Date().toISOString()});
    if(navigator.clipboard) navigator.clipboard.writeText(rec).catch(()=>{});
    showToast("Form not set up yet — record copied to clipboard");
    return;
  }

  const body = new FormData();
  body.append(FORM.fields.name, nm);
  body.append(FORM.fields.label, finalLabel);
  body.append(FORM.fields.picks, enc);
  body.append(FORM.fields.bid, state.activeBid);
  body.append(FORM.fields.official, official ? "Yes" : "No");
  body.append(FORM.fields.submittedAt, new Date().toISOString());
  if(pinHashConfigured()) body.append(FORM.fields.pinHash, hash);
  // Google Forms has no CORS endpoint; fire-and-forget with no-cors. The
  // response is opaque, so we optimistically report success.
  fetch(FORM.action, {method:"POST", mode:"no-cors", body}).then(()=>{}, ()=>{});
  showToast("Bracket submitted! It’ll appear on the leaderboard shortly.");
}

/* Open the submit dialog. opts.forceOfficial pre-checks "official" (used by the
   make-this-official toggle). */
function openSubmitDialog(opts){
  opts = opts || {};
  const nm = getName();
  if(!nm){ nameInput.focus(); showToast("Add your name first"); return; }
  if(!state.picks[String(TREE.final.id)]){ showToast("Pick a champion before submitting"); return; }
  submitLabelIn.value = state.activeLabel || "";
  submitPinIn.value = "";
  const echo = document.getElementById('submitNameEcho');
  if(echo) echo.textContent = nm;
  // Default official: forced on for a make-official action; else true only for a
  // name's first-ever bracket.
  submitOfficial.checked = opts.forceOfficial ? true : (mySubs(nm).length === 0);
  // hint whether a PIN is being set vs. entered
  const hint = document.getElementById('pinHint');
  if(hint){
    hint.textContent = establishedPinHash(nm)
      ? "Enter your PIN for this name."
      : "Set a PIN — you'll need it to edit or re-submit under this name.";
  }
  if(typeof submitDialog.showModal === "function") submitDialog.showModal();
  else confirmSubmit();   // no <dialog> support: submit immediately
}

async function confirmSubmit(){
  const nm = getName();
  const pin = (submitPinIn.value || "").trim();
  if(!pin){ submitPinIn.focus(); showToast("Enter a PIN"); return; }
  // Friendly client-side PIN check against the established hash (the Apps Script
  // also enforces this server-side).
  const established = establishedPinHash(nm);
  if(established){
    const h = await pinHashFor(nm, pin);
    if(h !== established){ submitPinIn.focus(); showToast("Wrong PIN for that name"); return; }
  }
  submitDialog.close();
  await submitBracket(nm, submitLabelIn.value.trim(), pin, submitOfficial.checked);
}

/* Called by the chooser's "make this official" toggle. */
export function requestMakeOfficial(){
  openSubmitDialog({forceOfficial:true});
}

export function initSubmit(){
  document.getElementById('submitBtn').addEventListener('click',()=> openSubmitDialog());
  document.getElementById('submitConfirmBtn').addEventListener('click',()=> confirmSubmit());
  document.getElementById('submitCancelBtn').addEventListener('click',()=> submitDialog.close());
}
