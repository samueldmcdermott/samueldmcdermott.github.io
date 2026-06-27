/* ============================================================
   World Cup 2026 Knockout Bracket — entry point.
   Loaded as a module (after data.js publishes window.WC); wires
   the page together and kicks off the initial render + fetches.
   ============================================================ */
import {
  state, nameInput, persistName, saveURL, showToast, loadURL
} from "./state.js";
import { render } from "./view.js";
import { loadSubmissions, loadResults } from "./submissions.js";
import { initSubmit } from "./submit.js";
import { initChooser, refreshChooser } from "./chooser.js";
import { loadLeaderboard, initTabs } from "./leaderboard.js";

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

  // persist the name as it's typed; refresh the bracket dropdown when it settles
  nameInput.addEventListener('input',()=>{ persistName(); saveURL(); });
  nameInput.addEventListener('change',()=>{ refreshChooser(); });
}

/* ---- init ---- */
loadURL();
render();
initToolbar();
initSubmit();
initChooser();
initTabs();
loadResults();
loadLeaderboard();
// Populate the inline bracket dropdown once submissions are loaded.
loadSubmissions().then(()=>{ refreshChooser(); });
