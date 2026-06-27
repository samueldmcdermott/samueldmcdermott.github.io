/* ============================================================
   Bracket tree logic — resolving teams through the bracket from
   the user's picks and from the official results. Pure logic over
   state.picks / state.results; no DOM.
   ============================================================ */
import { state, R32, TREE } from "./state.js";

/* ---- flat registry of every match with side references ---- */
export const allMatches = {};
(function buildMatches(){
  R32.forEach(m=>{
    allMatches[m.id] = {
      id:m.id, round:"r32",
      aRef:{type:"team", team:m.a},
      bRef:{type:"team", team:m.b}
    };
  });
  const add = (round, list) => list.forEach(x=>{
    allMatches[x.id] = {
      id:x.id, round,
      aRef:{type:"winner", match:x.from[0]},
      bRef:{type:"winner", match:x.from[1]}
    };
  });
  add("r16", TREE.r16); add("qf", TREE.qf); add("sf", TREE.sf);
  allMatches[TREE.final.id] = {
    id:TREE.final.id, round:"final",
    aRef:{type:"winner", match:TREE.final.from[0]},
    bRef:{type:"winner", match:TREE.final.from[1]}
  };
})();

/* ---- resolve teams through the tree using the USER's picks ---- */
export function sideTeam(m, side){
  const ref = side==="a" ? m.aRef : m.bRef;
  if(ref.type==="team") return ref.team;
  return winnerOf(ref.match);
}
export function winnerOf(matchId){
  const m = allMatches[matchId];
  if(!m) return null;
  const side = state.picks[matchId];
  if(!side) return null;
  return sideTeam(m, side);
}
export function loserOf(matchId){
  const m = allMatches[matchId];
  if(!state.picks[matchId]) return null;
  return state.picks[matchId]==="a" ? sideTeam(m,"b") : sideTeam(m,"a");
}

/* ---- resolve the REAL team at each slot using OFFICIAL results ----
   Independent of the user's picks. */
export function officialSideTeam(m, side){
  const ref = side==="a" ? m.aRef : m.bRef;
  if(ref.type==="team") return ref.team;
  return officialWinnerOf(ref.match);
}
export function officialWinnerOf(matchId){
  const m = allMatches[matchId];
  if(!m) return null;
  const side = state.results[matchId];
  if(!side) return null;
  return officialSideTeam(m, side);
}
/* Set of team names eliminated by an official result (lost a decided match). */
export function eliminatedTeams(){
  const dead = new Set();
  Object.keys(state.results).forEach(id=>{
    const m = allMatches[id];
    if(!m) return;
    const loseSide = state.results[id]==="a" ? "b" : "a";
    const t = officialSideTeam(m, loseSide);
    if(t && !t.tbd) dead.add(t.name);
  });
  return dead;
}

/* ---- clear downstream picks whose team no longer resolves ---- */
export function propagate(){
  const order = [...TREE.r16, ...TREE.qf, ...TREE.sf, TREE.final].map(x=>x.id);
  let changed = true;
  while(changed){
    changed = false;
    order.forEach(id=>{
      if(!state.picks[id]) return;
      const m = allMatches[id];
      const chosen = state.picks[id]==="a" ? sideTeam(m,"a") : sideTeam(m,"b");
      if(!chosen){ delete state.picks[id]; changed = true; }
    });
  }
}
