/* ============================================================
   Inline bracket chooser (Your-bracket tab). A row of buttons —
   one per saved bracket under the current name, plus "New bracket"
   — and a "make this official" toggle. PIN-gated: an existing name
   must enter its PIN before its brackets load.

   This replaced a native <select>, whose OS-drawn dropdown was
   unreliable (it sometimes refused to open). Buttons have none of
   that fragility: one click loads a bracket, full stop.
   ============================================================ */
import { state, getName, nameInput, esc, showToast, persistName, saveURL } from "./state.js";
import {
  subsForName, bracketTitle, loadBracketFromSub, startNewBracket
} from "./submissions.js";
import { requestMakeOfficial, establishedPinHash } from "./submit.js";
import { pinHashFor } from "./crypto.js";

const bar         = document.getElementById('chooserBar');
const listEl      = document.getElementById('bracketList');
const makeOff     = document.getElementById('makeOfficial');
const makeOffWrap = document.getElementById('makeOfficialWrap');

const unlockDialog   = document.getElementById('unlockDialog');
const unlockPinIn    = document.getElementById('unlockPin');
const unlockNameEcho = document.getElementById('unlockNameEcho');

/* bids the user started fresh via "New bracket" this session — so showChooser()
   doesn't auto-load a saved bracket over an empty one in progress. */
const startedBids = new Set();

/* ---- PIN gate --------------------------------------------------------- */

/* Has the typed name been verified (or does it need no PIN)? A name is gated
   when it has saved brackets carrying a PIN hash that hasn't been unlocked
   this session. */
function nameUnlocked(nm){
  const k = (nm||"").trim().toLowerCase();
  if(!k) return true;
  if(state.unlockedNames.has(k)) return true;
  return !establishedPinHash(nm);   // no PIN on record -> nothing to gate
}

/* Called when the name field settles (or after submissions load). A
   PIN-protected name that hasn't been unlocked this session prompts for its
   PIN; everything else just shows its brackets. */
export function gateName(){
  const nm = getName();
  if(nm && subsForName(nm).length && !nameUnlocked(nm)){
    openUnlockDialog(nm);
    return;
  }
  showChooser();
}

function openUnlockDialog(nm){
  unlockPinIn.value = "";
  if(unlockNameEcho) unlockNameEcho.textContent = nm;
  if(typeof unlockDialog.showModal === "function"){
    unlockDialog.showModal();
    unlockPinIn.focus();
  } else {
    // No <dialog> support: skip the gate (server-side PIN still protects writes).
    state.unlockedNames.add(nm.trim().toLowerCase());
    showChooser();
  }
}

async function confirmUnlock(){
  const nm = getName();
  const pin = (unlockPinIn.value || "").trim();
  if(!pin){ unlockPinIn.focus(); showToast("Enter the PIN"); return; }
  const established = establishedPinHash(nm);

  // crypto.subtle needs a secure context (https / localhost); on file:// it
  // throws. Either way, close the modal before touching the page.
  let h = "";
  try { h = await pinHashFor(nm, pin); }
  catch(e){
    if(unlockDialog.open) unlockDialog.close();
    showToast("Can't verify the PIN here (needs https/localhost).");
    return;
  }
  if(unlockDialog.open) unlockDialog.close();

  if(h !== established){
    // Wrong PIN: the name belongs to someone else. Clear it, ask for a new one.
    showToast("That name is taken — wrong PIN. Choose a different name.");
    nameInput.value = "";
    persistName(); saveURL();
    nameInput.focus();
    showChooser();              // hides the bar for the now-empty name
    return;
  }
  state.unlockedNames.add(nm.trim().toLowerCase());
  showChooser();               // unlocked: reveal + auto-load their bracket
}

/* ---- chooser rendering ------------------------------------------------ */

/* The brackets for the current (unlocked) name, newest first. */
function myBrackets(){
  return subsForName(getName())
    .slice()
    .sort((a,b)=> (b.submittedAt||"").localeCompare(a.submittedAt||""));
}

/* The saved bracket to auto-load when the chooser opens: their official one,
   else the newest. Returns "" if none. */
function defaultBid(list){
  const official = list.find(s => s.official);
  return official ? official.bid : (list[0] ? list[0].bid : "");
}

/* Entry point after the name settles / a bracket is chosen. Hides the bar for
   names with no brackets; otherwise ensures a bracket is loaded and paints the
   button row, highlighting whichever saved bracket is currently live. */
export function showChooser(){
  const nm = getName();
  if(!nm || !nameUnlocked(nm)){ bar.hidden = true; return; }

  const list = myBrackets();
  if(!list.length){ bar.hidden = true; return; }
  bar.hidden = false;

  // Is the page already showing one of this name's saved brackets, or a
  // brand-new in-progress bracket the user just started? If so, leave it.
  const liveIsSaved = list.some(s => s.bid === state.activeBid);
  const liveIsKnown = liveIsSaved || startedBids.has(state.activeBid);

  // Otherwise auto-load their default (official/newest) bracket. This is the
  // ONE place a bracket auto-loads — explicit, never a render side effect.
  if(!liveIsKnown){
    const sub = list.find(s => s.bid === defaultBid(list));
    if(sub) loadBracketFromSub(sub);
  }

  // Highlight the active button only when a saved bracket is live (a fresh
  // "New bracket" has no entry to highlight).
  const activeBid = list.some(s => s.bid === state.activeBid) ? state.activeBid : "";
  paintList(list, activeBid);
  syncOfficialToggle(list, activeBid);
}

function paintList(list, activeBid){
  const buttons = list.map(s=>{
    const active = s.bid === activeBid ? " active" : "";
    const tag = s.official ? `<span class="bx-tag">official</span>` : "";
    return `<button type="button" class="bx-btn${active}" data-bid="${esc(s.bid)}">
      <span class="bx-title">${esc(bracketTitle(s))}</span>${tag}
    </button>`;
  }).join("");
  listEl.innerHTML = buttons +
    `<button type="button" class="bx-btn bx-new" data-new="1">➕ New bracket</button>`;
}

/* The "make this official" toggle reflects the ACTIVE bracket. */
function syncOfficialToggle(list, activeBid){
  const cur = list.find(s => s.bid === activeBid);
  if(cur){
    makeOffWrap.hidden = false;
    makeOff.checked = !!cur.official;
    // an already-official bracket can't be un-officialed here
    makeOff.disabled = !!cur.official;
  } else {
    makeOffWrap.hidden = true;
    makeOff.checked = false;
  }
}

/* ---- wiring ----------------------------------------------------------- */
export function initChooser(){
  // One delegated click handler for the whole button row.
  listEl.addEventListener('click', e=>{
    const btn = e.target.closest('.bx-btn');
    if(!btn) return;
    if(btn.dataset.new){ startNewBracket(); startedBids.add(state.activeBid); showChooser(); return; }
    const bid = btn.dataset.bid;
    if(bid === state.activeBid){ return; }   // already showing it
    const sub = subsForName(getName()).find(s => s.bid === bid);
    if(sub) loadBracketFromSub(sub);
    showChooser();
  });

  // Turning the toggle on re-submits the active bracket as official (PIN-gated
  // via the submit dialog). It reconciles on the next submissions fetch.
  makeOff.addEventListener('change',()=>{
    if(!makeOff.checked) return;            // only act on turning it ON
    requestMakeOfficial();
  });

  document.getElementById('unlockConfirmBtn').addEventListener('click',()=> confirmUnlock());
  document.getElementById('unlockCancelBtn').addEventListener('click',()=> unlockDialog.close());
  // Enter in the PIN field confirms.
  unlockPinIn.addEventListener('keydown', e=>{
    if(e.key === "Enter"){ e.preventDefault(); confirmUnlock(); }
  });
}
