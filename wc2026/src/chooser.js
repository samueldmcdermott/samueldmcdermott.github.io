/* ============================================================
   Inline bracket chooser (Your-bracket tab). A dropdown of the
   current name's saved submissions + a "make this official"
   toggle. Replaces the old modal pop-up.
   ============================================================ */
import { state, getName, esc } from "./state.js";
import {
  subsForName, bracketTitle, loadBracketFromSub, startNewBracket
} from "./submissions.js";
import { requestMakeOfficial } from "./submit.js";

const bar       = document.getElementById('chooserBar');
const select    = document.getElementById('bracketSelect');
const makeOff    = document.getElementById('makeOfficial');
const makeOffWrap = document.getElementById('makeOfficialWrap');

const NEW = "__new__";

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
}
