/* ============================================================
   FROZEN bracket picker (Picks tab). Submissions are closed, so the
   bracket is a read-only viewer. This module lets anyone browse every
   OFFICIAL bracket by name; entering a name + PIN additionally reveals
   that person's non-official brackets. Selecting one loads its picks
   into the read-only bracket and labels whose it is.
   ============================================================ */
import {
  state, getName, nameInput, esc, showToast, persistName, saveURL,
  POINTS, TREE, CODES
} from "./state.js";
import { allMatches } from "./tree.js";
import { bracketTitle, loadBracketFromSub } from "./submissions.js";
import { pinHashFor } from "./crypto.js";

const bar       = document.getElementById('pickerBar');
const listEl    = document.getElementById('pickerList');
const unlockBtn = document.getElementById('unlockNameBtn');
const headEl    = document.getElementById('bracketHead');
const bhName    = document.getElementById('bhName');
const bhMeta    = document.getElementById('bhMeta');

const revealDialog = document.getElementById('revealDialog');
const revealName   = document.getElementById('revealName');
const revealPin    = document.getElementById('revealPin');

/* Names whose PIN was verified this session — their non-official brackets
   become visible in the picker. */
const revealedNames = new Set();

/* ---- which submissions appear in the picker ---- */
/* Every official bracket, plus any bracket belonging to a revealed name. */
function visibleSubs(){
  return state.allSubs.filter(s =>
    s.official || revealedNames.has((s.user||"").trim().toLowerCase()));
}

/* Earned points for a bracket's picks against the official results so far. */
function earnedScore(picks){
  const sel = {};
  (picks||"").split(",").forEach(tok=>{
    const side = tok.slice(-1), id = tok.slice(0,-1);
    if((side==="a"||side==="b") && id) sel[id]=side;
  });
  let pts = 0;
  Object.keys(state.results).forEach(id=>{
    if(id==="103") return;                 // third-place sits outside scoring
    const m = allMatches[id];
    if(!m) return;
    if(sel[id] && sel[id]===state.results[id]) pts += POINTS[m.round];
  });
  return pts;
}

/* The bracket currently displayed (by bid), if any. */
function subByBid(bid){ return state.allSubs.find(s => s.bid === bid); }

/* ---- rendering -------------------------------------------------------- */
export function showPicker(){
  if(!bar) return;
  const subs = visibleSubs().slice().sort((a,b)=>{
    // official first, then by leaderboard score (desc), then name
    if(!!b.official !== !!a.official) return b.official ? 1 : -1;
    const sa = state.lbByBid[a.bid]?.score ?? earnedScore(a.picks);
    const sb = state.lbByBid[b.bid]?.score ?? earnedScore(b.picks);
    if(sb !== sa) return sb - sa;
    return (a.user||"").localeCompare(b.user||"");
  });
  bar.hidden = false;
  if(!subs.length){
    listEl.innerHTML = `<span class="picker-empty">No brackets submitted.</span>`;
    return;
  }
  listEl.innerHTML = subs.map(s=>{
    const active = s.bid === state.activeBid ? " active" : "";
    const score  = state.lbByBid[s.bid]?.score ?? earnedScore(s.picks);
    const who    = esc(s.user || "—");
    // a revealed non-official bracket: show its label to tell several apart
    const sub    = (!s.official && s.label) ? ` <span class="px-sub">${esc(s.label)}</span>` : "";
    return `<button type="button" class="px-btn${active}" data-bid="${esc(s.bid)}">
      <span class="px-name">${who}${sub}</span>
      <span class="px-score">${score}</span>
    </button>`;
  }).join("");
}

/* Load a bracket into the read-only view and label whose it is. */
export function viewBracketByBid(bid){
  const sub = subByBid(bid);
  if(!sub) return;
  loadBracketFromSub(sub);   // sets picks + activeBid, re-renders the bracket
  paintHead(sub);
  showPicker();              // refresh active highlight
}

function paintHead(sub){
  if(!headEl) return;
  headEl.hidden = false;
  const champ = champName(sub.picks);
  const lb    = state.lbByBid[sub.bid];
  const score = lb?.score ?? earnedScore(sub.picks);
  const max   = lb?.maxPossible;
  bhName.textContent = sub.user || "—";
  const bits = [];
  if(!sub.official && sub.label) bits.push(esc(sub.label));
  if(champ) bits.push(`🏆 ${esc(champ)}`);
  bits.push(`<b>${score}</b> pt${score===1?"":"s"}${max!=null?` · max ${max}`:""}`);
  bhMeta.innerHTML = bits.join(" &nbsp;·&nbsp; ");
}

/* Champion (final winner) team name from an encoded picks string. */
function champName(picks){
  const sel = {};
  (picks||"").split(",").forEach(tok=>{
    const side = tok.slice(-1), id = tok.slice(0,-1);
    if((side==="a"||side==="b") && id) sel[id]=side;
  });
  const finalId = String(TREE.final.id);
  if(!sel[finalId]) return "";
  // walk the chosen side down to a concrete team
  const resolve = (id) => {
    const m = allMatches[id]; if(!m) return null;
    const side = sel[id]; if(!side) return null;
    const ref = side==="a" ? m.aRef : m.bRef;
    return ref.type==="team" ? ref.team : resolve(ref.match);
  };
  const t = resolve(finalId);
  return t ? (CODES[t.name] ? `${CODES[t.name]} ${t.name}` : t.name) : "";
}

/* ---- reveal-my-brackets dialog (name + PIN) --------------------------- */
function openReveal(){
  revealName.value = getName() || "";
  revealPin.value = "";
  if(typeof revealDialog.showModal === "function"){
    revealDialog.showModal();
    (revealName.value ? revealPin : revealName).focus();
  }
}

async function confirmReveal(){
  const nm  = (revealName.value || "").trim();
  const pin = (revealPin.value || "").trim();
  if(!nm){ revealName.focus(); showToast("Enter your name"); return; }
  if(!pin){ revealPin.focus(); showToast("Enter your PIN"); return; }

  const key  = nm.toLowerCase();
  const subs = state.allSubs.filter(s => (s.user||"").trim().toLowerCase()===key);
  const established = (subs.find(s => s.pinHash) || {}).pinHash || "";
  if(!subs.length){ showToast("No brackets found under that name"); return; }
  if(!established){
    // name has brackets but no PIN on record — nothing to gate
    revealedNames.add(key);
    if(revealDialog.open) revealDialog.close();
    showPicker(); showToast(`Showing ${nm}’s brackets`);
    return;
  }
  let h = "";
  try { h = await pinHashFor(nm, pin); }
  catch(e){
    if(revealDialog.open) revealDialog.close();
    showToast("Can't verify the PIN here (needs https/localhost).");
    return;
  }
  if(h !== established){ revealPin.focus(); showToast("Wrong PIN for that name"); return; }
  if(revealDialog.open) revealDialog.close();
  revealedNames.add(key);
  // remember the name locally for convenience
  nameInput.value = nm; persistName();
  showPicker();
  showToast(`Showing ${nm}’s brackets`);
}

/* ---- wiring ----------------------------------------------------------- */
export function initPicker(){
  if(!bar) return;
  listEl.addEventListener('click', e=>{
    const btn = e.target.closest('.px-btn');
    if(!btn) return;
    if(btn.dataset.bid === state.activeBid) return;   // already showing it
    viewBracketByBid(btn.dataset.bid);
  });
  unlockBtn.addEventListener('click', openReveal);
  document.getElementById('revealConfirmBtn').addEventListener('click', confirmReveal);
  document.getElementById('revealCancelBtn').addEventListener('click', ()=> revealDialog.close());
  revealPin.addEventListener('keydown', e=>{
    if(e.key==="Enter"){ e.preventDefault(); confirmReveal(); }
  });
}
