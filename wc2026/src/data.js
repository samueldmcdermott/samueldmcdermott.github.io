/* ============================================================
   World Cup 2026 Knockout Bracket — DATA
   ------------------------------------------------------------
   Edit this file to update teams as group-stage results are
   confirmed. The bracket logic in bracket.js reads from here
   and needs no changes when you swap a placeholder for a team.

   To confirm a team: change P("Name","seed") -> T("Name","seed")
   (T = confirmed team, P = projected/placeholder slot).
   Add a flag emoji to FLAGS if the team isn't listed yet.
   ============================================================ */

/* Three-letter FIFA-style country codes, rendered as text badges.
   (Emoji flags were dropped — they fail to render on Windows and for the
   subdivision flags of England/Scotland, so plain codes are used instead.) */
const CODES = {
  "South Africa":"RSA","Canada":"CAN","Brazil":"BRA","Japan":"JPN","Germany":"GER",
  "Paraguay":"PAR","Netherlands":"NED","Morocco":"MAR","Ivory Coast":"CIV","Norway":"NOR",
  "France":"FRA","Sweden":"SWE","Mexico":"MEX","Ecuador":"ECU","England":"ENG",
  "Cabo Verde":"CPV","Egypt":"EGY","DR Congo":"COD","United States":"USA","Bosnia and Herzegovina":"BIH",
  "Spain":"ESP","Austria":"AUT","Switzerland":"SUI","Belgium":"BEL","Portugal":"POR",
  "Ghana":"GHA","Australia":"AUS","Senegal":"SEN","Argentina":"ARG","Algeria":"ALG",
  "Colombia":"COL","Croatia":"CRO"
};

/* helpers: T = confirmed team, P = projected placeholder slot */
function T(name, seed){ return {name, seed, tbd:false}; }
function P(name, seed){ return {name, seed, tbd:true}; }

/* Round of 32 — ordered to match the bracket tree top-to-bottom.
   This sequence is the canonical spatial order: walking TREE from the Final
   down (top feeder first) places every later-round match between its two
   feeders. Reorder here (not the logic) if the tree ever changes.
   Each match: { id, a, b } */
const R32 = [
  {id:74, a:T("Germany","1E"),       b:T("Paraguay","3D")},
  {id:77, a:T("France","1I"),        b:T("Sweden","3F")},
  {id:73, a:T("South Africa","2A"),  b:T("Canada","2B")},
  {id:75, a:T("Netherlands","1F"),   b:T("Morocco","2C")},
  {id:83, a:T("Portugal","2K"),      b:T("Croatia","2L")},
  {id:84, a:T("Spain","1H"),         b:T("Austria","2J")},
  {id:81, a:T("United States","1D"), b:T("Bosnia and Herzegovina","3B")},
  {id:82, a:T("Belgium","1G"),       b:T("Senegal","3I")},
  {id:76, a:T("Brazil","1C"),        b:T("Japan","2F")},
  {id:78, a:T("Ivory Coast","2E"),   b:T("Norway","2I")},
  {id:79, a:T("Mexico","1A"),        b:T("Ecuador","3E")},
  {id:80, a:T("England","1L"),       b:T("DR Congo","3K")},
  {id:86, a:T("Argentina","1J"),     b:T("Cabo Verde","2H")},
  {id:88, a:T("Australia","2D"),     b:T("Egypt","2G")},
  {id:85, a:T("Switzerland","1B"),   b:T("Algeria","3J")},
  {id:87, a:T("Colombia","1K"),      b:T("Ghana","3L")}
];

/* Fixed bracket tree (FIFA published Round-of-32 paths).
   `from` lists the two feeder match ids whose winners meet. */
const TREE = {
  r16:[
    {id:89, from:[74,77]},
    {id:90, from:[73,75]},
    {id:93, from:[83,84]},
    {id:94, from:[81,82]},
    {id:91, from:[76,78]},
    {id:92, from:[79,80]},
    {id:95, from:[86,88]},
    {id:96, from:[85,87]}
  ],
  qf:[
    {id:97,  from:[89,90]},
    {id:98,  from:[93,94]},
    {id:99,  from:[91,92]},
    {id:100, from:[95,96]}
  ],
  sf:[
    {id:101, from:[97,98]},
    {id:102, from:[99,100]}
  ],
  final:{id:104, from:[101,102]},
  third:{id:103, from:[101,102]}   // third-place playoff = losers of the semis
};

/* Conventional exponentially-rising scoring */
const POINTS = {r32:1, r16:2, qf:4, sf:8, final:16};
const ROUND_LABEL = {r32:"Round of 32", r16:"Round of 16", qf:"Quarter-finals", sf:"Semi-finals", final:"Final"};
const ROUND_MAX  = {r32:16, r16:8, qf:4, sf:2, final:1};

/* expose for bracket.js */
window.WC = { CODES, R32, TREE, POINTS, ROUND_LABEL, ROUND_MAX };
