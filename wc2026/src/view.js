/* ============================================================
   Rendering the bracket, click interaction, and the live
   "max points picked" score readout.
   ============================================================ */
import {
  state, CODES, R32, TREE, POINTS, ROUND_LABEL, ROUND_MAX, saveURL
} from "./state.js";
import {
  allMatches, sideTeam, winnerOf, loserOf, eliminatedTeams, propagate
} from "./tree.js";

const bracketEl = document.getElementById('bracket');

/* Real 3-letter code when we know the team (even projected slots carry a
   projected name); only genuinely unknown names fall back to "TBD". */
function codeFor(team){ return CODES[team.name] || "TBD"; }

/* status of a picked side, given official results:
     'correct'    -> this pick won its own match per the official result
     'wrong'      -> this pick lost its own match per the official result
     'eliminated' -> the advanced team lost earlier (can no longer be here)
     ''           -> fine / undecided */
function pickStatus(team, matchId, isWin){
  if(!isWin || !team || team.tbd) return "";
  const r = state.results[matchId];
  if(r) return r === state.picks[matchId] ? "correct" : "wrong";
  if(state.deadSet.has(team.name)) return "eliminated";
  return "";
}

function slotHTML(team, matchId, side, isWin){
  if(!team){
    return `<button class="slot placeholder" data-noclick="1">
      <span class="code">—</span><span class="nm">Awaiting result</span></button>`;
  }
  const status = pickStatus(team, matchId, isWin);   // '', 'correct', 'wrong', 'eliminated'
  let cls = "slot";
  if(isWin) cls += " win";
  if(team.tbd) cls += " projected";   // name known but slot not yet locked
  // 'correct' is a live, still-standing pick; 'wrong'/'eliminated' are busted
  if(status==="correct") cls += " correct";
  else if(status) cls += " dead " + status;
  // low-opacity code watermark shown only once this side has been picked
  const watermark = isWin ? `<span class="code-bg" aria-hidden="true">${codeFor(team)}</span>` : "";
  const mark = status==="correct" ? "✓" : "✕";
  const xmark = status ? `<span class="xmark" aria-hidden="true">${mark}</span>` : "";
  return `<button class="${cls}" data-match="${matchId}" data-side="${side}">
      ${watermark}
      <span class="code">${codeFor(team)}</span>
      <span class="nm">${team.name}</span>
      ${xmark}
      <span class="seedtag">${team.seed||""}</span>
    </button>`;
}

function matchHTML(matchId){
  const m = allMatches[matchId];
  const aT = sideTeam(m,"a"), bT = sideTeam(m,"b");
  const pick = state.picks[matchId];
  return `<div class="match" data-mid="${matchId}">
    <span class="mno">M${matchId}</span>
    ${slotHTML(aT, matchId, "a", pick==="a")}
    ${slotHTML(bT, matchId, "b", pick==="b")}
  </div>`;
}

function colHTML(title, pts, ids){
  return `<div class="col">
    <div class="col-head">${title}<span class="pts">${pts}</span></div>
    ${ids.map(matchHTML).join("")}
  </div>`;
}

function thirdPlaceHTML(){
  const loserA = loserOf(101), loserB = loserOf(102);
  const tpPick = state.picks["103"];
  function tpSlot(team, side){
    if(!team) return `<button class="slot placeholder" data-noclick="1"><span class="code">—</span><span class="nm">Awaiting semis</span></button>`;
    const isWin = tpPick===side;
    const cls = isWin ? "slot win":"slot";
    const watermark = isWin ? `<span class="code-bg" aria-hidden="true">${codeFor(team)}</span>` : "";
    return `<button class="${cls}" data-third="${side}">${watermark}<span class="code">${codeFor(team)}</span><span class="nm">${team.name}</span><span class="seedtag">SF loser</span></button>`;
  }
  return `<div class="third-card">
    <div class="col-head">Third place</div>
    <div class="match" data-mid="103"><span class="mno">M103</span>
      ${tpSlot(loserA,"a")}
      ${tpSlot(loserB,"b")}
    </div>
  </div>`;
}

export function render(){
  propagate();
  state.deadSet = eliminatedTeams();
  const cols = [];
  cols.push(colHTML("Round of 32","16 ties · 1 pt", R32.map(m=>m.id)));
  cols.push(colHTML("Round of 16","2 pts", TREE.r16.map(x=>x.id)));
  cols.push(colHTML("Quarter-finals","4 pts", TREE.qf.map(x=>x.id)));
  cols.push(colHTML("Semi-finals","8 pts", TREE.sf.map(x=>x.id)));

  const finalMatch = matchHTML(TREE.final.id);
  const champ = winnerOf(TREE.final.id);
  const champHTML = `
    <div class="champ-wrap">
      <div class="clbl">Champion</div>
      <div class="champ-name ${champ?'':'empty'}">
        ${champ ? `<span class="tro">🏆</span> <span class="champ-code">${codeFor(champ)}</span> ${champ.name}` : 'Pick the final'}
      </div>
    </div>`;
  cols.push(`<div class="col final-col">
      <div class="col-head">Final<span class="pts">16 pts</span></div>
      ${finalMatch}
      ${champHTML}
      ${thirdPlaceHTML()}
  </div>`);

  bracketEl.innerHTML = cols.join("");
  attachHandlers();
  updateScore();
}

/* ============================================================
   INTERACTION
   ============================================================ */
function attachHandlers(){
  bracketEl.querySelectorAll('.slot[data-match]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const id = btn.dataset.match;
      const side = btn.dataset.side;
      const m = allMatches[id];
      const team = sideTeam(m, side);
      if(!team) return;
      if(state.picks[id]===side){ delete state.picks[id]; }
      else { state.picks[id]=side; }
      if(m.round==="sf"){ delete state.picks["103"]; }
      saveURL(); render();
    });
  });
  bracketEl.querySelectorAll('.slot[data-third]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const side = btn.dataset.third;
      const team = side==="a" ? loserOf(101) : loserOf(102);
      if(!team) return;
      if(state.picks["103"]===side) delete state.picks["103"]; else state.picks["103"]=side;
      saveURL(); render();
    });
  });
}

/* ============================================================
   SCORING readout — "max points picked" = sum of each filled
   match's round value (the points at stake on that pick).
   ============================================================ */
function shortR(r){ return {r32:"R32",r16:"R16",qf:"QF",sf:"SF",final:"F"}[r]; }
function updateScore(){
  let total = 0;
  const tally = {r32:0,r16:0,qf:0,sf:0,final:0};
  Object.keys(state.picks).forEach(id=>{
    if(id==="103") return;             // third place sits outside the scheme
    const m = allMatches[id];
    if(!m) return;
    total += POINTS[m.round];
    tally[m.round]++;
  });
  document.getElementById('totalScore').textContent = total;
  document.getElementById('roundsMini').innerHTML = Object.keys(ROUND_LABEL).map(r=>
    `<span class="rmini">${shortR(r)} <b>${tally[r]}/${ROUND_MAX[r]}</b></span>`
  ).join("");
}
