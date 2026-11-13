(function(){
"use strict";
const CFG=window.WVFC_CONFIG||{};
const $=s=>document.querySelector(s);
const el=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="class")e.className=v;else if(k==="text")e.textContent=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v);}for(const kid of kids.flat()){if(kid==null||kid===false)continue;e.append(kid.nodeType?kid:document.createTextNode(String(kid)));}return e;};
const SVGNS="http://www.w3.org/2000/svg";
const sv=(tag,attrs={})=>{const e=document.createElementNS(SVGNS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};
const fmt$=v=>"$"+v.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmt0=v=>"$"+Math.round(v).toLocaleString("en-US");
const fmtPct=(v,d=1)=>(v>=0?"+":"−")+Math.abs(v*100).toFixed(d)+"%";
const fmtShares=v=>v.toLocaleString("en-US",{maximumFractionDigits:4});
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtStamp=s=>{const d=new Date(s);return isNaN(d)?s:d.toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});};
// "Checked Nov 9 · no new news since Nov 5" when the morning check found nothing new, else "Updated Nov 9".
const briefWhen=n=>{if(!n.updatedAt)return "Updated recently";const c=n.checkedAt&&n.checkedAt.slice(0,10)>n.updatedAt.slice(0,10)?n.checkedAt:null;
  return c?`Checked ${fmtDate(c)} · no new news since ${fmtDate(n.updatedAt).replace(/, \d{4}$/,"")}`:`Updated ${fmtDate(n.updatedAt)}`;};
const fmtDate=s=>{const[y,m,d]=s.slice(0,10).split("-").map(Number);return MON[m-1]+" "+d+", "+y;};
const cls=v=>v>0.0005?"up":v<-0.0005?"down":"flat";
const arrow=v=>v>0.0005?"▲":v<-0.0005?"▼":"■";
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),2400);}
const bare=sym=>String(sym).split(":").pop().toUpperCase();

/* ---------- TradingView widgets ---------- */
const darkMQ=window.matchMedia("(prefers-color-scheme: dark)");
const tvTheme=()=>"dark";
// Clicks inside the widgets open the stock on our own Search tab (TradingView adds ?tvwidgetsymbol=...), not on TradingView.
const SELF=location.origin+location.pathname;
function tv(container,name,config){
  if(!container)return;container.replaceChildren();
  const wrap=el("div",{class:"tradingview-widget-container"},el("div",{class:"tradingview-widget-container__widget"}));
  const s=document.createElement("script");s.type="text/javascript";s.async=true;
  s.src=`https://s3.tradingview.com/external-embedding/embed-widget-${name}.js`;
  s.textContent=JSON.stringify(Object.assign({locale:"en"},config));
  wrap.append(s);container.append(wrap);
}

/* ---------- State ---------- */
const S={livePx:{},schools:[],school:null,picks:[],briefs:[],quotes:{},prices:{dates:[],closes:{}},tk:(store.get("wvfc.tk")||"NVDA"),newsTk:null,classTk:null,watch:[],mine:null};
try{S.watch=JSON.parse(store.get("wvfc.watch")||"[]").filter(x=>typeof x==="string");}catch(e){S.watch=[];}

/* ---------- Tabs ---------- */
const TABS=["portfolio","mine","feed","trade","search","news","district","staff","users"].filter(t=>document.getElementById(t));const rendered={};
const PVIEWS=["overview","positions","sectors","history","classnews","ideas"];let S_view="overview";
const DVIEWS=["dschools","dpeople","dweek"];let D_view="dschools";
// Personal Home (My Portfolio) drop-down: "mine" is the overview, the rest are views of your own Paper Trading stocks (paper.js draws them).
const MVIEWS=["mine","mystocks","mysectors","myhistory","mytrades"];let M_view="mine";
function showTab(name,push){
  if(name==="schools")name="dschools";
  // "Just me" accounts: Home is My Portfolio, Leaderboard is the everyone list. No class or school pages.
  if(S.individual){if(name==="portfolio"||PVIEWS.includes(name)||name==="home")name="mine";if(name==="district"||DVIEWS.includes(name))name="dpeople";}
  if(DVIEWS.includes(name)){D_view=name;name="district";}else if(name==="district")D_view="dschools";
  if(PVIEWS.includes(name)){S_view=name;name="portfolio";}else if(name==="portfolio")S_view="overview";
  if(MVIEWS.includes(name)){M_view=name;name="mine";}
  // Search has no tab button: the search bar at the top opens it.
  const tb=n=>$("#tab-"+n);
  if(!TABS.includes(name)||(tb(name)&&tb(name).hidden)){name=S.individual?"mine":"portfolio";}
  if(name==="portfolio"){for(const v of PVIEWS)$("#pv-"+v).hidden=v!==S_view;
    document.querySelectorAll("#pf-menu [data-view]").forEach(b=>b.classList.toggle("on",b.dataset.view===S_view));renderBreakdown();if(S_view==="classnews")renderClassFeed();if(S_view==="ideas")loadIdeas();}
  for(const t of TABS){$("#"+t).hidden=t!==name;if(tb(t))tb(t).setAttribute("aria-selected",String(t===name));}
  if(name==="mine"){for(const v of MVIEWS)$("#mv-"+v).hidden=v!==M_view;
    document.querySelectorAll("#mine-menu [data-view]").forEach(b=>b.classList.toggle("on",b.dataset.view===M_view));}
  if(name==="district"){for(const v of DVIEWS)$("#dv-"+v).hidden=v!==D_view;
    document.querySelectorAll("#dist-menu [data-view]").forEach(b=>b.classList.toggle("on",b.dataset.view===D_view));}
  if(push){try{history.replaceState(null,"","#"+(name==="portfolio"&&S_view!=="overview"?S_view:name==="district"&&D_view!=="dschools"?D_view:name==="mine"?M_view:name))}catch(e){}}
  if(name==="search"&&rendered.search!==S.tk+tvTheme())renderSearch();
  if(name==="news")renderNewsFeed();
  if(name==="district"&&D_view==="dschools")renderSchools();
  if(name==="district"&&D_view==="dpeople")document.dispatchEvent(new CustomEvent("wvfc:dpeople"));
  if(name==="district"&&D_view==="dweek")document.dispatchEvent(new CustomEvent("wvfc:dweek"));
  document.dispatchEvent(new CustomEvent("wvfc:tab",{detail:name}));
  if(name==="mine")document.dispatchEvent(new CustomEvent("wvfc:mview",{detail:M_view}));
  window.scrollTo({top:0});
}
document.querySelectorAll(".tab:not(.hasmenu)").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab,true)));
// Tabs with a drop-down menu: Class Portfolio and District.
const menus=[["#tab-portfolio","#pf-menu"],["#tab-district","#dist-menu"]].map(([t,m])=>({tab:$(t),menu:$(m)})).filter(x=>x.tab&&x.menu);
function setMenu(open,which){for(const m of menus){const on=open&&m===which;m.menu.hidden=!on;m.tab.setAttribute("aria-expanded",String(on));
  if(on){const r=m.tab.getBoundingClientRect(),n=m.tab.closest("nav").getBoundingClientRect();m.menu.style.left=Math.max(8,Math.min(r.left-n.left,n.width-m.menu.offsetWidth-8))+"px";}}}
function addMenu(m){
  m.tab.addEventListener("click",e=>{e.stopPropagation();setMenu(m.menu.hidden,m);});
  m.menu.addEventListener("click",e=>{const b=e.target.closest("[data-view]");if(!b)return;setMenu(false);showTab(b.dataset.view,true);});
}
menus.forEach(addMenu);
document.addEventListener("click",e=>{if(menus.some(m=>!m.menu.hidden&&!m.menu.contains(e.target)))setMenu(false);});
document.addEventListener("keydown",e=>{const m=menus.find(m=>!m.menu.hidden);if(e.key==="Escape"&&m){setMenu(false);m.tab.focus();}});
window.addEventListener("resize",()=>setMenu(false));
window.addEventListener("hashchange",()=>showTab(location.hash.slice(1)));

/* ---------- Data ---------- */
async function loadJSON(path){const r=await fetch(path+"?v="+Date.now(),{cache:"no-store"});if(!r.ok)throw new Error(path+" "+r.status);return r.json();}
async function quote(tk){
  if(!CFG.finnhubKey)return null;
  if(S.quotes[tk])return S.quotes[tk];
  try{const r=await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(tk)}&token=${encodeURIComponent(CFG.finnhubKey)}`);if(!r.ok)return null;const j=await r.json();if(!(j&&j.c>0))return null;S.quotes[tk]=j;return j;}catch(e){return null;}
}

/* ---------- Ticker tape ---------- */
// Our own moving ticker (TradingView's tape often sat still). Index and crypto numbers are the last
// daily close from data/prices.json; stock prices are live from Paper Trading's price lookup once you're
// logged in, and the last close before that.
const TAPE_IDX=[["^GSPC","S&P 500","FOREXCOM:SPXUSD"],["^IXIC","Nasdaq","NASDAQ:IXIC"],["^DJI","Dow","FOREXCOM:DJI"],["^RUT","Russell 2000","TVC:RUT"],["BTC","Bitcoin","COINBASE:BTCUSD"],["ETH","Ethereum","COINBASE:ETHUSD"]];
const TAPE_FILL=["AAPL","NVDA","MSFT","AMZN","GOOGL","META","TSLA","JPM","XOM","JNJ","COST","KO"];
const tapeLive={};
function lastTwo(tk){const c=S.prices.closes&&S.prices.closes[tk];if(!c)return null;let last=null,prev=null;
  for(let i=c.length-1;i>=0;i--){if(c[i]==null)continue;if(last==null)last=c[i];else{prev=c[i];break;}}
  return last==null?null:{price:last,chg:prev?last/prev-1:null};}
function tapeNum(tk){const q=tapeLive[tk];if(q&&q.price>0)return{price:+q.price,chg:q.prev_close>0?q.price/q.prev_close-1:null};return lastTwo(tk);}
function tapeStocks(){const own=S.individual?(S.mine||[]):S.picks.filter(p=>!["BTC","ETH"].includes(p.ticker)).map(p=>p.ticker);
  return [...new Set(own.concat(TAPE_FILL).map(bare))].slice(0,Math.max(12,own.length));}
function tapeItem(tk,label,sym){const it=el("button",{type:"button",class:"mt-item","data-tk":tk,onclick:()=>{if(!document.documentElement.classList.contains("unlocked"))return;openStock(sym);showTab("search",true);}},
    el("b",{text:label}),el("span",{class:"mt-px"}),el("span",{class:"mt-ch"}));fillTapeItem(it);return it;}
function fillTapeItem(it){const n=tapeNum(it.dataset.tk);if(!n){it.hidden=true;return;}it.hidden=false;
  it.querySelector(".mt-px").textContent=n.price.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
  const ch=it.querySelector(".mt-ch");ch.textContent=n.chg==null?"":fmtPct(n.chg,2);ch.className="mt-ch "+(n.chg==null?"":cls(n.chg));}
function buildTape(box,stocks){
  if(!box)return;const items=()=>TAPE_IDX.map(([tk,l,sym])=>tapeItem(tk,l,sym)).concat(stocks.map(t=>tapeItem(t,t,t)));
  // Two copies side by side; sliding left by one copy's width loops with no jump.
  const track=el("div",{class:"mt-track"},el("div",{class:"mt-set"},items()),el("div",{class:"mt-set","aria-hidden":"true"},items()));
  box.replaceChildren(el("div",{class:"mtape"},track));
  requestAnimationFrame(()=>{const w=track.firstChild.scrollWidth||1200;track.style.animationDuration=Math.max(20,Math.round(w/50))+"s";});
}
let tapeKey="";
function renderTape(){
  const stocks=tapeStocks(),key=stocks.join();
  if(key!==tapeKey||!$("#tape .mtape")){tapeKey=key;buildTape($("#tape"),stocks);}
  liveTape(stocks);
}
// Live stock prices (at most a minute old) for the ticker, every 2 minutes while the page is open.
let tapeTimer=null;
async function liveTape(stocks){
  const ss=window.WVFC_SESSION;if(!ss||!ss.db)return;
  await Promise.all(stocks.map(async t=>{try{const{data,error}=await ss.db.rpc("paper_quote",{sym:t});if(!error&&data&&data.price>0)tapeLive[t]=data;}catch(e){}}));
  document.querySelectorAll("#tape .mt-item").forEach(fillTapeItem);
  clearTimeout(tapeTimer);tapeTimer=setTimeout(()=>{if(!document.hidden)liveTape(tapeStocks());else tapeTimer=null;},120000);
}
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!tapeTimer&&S.loaded)liveTape(tapeStocks());});

/* ---------- Portfolio ---------- */
// Live Finnhub quote when a key is set, otherwise the latest daily close from data/prices.json.
function lastClose(tk){const c=S.prices.closes&&S.prices.closes[tk];if(!c)return null;for(let i=c.length-1;i>=0;i--)if(c[i]!=null)return c[i];return null;}
function closeOn(tk,date){const c=S.prices.closes&&S.prices.closes[tk],d=S.prices.dates||[];if(!c)return null;let v=null;for(let i=0;i<d.length&&d[i]<=date;i++)if(c[i]!=null)v=c[i];return v;}
// Last close from the daily price file; for a stock a teacher just bought, the database's latest price until the file has it.
function priceOf(tk){const q=S.quotes[tk];if(q)return q.c;const c=lastClose(tk);return c!=null?c:(S.livePx[tk]!=null?S.livePx[tk]:null);}
function spyEntry(p){return p.spyEntryPrice||closeOn("SPY",p.entryDate);}
function calc(p){
  const cur=priceOf(p.ticker),spyNow=priceOf("SPY");if(cur==null)return null;const q=S.quotes[p.ticker];
  const ret=cur/p.entryPrice-1;const se=spyEntry(p);const spyRet=spyNow&&se?spyNow/se-1:null;
  const shares=p.shares||(p.invested?p.invested/p.entryPrice:null);const invested=shares?(p.invested||shares*p.entryPrice):null;
  const value=shares?shares*cur:null;
  return{cur,ret,spyRet,alpha:spyRet==null?null:ret-spyRet,shares,invested,value,gain:value!=null?value-invested:null,spyValue:invested&&spyRet!=null?invested*(1+spyRet):null,day:q?q.dp/100:null};
}
function renderTiles(){
  const box=$("#tiles");box.replaceChildren();
  const tile=(label,val,note,k)=>el("div",{class:"tile"},el("div",{class:"eyebrow",text:label}),el("div",{class:"v "+(k||""),text:val}),el("div",{class:"n",text:note}));
  const inv=S.picks.reduce((s,p)=>s+(p.invested||(p.shares||0)*p.entryPrice),0);
  const cs=S.picks.map(calc).filter(c=>c&&c.invested);const all=cs.length===S.picks.length&&cs.length>0;
  const val=all?cs.reduce((s,c)=>s+c.value,0):null;const spyOK=all&&cs.every(c=>c.spyValue!=null);const spyV=spyOK?cs.reduce((s,c)=>s+c.spyValue,0):null;
  const beating=cs.filter(c=>c.alpha!=null&&c.alpha>0).length;
  const sgn=v=>(v>=0?"+":"−")+fmt0(Math.abs(v));
  box.append(
    tile("Money invested",S.picks.length?fmt0(inv):"–",`${S.picks.length} ${S.picks.length===1?"stock":"stocks"} in the portfolio`),
    tile("Worth now",val==null?"–":fmt0(val),val==null?"live value":`${sgn(val-inv)} (${fmtPct(val/inv-1)})`,val==null?"":cls(val/inv-1)),
    tile("Same money in the S&P 500",spyV==null?"–":fmt0(spyV),spyV==null?"what an index fund did":`${sgn(spyV-inv)} (${fmtPct(spyV/inv-1)})`,spyV==null?"":cls(spyV/inv-1)),
    tile("Beating the market",cs.length?`${beating} of ${cs.length}`:"–",spyV!=null?((val-spyV)>=0?`club leads by ${fmt0(val-spyV)}`:`club trails by ${fmt0(spyV-val)}`):"picks ahead of the S&P 500"));
  $("#cnt-picks").textContent=S.picks.length?String(S.picks.length):"";
  const note=$("#price-note");
  if(S.picks.length&&!all){note.hidden=false;note.textContent="Prices for a new pick show up after the next daily price update, usually within a few minutes.";}
  else note.hidden=true;
}
function niceStep(raw){const p=Math.pow(10,Math.floor(Math.log10(raw)));const f=raw/p;return(f<1.5?1:f<3?2:f<7?5:10)*p;}
function renderCompare(){
  const panel=$("#cmp-panel");panel.hidden=!S.picks.length;if(S.picks.length)renderHistory($("#cmp"));
}
function renderPicks(){
  const wrap=$("#picks");wrap.replaceChildren();
  if(!S.picks.length){
    wrap.append(el("div",{class:"empty"},el("h3",{text:"No picks yet"}),
      el("p",{text:"The portfolio fills up after each debate. Here's how a stock gets in:"}),
      el("div",{class:"steps"},
        el("div",{},el("b",{text:"1. Pitch"}),"A member picks a stock and builds the case for it."),
        el("div",{},el("b",{text:"2. Debate"}),"Two members go head to head on their stocks at the meeting."),
        el("div",{},el("b",{text:"3. Vote"}),"The audience votes A or B on the Google Form and says why. The winner joins the portfolio at that day's price."))));
    return;}
  // On phones each stock is a short row (ticker, value, gain) that opens to the full card.
  const compact=phoneMQ.matches;const grid=el("div",{class:compact?"picks compact":"picks"});
  for(const p of S.picks){
    const c=calc(p);const sym=p.symbol||p.ticker;const mini=el("div",{class:"mini"});
    const d=p.debate;const tot=d?(d.votesFor||0)+(d.votesAgainst||0):0;
    const card=el("article",{class:"pick"},
      compact?null:el("div",{class:"pick-top"},
        el("div",{style:"min-width:0"},el("div",{class:"tk",text:p.ticker}),el("div",{class:"tk-name",text:p.name||""})),
        c?el("div",{},el("div",{class:"price-big",text:fmt$(c.cur)}),el("div",{style:"text-align:right"},el("span",{class:"pill "+cls(c.ret),text:arrow(c.ret)+" "+fmtPct(c.ret)}))):null),
      mini,
      el("div",{class:"kv"},
        el("div",{},el("div",{class:"k",text:"Bought"}),el("div",{class:"val",text:fmt$(p.entryPrice)}),el("div",{class:"meta",text:fmtDate(p.entryDate)})),
        el("div",{},el("div",{class:"k",text:"S&P 500 since"}),el("div",{class:"val",text:c&&c.spyRet!=null?fmtPct(c.spyRet):"–"})),
        el("div",{},el("div",{class:"k",text:"vs market"}),el("div",{class:"val"},c&&c.alpha!=null?el("span",{class:"pill "+cls(c.alpha),text:(c.alpha>=0?"Ahead ":"Behind ")+fmtPct(Math.abs(c.alpha)).slice(1)}):"–")),
        el("div",{},el("div",{class:"k",text:"Invested"}),el("div",{class:"val",text:p.invested?fmt$(p.invested):"–"})),
        el("div",{},el("div",{class:"k",text:"Shares"}),el("div",{class:"val",text:p.shares?fmtShares(p.shares):"–"})),
        el("div",{},el("div",{class:"k",text:"Worth now"}),el("div",{class:"val",text:c&&c.value!=null?fmt$(c.value):"–"}),c&&c.gain!=null?el("div",{class:"meta",style:`color:var(--${cls(c.ret)})`,text:(c.gain>=0?"+":"−")+fmt$(Math.abs(c.gain))}):null)),
      el("p",{class:"thesis"},el("b",{text:"Thesis: "}),p.thesis||""),
      d&&tot?el("div",{class:"debate"},el("div",{class:"eyebrow",text:`Won the debate vs ${d.opponent} · ${d.votesFor}–${d.votesAgainst}`}),
        el("div",{class:"vbar","aria-hidden":"true"},el("span",{style:`width:${d.votesFor/tot*100}%;background:var(--gold)`}),el("span",{style:`width:${d.votesAgainst/tot*100}%;background:var(--muted)`}))):null,
      el("div",{class:"meta",text:"Pitched by "+(p.pitchedBy||"a member")}),
      el("div",{},el("button",{class:"btn small",text:"Full chart & news →",onclick:()=>{openStock(sym);showTab("search",true);}})));
    const drawMini=()=>tv(mini,"mini-symbol-overview",{symbol:sym,width:"100%",height:170,dateRange:"12M",colorTheme:tvTheme(),isTransparent:true,autosize:false,largeChartUrl:SELF});
    if(!compact){grid.append(card);drawMini();continue;}
    // The mini chart loads only when a row is opened.
    const row=el("details",{class:"pickrow"},el("summary",{},
      el("div",{class:"pr-name"},el("span",{class:"tk",text:p.ticker}),el("span",{class:"tk-name",text:p.name||""})),
      el("div",{class:"pr-val"},el("b",{text:c&&c.value!=null?fmt$(c.value):"–"}),c?el("span",{class:"pill "+cls(c.ret),text:arrow(c.ret)+" "+fmtPct(c.ret)}):null)),card);
    row.addEventListener("toggle",()=>{if(row.open&&!mini.childElementCount)drawMini();});
    grid.append(row);
  }
  wrap.append(grid);
}
const phoneMQ=matchMedia("(max-width:600px)");phoneMQ.addEventListener&&phoneMQ.addEventListener("change",()=>{if(S.loaded){renderPicks();renderEvents();}});
/* ---------- Portfolio dropdowns ---------- */
const SECTOR_COLORS=["#3987e5","#d95926","#199e70","#c98500","#d55181","#008300","#9085e9","#e66767"];
const emptyNote=t=>el("p",{class:"meta dropnote",text:t});
function renderPositions(){
  const box=$("#pos-body");const rows=S.picks.map(p=>({p,c:calc(p)}));
  $("#drop-pos").hidden=!rows.length;if(!rows.length)return;
  const total=rows.reduce((s,r)=>s+(r.c&&r.c.value!=null?r.c.value:0),0);
  const td=(t,k)=>el("td",{class:k||"",text:t});
  const tbody=el("tbody",{},rows.map(({p,c})=>el("tr",{},
    el("td",{},el("b",{text:p.ticker})),td(p.name||""),td(p.sector||"–"),
    td(c&&c.shares?fmtShares(c.shares):"–","num"),td(fmt$(p.entryPrice),"num"),td(c?fmt$(c.cur):"–","num"),
    td(c&&c.value!=null?fmt$(c.value):"–","num"),
    td(c&&c.gain!=null?(c.gain>=0?"+":"−")+fmt$(Math.abs(c.gain)):"–","num "+(c?cls(c.ret):"")),
    td(c?fmtPct(c.ret):"–","num "+(c?cls(c.ret):"")),
    td(c&&c.value!=null&&total?Math.round(c.value/total*100)+"%":"–","num"))));
  const head=el("thead",{},el("tr",{},["Ticker","Name","Sector","Shares","Bought at","Price now","Worth now","Gain $","Gain %","% of portfolio"].map((h,i)=>el("th",{class:i>2?"num":"",text:h}))));
  box.replaceChildren(el("div",{class:"tablewrap"},el("table",{class:"pos"},head,tbody)));
}
function renderSectors(){
  const box=$("#sec-body");const by={};
  for(const p of S.picks){const c=calc(p);const v=c&&c.value!=null?c.value:(p.invested||0);if(v>0)by[p.sector||"Other"]=(by[p.sector||"Other"]||0)+v;}
  sectorPie(box,by,"The pie fills in once the club owns a stock. Each slice is a type of business, like Tech or Banks.","What we own by sector");
}
// A donut of money by sector, biggest slice first. Used by the Class Portfolio and the personal Home (paper.js).
function sectorPie(box,by,empty,label,extra){
  let parts=Object.entries(by).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]);
  if(!parts.length){box.replaceChildren(emptyNote(empty));return;}
  if(parts.length>8){const rest=parts.slice(7).reduce((s,x)=>s+x[1],0);parts=parts.slice(0,7).concat([["Other",rest]]);}
  const total=parts.reduce((s,x)=>s+x[1],0);const R=90,r0=56,C=110;
  const svg=sv("svg",{viewBox:"0 0 220 220",class:"donut",role:"img","aria-label":label});
  let a=-Math.PI/2;
  parts.forEach(([name,v],i)=>{const frac=v/total;const col=SECTOR_COLORS[i%SECTOR_COLORS.length];
    if(frac>=0.9999){svg.append(sv("circle",{cx:C,cy:C,r:(R+r0)/2,fill:"none",stroke:col,"stroke-width":R-r0}));}
    else{const b=a+frac*Math.PI*2,big=frac>0.5?1:0,P=(rad,ang)=>`${C+rad*Math.cos(ang)} ${C+rad*Math.sin(ang)}`;
      const path=sv("path",{d:`M${P(R,a)}A${R} ${R} 0 ${big} 1 ${P(R,b)}L${P(r0,b)}A${r0} ${r0} 0 ${big} 0 ${P(r0,a)}Z`,fill:col,stroke:"var(--surface)","stroke-width":2});
      const t=sv("title");t.textContent=`${name}: ${Math.round(frac*100)}%`;path.append(t);svg.append(path);a=b;}});
  const mid=sv("text",{x:C,y:C-2,"text-anchor":"middle",class:"donut-n"});mid.textContent=String(parts.length);
  const sub=sv("text",{x:C,y:C+18,"text-anchor":"middle",class:"donut-s"});sub.textContent=parts.length===1?"sector":"sectors";svg.append(mid,sub);
  const legend=el("ul",{class:"seclegend"},parts.map(([name,v],i)=>el("li",{},el("i",{style:`background:${SECTOR_COLORS[i%SECTOR_COLORS.length]}`}),el("span",{text:name}),el("b",{text:Math.round(v/total*100)+"%"}),el("span",{class:"meta",text:fmt0(v)}))));
  box.replaceChildren(el("div",{class:"secwrap"},svg,legend),extra||"");
}
// Sector for any ticker: data/sectors.json (S&P 500 and popular stocks), "Funds" for ETFs (no exchange in data/stocks.json), else "Other".
let sectorMap=null;
async function sectorsFor(tks){
  if(!sectorMap)sectorMap=loadJSON("data/sectors.json").then(j=>j.sectors||{}).catch(()=>({}));
  const [map]=await Promise.all([sectorMap,loadStocks()]);
  const out={};for(const t of tks){const b=bare(t);const st=(stockList||[]).find(x=>x.t===b);
    out[t]=map[b]||(st&&st.i>=0&&st.sym===b?"Funds":"Other");}
  return out;
}
function stockName(t){const b=bare(t),st=(stockList||[]).find(x=>x.t===b);return st?st.n:"";}
function historySeries(){
  const d=S.prices.dates||[],cl=S.prices.closes||{};if(!d.length||!cl.SPY)return null;
  const picks=S.picks.filter(p=>cl[p.ticker]&&p.entryDate);if(!picks.length)return null;
  const first=picks.reduce((m,p)=>p.entryDate<m?p.entryDate:m,picks[0].entryDate);
  const legs=picks.map(p=>{const inv=p.invested||(p.shares||0)*p.entryPrice;const sh=p.shares||inv/p.entryPrice;const se=spyEntry(p);return{p,inv,sh,spySh:se?inv/se:0};});
  const last={};const out=[];
  d.forEach((day,i)=>{for(const tk of Object.keys(cl))if(cl[tk][i]!=null)last[tk]=cl[tk][i];
    if(day<first)return;let club=0,spy=0,inv=0;
    for(const l of legs)if(l.p.entryDate<=day){const px=last[l.p.ticker]!=null?last[l.p.ticker]:l.p.entryPrice;club+=l.sh*px;spy+=l.spySh*(last.SPY||0);inv+=l.inv;}
    if(inv>0)out.push({day,club,spy,inv});});
  return out.length?out:null;
}
function renderHistory(box=$("#hist-body")){
  const pts=historySeries();
  if(!pts){box.replaceChildren(emptyNote(S.picks.length?"The chart fills in after the next daily price update.":"Once we own stocks, this line shows our portfolio's value each day next to the same money in the S&P 500."));return;}
  const W=Math.max(320,box.clientWidth||760),H=300,L=64,Rr=16,T=16,B=30;
  // Plot growth in %, (value / money put in) - 1, so buying a new stock doesn't make the line jump.
  for(const p of pts){p.c=p.club/p.inv-1;p.s=p.spy/p.inv-1;}
  const vals=pts.flatMap(p=>[p.c,p.s,0]);let mn=Math.min(...vals),mx=Math.max(...vals);const pad=(mx-mn)*0.1||0.01;mn-=pad;mx+=pad;
  const x=i=>L+(pts.length===1?0.5:i/(pts.length-1))*(W-L-Rr),y=v=>T+(1-(v-mn)/(mx-mn))*(H-T-B);
  const svg=sv("svg",{viewBox:`0 0 ${W} ${H}`,class:"hist",role:"img","aria-label":"Club portfolio value compared with the S&P 500 over time"});
  const step=niceStep((mx-mn)/4);for(let v=Math.ceil(mn/step)*step;v<=mx;v+=step){const Y=y(v);svg.append(sv("line",{x1:L,x2:W-Rr,y1:Y,y2:Y,stroke:"var(--line)"}));const t=sv("text",{x:L-8,y:Y+4,"text-anchor":"end"});t.textContent=(v>0?"+":"")+Math.round(v*100*10)/10+"%";svg.append(t);}
  svg.append(sv("line",{x1:L,x2:W-Rr,y1:y(0),y2:y(0),stroke:"var(--muted)","stroke-width":1.5}));
  const nt=Math.min(W<520?3:5,pts.length);for(let k=0;k<nt;k++){const i=nt===1?0:Math.round(k*(pts.length-1)/(nt-1));const t=sv("text",{x:x(i),y:H-8,"text-anchor":k===0?"start":k===nt-1?"end":"middle"});t.textContent=fmtDate(pts[i].day).replace(/, \d{4}$/,"");svg.append(t);}
  const line=(key,col,w)=>sv("path",{d:pts.map((p,i)=>(i?"L":"M")+x(i).toFixed(1)+" "+y(p[key]).toFixed(1)).join(""),fill:"none",stroke:col,"stroke-width":w,"stroke-linejoin":"round","stroke-linecap":"round"});
  svg.append(line("s","var(--ink-2)",2),line("c","var(--gold)",3));
  const lastP=pts[pts.length-1];svg.append(sv("circle",{cx:x(pts.length-1),cy:y(lastP.c),r:4,fill:"var(--gold)"}),sv("circle",{cx:x(pts.length-1),cy:y(lastP.s),r:3.5,fill:"var(--ink-2)"}));
  const cross=sv("line",{y1:T,y2:H-B,stroke:"var(--muted)","stroke-dasharray":"3 3",visibility:"hidden"});
  const dotC=sv("circle",{r:4.5,fill:"var(--gold)",visibility:"hidden"}),dotS=sv("circle",{r:4,fill:"var(--ink-2)",visibility:"hidden"});svg.append(cross,dotC,dotS);
  const tip=el("div",{class:"histtip",hidden:true});
  const hide=()=>{tip.hidden=true;[cross,dotC,dotS].forEach(n=>n.setAttribute("visibility","hidden"));};
  svg.addEventListener("pointermove",e=>{const rc=svg.getBoundingClientRect();const px=(e.clientX-rc.left)*W/rc.width;
    const i=Math.max(0,Math.min(pts.length-1,Math.round((px-L)/(W-L-Rr)*(pts.length-1))));const p=pts[i],X=x(i);
    cross.setAttribute("x1",X);cross.setAttribute("x2",X);dotC.setAttribute("cx",X);dotC.setAttribute("cy",y(p.c));dotS.setAttribute("cx",X);dotS.setAttribute("cy",y(p.s));
    [cross,dotC,dotS].forEach(n=>n.setAttribute("visibility","visible"));
    tip.replaceChildren(el("div",{class:"meta",text:fmtDate(p.day)}),el("div",{},el("i",{style:"background:var(--gold)"}),"Our portfolio ",el("b",{text:fmtPct(p.c)})," ("+fmt0(p.club)+")"),el("div",{},el("i",{style:"background:var(--ink-2)"}),"S&P 500 ",el("b",{text:fmtPct(p.s)})," ("+fmt0(p.spy)+")"),el("div",{class:"meta",text:"Money put in so far: "+fmt0(p.inv)}));
    tip.hidden=false;const left=X*rc.width/W;tip.style.left=Math.min(Math.max(left,70),rc.width-70)+"px";});
  svg.addEventListener("pointerleave",hide);
  const diff=lastP.club-lastP.spy;
  const summary=el("p",{class:"histsum"},"Our portfolio is ",el("b",{class:"gold",text:(lastP.c>=0?"up ":"down ")+fmtPct(Math.abs(lastP.c)).slice(1)}),". The same money in the S&P 500 would be ",el("b",{text:(lastP.s>=0?"up ":"down ")+fmtPct(Math.abs(lastP.s)).slice(1)}),". ",
    el("span",{class:cls(diff/lastP.inv),text:Math.abs(diff)<0.5?"We're even with the market.":diff>0?`We're ahead by ${fmt0(diff)}.`:`We're behind by ${fmt0(-diff)}.`}));
  const legend=el("div",{class:"legend histlegend"},el("span",{},el("i",{style:"background:var(--gold)"}),"Our portfolio"),el("span",{},el("i",{style:"background:var(--ink-2)"}),"Same money in the S&P 500"));
  box.replaceChildren(summary,legend,el("div",{class:"histwrap"},svg,tip));
}
function renderBreakdown(){
  if(!S.loaded)return;if(S_view==="positions")renderPositions();else if(S_view==="sectors")renderSectors();else if(S_view==="history")renderHistory();
}
/* ---------- Market today, upcoming events and weekly recap ---------- */
// The real indexes (the numbers on the news); their index funds fill in if an index is missing.
const MKT=[["^GSPC","SPY","S&P 500"],["^IXIC","QQQ","Nasdaq"],["^DJI","DIA","Dow"],["^RUT","IWM","Russell 2000"]];
function moveOver(tk,back,end){const d=S.prices.dates||[];const e=end==null?d.length-1:end;if(e-back<0)return null;const a=closeOn(tk,d[e]),b=closeOn(tk,d[e-back]);return a!=null&&b?a/b-1:null;}
function marketDay(){const d=S.prices.dates||[];const last=d[d.length-1];if(!last)return null;
  const isToday=last===new Date().toLocaleDateString("en-CA",{timeZone:"America/New_York"});
  return{last,label:isToday?"Market today":"Market on "+new Date(last+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})};}
// Until the after-close explanation is written (a little after 5pm Chicago time), say plainly what happened.
function plainWhy(rows,avg){
  const up=rows.filter(x=>x.r>0.0005).map(x=>x.name),down=rows.filter(x=>x.r<-0.0005).map(x=>x.name);
  const list=a=>a.length>1?a.slice(0,-1).join(", ")+" and "+a[a.length-1]:a[0];
  const what=up.length&&down.length?`The ${list(up)} went up, but the ${list(down)} went down.`
    :avg>0.002?"Stocks went up overall.":avg<-0.002?"Stocks went down overall.":"Stocks barely moved.";
  return what+" The full reason why is added after the market closes, a little after 5pm Chicago time.";
}
function renderMarket(){
  const box=$("#market");let md=marketDay();
  const dayRows=end=>MKT.map(([ix,fund,name])=>{const c=(S.prices.closes||{})[ix],e=end==null?(S.prices.dates||[]).length-1:end;const r=c&&c[e]!=null&&c[e-1]!=null?moveOver(ix,1,end):null;return{name,r:r!=null?r:moveOver(fund,1,end)};}).filter(x=>x.r!=null);
  let rows=dayRows();
  if(!md||!rows.length){box.hidden=true;return;}
  // The "why" comes from the after-close market recap written for this exact day.
  // If that's missing, use the S&P 500 brief, but only if it was written after this day's close
  // (a brief written that morning would still be about the day before).
  // Otherwise keep showing the last day that has a finished recap (its numbers and its why) until today's is ready.
  const mr=S.marketRecap;const sp=S.briefs.find(b=>b.ticker==="SP500");
  const spFresh=sp&&sp.headline&&sp.updatedAt&&new Date(sp.updatedAt)>=new Date(md.last+"T21:00:00Z")&&(new Date(sp.updatedAt)-new Date(md.last+"T21:00:00Z"))<3*864e5;
  let why;
  if(mr&&mr.date===md.last&&mr.why)why=mr.why;
  else if(spFresh)why=(sp.summary||"").split(/(?<=[.!?])\s+(?=[A-Z])/).slice(0,3).join(" ")||sp.headline;
  else{
    const i=mr&&mr.why?(S.prices.dates||[]).indexOf(mr.date):-1,prev=i>0?dayRows(i):[];
    if(prev.length){rows=prev;why=mr.why;md={last:mr.date,label:"Market on "+new Date(mr.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})};}
    else why=plainWhy(rows,rows.reduce((t,x)=>t+x.r,0)/rows.length);
  }
  box.replaceChildren(el("div",{class:"eyebrow",text:md.label}),
    el("div",{class:"mkrow"},rows.map(x=>el("div",{class:"mk"},el("span",{text:x.name}),el("b",{class:cls(x.r),text:fmtPct(x.r,2)})))),
    el("p",{class:"mkwhy"},el("b",{text:"Why: "}),why));
  box.hidden=false;
}
const MONS={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
// Pull the first "Oct 28" / "October 28, 2026" style date out of a brief's "coming up" text.
function eventDate(t){const m=String(t||"").match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?!\d)(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i);
  if(!m)return null;return new Date(m[3]?+m[3]:new Date().getFullYear(),MONS[m[1].slice(0,3).toLowerCase()],+m[2]);}
function renderEvents(){
  const panel=$("#events-panel"),box=$("#events");const held=new Map(S.picks.map(p=>[p.ticker,p]));
  const today=new Date();today.setHours(0,0,0,0);
  const rows=S.briefs.filter(b=>b.nextEvent&&held.has(b.ticker)).map(b=>({b,d:eventDate(b.nextEvent)})).filter(r=>!r.d||r.d>=today)
    .sort((x,y)=>(x.d?x.d.getTime():Infinity)-(y.d?y.d.getTime():Infinity));
  panel.hidden=!rows.length;if(!rows.length)return;
  // Show the next 3; the rest open with "Show all".
  const shown=S.eventsAll?rows:rows.slice(0,3);
  const more=rows.length>3?el("button",{type:"button",class:"btn small evmore",text:S.eventsAll?"Show fewer":`Show all ${rows.length}`,onclick:()=>{S.eventsAll=!S.eventsAll;renderEvents();}}):null;
  box.replaceChildren(...shown.map(({b,d})=>el("button",{type:"button",class:"event",onclick:()=>{S.classTk=b.ticker;newsBoard(true);rendered.classnews=null;showTab("classnews",true);}},
    el("span",{class:"edate"+(d?"":" tbd")},d?el("b",{text:d.toLocaleDateString("en-US",{month:"short",day:"numeric"})}):el("b",{text:"Soon"}),el("span",{text:d?d.toLocaleDateString("en-US",{weekday:"short"}):"date TBD"})),
    el("span",{class:"etext"},el("b",{text:b.ticker+" · "+(held.get(b.ticker).name||"")}),el("span",{text:b.nextEvent})))),...(more?[more]:[]));
}
// Best and worst pick over the last 5 market days, with the headline from each one's brief as the reason.
function renderRecap(){
  const panel=$("#recap");const rows=S.picks.map(p=>({p,r:moveOver(p.ticker,5)})).filter(x=>x.r!=null).sort((a,b)=>b.r-a.r);
  if(rows.length<2){panel.hidden=true;return;}
  const spy=moveOver("SPY",5);
  const card=(title,x)=>{const b=S.briefs.find(n=>n.ticker===x.p.ticker);
    return el("button",{type:"button",class:"recapcard",onclick:()=>{S.classTk=x.p.ticker;newsBoard(true);renderClassFeed();$("#c-brief").scrollIntoView({behavior:"smooth",block:"start"});}},
      el("div",{class:"eyebrow",text:title}),el("div",{class:"rtop"},el("b",{text:x.p.ticker+" · "+(x.p.name||"")}),el("span",{class:"rmove "+cls(x.r),text:fmtPct(x.r)})),
      el("p",{text:b&&b.headline?"What moved it: "+b.headline:"No brief yet for this stock."}));};
  panel.replaceChildren(el("div",{class:"sechead",style:"margin-bottom:10px"},el("div",{},el("div",{class:"eyebrow",text:"Weekly recap · last 5 market days"}),el("h3",{class:"h3",text:"Our best and worst stock this week"})),
      spy!=null?el("span",{class:"meta",text:`S&P 500 ${fmtPct(spy)}`}):null),
    el("div",{class:"recapgrid"},card("Best",rows[0]),card("Worst",rows[rows.length-1])));
  panel.hidden=false;
}
function renderPortfolio(){renderMarket();renderTiles();renderCompare();renderEvents();renderPicks();renderBreakdown();}

/* ---------- Search ---------- */
function normSym(raw){const v=String(raw||"").trim().toUpperCase().replace(/\s+/g,"");if(!v)return null;if(!/^[A-Z0-9.:\-!_]{1,24}$/.test(v))return null;return v;}
function openStock(sym){S.tk=sym;store.set("wvfc.tk",sym);if(!$("#search").hidden)renderSearch();renderWatch();renderQuick();}
function renderSearch(){
  const sym=S.tk,theme=tvTheme();rendered.search=sym+theme;
  tv($("#tv-info"),"symbol-info",{symbol:sym,width:"100%",colorTheme:theme,isTransparent:true,largeChartUrl:SELF});
  tv($("#tv-chart"),"advanced-chart",{autosize:true,symbol:sym,interval:"D",timezone:"America/Chicago",theme,style:"1",allow_symbol_change:true,calendar:false,hide_volume:false,studies:[],support_host:"https://www.tradingview.com"});
  document.querySelectorAll(".drop [data-sym]").forEach(e=>e.textContent=bare(sym));
  renderDrops();
  renderWatch();renderSearchBrief();renderQuick();
  document.dispatchEvent(new CustomEvent("wvfc:stock",{detail:bare(sym)}));
}
// The dropdowns load their widget only when open, and reload when the stock changes.
function renderDrops(){
  const sym=S.tk,theme=tvTheme();
  const fin=$("#drop-fin"),feed=$("#drop-feed");
  if(fin.open&&rendered.fin!==sym){rendered.fin=sym;tv($("#tv-fin"),"financials",{symbol:sym,colorTheme:theme,isTransparent:true,largeChartUrl:SELF,displayMode:"regular",width:"100%",height:"100%"});}
  if(feed.open&&rendered.feed!==sym){rendered.feed=sym;recentNews($("#tv-feed"),newsKey(sym),()=>tv($("#tv-feed"),"timeline",{feedMode:"symbol",symbol:sym,colorTheme:theme,isTransparent:true,displayMode:"regular",width:"100%",height:"100%"}));}
}
$("#drop-fin").addEventListener("toggle",renderDrops);$("#drop-feed").addEventListener("toggle",renderDrops);
function renderQuick(){
  const q=$("#quick");q.replaceChildren(el("span",{text:"Try:"}));
  const list=[...new Set(S.picks.map(p=>p.symbol||p.ticker).concat(["NASDAQ:AAPL","NASDAQ:NVDA","NASDAQ:MSFT","NASDAQ:AMZN","NASDAQ:TSLA","NYSE:JPM","NASDAQ:COST","NYSE:KO"]))].slice(0,10);
  list.forEach(s=>q.append(el("button",{class:"qchip"+(bare(s)===bare(S.tk)?" on":""),type:"button",text:bare(s),onclick:()=>openStock(s)})));
}
if(phoneMQ.matches)$("#q").placeholder="Name or ticker, like Nvidia";
/* ---------- Search suggestions: the top 3 matches by name or ticker ---------- */
// data/stocks.json is the SEC's list of US stocks and funds, biggest first (updated weekly by GitHub Actions).
const COINS=[["BTC","Bitcoin","COINBASE:BTCUSD"],["ETH","Ethereum","COINBASE:ETHUSD"],["SOL","Solana","COINBASE:SOLUSD"]];
let stockList=null,stockLoad=null,sugg=[],suggAt=-1;
function loadStocks(){if(!stockLoad)stockLoad=loadJSON("data/stocks.json").then(j=>{stockList=(j.stocks||[]).map(([t,n,ex],i)=>({t,n,sym:ex?ex+":"+t:t,lo:n.toLowerCase(),i}));
  stockList.unshift(...COINS.map(([t,n,sym],i)=>({t,n:n+" (crypto)",sym,lo:n.toLowerCase(),i:-1})));}).catch(()=>{stockList=[];});return stockLoad;}
function findStocks(q){
  q=q.trim().toLowerCase();if(!q||!stockList)return[];const qt=q.toUpperCase().replace(/^[A-Z]+:/,"");
  // Best first: exact ticker, then name starts with it, ticker starts with it, a word in the name starts with it, then name contains it. Bigger companies win ties.
  const rank=s=>s.t===qt?0:s.lo.startsWith(q)?1:s.t.startsWith(qt)?2:(" "+s.lo).includes(" "+q)?3:q.length>2&&s.lo.includes(q)?4:9;
  const out=[];for(const s of stockList){const r=rank(s);if(r<9)out.push([r,s]);}
  return out.sort((a,b)=>a[0]-b[0]||a[1].i-b[1].i).slice(0,3).map(x=>x[1]);
}
function showSuggest(){
  const box=$("#suggest"),inp=$("#q");box.replaceChildren(...sugg.map((s,i)=>el("li",{role:"option",id:"sg"+i,class:i===suggAt?"on":"","aria-selected":String(i===suggAt),
    onmousedown:e=>{e.preventDefault();pickSuggest(i);}},el("b",{text:s.t}),el("span",{text:s.n}))));
  box.hidden=!sugg.length;inp.setAttribute("aria-expanded",String(!!sugg.length));
  if(suggAt>=0)inp.setAttribute("aria-activedescendant","sg"+suggAt);else inp.removeAttribute("aria-activedescendant");
}
function pickSuggest(i){const s=sugg[i];if(!s)return;sugg=[];suggAt=-1;showSuggest();$("#q").value="";$("#q").blur();openStock(s.sym);showTab("search",true);}
$("#q").addEventListener("focus",loadStocks);
$("#q").addEventListener("input",async()=>{await loadStocks();sugg=findStocks($("#q").value);suggAt=-1;showSuggest();});
$("#q").addEventListener("keydown",e=>{
  if(!sugg.length)return;
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();suggAt=(suggAt+(e.key==="ArrowDown"?1:sugg.length-1)+1)%(sugg.length+1)-1;if(suggAt<-1)suggAt=sugg.length-1;showSuggest();}
  else if(e.key==="Escape"){sugg=[];showSuggest();}
  else if(e.key==="Enter"&&suggAt>=0){e.preventDefault();pickSuggest(suggAt);}});
$("#q").addEventListener("blur",()=>setTimeout(()=>{sugg=[];showSuggest();},150));
$("#searchform").addEventListener("submit",e=>{e.preventDefault();// A name like "apple" opens the top match; a ticker, or a symbol like NYSE:F, works as before.
  if(!/^[A-Z]+:/i.test($("#q").value.trim())){const top=findStocks($("#q").value)[0];if(top){sugg=[top];pickSuggest(0);return;}}const s=normSym($("#q").value);if(!s){toast("Type a ticker, like AAPL or NYSE:F");return;}$("#q").value="";$("#q").blur();openStock(s);showTab("search",true);});
function saveWatch(){store.set("wvfc.watch",JSON.stringify(S.watch));if(window.WVFC_ACCOUNT)window.WVFC_ACCOUNT.saveWatch(S.watch);}
// Lets the account page (beta.html) load a saved watchlist and open stocks.
// account.js tells us the member's school once they're logged in; boot() waits for it.
let schoolSet;const schoolReady=new Promise(r=>{schoolSet=r;});
window.WVFC_APP={setSchool(id){schoolSet(id);},setMine(list){const m=[...new Set(list.map(bare))];if(S.mine&&m.join()===S.mine.join())return;S.mine=m;rendered.news=null;document.dispatchEvent(new CustomEvent("wvfc:mine"));if(S.loaded)renderTape();renderNews();renderHomeNews();loadMineBriefs();loadEarnings();if(!$("#news").hidden)renderNewsFeed();},setWatch(list){S.watch=list;store.set("wvfc.watch",JSON.stringify(list));renderWatch();},mine:()=>S.mine||[],watch:()=>(S.watch||[]).map(bare),openStock(sym){openStock(sym);showTab("search",true);},tk:()=>bare(S.tk),prices:()=>S.prices,refreshPicks:()=>refreshPicks(),sectorPie:(...a)=>sectorPie(...a),sectorsFor:t=>sectorsFor(t),stockName:t=>stockName(t),picks:()=>S.picks,classRows:()=>classRows(),calc:p=>calc(p)};
function renderWatch(){
  const box=$("#wl");box.replaceChildren();const on=S.watch.some(w=>bare(w)===bare(S.tk));
  $("#wl-toggle").textContent=on?"On watchlist ✓":"Add to watchlist";
  if(!S.watch.length){box.append(el("div",{class:"notice",text:"Nothing saved yet. Search a stock and press Add to watchlist."}));return;}
  for(const w of S.watch)box.append(el("div",{class:"wl-row"},el("button",{class:"go",text:bare(w),onclick:()=>openStock(w)}),el("button",{class:"x","aria-label":`Remove ${bare(w)}`,text:"×",onclick:()=>{S.watch=S.watch.filter(x=>x!==w);saveWatch();renderWatch();}})));
}
$("#wl-toggle").addEventListener("click",()=>{const i=S.watch.findIndex(w=>bare(w)===bare(S.tk));if(i>=0){S.watch.splice(i,1);toast(`Removed ${bare(S.tk)}`);}else{S.watch.unshift(S.tk);toast(`Saved ${bare(S.tk)} to your watchlist`);}saveWatch();renderWatch();});

/* ---------- News ---------- */
const SENT={bullish:["Bullish","M5 1 L9 9 L1 9 Z"],neutral:["Neutral","M1 4 H9 V6 H1 Z"],bearish:["Bearish","M1 1 H9 L5 9 Z"]};
function sentiPill(s){const k=SENT[s]?s:"neutral";const p=el("span",{class:"senti "+k});const ic=sv("svg",{viewBox:"0 0 10 10","aria-hidden":"true"});ic.append(sv("path",{d:SENT[k][1],fill:"currentColor"}));p.append(ic,SENT[k][0]);return p;}
const inPortfolio=tk=>S.picks.some(p=>p.ticker===tk);
// News tab: the market, crypto, then the stocks in the member's own Paper Trading account (My Portfolio).
// The Class Portfolio's stocks have their own News view under the Class Portfolio menu.
const inMine=tk=>(S.mine||[]).includes(tk);
// A stock you own with no brief in news.json gets one written on the spot by the brief server (kept there for a day).
const liveMine=()=>(S.mine||[]).filter(t=>!S.briefs.some(b=>b.ticker===t)).map(t=>liveBriefs[t]).filter(b=>b&&!b.loading&&!b.error&&b.ticker);
const mineBriefs=()=>S.briefs.filter(b=>!b.market&&inMine(b.ticker)&&!S.briefs.some(m=>m.market&&m.ticker===b.ticker)).concat(liveMine());
function visibleBriefs(){return S.briefs.filter(b=>b.market).sort((a,b)=>(a.order||0)-(b.order||0)).concat(mineBriefs().sort((a,b)=>a.ticker.localeCompare(b.ticker)));}
function loadMineBriefs(){if(!S.loaded||!CFG.briefApi)return;
  (S.mine||[]).filter(t=>!S.briefs.some(b=>b.ticker===t)&&!liveBriefs[t]).slice(0,8).forEach(t=>loadLiveBrief(t));}
// "No brief yet" for owned stocks still missing one, or "Writing…" while the brief server works on it.
function mineMissingNote(have){const mine=S.mine||[],miss=mine.filter(t=>!have.some(b=>b.ticker===t));if(!miss.length)return "";
  const busy=miss.filter(t=>liveBriefs[t]&&liveBriefs[t].loading),none=miss.filter(t=>!busy.includes(t));
  return [busy.length?`Writing a brief for ${busy.join(", ")}… this takes about 20 seconds.`:"",none.length?`No brief yet for ${none.join(", ")}.`:""].filter(Boolean).join(" ");}
function briefForSymbol(sym){const t=bare(sym);return visibleBriefs().find(b=>bare(b.symbol||b.ticker)===t||b.ticker===t)||null;}
// Two news boards share this code: the News tab (market, crypto and My Portfolio stocks)
// and "News" under the Class Portfolio menu (only our stocks). ids starting with "c-" are the second one.
const secOf=tk=>{const p=S.picks.find(x=>x.ticker===tk);return p&&p.sector||"";};
// Grouped by sector (A to Z), then ticker, so each sector gets its own heading.
const classBriefs=()=>S.briefs.filter(b=>!b.market&&inPortfolio(b.ticker)).sort((a,b)=>(secOf(a.ticker)||"~").localeCompare(secOf(b.ticker)||"~")||a.ticker.localeCompare(b.ticker));
function newsBoard(cls){
  const id=x=>$("#"+(cls?"c-":"")+x),key=cls?"classTk":"newsTk";
  const list=cls?classBriefs():visibleBriefs();
  const nl=id("nlist"),br=id("brief");nl.replaceChildren();
  if(!list.length){br.replaceChildren(el("div",{class:"empty",style:"border:0"},el("h3",{text:cls?"No briefs for our stocks yet":"No briefs yet"})));id("news-meter-panel").hidden=true;if(cls)id("feed-panel").hidden=true;return;}
  if(cls)id("feed-panel").hidden=false;
  const counts={bullish:0,neutral:0,bearish:0};list.forEach(n=>counts[n.sentiment in counts?n.sentiment:"neutral"]++);
  id("news-meter-panel").hidden=false;const mt=id("news-meter");mt.replaceChildren();
  [["bullish","var(--up)"],["neutral","var(--flat)"],["bearish","var(--down)"]].forEach(([k,c])=>{if(counts[k])mt.append(el("span",{style:`flex:${counts[k]};background:${c}`,title:`${counts[k]} ${k}`}));});
  id("news-legend").replaceChildren(...["bullish","neutral","bearish"].map(k=>el("span",{},el("i",{style:`background:var(--${k==="bullish"?"up":k==="bearish"?"down":"flat"})`}),`${SENT[k][0]} ${counts[k]}`)));
  if(!S[key]||!list.some(n=>n.ticker===S[key]))S[key]=list[0].ticker;
  const mk=list.filter(n=>n.market).length,sk=list.length-mk;const label=t=>el("div",{class:"eyebrow",style:"margin:6px 2px 0",text:t});
  // Groups: the market (S&P 500, Nasdaq, Dow, Russell 2000), crypto (Bitcoin, Ethereum), then the member's own stocks.
  list.forEach((n,i)=>{const prev=list[i-1];if(!cls){if(i===0&&mk&&!n.crypto)nl.append(label("The market"));if(n.crypto&&!(prev&&prev.crypto))nl.append(label("Crypto"));if(i===mk&&sk)nl.append(label("My portfolio"));}
    else if(i===0||secOf(n.ticker)!==secOf(prev.ticker))nl.append(label(secOf(n.ticker)||"Other"));
    nl.append(el("button",{class:"nitem","aria-current":String(n.ticker===S[key]),onclick:()=>{S[key]=n.ticker;newsBoard(cls);cls?renderClassFeed():renderNewsFeed();if(innerWidth<820)br.scrollIntoView({behavior:"smooth",block:"start"});}},el("span",{class:"t",text:n.market?n.name:n.ticker}),sentiPill(n.sentiment),el("span",{class:"h",text:n.headline||""})));});
  if(!cls){const mine=S.mine||[],missing=mine.filter(t=>!list.some(b=>b.ticker===t));
    if(!sk)nl.append(label("My portfolio"));
    if(!mine.length)nl.append(el("div",{class:"notice",text:S.mine?"Buy a stock in Paper Trading and its news shows up here.":"Log in and buy stocks in Paper Trading to see their news here."}));
    else if(missing.length)nl.append(el("div",{class:"notice",text:mineMissingNote(list)}));}
  if(cls){const missing=S.picks.filter(p=>!list.some(b=>b.ticker===p.ticker)).map(p=>p.ticker);if(missing.length)nl.append(el("div",{class:"notice",text:`No brief yet for ${missing.join(", ")}.`}));}
  const n=list.find(x=>x.ticker===S[key]);
  br.replaceChildren(...[
    el("div",{class:"sechead"},el("div",{},el("div",{class:"eyebrow",text:n.market?`${n.crypto?"Crypto":"Market"} brief · ${n.name}`:[n.ticker,n.name,cls&&secOf(n.ticker)].filter(Boolean).join(" · ")}),el("h3",{text:n.headline||""})),sentiPill(n.sentiment)),
    el("p",{class:"lede",text:n.summary||""}),
    el("div",{class:"sides"},el("div",{class:"side-col bull"},el("h4",{text:"What the bulls say"}),el("ul",{},(n.bull||[]).map(x=>el("li",{text:x})))),el("div",{class:"side-col bear"},el("h4",{text:"What the bears say"}),el("ul",{},(n.bear||[]).map(x=>el("li",{text:x}))))),
    n.nextEvent?el("div",{class:"notice"},el("b",{text:"Coming up: "}),n.nextEvent):null,
    el("details",{class:"drop srcdrop"},el("summary",{},el("span",{text:`Sources (${(n.sources||[]).length})`})),el("ul",{class:"sources"},(n.sources||[]).map(s=>el("li",{},el("a",{href:s.url,target:"_blank",rel:"noopener noreferrer",text:s.title}),el("span",{class:"o",text:[s.outlet,s.date].filter(Boolean).join(" · ")}))))),
    el("div",{class:"meta",text:briefWhen(n)}),
    el("div",{},el("button",{class:"btn small",text:`Open ${n.market?n.name:n.ticker} chart →`,onclick:()=>{openStock(n.symbol||n.ticker);showTab("search",true);}}))].filter(Boolean));
}
function renderNews(){
  renderRecap();
  const list=visibleBriefs();$("#cnt-news").textContent=list.length?String(list.length):"";
  newsBoard(false);newsBoard(true);renderUpcoming();
}
/* ---------- News tab: Upcoming calendar (under My portfolio) ---------- */
// Market-wide dates come from data/market-calendar.json. Earnings days for the member's own
// Paper Trading stocks come from Finnhub through Supabase (supabase/calendar.sql). Dividend and other
// dates come from each stock's news brief ("Coming up"), when the brief gives a date.
const CAL_KIND={
  fed:["Fed","The Federal Reserve decides interest rates. Lower rates usually help stocks, higher rates can hurt them."],
  jobs:["Jobs","The government says how many jobs were added last month. It shows if the economy is strong or slowing down."],
  cpi:["Inflation","Shows how fast prices for everyday things are rising. High inflation can mean higher interest rates."],
  closed:["No trading","The stock market is closed, so Paper Trading can't buy or sell today."],
  early:["Short day","The market closes at 1pm Eastern (noon Chicago time) instead of 4pm."]};
async function loadEarnings(){
  const ss=window.WVFC_SESSION;if(!ss||!ss.db||!(S.mine||[]).length){S.earn=[];renderUpcoming();return;}
  try{const{data,error}=await ss.db.rpc("my_calendar");S.earn=!error&&Array.isArray(data)?data:[];}catch(e){S.earn=[];}
  renderUpcoming();
}
function upcomingRows(){
  const today=new Date();today.setHours(0,0,0,0);const end=new Date(today.getTime()+92*864e5);
  const day=iso=>new Date(iso+"T12:00:00");const inRange=d=>d&&d>=today&&d<=end;const rows=[];
  const EARN="The company shares how much money it made. The stock often jumps or drops a lot right after.";
  (S.marketCal||[]).forEach(e=>{const d=day(e.date),k=CAL_KIND[e.type]||["",""];if(inRange(d))rows.push({d,k:e.type,title:e.title,mean:k[1]});});
  const mine=S.mine||[],earnTk=new Set();
  (S.earn||[]).forEach(e=>{const d=e.date&&day(e.date);if(!inRange(d)||!mine.includes(e.symbol)||earnTk.has(e.symbol+e.date))return;earnTk.add(e.symbol+e.date);
    const when=e.hour==="bmo"?"Before the market opens. ":e.hour==="amc"?"After the market closes. ":"";
    rows.push({d,k:"earn",tk:e.symbol,title:`${e.symbol} earnings`,mean:when+EARN});});
  mine.forEach(tk=>{const b=S.briefs.find(x=>x.ticker===tk);if(!b||!b.nextEvent)return;const d=eventDate(b.nextEvent);if(!inRange(d))return;
    const div=/dividend/i.test(b.nextEvent),earn=/earning|results/i.test(b.nextEvent);
    if(earn&&[...earnTk].some(k=>k.startsWith(tk)))return;
    const amt=(b.nextEvent.match(/\$\d+(?:\.\d+)?/)||[""])[0];
    rows.push({d,k:div?"div":earn?"earn":"other",tk,title:div?`${tk} dividend${amt?" "+amt+"/share":""}`:earn?`${tk} earnings`:`${tk}: ${b.nextEvent}`,
      mean:b.nextEvent.replace(/\.\s*$/,"")+". "+(div?"The company pays its owners a little cash for each share. (Paper Trading doesn't pay dividends.)":earn?EARN:"")});});
  return rows.sort((a,b)=>a.d-b.d||(a.tk?1:0)-(b.tk?1:0));
}
// One short line per date; tap a line to see what it means.
function renderUpcoming(){
  const box=$("#upcoming");if(!box)return;const rows=upcomingRows();box.hidden=!rows.length;if(!rows.length)return;
  const shown=S.upAll?rows:rows.slice(0,5);
  const more=rows.length>5?el("button",{type:"button",class:"btn small evmore",text:S.upAll?"Show fewer":`Show all ${rows.length}`,onclick:()=>{S.upAll=!S.upAll;renderUpcoming();}}):null;
  box.replaceChildren(el("div",{class:"eyebrow",style:"margin:6px 2px 0",text:"Upcoming"}),
    el("div",{class:"uplist"},shown.map(r=>el("details",{class:"uprow"},
      el("summary",{},el("span",{class:"ud",text:r.d.toLocaleDateString("en-US",{month:"short",day:"numeric"})}),el("span",{class:"ut",text:r.title})),
      el("div",{class:"um"},el("span",{text:r.d.toLocaleDateString("en-US",{weekday:"long"})+". "+(r.mean||"")}),
        r.tk&&visibleBriefs().some(b=>b.ticker===r.tk)?el("button",{type:"button",class:"btn small",text:`Read the ${r.tk} brief`,onclick:()=>{S.newsTk=r.tk;newsBoard(false);renderNewsFeed();$("#brief").scrollIntoView({behavior:"smooth",block:"start"});}}):null)))),
    ...(more?[more]:[]));
}
// Headlines from only the last 30 days (supabase/recent-news.sql, from Finnhub). TradingView's news box
// can show years-old stories, so it's only used if that list can't load (for example before the SQL is run).
function newsKey(sym,crypto){const raw=String(sym||"").toUpperCase();
  if(crypto||/^(COINBASE|BINANCE|BITSTAMP|KRAKEN|CRYPTO|BITFINEX):/.test(raw))return "CRYPTO";
  if(!raw||/^(FOREXCOM|TVC|SP|INDEX|CBOE|DJ|OANDA|FX|FX_IDC):/.test(raw))return "MARKET";
  const t=bare(raw);
  // Crypto searched without an exchange, like ETHUSD, BTCUSDT or BTC-USD.
  if(/^(BTC|ETH|SOL|XRP|DOGE|ADA|LTC|BNB|AVAX|DOT|LINK|SHIB|MATIC|TRX)(-?USDT?|-?USDC)?$/.test(t))return "CRYPTO";
  // Market indexes and the funds that follow them.
  if(/^(SPX|SPY|NDX|IXIC|QQQ|DJI|DIA|VOO|IVV|VTI|IWM|RUT)$/.test(t))return "MARKET";
  return t;}
function ago(t){const m=Math.max(1,Math.round((Date.now()/1000-t)/60));
  if(m<60)return m+" min ago";const h=Math.round(m/60);if(h<24)return h+(h===1?" hour ago":" hours ago");const d=Math.round(h/24);return d+(d===1?" day ago":" days ago");}
async function recentNews(box,key,fallback){
  const n=(box._rn=(box._rn||0)+1);const ss=window.WVFC_SESSION;
  if(!ss||!ss.db){box.classList.remove("rn");fallback();return;}
  box.classList.add("rn");box.replaceChildren(el("p",{class:"meta rn-msg",text:"Loading the latest news…"}));
  let data=null,error=null;try{({data,error}=await ss.db.rpc("recent_news",{sym:key}));}catch(e){error=e;}
  if(box._rn!==n)return;
  if(error||!Array.isArray(data)){box.classList.remove("rn");fallback();return;}
  // Nothing about this one lately (small companies, funds): show market news, and say so.
  let note=null;
  if(!data.length&&key!=="MARKET"){
    let more=null;try{({data:more}=await ss.db.rpc("recent_news",{sym:"MARKET"}));}catch(e){}
    if(box._rn!==n)return;
    if(Array.isArray(more)&&more.length){data=more;note=el("p",{class:"meta rn-msg",text:`No news about ${key==="CRYPTO"?"crypto":key} in the last 30 days, so here's general market news.`});}
  }
  if(!data.length){box.replaceChildren(el("p",{class:"meta rn-msg",text:"No news in the last 30 days."}));return;}
  box.replaceChildren(...(note?[note]:[]),el("ul",{class:"rnews"},data.map(x=>el("li",{},
    el("a",{href:x.url,target:"_blank",rel:"noopener noreferrer",text:x.headline}),
    el("span",{class:"o",text:[x.source,x.time?ago(x.time):""].filter(Boolean).join(" · ")})))),
    el("p",{class:"meta rn-foot",text:"Only news from the last 30 days."}));
}
function renderNewsFeed(){
  const n=visibleBriefs().find(x=>x.ticker===S.newsTk);const key=(n?n.ticker:"mkt")+tvTheme();if(rendered.news===key)return;rendered.news=key;
  const theme=tvTheme();
  if(n&&(!n.market||n.crypto)){$("#feed-label").textContent=`Live headlines · ${n.crypto?"Crypto":n.ticker}`;recentNews($("#tv-newsfeed"),newsKey(n.symbol||n.ticker,n.crypto),()=>tv($("#tv-newsfeed"),"timeline",{feedMode:"symbol",symbol:n.symbol||n.ticker,colorTheme:theme,isTransparent:true,displayMode:"regular",width:"100%",height:"100%"}));}
  else{$("#feed-label").textContent="Live headlines · US stock market";recentNews($("#tv-newsfeed"),"MARKET",()=>tv($("#tv-newsfeed"),"timeline",{feedMode:"market",market:"stock",colorTheme:theme,isTransparent:true,displayMode:"regular",width:"100%",height:"100%"}));}
}
function renderClassFeed(){
  const n=classBriefs().find(x=>x.ticker===S.classTk);if(!n)return;const key=n.ticker+tvTheme();if(rendered.classnews===key)return;rendered.classnews=key;
  $("#c-feed-label").textContent=`Live headlines · ${n.ticker}`;
  recentNews($("#c-tv-newsfeed"),newsKey(n.symbol||n.ticker,n.crypto),()=>tv($("#c-tv-newsfeed"),"timeline",{feedMode:"symbol",symbol:n.symbol||n.ticker,colorTheme:tvTheme(),isTransparent:true,displayMode:"regular",width:"100%",height:"100%"}));
}
// On Search, show the club's brief for the stock whenever one exists, even if it isn't in the portfolio.
function anyBriefFor(sym){const t=bare(sym);return S.briefs.find(b=>bare(b.symbol||b.ticker)===t||b.ticker===t)||null;}
// Briefs written on the spot by the brief server, kept for this page visit.
const liveBriefs={};
async function loadLiveBrief(sym){
  const t=bare(sym);if(liveBriefs[t])return;liveBriefs[t]={loading:true};
  let r;
  try{r=await fetch(`${CFG.briefApi.replace(/\/$/,"")}/brief?symbol=${encodeURIComponent(sym)}`);}
  catch(e){liveBriefs[t]={error:"The brief couldn't be loaded. Check your connection and try again."};}
  if(r){let b=null;try{b=await r.json();}catch(e){}
    liveBriefs[t]=r.ok&&b?b:{error:(b&&b.error)||"The brief couldn't be written right now. Try again in a minute."};}
  if(bare(S.tk)===t)renderSearchBrief();
  if(inMine(t)){rendered.news=null;renderNews();renderHomeNews();}
}
// The 3 newest articles behind the current stock's brief, shown above the headlines dropdown.
function renderLatest3(n){
  const box=$("#latest3");const src=(n&&n.sources||[]).slice().sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0)).slice(0,3);
  box.hidden=!src.length;if(!src.length)return;
  box.replaceChildren(el("h3",{class:"h3",text:src.length===3?"3 latest articles":"Latest articles"}),
    el("ul",{class:"latestlist"},src.map(s=>el("li",{},el("a",{href:s.url,target:"_blank",rel:"noopener noreferrer",text:s.title}),el("span",{class:"o",text:[s.outlet,s.date].filter(Boolean).join(" · ")})))));
}
function renderSearchBrief(){
  renderLatest3(anyBriefFor(S.tk)||(liveBriefs[bare(S.tk)]&&!liveBriefs[bare(S.tk)].loading&&!liveBriefs[bare(S.tk)].error?liveBriefs[bare(S.tk)]:null));
  const box=$("#s-brief");let n=anyBriefFor(S.tk);
  if(!n&&CFG.briefApi){const t=bare(S.tk),lb=liveBriefs[t];
    if(!lb||lb.loading){box.hidden=false;box.replaceChildren(el("div",{class:"eyebrow",text:`News brief · ${t}`}),el("h3",{class:"loading",text:"Brief loading…"}),el("p",{class:"meta",text:"Reading the latest news about this stock. This usually takes 10 to 20 seconds."}));if(!lb)loadLiveBrief(S.tk);return;}
    if(lb.error){box.hidden=false;box.replaceChildren(el("div",{class:"eyebrow",text:`News brief · ${t}`}),el("p",{text:lb.error}),el("button",{class:"btn small",text:"Try again",onclick:()=>{delete liveBriefs[t];renderSearchBrief();}}));return;}
    n=lb;}
  box.hidden=!n;if(!n)return;
  const inNews=visibleBriefs().includes(n);
  box.replaceChildren(...[
    el("div",{class:"sechead"},el("div",{},el("div",{class:"eyebrow",text:`News brief · ${n.market?n.name:n.ticker}`}),el("h3",{text:n.headline||""})),sentiPill(n.sentiment)),
    el("p",{class:"lede",text:n.summary||""}),
    el("div",{class:"sides"},el("div",{class:"side-col bull"},el("h4",{text:"What the bulls say"}),el("ul",{},(n.bull||[]).map(x=>el("li",{text:x})))),el("div",{class:"side-col bear"},el("h4",{text:"What the bears say"}),el("ul",{},(n.bear||[]).map(x=>el("li",{text:x}))))),
    el("div",{class:"meta",text:`From ${(n.sources||[]).length} ${(n.sources||[]).length===1?"article":"articles"} · ${briefWhen(n).replace(/^./,c=>c.toLowerCase())}`}),
    inNews?el("div",{},el("button",{class:"btn small",text:"Sources and full brief →",onclick:()=>{S.newsTk=n.ticker;renderNews();showTab("news",true);}})):el("details",{class:"drop srcdrop"},el("summary",{},el("span",{text:`Sources (${(n.sources||[]).length})`})),el("ul",{class:"sources"},(n.sources||[]).map(s=>el("li",{},el("a",{href:s.url,target:"_blank",rel:"noopener noreferrer",text:s.title}),el("span",{class:"o",text:[s.outlet,s.date].filter(Boolean).join(" · ")})))))].filter(Boolean));
}

/* ---------- Boot ---------- */
let rsT;window.addEventListener("resize",()=>{clearTimeout(rsT);rsT=setTimeout(()=>{renderCompare();if(S_view==="history")renderHistory();},120);});
darkMQ.addEventListener&&darkMQ.addEventListener("change",()=>{rendered.search=null;rendered.news=null;rendered.classnews=null;renderPicks();const t=location.hash.slice(1);if(t==="search")renderSearch();if(t==="news")renderNewsFeed();if(t==="classnews")renderClassFeed();});
/* ---------- Schools ---------- */
// data/schools.json lists every school and where its Class Portfolio file is.
const OK_PICK=p=>p&&p.ticker&&p.entryPrice>0&&p.entryDate;
const DEFAULT_SCHOOLS=[{id:"wvhs",name:"Waubonsie Valley",portfolio:"data/portfolio.json"}];
// A school's Class Portfolio = the stocks in its website file, plus what teachers bought on the site
// (saved in the database, supabase/class-portfolio.sql), minus what teachers sold.
let pfCache={},classDB=null;
const CLASS_COLS="id,school_id,ticker,symbol,name,sector,entry_date,entry_price,invested,shares,spy_entry_price,pitched_by,thesis,from_file,bought_at,sold_at,sold_price";
function classRows(){
  if(classDB)return classDB;const ses=window.WVFC_SESSION;if(!ses)return Promise.resolve([]);
  classDB=Promise.all([ses.db.from("class_picks").select(CLASS_COLS).order("bought_at"),ses.db.rpc("class_prices")]).then(([r,px])=>{
    for(const x of (px&&px.data)||[])S.livePx[x.symbol]=+x.price;return r.error?[]:(r.data||[]);}).catch(()=>[]);
  return classDB;
}
const dbPick=r=>({ticker:r.ticker,symbol:r.symbol||r.ticker,name:r.name||r.ticker,sector:r.sector||"",entryDate:r.entry_date,entryPrice:+r.entry_price,
  invested:+r.invested,shares:+r.shares,spyEntryPrice:r.spy_entry_price?+r.spy_entry_price:undefined,pitchedBy:r.pitched_by||"",thesis:r.thesis||"",dbId:r.id});
function schoolPicks(sc){
  if(!pfCache[sc.id])pfCache[sc.id]=Promise.all([loadJSON(sc.portfolio).then(j=>j.picks||[]).catch(()=>[]),classRows()]).then(([file,rows])=>{
    rows=rows.filter(r=>r.school_id===sc.id);
    const soldFile=new Set(rows.filter(r=>r.from_file).map(r=>r.ticker+"|"+r.entry_date));
    return file.filter(p=>!soldFile.has(String(p.ticker||"").toUpperCase()+"|"+p.entryDate))
      .concat(rows.filter(r=>!r.from_file&&!r.sold_at).map(dbPick)).filter(OK_PICK);});
  return pfCache[sc.id];
}
// After a teacher buys or sells: load the Class Portfolio again and redraw it.
async function refreshPicks(){pfCache={};classDB=null;if(!S.school)return;S.picks=await schoolPicks(S.school);rendered.classnews=null;renderTape();renderPortfolio();renderNews();}
// One school's Class Portfolio as a whole: money in, worth now, and the same money in the S&P 500.
function schoolTotals(picks){
  let inv=0,val=0,spy=0,priced=0,spyOK=true;
  for(const p of picks){const c=calc(p);if(!c||!c.invested)continue;priced++;inv+=c.invested;val+=c.value;if(c.spyValue==null)spyOK=false;else spy+=c.spyValue;}
  return{count:picks.length,priced,inv,val,ret:inv?val/inv-1:null,spyRet:inv&&spyOK?spy/inv-1:null};
}
async function renderSchools(){
  const box=$("#schools-body");if(!S.loaded){box.replaceChildren(el("p",{class:"meta",text:"Loading…"}));return;}
  const rows=await Promise.all(S.schools.map(async sc=>({sc,t:schoolTotals(await schoolPicks(sc))})));
  rows.sort((a,b)=>(b.t.ret==null?-1e9:b.t.ret)-(a.t.ret==null?-1e9:a.t.ret));
  let rank=0;
  box.replaceChildren(el("ol",{class:"ptboard schools"},rows.map(({sc,t})=>{
    const has=t.ret!=null;if(has)rank++;const mine=S.school&&sc.id===S.school.id;
    const note=has?`${t.count} ${t.count===1?"stock":"stocks"}`+(t.spyRet!=null?` · S&P 500 ${fmtPct(t.spyRet)} with the same money`:""):"No picks yet";
    return el("li",{class:mine?"me":""},el("span",{class:"r",text:has?"#"+rank:"–"}),
      el("span",{class:"n",text:sc.name+(mine?(window.WVFC_ROLE==="admin"?" (viewing)":" (your school)"):"")},el("small",{class:"sc",text:note})),
      el("span",{class:"g "+(has?cls(t.ret):""),text:has?fmtPct(t.ret):"–"}),el("span",{class:"v",text:has?fmt0(t.val):""}));})),
    el("p",{class:"meta",style:"margin-top:12px",text:"Ranked by % gain, so a school with fewer picks can still win. Prices are the latest daily closes."}));
}

// The header always says Simple Street. Class members see their club's name under it and their school's colors.
function showBrand(sc){
  document.title="Simple Street";
  const id=S.individual?"me":sc.id;
  document.documentElement.dataset.school=id;try{localStorage.setItem("wvfc.theme",id);}catch(e){}
  $("#school-name").textContent=S.individual?"":(sc.club||sc.name);
  $("#brand-link").setAttribute("href",S.individual?"#mine":"#portfolio");
}

// The strip across the top of the log in screen: the same moving ticker as inside the site.
function renderGateTick(){
  const box=$("#gate-tick");if(!box||box.dataset.done)return;box.dataset.done="1";
  buildTape(box,TAPE_FILL);
}

/* ---------- "Just me" accounts (supabase/individual.sql) ---------- */
// Tabs become Home · Paper Trading · News · Leaderboard.
function setupIndividual(){
  $("#tab-portfolio").hidden=true;
  // Home gets a drop-down like the Class Portfolio. The stocks table and waiting orders move to "My stocks".
  const home=$("#tab-mine").cloneNode(false);
  home.classList.add("hasmenu");home.setAttribute("aria-haspopup","menu");home.setAttribute("aria-expanded","false");
  home.replaceChildren("Home",el("span",{class:"caret","aria-hidden":"true"}));$("#tab-mine").replaceWith(home);
  const hm={tab:home,menu:$("#mine-menu")};menus.push(hm);addMenu(hm);
  $("#mine-stocks-box").append($("#mine-hold"),$("#mine-orders"));
  const old=$("#tab-district"),lb=old.cloneNode(false);
  lb.classList.remove("hasmenu");lb.removeAttribute("aria-haspopup");lb.removeAttribute("aria-expanded");lb.textContent="Leaderboard";
  lb.addEventListener("click",()=>showTab("dpeople",true));old.replaceWith(lb);
  const h=new Date().getHours(),hi=h<12?"Good morning":h<17?"Good afternoon":"Good evening";
  const first=String(window.WVFC_NAME||"").split(/\s+/)[0];
  $("#mine-title").textContent=first?`${hi}, ${first}`:hi;
  
  $("#dpeople-title").textContent="Leaderboard";
  $("#dpeople-sub").textContent="Everyone playing Paper Trading on Simple Street, ranked by how much their $50,000 has grown, in %.";
  $("#pt-board-title").textContent="Leaderboard";
  $("#join-class").hidden=!!$("#join-class").dataset.off;
  renderHomeNews();
}
// Home: the news briefs for the stocks you own, newest market brief first.
function renderHomeNews(){
  const box=$("#mine-news");if(!S.individual||!box)return;box.hidden=false;
  const mine=S.mine||[],market=S.briefs.find(b=>b.market&&b.ticker==="SP500");
  const own=mineBriefs();
  const why=t=>{const m=String(t||"").match(/^.*?[.!?](\s|$)/);return m?m[0].trim():String(t||"");};
  const item=(b,label)=>el("li",{},el("button",{type:"button",onclick:()=>{S.newsTk=b.ticker;renderNews();showTab("news",true);}},
    el("span",{class:"hh"},el("span",{class:"tkp",text:label}),b.headline||""),el("span",{class:"hw",text:why(b.summary)})));
  const rows=[market&&item(market,"Market"),...own.map(b=>item(b,b.ticker))].filter(Boolean);
  box.replaceChildren(el("h3",{class:"h3",text:"News for your stocks"}),
    el("p",{class:"meta",text:mine.length?[own.length?"Plain-English briefs for what you own. Tap one to read it all.":"",mineMissingNote(own)].filter(Boolean).join(" "):"Buy a stock in Paper Trading and its news shows up here."}),
    rows.length?el("ul",{class:"homenews"},rows):"");
}

async function boot(){
  renderWatch();renderQuick();
  const [sl,nw,px,mc]=await Promise.allSettled([loadJSON("data/schools.json"),loadJSON("data/news.json"),loadJSON("data/prices.json"),loadJSON("data/market-calendar.json")]);
  if(mc.status==="fulfilled")S.marketCal=mc.value.events||[];
  if(px.status==="fulfilled"&&px.value&&px.value.closes)S.prices=px.value;
  renderGateTick();
  S.schools=sl.status==="fulfilled"&&sl.value.schools&&sl.value.schools.length?sl.value.schools:DEFAULT_SCHOOLS;
  // Wait for the login to say which school this is (a page with no login shows the log in box anyway).
  const sid=await Promise.race([schoolReady,new Promise(r=>setTimeout(()=>r(null),10000))]);
  S.individual=sid==="me";
  S.school=S.schools.find(sc=>sc.id===sid)||S.schools[0];
  showBrand(S.school);
  S.picks=S.individual?[]:await schoolPicks(S.school);
  if(nw.status==="fulfilled"){S.briefs=nw.value.briefs||[];S.marketRecap=nw.value.market||null;if(nw.value.updated)$("#news-asof").textContent="News briefs updated "+fmtDate(nw.value.updated);}
  S.loaded=true;renderTape();renderPortfolio();renderNews();
  if(S.individual)setupIndividual();
  loadMineBriefs();
  const fromWidget=new URLSearchParams(location.search).get("tvwidgetsymbol");
  if(fromWidget){try{history.replaceState(null,"",location.pathname+"#search")}catch(e){}openStock(fromWidget.toUpperCase());}
  showTab(location.hash.slice(1)||(S.individual?"mine":"portfolio"));
  if(S.picks.length&&CFG.finnhubKey){await Promise.all(S.picks.map(p=>quote(p.ticker)).concat([quote("SPY")]));renderTiles();renderCompare();renderPicks();renderBreakdown();}
}
boot();

/* ---------- Suggestions ---------- */
// Saved on the brief server. Members never see vote counts; only the club leader does.
const IDEA_API=(CFG.briefApi||"").replace(/\/$/,"");
const voter=(()=>{let v=store.get("wvfc.voter");if(!/^[a-z0-9]{12,40}$/.test(v||"")){v=Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(36).padStart(2,"0")).join("").slice(0,20);store.set("wvfc.voter",v);}return v;})();
const IDEA_HINTS={pitch:["Stock name or ticker, like Costco","Why should the club debate it? (optional)"],topic:["Topic, like how ETFs work","What should we learn? (optional)"]};
async function ideaCall(path,body){
  const r=await fetch(IDEA_API+path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{});
  let j={};try{j=await r.json();}catch(e){}
  if(!r.ok)throw new Error(j.error||"Something went wrong. Try again in a minute.");
  return j;
}
const ideaForm=$("#idea-form"),ideaText=$("#idea-text"),ideaWhy=$("#idea-why"),ideaMsg=$("#idea-msg");
function ideaKind(){return ideaForm.querySelector("input[name=kind]:checked").value;}
function setIdeaHints(){const[a,b]=IDEA_HINTS[ideaKind()];ideaText.placeholder=a;ideaWhy.placeholder=b;}
ideaForm.addEventListener("change",setIdeaHints);setIdeaHints();
ideaForm.addEventListener("submit",async e=>{
  e.preventDefault();const kind=ideaKind(),text=ideaText.value.trim();
  if(!text){ideaMsg.textContent="Write your idea first.";ideaText.focus();return;}
  const btn=ideaForm.querySelector("button[type=submit]");btn.disabled=true;ideaMsg.textContent="Sending…";
  try{await ideaCall("/suggest",{kind,text,why:ideaWhy.value.trim()});
    ideaText.value="";ideaWhy.value="";
    ideaMsg.textContent="Thanks! Your idea is on the list.";
    loadIdeas(true);}
  catch(err){ideaMsg.textContent=err.message;}
  btn.disabled=false;
});
let ideasLoaded=false;
async function loadIdeas(force){
  if(ideasLoaded&&!force)return;ideasLoaded=true;
  if(!IDEA_API){$("#ideas-pitch").replaceChildren(el("li",{class:"empty",text:"Suggestions aren't set up yet."}));return;}
  let d;try{d=await ideaCall("/suggest?voter="+voter);}catch(e){ideasLoaded=false;for(const k of["pitch","topic"])$("#ideas-"+k).replaceChildren(el("li",{class:"empty",text:"Ideas couldn't be loaded. Try again in a minute."}));return;}
  const voted=new Set(d.voted||[]);
  for(const k of["pitch","topic"]){
    const list=(d.items||[]).filter(i=>i.kind===k);
    $("#ideas-"+k).replaceChildren(...(list.length?list.map(i=>ideaRow(i,voted.has(i.id))):[el("li",{class:"empty",text:k==="pitch"?"No stock ideas yet. Be the first!":"No topic ideas yet. Be the first!"})]));
  }
}
function ideaRow(i,done){
  const b=el("button",{type:"button",class:"btn small vote","aria-pressed":String(done),text:done?"Upvoted ✓":"▲ Upvote",disabled:done});
  b.addEventListener("click",async()=>{b.disabled=true;b.textContent="…";
    try{await ideaCall("/suggest/vote",{id:i.id,voter});b.textContent="Upvoted ✓";b.setAttribute("aria-pressed","true");}
    catch(e){b.disabled=false;b.textContent="▲ Upvote";toast(e.message);}});
  return el("li",{},el("div",{},el("div",{class:"t",text:i.text}),i.why?el("div",{class:"w",text:i.why}):null),b);
}
// Club leader view. The password stays only in this tab's memory and is checked by the server.
let leaderPass="";
$("#leader-open").addEventListener("click",()=>{const f=$("#leader-form");f.hidden=!f.hidden;if(!f.hidden)$("#leader-pass").focus();});
$("#leader-form").addEventListener("submit",e=>{e.preventDefault();leaderPass=$("#leader-pass").value;leaderLoad();});
const KIND_NAME={pitch:"Stock to pitch",topic:"Meeting topic",feedback:"Site feedback"};
async function leaderLoad(action,id){
  const msg=$("#leader-msg");msg.textContent=action?"":"Checking…";
  let d;try{d=await ideaCall("/suggest/admin",{password:leaderPass,action,id});}
  catch(e){msg.textContent=e.message;$("#leader-view").hidden=true;return;}
  msg.textContent="";$("#leader-form").hidden=true;$("#leader-pass").value="";
  const v=$("#leader-view");v.hidden=false;
  const act=(label,a,it)=>el("button",{type:"button",class:"btn small",text:label,onclick:()=>{if(a!=="delete"||confirmDelete(it))leaderLoad(a,it.id);}});
  v.replaceChildren(el("div",{class:"sechead"},el("h3",{class:"h3",text:"Leader view: all ideas, most votes first"}),el("button",{type:"button",class:"btn ghost small",text:"Close",onclick:()=>{v.hidden=true;leaderPass="";}})),
    ...(d.items.length?d.items.map(it=>el("div",{class:"lrow"+(it.hidden?" off":"")},
      el("div",{class:"n",title:"votes",text:it.kind==="feedback"?"–":String(it.votes)}),
      el("div",{},el("div",{class:"k",text:KIND_NAME[it.kind]+" · "+fmtDate(it.at)+(it.hidden?" · hidden":"")}),el("div",{class:"t",text:it.text}),it.why?el("div",{class:"meta",text:it.why}):null),
      el("div",{class:"acts"},it.kind==="feedback"?null:act(it.hidden?"Show":"Hide",it.hidden?"show":"hide",it),act("Delete","delete",it)))):[el("p",{class:"meta",text:"No ideas yet."})]));
  if(action)loadIdeas(true);
}
// Two taps to delete, without a pop-up box.
const armed=new Set();
function confirmDelete(it){if(armed.has(it.id))return true;armed.add(it.id);toast("Tap Delete again to remove it for good.");setTimeout(()=>armed.delete(it.id),4000);return false;}
})();
