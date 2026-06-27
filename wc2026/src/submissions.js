/* ============================================================
   Submissions + bracket chooser. Reads the committed submissions
   (data/submissions.json) so a returning user can reopen/edit a
   bracket saved under their name, and loads the official results.
   ============================================================ */
import {
  state, getName, newBid, setActive, saveURL, decodePicksInto,
  showToast, esc, fmtWhen
} from "./state.js";
import { render } from "./view.js";

const pickerDialog = document.getElementById('bracketPicker');

/* Submissions saved under a given name (case-insensitive). */
export function subsForName(nm){
  const k = (nm||"").trim().toLowerCase();
  if(!k) return [];
  return state.allSubs.filter(s => (s.user||"").trim().toLowerCase() === k);
}

/* Display title for a bracket row: its label, or a time-based fallback. */
function bracketTitle(s){
  return s.label && s.label.trim()
    ? s.label.trim()
    : ("Bracket from " + (fmtWhen(s.submittedAt) || "an earlier submit"));
}

function loadBracketFromSub(s){
  // replace picks in place so the shared state object stays the same reference
  Object.keys(state.picks).forEach(k => delete state.picks[k]);
  decodePicksInto(state.picks, s.picks);
  setActive(s.bid || newBid(), s.label || "");
  saveURL();
  render();
  showToast(`Loaded “${bracketTitle(s)}”`);
}

function renderPicker(nm, list){
  document.getElementById('pickerTitle').textContent = `Brackets for ${nm}`;
  const ul = document.getElementById('pickerList');
  // newest first
  const rows = list.slice().sort((a,b)=> (b.submittedAt||"").localeCompare(a.submittedAt||""));
  ul.innerHTML = rows.map((s,i)=>{
    const lb = s.bid ? state.lbByBid[s.bid] : null;
    const score = lb ? `<span class="pk-score">${lb.score} pts</span>` : "";
    const off = s.official ? `<span class="pk-tag">official</span>` : "";
    const cur = s.bid && s.bid===state.activeBid ? `<span class="pk-tag cur">editing</span>` : "";
    return `<li>
      <button class="pk-row" data-i="${i}">
        <span class="pk-name">${esc(bracketTitle(s))}</span>
        ${off}${cur}${score}
        <span class="pk-when">${esc(fmtWhen(s.submittedAt))}</span>
      </button>
    </li>`;
  }).join("");
  ul.querySelectorAll('.pk-row').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const s = rows[+btn.dataset.i];
      pickerDialog.close();
      loadBracketFromSub(s);
    });
  });
}

/* Offer the chooser if the current name has saved brackets.
   force=true always opens; otherwise only when the current bracket is empty,
   so we don't interrupt work in progress. */
export function maybeOfferBrackets(force){
  const nm = getName();
  const list = subsForName(nm);
  if(!list.length) return false;
  const empty = Object.keys(state.picks).length === 0;
  const editingOwn = state.activeBid && list.some(s=>s.bid===state.activeBid);
  if(!force && (!empty || editingOwn)) return false;
  renderPicker(nm, list);
  if(typeof pickerDialog.showModal === "function") pickerDialog.showModal();
  return true;
}

export function loadSubmissions(){
  return fetch("data/submissions.json", {cache:"no-store"})
    .then(r=> r.ok ? r.json() : [])
    .then(data=>{ state.allSubs = Array.isArray(data) ? data : []; })
    .catch(()=>{ state.allSubs = []; });
}

/* Official results: load decided matches so the bracket can X wrong picks
   and grey out picks that can no longer come true, then re-render. */
export function loadResults(){
  return fetch("data/results.json", {cache:"no-store"})
    .then(r=> r.ok ? r.json() : null)
    .then(data=>{
      state.results = {};
      const w = (data && data.winners) || {};
      Object.keys(w).forEach(id=>{ if(w[id]==="a"||w[id]==="b") state.results[id]=w[id]; });
      render();   // re-render now that results are known
    })
    .catch(()=>{ /* no results yet — bracket renders normally */ });
}

/* Wire the "+ Create a new bracket" button in the chooser. */
export function initChooser(){
  document.getElementById('newBracketBtn').addEventListener('click',()=>{
    pickerDialog.close();
    Object.keys(state.picks).forEach(k => delete state.picks[k]);
    setActive(newBid(), "");
    saveURL(); render();
    showToast("Started a new bracket");
  });
}
