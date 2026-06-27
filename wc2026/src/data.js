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

const FLAGS = {
  "South Africa":"🇿🇦","Canada":"🇨🇦","Brazil":"🇧🇷","Japan":"🇯🇵","Germany":"🇩🇪",
  "Paraguay":"🇵🇾","Netherlands":"🇳🇱","Morocco":"🇲🇦","Ivory Coast":"🇨🇮","Norway":"🇳🇴",
  "France":"🇫🇷","Sweden":"🇸🇪","Mexico":"🇲🇽","Scotland":"🏴󠁧󠁢󠁳󠁣󠁴󠁿","England":"🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "Cabo Verde":"🇨🇻","Egypt":"🇪🇬","Czechia":"🇨🇿","United States":"🇺🇸","Bosnia and Herzegovina":"🇧🇦",
  "Spain":"🇪🇸","Austria":"🇦🇹","Switzerland":"🇨🇭","Belgium":"🇧🇪","Portugal":"🇵🇹",
  "Ghana":"🇬🇭","Australia":"🇦🇺","Iran":"🇮🇷","Argentina":"🇦🇷","Uruguay":"🇺🇾",
  "Colombia":"🇨🇴","Croatia":"🇭🇷"
};

/* helpers: T = confirmed team, P = projected placeholder slot */
function T(name, seed){ return {name, seed, tbd:false}; }
function P(name, seed){ return {name, seed, tbd:true}; }

/* Round of 32 — ordered to match the bracket tree top-to-bottom.
   Each match: { id, a, b } */
const R32 = [
  {id:73, a:T("South Africa","2A"),  b:T("Canada","2B")},
  {id:75, a:T("Netherlands","1F"),   b:T("Morocco","2C")},
  {id:74, a:T("Germany","1E"),       b:T("Paraguay","3rd D")},
  {id:77, a:P("France","1I"),        b:P("Sweden","3rd C/D/F/G/H")},
  {id:76, a:T("Brazil","1C"),        b:T("Japan","2F")},
  {id:78, a:T("Ivory Coast","2E"),   b:T("Norway","2I")},
  {id:79, a:T("Mexico","1A"),        b:P("Scotland","3rd C/E/F/H/I")},
  {id:80, a:P("England","1L"),       b:P("Cabo Verde","3rd E/H/I/J/K")},
  {id:81, a:T("United States","1D"), b:T("Bosnia and Herzegovina","3rd B")},
  {id:82, a:P("Egypt","1G"),         b:P("Czechia","3rd A/E/H/I/J")},
  {id:83, a:P("Portugal","2K"),      b:P("Ghana","2L")},
  {id:84, a:P("Spain","1H"),         b:P("Austria","2J")},
  {id:85, a:P("Switzerland","1B"),   b:P("Belgium","3rd E/F/G/I/J")},
  {id:86, a:T("Argentina","1J"),     b:T("Uruguay","2H")},
  {id:87, a:P("Colombia","1K"),      b:P("Croatia","3rd D/E/I/J/L")},
  {id:88, a:T("Australia","2D"),     b:T("Iran","2G")}
];

/* Fixed bracket tree (FIFA published Round-of-32 paths).
   `from` lists the two feeder match ids whose winners meet. */
const TREE = {
  r16:[
    {id:90, from:[73,75]},
    {id:89, from:[74,77]},
    {id:91, from:[76,78]},
    {id:92, from:[79,80]},
    {id:93, from:[83,84]},
    {id:94, from:[81,82]},
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
window.WC = { FLAGS, R32, TREE, POINTS, ROUND_LABEL, ROUND_MAX };
