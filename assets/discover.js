// Discover tab: ways to find new stocks. Each page is its own section; the Discover drop-down opens them.
//  * Industries: pick an industry (Tech, Banks...) and see its companies, biggest first.
//  * Movers today: the biggest gainers and losers among well-known stocks, with their newest headline.
//  * New on the market: companies that just went public, and ones coming soon.
//  * Most searched: what people looked up most on Simple Street this week (supabase/searches.sql).
//  * Find stocks with filters: price, industry, dividends, how it's done this year.
//  * Surprise me: opens a random well-known company in Search.
//  * Stocks like this: a box on each stock's Search page with similar companies.
// Data: data/discover.json, saved a few times each weekday by scripts/update_discover.py (free).
(function(){
"use strict";
const $=s=>document.querySelector(s);
const el=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="class")e.className=v;else if(k==="text")e.textContent=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v);}for(const kid of kids.flat()){if(kid==null||kid===false)continue;e.append(kid.nodeType?kid:document.createTextNode(String(kid)));}return e;};
const CFG=window.WVFC_CONFIG||{};

// Plain-words description and a small line icon for each industry, in the order the tiles show.
const INFO=[
  ["Tech","Computers, phones, chips, apps and websites.","M4 5h16v11H4zM2 20h20M9 16v4M15 16v4"],
  ["Health","Medicine, hospitals and health insurance.","M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-3 4.5 4.5 0 0 1 8 3c0 6-8 11-8 11zM9 11h6M12 8v6"],
  ["Banks","Banks, credit cards and money apps.","M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"],
  ["Shopping","Stores and online shopping.","M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"],
  ["Food & Household","Food, drinks and everyday stuff like soap.","M4 11h16a8 8 0 0 1-16 0zM8 7c0-2 2-2 2-4M13 7c0-2 2-2 2-4"],
  ["Energy","Oil, gas and fuel.","M13 2L5 14h6l-1 8 8-12h-6z"],
  ["Cars","Car makers and car parts.","M5 16l1.5-5h11l1.5 5M3 16h18v3H3zM7 19v2M17 19v2"],
  ["Travel & Fun","Hotels, restaurants, cruises and casinos.","M2 16l20-6-2-3-6 2-6-5-2 1 4 6-5 2-2-2-2 1z"],
  ["Media","TV, movies, games, phone service and ads.","M3 6h18v12H3zM10 9.5v5l4.5-2.5z"],
  ["Industrial","Planes, trains, machines and builders.","M3 21V10l6 4V10l6 4V5h6v16zM7 18h2M12 18h2M17 18h2"],
  ["Utilities","Power, water and gas for homes.","M12 3v4M5 8l2 2M19 8l-2 2M8 15a4 4 0 1 1 8 0c0 2-2 3-2 5h-4c0-2-2-3-2-5zM10 22h4"],
  ["Insurance","Pays you back when something bad happens, like a car crash.","M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"],
  ["Real Estate","Buildings, apartments and cell towers.","M4 21V8l6-4 6 4v13M16 11h4v10M8 10h4M8 14h4M8 18h4"],
  ["Materials","Chemicals, metals and packaging.","M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 18l9 5 9-5"],
];
const PAGE=25;
const app=()=>window.WVFC_APP||{};
let file=null,loading=null;
function load(){
  if(!loading)loading=fetch("data/discover.json",{cache:"no-cache"}).then(r=>{if(!r.ok)throw 0;return r.json();}).catch(()=>({industries:{}})).then(j=>{file=j;all=null;return j;});
  return loading;
}
// Every stock as an object, biggest first.
let all=null;
function stocks(){
  if(all)return all;all=[];
  const order=new Map(((file&&file.order)||[]).map((t,i)=>[t,i]));
  for(const[ind,rows]of Object.entries((file&&file.industries)||{}))rows.forEach((r,i)=>all.push({tk:r[0],name:r[1],price:r[2],day:r[3],month:r[4],year:r[5],div:r[6],ind,rk:order.has(r[0])?order.get(r[0]):i*14}));
  all.sort((a,b)=>a.rk-b.rk);
  return all;
}

/* ---------- Helpers ---------- */
const pct=n=>{if(n==null)return "";const v=Math.round(n*10)/10;return (v>0?"+":v<0?"−":"")+Math.abs(v).toFixed(1)+"%";};
const tone=n=>n==null?"":n>=0.05?"up":n<=-0.05?"down":"flat";
const money=n=>n==null?"":"$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const icon=d=>{const s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("viewBox","0 0 24 24");s.setAttribute("aria-hidden","true");s.innerHTML=`<path d="${d}"/>`;return s;};
const shortDay=d=>d?new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}):"";
const look=tk=>()=>app().openStock&&app().openStock(tk);
const buy=tk=>()=>window.WVFC_PAPER&&window.WVFC_PAPER.trade(tk,"buy");
const msg=t=>el("p",{class:"meta",text:t});
function when(){
  if(!file||!file.updated)return "";
  const d=new Date(file.updated.replace("Z",":00Z"));if(isNaN(d))return "";
  return "Prices from "+d.toLocaleString("en-US",{weekday:"short",hour:"numeric",minute:"2-digit",timeZone:"America/Chicago"})+" Chicago time";
}
function setWhen(id){const w=$(id);if(w)w.textContent=when();}

// One company row: ticker and name, price and today, one more number, Buy and See.
function row(s,extra){
  const [label,val,cls]=extra||["1 month",pct(s.month),tone(s.month)];
  return el("li",{class:"inrow"},
    el("button",{type:"button",class:"intk",title:`Look up ${s.tk}`,onclick:look(s.tk)},
      el("b",{text:s.tk}),el("span",{class:"innm",text:s.name||""})),
    el("span",{class:"inpx"},el("b",{text:money(s.price)}),el("span",{class:"inchg "+tone(s.day),text:s.day==null?"":pct(s.day)+" today"})),
    el("span",{class:"inmo "+(cls||""),title:label,text:val||""}),
    el("span",{class:"inbtns"},
      el("button",{type:"button",class:"btn small primary",text:"Buy",title:`Buy ${s.tk} in Paper Trading`,onclick:buy(s.tk)}),
      el("button",{type:"button",class:"inmore",text:"See →",title:`Look up ${s.tk}`,onclick:look(s.tk)})));
}
const cols=(third)=>el("div",{class:"inrow incols","aria-hidden":"true"},el("span",{text:"Company"}),el("span",{text:"Price"}),el("span",{class:"inmo",text:third}),el("span",{}));
function list(rows,shown,more,extra,third){
  if(!rows.length)return [];
  return [cols(third||"1 month"),el("ol",{class:"inrows"},rows.slice(0,shown).map(s=>row(s,extra&&extra(s)))),
    rows.length>shown?el("button",{type:"button",class:"btn inshowmore",text:`Show ${Math.min(PAGE,rows.length-shown)} more`,onclick:more}):null];
}

/* ---------- Industries ---------- */
let pick=null,sort="big",shown=PAGE;
function median(rows){const v=rows.map(r=>r[3]).filter(x=>x!=null).sort((a,b)=>a-b);if(!v.length)return null;const m=v.length>>1;return v.length%2?v[m]:(v[m-1]+v[m])/2;}
const rowsOf=name=>(file&&file.industries&&file.industries[name])||[];
const asStock=(r,ind)=>({tk:r[0],name:r[1],price:r[2],day:r[3],month:r[4],year:r[5],div:r[6],ind});
function goInd(name){pick=name;sort="big";shown=PAGE;try{history.replaceState(null,"","#industries"+(name?"/"+encodeURIComponent(name):""));}catch(e){}drawInd();window.scrollTo({top:0});}
function tiles(){
  return el("div",{class:"inlist"},INFO.filter(i=>!file||rowsOf(i[0]).length).map(([name,about,d])=>{
    const rows=rowsOf(name),m=median(rows);
    return el("button",{type:"button",class:"intile",onclick:()=>goInd(name)},
      el("span",{class:"inic"},icon(d)),
      el("span",{class:"inbody"},
        el("b",{class:"inname",text:name}),
        el("span",{class:"inabout",text:about}),
        el("span",{class:"inmeta"},
          el("span",{text:file?`${rows.length} companies`:"Loading…"}),
          m!=null?el("span",{class:"inday "+tone(m),text:`Today ${pct(m)}`}):null)),
      el("span",{class:"inarrow","aria-hidden":"true",text:"›"}));
  }));
}
function detail(){
  const info=INFO.find(i=>i[0]===pick)||[pick,"",""];
  let rows=rowsOf(pick).map(r=>asStock(r,pick));
  if(sort==="up")rows=rows.filter(r=>r.day!=null).sort((a,b)=>b.day-a.day);
  if(sort==="down")rows=rows.filter(r=>r.day!=null).sort((a,b)=>a.day-b.day);
  if(sort==="month")rows=rows.filter(r=>r.month!=null).sort((a,b)=>b.month-a.month);
  const chip=(k,t)=>el("button",{type:"button",class:"inchip"+(sort===k?" on":""),"aria-pressed":String(sort===k),text:t,onclick:()=>{sort=k;shown=PAGE;drawInd();}});
  const m=median(rowsOf(pick));
  return el("div",{class:"indetail"},
    el("button",{type:"button",class:"inback",onclick:()=>goInd(null),text:"‹ All industries"}),
    el("div",{class:"panel inpanel"},
      el("div",{class:"inhead"},
        el("span",{class:"inic big"},icon(info[2])),
        el("div",{},el("h3",{text:info[0]}),el("p",{class:"inabout",text:info[1]}),
          el("p",{class:"inmeta"},el("span",{text:`${rowsOf(pick).length} companies`}),m!=null?el("span",{class:"inday "+tone(m),text:`Typical stock today ${pct(m)}`}):null))),
      el("div",{class:"inchips",role:"group","aria-label":"Sort"},chip("big","Biggest"),chip("up","Up most today"),chip("down","Down most today"),chip("month","Best this month")),
      rows.length?list(rows,shown,()=>{shown+=PAGE;drawInd();}):msg(file?"Prices aren't in yet. Check back soon.":"Loading…")));
}
function drawInd(){setWhen("#in-when");$("#in-body").replaceChildren(pick?detail():tiles());}
function startInd(){
  const h=decodeURIComponent((location.hash.split("/")[1]||""));
  pick=h&&INFO.some(i=>i[0]===h)?h:null;if(!pick){sort="big";shown=PAGE;}
  drawInd();load().then(drawInd);
}

/* ---------- Movers today ---------- */
function moverCard(m,up){
  const h=m.headline;
  return el("li",{class:"t3card"},
    el("div",{class:"t3row mvrow"},
      el("button",{type:"button",class:"t3tk",title:`Look up ${m.ticker}`,onclick:look(m.ticker)},
        el("b",{text:m.ticker}),el("span",{class:"t3name"},el("span",{class:"t3nm",text:m.name||""}),m.price!=null?el("span",{class:"t3px",text:" · "+money(m.price)}):null)),
      el("div",{class:"t3stat "+(up?"up":"down")},el("b",{text:pct(m.day)}),el("span",{text:"today"}))),
    h&&h.title?el("a",{class:"t3news",href:h.url,target:"_blank",rel:"noopener"},
      el("span",{class:"mvwhy",text:"Why it may have moved"}),
      el("span",{class:"t3q",text:h.title}),
      el("span",{class:"t3src",text:[h.source,shortDay(h.date)].filter(Boolean).join(" · ")})):
      el("p",{class:"t3why meta",text:"No big news found. Sometimes a stock moves with its industry or the whole market."}),
    el("div",{class:"t3btns"},
      el("button",{type:"button",class:"btn small primary",text:"Buy",title:`Buy ${m.ticker} in Paper Trading`,onclick:buy(m.ticker)}),
      el("button",{type:"button",class:"t3more",text:"See the stock →",onclick:look(m.ticker)})));
}
function drawMovers(){
  setWhen("#mv-when");
  const mv=(file&&file.movers)||{up:[],down:[]};
  const box=(kind,title,sub,rows,up)=>el("div",{class:"panel t3box t3-"+kind},
    el("div",{class:"t3head"},el("span",{class:"t3ic"},icon(up?"M3 17l6-6 4 4 8-8M15 7h6v6":"M3 7l6 6 4-4 8 8M15 17h6v-6")),el("div",{},el("h3",{text:title}),el("p",{class:"t3sub",text:sub}))),
    !file?msg("Loading…"):rows.length?el("ol",{class:"t3list"},rows.map(m=>moverCard(m,up))):msg("Check back once the market opens."));
  $("#mv-grid").replaceChildren(
    box("rocket","Up the most today","Well-known companies that rose the most.",mv.up||[],true),
    box("down","Down the most today","Well-known companies that fell the most.",mv.down||[],false));
}

/* ---------- New on the market ---------- */
function drawNew(){
  const ip=(file&&file.ipos)||{recent:[],upcoming:[]};
  const recent=(ip.recent||[]).map(x=>el("li",{class:"inrow nwrow"},
    el("button",{type:"button",class:"intk",title:`Look up ${x.ticker}`,onclick:look(x.ticker)},el("b",{text:x.ticker}),el("span",{class:"innm",text:x.name})),
    el("span",{class:"inpx"},el("b",{text:x.price!=null?money(x.price):"–"}),el("span",{class:"inchg flat",text:x.ipo_price?`Started at ${money(x.ipo_price)}`:""})),
    el("span",{class:"inmo "+tone(x.since),title:"Since it started trading",text:x.since!=null?pct(x.since):""}),
    el("span",{class:"inbtns"},el("span",{class:"nwdate",text:shortDay(x.date)}),el("button",{type:"button",class:"btn small primary",text:"Buy",onclick:buy(x.ticker)}))));
  const soon=(ip.upcoming||[]).map(x=>el("li",{class:"inrow nwsoon"},
    el("span",{class:"intk"},el("b",{text:x.ticker}),el("span",{class:"innm",text:x.name})),
    el("span",{class:"inpx"},el("b",{text:x.price_range?"$"+x.price_range.replace(/-/," to $"):"–"}),el("span",{class:"inchg flat",text:"expected price"})),
    el("span",{class:"inbtns"},el("span",{class:"nwdate",text:x.date?"Around "+shortDay(x.date):"Date not set"}))));
  $("#nw-body").replaceChildren(
    el("div",{class:"panel inpanel"},el("h3",{class:"nwh",text:"Just started trading"}),el("p",{class:"inabout",text:"Companies that sold their stock to the public in the last two months, biggest first."}),
      !file?msg("Loading…"):recent.length?[el("div",{class:"inrow incols","aria-hidden":"true"},el("span",{text:"Company"}),el("span",{text:"Price now"}),el("span",{class:"inmo",text:"Since start"}),el("span",{class:"nwcol",text:"Started"})),el("ol",{class:"inrows"},recent)]:msg("No new companies in the last two months.")),
    el("div",{class:"panel inpanel"},el("h3",{class:"nwh",text:"Coming soon"}),el("p",{class:"inabout",text:"Companies planning to start trading in the next few weeks. Dates can change."}),
      !file?msg("Loading…"):soon.length?el("ol",{class:"inrows"},soon):msg("Nothing announced yet. Check back next week.")));
}

/* ---------- Most searched ---------- */
let searched=null,searchedOff=false;
const rpc=(fn,body)=>fetch(`${(CFG.supabaseUrl||"").replace(/\/$/,"")}/rest/v1/rpc/${fn}`,{method:"POST",headers:{"Content-Type":"application/json",apikey:CFG.supabaseKey||""},body:JSON.stringify(body||{})});
async function loadSearched(){
  try{const r=await rpc("most_searched");if(!r.ok)throw 0;searched=await r.json();searchedOff=false;}catch(e){searched=[];searchedOff=true;}
  drawSearched();
}
function drawSearched(){
  const by={};for(const s of stocks())by[s.tk]=s;
  const ipo=t=>{const ip=(file&&file.ipos)||{};const x=[...(ip.recent||[]),...(ip.upcoming||[])].find(x=>x.ticker===t);return x&&x.name;};
  const name=t=>(by[t]&&by[t].name)||(app().stockName&&app().stockName(t))||ipo(t)||"";
  let body;
  if(searched==null)body=msg("Loading…");
  else if(searchedOff)body=msg("This list turns on soon.");
  else if(!searched.length)body=msg("Nobody has looked up a stock this week yet. Try the search bar!");
  else body=el("ol",{class:"inrows"},searched.map((x,i)=>{const s=by[x.symbol]||{tk:x.symbol,name:name(x.symbol)};
    return el("li",{class:"inrow msrow"},
      el("span",{class:"msn",text:String(i+1)}),
      el("button",{type:"button",class:"intk",title:`Look up ${x.symbol}`,onclick:look(x.symbol)},el("b",{text:x.symbol}),el("span",{class:"innm",text:s.name||""})),
      el("span",{class:"inpx"},el("b",{text:money(s.price)}),el("span",{class:"inchg "+tone(s.day),text:s.day==null?"":pct(s.day)+" today"})),
      el("span",{class:"inmo flat",text:`${x.searches} ${+x.searches===1?"look":"looks"}`}),
      el("span",{class:"inbtns"},el("button",{type:"button",class:"btn small primary",text:"Buy",onclick:buy(x.symbol)})));}));
  $("#ms-body").replaceChildren(el("div",{class:"panel inpanel"},body));
}
// Count a look-up once per stock per day per browser, so refreshing doesn't pad the list.
document.addEventListener("wvfc:stock",e=>{
  const t=String(e.detail||"").toUpperCase();if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)||!CFG.supabaseUrl)return;
  const k="ss.looked."+new Date().toISOString().slice(0,10);let seen=[];
  try{seen=JSON.parse(localStorage.getItem(k)||"[]");}catch(err){}
  if(seen.includes(t))return;seen.push(t);
  try{for(const x of Object.keys(localStorage))if(x.startsWith("ss.looked.")&&x!==k)localStorage.removeItem(x);localStorage.setItem(k,JSON.stringify(seen));}catch(err){}
  rpc("log_search",{sym:t}).catch(()=>{});
});

/* ---------- Find stocks with filters ---------- */
const F={ind:"",price:"",div:false,yearUp:false,sale:false,sort:"big"};let fShown=PAGE;
function drawFilters(){
  const opt=(v,t,cur)=>el("option",{value:v,selected:cur===v,text:t});
  const sel=(key,label,opts)=>el("label",{class:"fl"},el("span",{text:label}),el("select",{onchange:e=>{F[key]=e.target.value;fShown=PAGE;drawFilters();}},opts));
  const box=(key,label,hint)=>el("label",{class:"flck"},el("input",{type:"checkbox",checked:F[key],onchange:e=>{F[key]=e.target.checked;fShown=PAGE;drawFilters();}}),el("span",{},el("b",{text:label}),el("span",{class:"meta",text:hint})));
  let rows=stocks().filter(s=>s.price!=null||!file||!file.updated);
  if(F.ind)rows=rows.filter(s=>s.ind===F.ind);
  if(F.price)rows=rows.filter(s=>s.price!=null&&s.price<+F.price);
  if(F.div)rows=rows.filter(s=>s.div>0);
  if(F.yearUp)rows=rows.filter(s=>s.year!=null&&s.year>0);
  if(F.sale)rows=rows.filter(s=>s.month!=null&&s.month<0);
  if(F.sort==="year")rows=rows.filter(s=>s.year!=null).sort((a,b)=>b.year-a.year);
  if(F.sort==="div")rows=rows.slice().sort((a,b)=>(b.div||0)-(a.div||0));
  if(F.sort==="cheap")rows=rows.filter(s=>s.price!=null).sort((a,b)=>a.price-b.price);
  const third=F.div||F.sort==="div"?["Dividend",s=>[ "Dividend",s.div?s.div.toFixed(1)+"% a year":"None","flat"]]:["1 year",s=>["1 year",pct(s.year),tone(s.year)]];
  setWhen("#fl-when");
  $("#fl-body").replaceChildren(
    el("div",{class:"panel inpanel"},
      el("div",{class:"flgrid"},
        sel("ind","Industry",[opt("","All industries",F.ind),...INFO.map(i=>opt(i[0],i[0],F.ind))]),
        sel("price","Price of one share",[opt("","Any price",F.price),opt("20","Under $20",F.price),opt("50","Under $50",F.price),opt("100","Under $100",F.price),opt("250","Under $250",F.price)]),
        sel("sort","Sort by",[opt("big","Biggest companies",F.sort),opt("year","Up most this year",F.sort),opt("div","Biggest dividend",F.sort),opt("cheap","Cheapest share",F.sort)])),
      el("div",{class:"flchecks"},
        box("div","Pays a dividend","Sends owners cash a few times a year."),
        box("yearUp","Up over the last year","Worth more than a year ago."),
        box("sale","Down this month","Cheaper than a month ago.")),
      el("p",{class:"flcount",text:file?`${rows.length} ${rows.length===1?"company matches":"companies match"}`:"Loading…"}),
      rows.length?list(rows,fShown,()=>{fShown+=PAGE;drawFilters();},third[1],third[0]):file?msg("No companies match. Try taking off a filter."):null));
}

/* ---------- Surprise me ---------- */
async function surprise(){
  await load();
  const mine=new Set([...(app().mine?app().mine():[]),...(app().watch?app().watch():[])]);
  const pool=stocks().filter(s=>!mine.has(s.tk)&&s.rk<300);
  if(!pool.length)return;
  const s=pool[Math.floor(Math.random()*pool.length)];
  app().openStock&&app().openStock(s.tk);
}
window.WVFC_SURPRISE=surprise;

/* ---------- Stocks like this (Search page) ---------- */
const likeBox=$("#s-like");
let likeTk="";
async function drawLike(t){
  likeTk=t;if(!likeBox)return;
  await load();if(likeTk!==t)return;
  const ss=stocks(),me=ss.find(s=>s.tk===t);
  if(!me){likeBox.hidden=true;return;}
  // Same S&P group first, then same Nasdaq group, then same industry, closest in size.
  const subs=(file&&file.subs)||{},nsubs=(file&&file.nsubs)||{},sub=subs[t],nsub=nsubs[t];
  const near=(a,b)=>Math.abs(a.rk-me.rk)-Math.abs(b.rk-me.rk);
  let picks=sub?ss.filter(s=>s.tk!==t&&subs[s.tk]===sub).sort(near):[];
  if(picks.length<5&&nsub)picks=picks.concat(ss.filter(s=>s.tk!==t&&nsubs[s.tk]===nsub&&!picks.includes(s)).sort(near));
  // Same company, other share class (GOOGL and GOOG): skip.
  const base=n=>(n||"").replace(/\s+Class [A-C].*$/,"").toLowerCase();
  picks=picks.filter(s=>base(s.name)!==base(me.name));
  if(picks.length<5)picks=picks.concat(ss.filter(s=>s.tk!==t&&s.ind===me.ind&&!picks.includes(s)&&base(s.name)!==base(me.name)).sort(near)).slice(0,5);
  picks=picks.slice(0,5);
  likeBox.hidden=!picks.length;
  likeBox.replaceChildren(el("div",{class:"eyebrow",text:"Stocks like this"}),
    el("ul",{class:"lklist"},picks.map(s=>el("li",{},
      el("button",{type:"button",class:"lkbtn",title:`Look up ${s.tk}`,onclick:look(s.tk)},
        el("span",{class:"lkname"},el("b",{text:s.tk}),el("span",{class:"innm",text:s.name})),
        el("span",{class:"inchg "+tone(s.day),text:s.day==null?"":pct(s.day)}))))),
    el("button",{type:"button",class:"inmore lkmore",text:`More in ${me.ind} →`,onclick:()=>{location.hash="industries/"+encodeURIComponent(me.ind);}}));
}
document.addEventListener("wvfc:stock",e=>drawLike(String(e.detail||"").toUpperCase()));

/* ---------- Opening pages ---------- */
document.addEventListener("wvfc:tab",e=>{
  const t=e.detail;
  if(t==="industries")startInd();
  if(t==="movers"){drawMovers();load().then(drawMovers);}
  if(t==="newstocks"){drawNew();load().then(drawNew);}
  if(t==="searched"){drawSearched();load().then(()=>{drawSearched();loadSearched();});}
  if(t==="filters"){drawFilters();load().then(drawFilters);}
});
// If the page opened before this file loaded, catch up.
const open=["industries","movers","newstocks","searched","filters"].find(id=>$("#"+id)&&!$("#"+id).hidden);
if(open)document.dispatchEvent(new CustomEvent("wvfc:tab",{detail:open}));
if($("#search")&&!$("#search").hidden&&app().tk)drawLike(app().tk());
})();
