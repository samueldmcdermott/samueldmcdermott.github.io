/* ============================================================
   World Cup 2026 Knockout Bracket — LOGIC
   Reads data from window.WC (see data.js).
   ============================================================ */
(function(){
  const { FLAGS, R32, TREE, POINTS, ROUND_LABEL, ROUND_MAX } = window.WC;

  /* picks[matchId] = "a" | "b"  (which side advanced) */
  let picks = {};

  /* ---- flat registry of every match with side references ---- */
  let allMatches = {};
  function buildMatches(){
    allMatches = {};
    R32.forEach(m=>{
      allMatches[m.id] = {
        id:m.id, round:"r32",
        aRef:{type:"team", team:m.a},
        bRef:{type:"team", team:m.b}
      };
    });
    const add=(round, list)=>list.forEach(x=>{
      allMatches[x.id]={
        id:x.id, round,
        aRef:{type:"winner", match:x.from[0]},
        bRef:{type:"winner", match:x.from[1]}
      };
    });
    add("r16",TREE.r16); add("qf",TREE.qf); add("sf",TREE.sf);
    allMatches[TREE.final.id]={
      id:TREE.final.id, round:"final",
      aRef:{type:"winner",match:TREE.final.from[0]},
      bRef:{type:"winner",match:TREE.final.from[1]}
    };
  }
  buildMatches();

  /* ---- resolve teams through the tree ---- */
  function sideTeam(m, side){
    const ref = side==="a" ? m.aRef : m.bRef;
    if(ref.type==="team") return ref.team;
    return winnerOf(ref.match);
  }
  function winnerOf(matchId){
    const m = allMatches[matchId];
    if(!m) return null;
    const side = picks[matchId];
    if(!side) return null;
    return sideTeam(m, side);
  }
  function loserOf(matchId){
    const m=allMatches[matchId];
    if(!picks[matchId]) return null;
    return picks[matchId]==="a" ? sideTeam(m,"b") : sideTeam(m,"a");
  }

  /* ---- clear downstream picks whose team no longer resolves ---- */
  function propagate(){
    const order = [...TREE.r16, ...TREE.qf, ...TREE.sf, TREE.final].map(x=>x.id);
    let changed = true;
    while(changed){
      changed=false;
      order.forEach(id=>{
        if(!picks[id]) return;
        const m=allMatches[id];
        const chosen = picks[id]==="a"? sideTeam(m,"a"): sideTeam(m,"b");
        if(!chosen){ delete picks[id]; changed=true; }
      });
    }
  }

  /* ============================================================
     RENDER
     ============================================================ */
  const bracketEl = document.getElementById('bracket');

  function flagFor(team){ return team.tbd ? "🏳️" : (FLAGS[team.name]||"⚽"); }

  function slotHTML(team, matchId, side, isWin){
    if(!team){
      return `<button class="slot placeholder" data-noclick="1">
        <span class="flag">—</span><span class="nm">Awaiting result</span></button>`;
    }
    const cls = isWin ? "slot win" : "slot";
    return `<button class="${cls}" data-match="${matchId}" data-side="${side}">
        <span class="flag">${flagFor(team)}</span>
        <span class="nm">${team.name}</span>
        <span class="seedtag">${team.seed||""}</span>
      </button>`;
  }

  function matchHTML(matchId){
    const m = allMatches[matchId];
    const aT = sideTeam(m,"a"), bT = sideTeam(m,"b");
    const pick = picks[matchId];
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
    const tpPick = picks["103"];
    function tpSlot(team, side){
      if(!team) return `<button class="slot placeholder" data-noclick="1"><span class="flag">—</span><span class="nm">Awaiting semis</span></button>`;
      const cls = tpPick===side ? "slot win":"slot";
      return `<button class="${cls}" data-third="${side}"><span class="flag">${flagFor(team)}</span><span class="nm">${team.name}</span><span class="seedtag">SF loser</span></button>`;
    }
    return `<div class="third-card">
      <div class="col-head">Third place</div>
      <div class="match" data-mid="103"><span class="mno">M103</span>
        ${tpSlot(loserA,"a")}
        ${tpSlot(loserB,"b")}
      </div>
    </div>`;
  }

  function render(){
    propagate();
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
          ${champ ? `<span class="tro">🏆</span> ${flagFor(champ)} ${champ.name}` : 'Pick the final'}
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
        if(picks[id]===side){ delete picks[id]; }
        else { picks[id]=side; }
        if(m.round==="sf"){ delete picks["103"]; }
        saveURL(); render();
      });
    });
    bracketEl.querySelectorAll('.slot[data-third]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const side=btn.dataset.third;
        const team = side==="a"? loserOf(101): loserOf(102);
        if(!team) return;
        if(picks["103"]===side) delete picks["103"]; else picks["103"]=side;
        saveURL(); render();
      });
    });
  }

  /* ============================================================
     SCORING — "max points picked" = sum of each filled match's
     round value (the points at stake on that pick).
     ============================================================ */
  function updateScore(){
    let total=0;
    const tally={r32:0,r16:0,qf:0,sf:0,final:0};
    Object.keys(picks).forEach(id=>{
      if(id==="103") return;             // third place sits outside the scheme
      const m=allMatches[id];
      if(!m) return;
      total += POINTS[m.round];
      tally[m.round]++;
    });
    document.getElementById('totalScore').textContent = total;
    const mini = document.getElementById('roundsMini');
    mini.innerHTML = Object.keys(ROUND_LABEL).map(r=>
      `<span class="rmini">${shortR(r)} <b>${tally[r]}/${ROUND_MAX[r]}</b></span>`
    ).join("");
  }
  function shortR(r){return {r32:"R32",r16:"R16",qf:"QF",sf:"SF",final:"F"}[r];}

  /* ============================================================
     URL SHARE — compact encoding of picks
     ============================================================ */
  function saveURL(){
    const parts=[];
    Object.keys(picks).forEach(id=>{ parts.push(id+picks[id]); });
    const enc = parts.join(",");
    const u = new URL(window.location.href);
    if(enc) u.searchParams.set("p", enc); else u.searchParams.delete("p");
    history.replaceState(null,"",u.toString());
  }
  function loadURL(){
    const u=new URL(window.location.href);
    const p=u.searchParams.get("p");
    if(!p) return;
    p.split(",").forEach(tok=>{
      const side = tok.slice(-1);
      const id = tok.slice(0,-1);
      if((side==="a"||side==="b") && id) picks[id]=side;
    });
  }

  /* ---- toast + buttons ---- */
  function showToast(msg){
    const el=document.getElementById('toast');
    el.textContent=msg||"Share link copied";
    el.classList.add('show');
    setTimeout(()=>el.classList.remove('show'),1600);
  }
  function fallbackCopy(text){
    const t=document.createElement('textarea');t.value=text;document.body.appendChild(t);
    t.select();try{document.execCommand('copy');}catch(e){}t.remove();showToast();
  }
  document.getElementById('copyBtn').addEventListener('click',()=>{
    saveURL();
    const url=window.location.href;
    if(navigator.clipboard){
      navigator.clipboard.writeText(url).then(()=>showToast(), ()=>fallbackCopy(url));
    } else { fallbackCopy(url); }
  });
  document.getElementById('resetBtn').addEventListener('click',()=>{
    picks={}; saveURL(); render(); showToast("Bracket reset");
  });

  /* ---- init ---- */
  loadURL();
  render();
})();
