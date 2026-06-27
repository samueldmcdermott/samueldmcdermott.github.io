/* ============================================================
   Leaderboard fetch/render and the Bracket / Leaderboard tabs.
   ============================================================ */
import { state, getName, esc, fmtUpdated } from "./state.js";

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
    return `<li class="lb-row${mine}">
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
function showView(view){
  const isLb = view === "leaderboard";
  document.body.classList.toggle("show-leaderboard", isLb);
  document.body.classList.toggle("show-bracket", !isLb);
  document.querySelectorAll('.tab').forEach(t=>{
    const on = t.dataset.view === (isLb ? "leaderboard" : "bracket");
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', on);
  });
  if(isLb) loadLeaderboard();
}

export function initTabs(){
  document.querySelectorAll('.tab').forEach(t=>{
    t.addEventListener('click',()=>{
      const v = t.dataset.view;
      // keep picks/name params; just change the hash
      const u = new URL(window.location.href);
      u.hash = v === "leaderboard" ? "leaderboard" : "bracket";
      history.pushState(null,"",u.toString());
      showView(v);
    });
  });
  window.addEventListener('hashchange',()=>{
    showView(location.hash.replace('#','') || "bracket");
  });
  showView(location.hash.replace('#','') || "bracket");
}
