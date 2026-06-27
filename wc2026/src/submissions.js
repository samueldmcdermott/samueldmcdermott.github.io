/* ============================================================
   Submissions data layer. Loads the committed submissions
   (data/submissions.json) and the official results, and provides
   helpers the inline chooser (chooser.js) builds on.
   ============================================================ */
import {
  state, newBid, setActive, saveURL, decodePicksInto, showToast, fmtWhen
} from "./state.js";
import { render } from "./view.js";

/* Submissions saved under a given name (case-insensitive). */
export function subsForName(nm){
  const k = (nm||"").trim().toLowerCase();
  if(!k) return [];
  return state.allSubs.filter(s => (s.user||"").trim().toLowerCase() === k);
}

/* Display title for a bracket: its label, or a time-based fallback. */
export function bracketTitle(s){
  return s.label && s.label.trim()
    ? s.label.trim()
    : ("Bracket from " + (fmtWhen(s.submittedAt) || "an earlier submit"));
}

/* Load a saved submission's picks into the live bracket. */
export function loadBracketFromSub(s){
  // replace picks in place so the shared state object stays the same reference
  Object.keys(state.picks).forEach(k => delete state.picks[k]);
  decodePicksInto(state.picks, s.picks);
  setActive(s.bid || newBid(), s.label || "");
  saveURL();
  render();
  showToast(`Loaded “${bracketTitle(s)}”`);
}

/* Clear to a brand-new, empty bracket. */
export function startNewBracket(){
  Object.keys(state.picks).forEach(k => delete state.picks[k]);
  setActive(newBid(), "");
  saveURL();
  render();
  showToast("Started a new bracket");
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
