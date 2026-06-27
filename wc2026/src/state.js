/* ============================================================
   Shared state, persistence, and small utilities.
   Other modules import from here; the mutable app state lives on
   the single `state` object so updates are visible everywhere.
   ============================================================ */

/* Tournament data is published by data.js as a classic script. */
export const WC = window.WC;
export const { CODES, R32, TREE, POINTS, ROUND_LABEL, ROUND_MAX } = WC;

/* ---- mutable app state (shared across modules) ---- */
export const state = {
  picks: {},        // picks[matchId] = "a" | "b" (which side the user advanced)
  results: {},      // results[matchId] = "a" | "b" (official winning side)
  deadSet: new Set(),   // team names eliminated by an official result
  allSubs: [],      // every committed submission (data/submissions.json)
  lbByBid: {},      // bid -> leaderboard entry (for the chooser's score column)
  activeBid: "",    // identity of the bracket currently being edited
  activeLabel: ""   // its optional label
};

/* ---- DOM handles used in more than one module ---- */
export const nameInput = document.getElementById('userName');

/* ---- name ---- */
const NAME_KEY = "wc26_name";
export function getName(){ return (nameInput.value || "").trim(); }

/* ============================================================
   ACTIVE BRACKET — identity (bid) + optional label, persisted so
   a refresh keeps the user on the same bracket.
   ============================================================ */
const BID_KEY = "wc26_bid", LABEL_KEY = "wc26_label";

export function newBid(){
  return (Date.now().toString(36) + Math.random().toString(36).slice(2,6));
}
export function ensureBid(){
  if(!state.activeBid) state.activeBid = newBid();
  return state.activeBid;
}
export function setActive(bid, label){
  state.activeBid = bid || newBid();
  state.activeLabel = label || "";
  localStorage.setItem(BID_KEY, state.activeBid);
  if(state.activeLabel) localStorage.setItem(LABEL_KEY, state.activeLabel);
  else localStorage.removeItem(LABEL_KEY);
}

/* ============================================================
   URL SHARE — compact encoding of picks (+ name + bracket identity).
   ============================================================ */
export function encodePicks(){
  return Object.keys(state.picks).map(id => id + state.picks[id]).join(",");
}
export function decodePicksInto(target, str){
  (str || "").split(",").forEach(tok=>{
    const side = tok.slice(-1), id = tok.slice(0,-1);
    if((side==="a"||side==="b") && id) target[id]=side;
  });
}
export function saveURL(){
  const enc = encodePicks();
  const u = new URL(window.location.href);
  if(enc) u.searchParams.set("p", enc); else u.searchParams.delete("p");
  const nm = getName();
  if(nm) u.searchParams.set("u", nm); else u.searchParams.delete("u");
  if(state.activeBid) u.searchParams.set("bid", state.activeBid); else u.searchParams.delete("bid");
  if(state.activeLabel) u.searchParams.set("label", state.activeLabel); else u.searchParams.delete("label");
  history.replaceState(null,"",u.toString());
}
export function loadURL(){
  const u = new URL(window.location.href);
  const nm = u.searchParams.get("u");
  if(nm) nameInput.value = nm;
  else { const saved = localStorage.getItem(NAME_KEY); if(saved) nameInput.value = saved; }
  // active bracket identity: URL wins, else localStorage, else a fresh id
  state.activeBid   = u.searchParams.get("bid")   || localStorage.getItem(BID_KEY)   || "";
  state.activeLabel = u.searchParams.get("label") || localStorage.getItem(LABEL_KEY) || "";
  decodePicksInto(state.picks, u.searchParams.get("p"));
}
export function persistName(){
  const nm = getName();
  if(nm) localStorage.setItem(NAME_KEY, nm); else localStorage.removeItem(NAME_KEY);
}

/* ============================================================
   Small shared utilities.
   ============================================================ */
export function showToast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg || "Share link copied";
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 1600);
}
export function esc(s){
  return String(s).replace(/[&<>"']/g, c => (
    {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
/* "Jun 22, 3:14 PM" style; "" for missing/invalid. */
export function fmtWhen(iso){
  if(!iso) return "";
  const d = new Date(iso);
  if(isNaN(d)) return "";
  return d.toLocaleString(undefined,
    {month:"short", day:"numeric", hour:"2-digit", minute:"2-digit"});
}
/* "Updated Jun 22, 2026, 3:14 PM"; "" for missing/invalid. */
export function fmtUpdated(iso){
  if(!iso) return "";
  const d = new Date(iso);
  if(isNaN(d)) return "";
  return "Updated " + d.toLocaleString(undefined,
    {year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit"});
}
