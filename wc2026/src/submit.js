/* ============================================================
   SUBMIT — no login required. Posts the bracket to a Google Form
   (silent, stays on the page); an Apps Script bound to the form's
   response sheet commits it to data/submissions.json and the
   leaderboard workflow re-scores. See SETUP.md to wire up the form.
   ============================================================ */
import {
  state, getName, nameInput, ensureBid, setActive, saveURL,
  encodePicks, showToast, TREE
} from "./state.js";
import { subsForName } from "./submissions.js";

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
    name:       "entry.0000000001",
    label:      "entry.0000000002",
    picks:      "entry.0000000003",
    bid:        "entry.0000000004",
    official:   "entry.0000000005",
    submittedAt:"entry.0000000006"
  }
};
const formConfigured = () => !FORM.action.includes("REPLACE_WITH_FORM_ID");

const submitDialog   = document.getElementById('submitDialog');
const submitLabelIn  = document.getElementById('submitLabel');
const submitOfficial = document.getElementById('submitOfficial');

/* YYMMDD_HHMMSS in local time — used as the label when none is given. */
function stampLabel(d){
  d = d || new Date();
  const p = n => String(n).padStart(2,"0");
  return p(d.getFullYear()%100)+p(d.getMonth()+1)+p(d.getDate())
    +"_"+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
}

/* Has this name already submitted at least once? (drives the official default
   and the auto-first-official behavior — first bracket is official.) */
function nameHasSubmissions(nm){ return subsForName(nm).length > 0; }

function submitBracket(nm, label, official){
  ensureBid();
  const finalLabel = label || stampLabel();
  setActive(state.activeBid, label);   // keep the user-typed label (may be blank) locally
  saveURL();
  const enc = encodePicks();

  if(!formConfigured()){
    // Not wired up yet: fall back to copying a paste-able record.
    const rec = JSON.stringify({user:nm, bid:state.activeBid, label:finalLabel,
      official:official, picks:enc, submittedAt:new Date().toISOString()});
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
  // Google Forms has no CORS endpoint; fire-and-forget with no-cors. The
  // response is opaque, so we optimistically report success.
  fetch(FORM.action, {method:"POST", mode:"no-cors", body}).then(()=>{}, ()=>{});
  showToast("Bracket submitted! It’ll appear on the leaderboard shortly.");
}

export function initSubmit(){
  document.getElementById('submitBtn').addEventListener('click',()=>{
    const nm = getName();
    if(!nm){ nameInput.focus(); showToast("Add your name first"); return; }
    if(!state.picks[String(TREE.final.id)]){ showToast("Pick a champion before submitting"); return; }
    submitLabelIn.value = state.activeLabel || "";
    // Default: first bracket for this name is official; later ones aren't.
    submitOfficial.checked = !nameHasSubmissions(nm);
    if(typeof submitDialog.showModal === "function") submitDialog.showModal();
    else submitBracket(nm, submitLabelIn.value.trim(), submitOfficial.checked);
  });
  document.getElementById('submitConfirmBtn').addEventListener('click',()=>{
    submitDialog.close();
    submitBracket(getName(), submitLabelIn.value.trim(), submitOfficial.checked);
  });
  document.getElementById('submitCancelBtn').addEventListener('click',()=>submitDialog.close());
}
