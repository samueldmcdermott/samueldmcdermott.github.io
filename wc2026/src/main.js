/* ============================================================
   World Cup 2026 Knockout Bracket — entry point.
   Loaded as a module (after data.js publishes window.WC); wires
   the page together and kicks off the initial render + fetches.
   ============================================================ */
import {
  state, nameInput, persistName, saveURL, showToast, loadURL, FROZEN
} from "./state.js";
import { render } from "./view.js";
import { loadSubmissions, loadResults } from "./submissions.js";
import { initSubmit } from "./submit.js";
import { initChooser, gateName } from "./chooser.js";
import { loadLeaderboard, initTabs } from "./leaderboard.js";
import { initPicker, showPicker, viewBracketByBid } from "./picker.js";

/* ---- copy share link + reset ---- */
function fallbackCopy(text){
  const t = document.createElement('textarea');
  t.value = text; document.body.appendChild(t);
  t.select(); try { document.execCommand('copy'); } catch(e){} t.remove();
  showToast();
}
function initToolbar(){
  document.getElementById('copyBtn').addEventListener('click',()=>{
    saveURL();
    const url = window.location.href;
    if(navigator.clipboard){
      navigator.clipboard.writeText(url).then(()=>showToast(), ()=>fallbackCopy(url));
    } else { fallbackCopy(url); }
  });
  document.getElementById('resetBtn').addEventListener('click',()=>{
    Object.keys(state.picks).forEach(k => delete state.picks[k]);
    saveURL(); render(); showToast("Bracket reset");
  });

  // persist the name as it's typed; PIN-gate + refresh the dropdown when it settles
  nameInput.addEventListener('input',()=>{ persistName(); saveURL(); });
  nameInput.addEventListener('change',()=>{ gateName(); });
}

/* ---- init ---- */
loadURL();
render();
initTabs();
loadResults();
loadLeaderboard();

if(FROZEN){
  // Submissions are closed: hide all editing UI (CSS handles it via body.frozen,
  // which beats the .scorebar/.chooserbar display rules) and run the picker.
  document.body.classList.add('frozen');
  initPicker();
  // Once submissions + leaderboard land, fill the picker and open a default
  // bracket (the one shared via ?bid=, else the top official entry).
  loadSubmissions().then(()=>{
    showPicker();
    const wanted = state.activeBid && state.allSubs.some(s => s.bid === state.activeBid)
      ? state.activeBid
      : defaultViewBid();
    if(wanted) viewBracketByBid(wanted);
  });
} else {
  // Live entry mode.
  initToolbar();
  initSubmit();
  initChooser();
  // Once submissions are loaded, populate the dropdown. If the page opened with
  // a remembered/shared name that's PIN-protected, gateName() prompts for the
  // PIN before loading that name's bracket.
  loadSubmissions().then(()=>{ gateName(); });
}

/* The bracket to open by default in frozen mode: highest-scoring official one. */
function defaultViewBid(){
  const officials = state.allSubs.filter(s => s.official);
  if(!officials.length) return "";
  officials.sort((a,b)=>{
    const sa = state.lbByBid[a.bid]?.score ?? 0;
    const sb = state.lbByBid[b.bid]?.score ?? 0;
    return sb - sa;
  });
  return officials[0].bid;
}
