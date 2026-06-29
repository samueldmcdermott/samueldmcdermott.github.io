/* ============================================================
   Inline bracket chooser (Your-bracket tab). A dropdown of the
   current name's saved submissions + a "make this official"
   toggle. Replaces the old modal pop-up.
   ============================================================ */
import { state, getName, nameInput, esc, showToast, persistName, saveURL } from "./state.js";
import {
  subsForName, bracketTitle, loadBracketFromSub, startNewBracket
} from "./submissions.js";
import { requestMakeOfficial, establishedPinHash } from "./submit.js";
import { pinHashFor } from "./crypto.js";

const bar       = document.getElementById('chooserBar');
const select    = document.getElementById('bracketSelect');
const makeOff    = document.getElementById('makeOfficial');
const makeOffWrap = document.getElementById('makeOfficialWrap');

const unlockDialog   = document.getElementById('unlockDialog');
const unlockPinIn    = document.getElementById('unlockPin');
const unlockNameEcho = document.getElementById('unlockNameEcho');

const NEW = "__new__";

/* Has the typed name been verified (or does it need no PIN)? A name is gated
   when it has saved brackets carrying a PIN hash that hasn't been unlocked
   this session. */
function nameUnlocked(nm){
  const k = (nm||"").trim().toLowerCase();
  if(!k) return true;
  if(state.unlockedNames.has(k)) return true;
  return !establishedPinHash(nm);   // no PIN on record -> nothing to gate
}

/* Called when the name field settles. Existing PIN-protected names prompt for
   the PIN before their bracket is loaded; everything else loads as before. */
export function gateName(){
  const nm = getName();
  if(nm && subsForName(nm).length && !nameUnlocked(nm)){
    openUnlockDialog(nm);
    return;
  }
  refreshChooser();
}

function openUnlockDialog(nm){
  unlockPinIn.value = "";
  if(unlockNameEcho) unlockNameEcho.textContent = nm;
  if(typeof unlockDialog.showModal === "function"){
    unlockDialog.showModal();
    unlockPinIn.focus();
  } else {
    // No <dialog> support: fall back to loading (server-side PIN still protects writes).
    state.unlockedNames.add(nm.trim().toLowerCase());
    refreshChooser();
  }
}

async function confirmUnlock(){
  const nm = getName();
  const pin = (unlockPinIn.value || "").trim();
  if(!pin){ unlockPinIn.focus(); showToast("Enter the PIN"); return; }
  const established = establishedPinHash(nm);
  const h = await pinHashFor(nm, pin);
  if(h !== established){
    // Wrong PIN: the name belongs to someone else. Clear it and ask for a new one.
    unlockDialog.close();
    showToast("That name is taken — wrong PIN. Choose a different name.");
    nameInput.value = "";
    persistName(); saveURL();
    nameInput.focus();
    refreshChooser();           // hides the chooser bar for the now-empty name
    return;
  }
  state.unlockedNames.add(nm.trim().toLowerCase());
  unlockDialog.close();
  refreshChooser();             // auto-loads the unlocked bracket
}

/* Rebuild the dropdown for the current name. Hidden when the name has no
   saved brackets. Call after submissions load or the name changes. */
export function refreshChooser(){
  const nm = getName();
  const list = subsForName(nm)
    .slice()
    .sort((a,b)=> (b.submittedAt||"").localeCompare(a.submittedAt||""));

  if(!list.length){ bar.hidden = true; return; }
  bar.hidden = false;

  // Which option to show selected: the active bracket if it's one of theirs,
  // else the official one, else the newest.
  const activeInList = list.some(s => s.bid === state.activeBid);
  const official = list.find(s => s.official);
  const selectedBid = activeInList ? state.activeBid
                    : (official ? official.bid : list[0].bid);

  // option per bracket (official marked), plus a "new bracket" entry
  select.innerHTML = list.map(s=>{
    const tag = s.official ? " — official" : "";
    const sel = s.bid===selectedBid ? " selected" : "";
    return `<option value="${esc(s.bid)}"${sel}>${esc(bracketTitle(s))}${tag}</option>`;
  }).join("") + `<option value="${NEW}">➕ New bracket…</option>`;

  // A <select> fires no `change` event when populated programmatically, so the
  // option we just marked selected wouldn't load on its own. If that bracket
  // isn't already the live one — and the name is unlocked — load it now so the
  // dropdown and the rendered bracket stay in sync. Locked names wait for the
  // PIN gate (gateName) to admit them first.
  if(selectedBid && selectedBid !== state.activeBid && nameUnlocked(nm)){
    const sel = list.find(s => s.bid === selectedBid);
    if(sel) loadBracketFromSub(sel);
  }

  syncOfficialToggle(list);
}

/* Reflect whether the *selected dropdown option* is the official one. */
function syncOfficialToggle(list){
  const cur = list.find(s => s.bid === select.value);
  if(cur){
    makeOffWrap.hidden = false;
    makeOff.checked = !!cur.official;
    // already-official can't be un-officialed here (pick another to switch)
    makeOff.disabled = !!cur.official;
  } else {
    // "New bracket…" selected: nothing to promote until it's submitted
    makeOffWrap.hidden = true;
    makeOff.checked = false;
  }
}

export function initChooser(){
  select.addEventListener('change',()=>{
    const v = select.value;
    if(v === NEW){ startNewBracket(); refreshChooser(); return; }
    const s = subsForName(getName()).find(x => x.bid === v);
    if(s) loadBracketFromSub(s);
    refreshChooser();
  });

  // Turning the toggle on re-submits the selected bracket as official (PIN-gated
  // via the submit dialog). It reconciles on the next submissions fetch.
  makeOff.addEventListener('change',()=>{
    if(!makeOff.checked) return;            // only act on turning it ON
    requestMakeOfficial();
  });

  document.getElementById('unlockConfirmBtn').addEventListener('click',()=> confirmUnlock());
  document.getElementById('unlockCancelBtn').addEventListener('click',()=>{
    // Cancelled: leave the name in place but don't load anyone's bracket.
    unlockDialog.close();
  });
}
