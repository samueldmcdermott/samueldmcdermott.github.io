/* ============================================================
   Official bracket — the live tournament bracket per the latest
   confirmed results, shown in common (no name, no editing). Mirrors
   the layout of the personal bracket in view.js, but resolves every
   slot from state.results via the "official*" helpers in tree.js.
   ============================================================ */
import { CODES, R32, TREE } from "./state.js";
import { state } from "./state.js";
import {
  allMatches, officialSideTeam, officialWinnerOf
} from "./tree.js";

const offEl = document.getElementById('officialBracket');

function codeFor(team){ return CODES[team.name] || "TBD"; }

/* A side is "advanced" when the official result picked it as winner. */
function offSlotHTML(team, matchId, side){
  if(!team){
    return `<div class="slot placeholder">
      <span class="code">—</span><span class="nm">Awaiting result</span></div>`;
  }
  const won = state.results[matchId] === side;
  let cls = "slot static";
  if(won) cls += " win";
  if(team.tbd) cls += " projected";   // name projected, slot not yet locked
  const watermark = won ? `<span class="code-bg" aria-hidden="true">${codeFor(team)}</span>` : "";
  return `<div class="${cls}">
      ${watermark}
      <span class="code">${codeFor(team)}</span>
      <span class="nm">${team.name}</span>
      <span class="seedtag">${team.seed||""}</span>
    </div>`;
}

function offMatchHTML(matchId){
  const m = allMatches[matchId];
  const aT = officialSideTeam(m,"a"), bT = officialSideTeam(m,"b");
  return `<div class="match" data-mid="${matchId}">
    <span class="mno">M${matchId}</span>
    ${offSlotHTML(aT, matchId, "a")}
    ${offSlotHTML(bT, matchId, "b")}
  </div>`;
}

function offColHTML(title, pts, ids){
  return `<div class="col">
    <div class="col-head">${title}<span class="pts">${pts}</span></div>
    ${ids.map(offMatchHTML).join("")}
  </div>`;
}

/* Third-place: losers of the two semis, winner per the official result. */
function offThirdHTML(){
  const loser = (semiId) => {
    const r = state.results[semiId];
    if(!r) return null;
    const m = allMatches[semiId];
    return r==="a" ? officialSideTeam(m,"b") : officialSideTeam(m,"a");
  };
  const loserA = loser(101), loserB = loser(102);
  const tpWin = state.results["103"];
  function tpSlot(team, side){
    if(!team) return `<div class="slot placeholder"><span class="code">—</span><span class="nm">Awaiting semis</span></div>`;
    const won = tpWin===side;
    const cls = won ? "slot static win":"slot static";
    const watermark = won ? `<span class="code-bg" aria-hidden="true">${codeFor(team)}</span>` : "";
    return `<div class="${cls}">${watermark}<span class="code">${codeFor(team)}</span><span class="nm">${team.name}</span><span class="seedtag">SF loser</span></div>`;
  }
  return `<div class="third-card">
    <div class="col-head">Third place</div>
    <div class="match" data-mid="103"><span class="mno">M103</span>
      ${tpSlot(loserA,"a")}
      ${tpSlot(loserB,"b")}
    </div>
  </div>`;
}

export function renderOfficial(){
  if(!offEl) return;
  const cols = [];
  cols.push(offColHTML("Round of 32","16 ties · 1 pt", R32.map(m=>m.id)));
  cols.push(offColHTML("Round of 16","2 pts", TREE.r16.map(x=>x.id)));
  cols.push(offColHTML("Quarter-finals","4 pts", TREE.qf.map(x=>x.id)));
  cols.push(offColHTML("Semi-finals","8 pts", TREE.sf.map(x=>x.id)));

  const champ = officialWinnerOf(TREE.final.id);
  const champHTML = `
    <div class="champ-wrap">
      <div class="clbl">Champion</div>
      <div class="champ-name ${champ?'':'empty'}">
        ${champ ? `<span class="tro">🏆</span> <span class="champ-code">${codeFor(champ)}</span> ${champ.name}` : 'Not yet decided'}
      </div>
    </div>`;
  cols.push(`<div class="col final-col">
      <div class="col-head">Final<span class="pts">16 pts</span></div>
      ${offMatchHTML(TREE.final.id)}
      ${champHTML}
      ${offThirdHTML()}
  </div>`);

  offEl.innerHTML = cols.join("");
}
