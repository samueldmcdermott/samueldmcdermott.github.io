/* ============================================================
   Leaderboard fetch/render and the Bracket / Leaderboard tabs.
   ============================================================ */
import { state, getName, esc, fmtUpdated, FROZEN } from "./state.js";
import { renderOfficial } from "./official.js";
import { viewBracketByBid } from "./picker.js";

export function renderLeaderboard(data){
  const listEl = document.getElementById('lbList');
  const updEl  = document.getElementById('lbUpdated');
  const entries = (data && Array.isArray(data.entries)) ? data.entries : [];
  // index scores by bid so the bracket chooser can show them
  state.lbByBid = {};
  entries.forEach(e=>{ if(e.bid) state.lbByBid[e.bid]=e; });
  updEl.textContent = (data && data.updatedAt) ? fmtUpdated(data.updatedAt) : "";
  const colhead = document.getElementById('lbColhead');
  if(!entries.length){
    if(colhead) colhead.hidden = true;
    listEl.innerHTML = `<li class="lb-empty">No brackets scored yet — be the first to submit.</li>`;
    return;
  }
  if(colhead) colhead.hidden = false;
  const me = getName().toLowerCase();
  listEl.innerHTML = entries.map((e,i)=>{
    const mine = me && String(e.user||"").toLowerCase()===me ? " mine" : "";
    const final = e.finalPick ? esc(e.finalPick) : "—";
    const max = (e.maxPossible!=null) ? e.maxPossible : "";
    // frozen: rows are clickable to open that bracket in the Picks tab
    const clickable = (FROZEN && e.bid) ? " lb-clickable" : "";
    const bidAttr = e.bid ? ` data-bid="${esc(e.bid)}"` : "";
    return `<li class="lb-row${mine}${clickable}"${bidAttr}>
      <span class="lb-rank">${i+1}</span>
      <span class="lb-name">${esc(e.user||"—")}</span>
      <span class="lb-final">${final}</span>
      <span class="lb-max">${max}</span>
      <span class="lb-score">${e.score!=null?e.score:0}</span>
    </li>`;
  }).join("");
}

export function loadLeaderboard(){
  return fetch("leaderboard.json", {cache:"no-store"})
    .then(r=> r.ok ? r.json() : null)
    .then(renderLeaderboard)
    .catch(()=>renderLeaderboard(null));
}

/* ============================================================
   TABS — "Your Bracket" (landing) and "Leaderboard", with the
   active view reflected in the URL hash so Back/links work.
   ============================================================ */
const VIEWS = ["bracket", "official", "leaderboard"];
function normView(v){ return VIEWS.includes(v) ? v : "bracket"; }

function showView(view){
  const v = normView(view);
  document.body.classList.toggle("show-bracket", v === "bracket");
  document.body.classList.toggle("show-official", v === "official");
  document.body.classList.toggle("show-leaderboard", v === "leaderboard");
  document.querySelectorAll('.tab').forEach(t=>{
    const on = t.dataset.view === v;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  if(v === "leaderboard") loadLeaderboard();
  if(v === "official") renderOfficial();
}

/* Switch the active view AND reflect it in the URL hash (so Back works). */
function gotoView(v){
  const u = new URL(window.location.href);
  u.hash = normView(v);
  history.pushState(null,"",u.toString());
  showView(v);
}

export function initTabs(){
  // Frozen: clicking a leaderboard row opens that bracket in the Picks tab.
  if(FROZEN){
    const lbList = document.getElementById('lbList');
    if(lbList) lbList.addEventListener('click', e=>{
      const row = e.target.closest('.lb-row[data-bid]');
      if(!row) return;
      viewBracketByBid(row.dataset.bid);
      gotoView("bracket");
    });
  }
  document.querySelectorAll('.tab').forEach(t=>{
    t.addEventListener('click',()=>{
      // keep picks/name params; just change the hash
      const u = new URL(window.location.href);
      u.hash = normView(t.dataset.view);
      history.pushState(null,"",u.toString());
      showView(t.dataset.view);
    });
  });
  window.addEventListener('hashchange',()=>{
    showView(location.hash.replace('#',''));
  });
  showView(location.hash.replace('#',''));
}
