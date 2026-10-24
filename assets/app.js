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
const fmtDate=s=>{const[y,m,d]=s.slice(0,10).split("-").map(Number);return MON[m-1]+" "+d+", "+y;};
const cls=v=>v>0.0005?"up":v<-0.0005?"down":"flat";
const arrow=v=>v>0.0005?"▲":v<-0.0005?"▼":"■";
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),2400);}
const bare=sym=>String(sym).split(":").pop().toUpperCase();

/* ---------- TradingView widgets ---------- */
const darkMQ=window.matchMedia("(prefers-color-scheme: dark)");
const tvTheme=()=>"dark";
function tv(container,name,config){
  if(!container)return;container.replaceChildren();
  const wrap=el("div",{class:"tradingview-widget-container"},el("div",{class:"tradingview-widget-container__widget"}));
  const s=document.createElement("script");s.type="text/javascript";s.async=true;
  s.src=`https://s3.tradingview.com/external-embedding/embed-widget-${name}.js`;
  s.textContent=JSON.stringify(Object.assign({locale:"en"},config));
  wrap.append(s);container.append(wrap);
}

/* ---------- State ---------- */
const S={picks:[],briefs:[],quotes:{},tk:(store.get("wvfc.tk")||"NVDA"),newsTk:null,watch:[]};
try{S.watch=JSON.parse(store.get("wvfc.watch")||"[]").filter(x=>typeof x==="string");}catch(e){S.watch=[];}

/* ---------- Tabs ---------- */
const TABS=["portfolio","search","news"];const rendered={};
function showTab(name,push){
  if(!TABS.includes(name))name="portfolio";
  for(const t of TABS){$("#"+t).hidden=t!==name;$("#tab-"+t).setAttribute("aria-selected",String(t===name));}
  if(push){try{history.replaceState(null,"","#"+name)}catch(e){}}
  if(name==="search"&&rendered.search!==S.tk+tvTheme())renderSearch();
  if(name==="news")renderNewsFeed();
  window.scrollTo({top:0});
}
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab,true)));
window.addEventListener("hashchange",()=>showTab(location.hash.slice(1)));

/* ---------- Data ---------- */
async function loadJSON(path){const r=await fetch(path+"?v="+Date.now(),{cache:"no-store"});if(!r.ok)throw new Error(path+" "+r.status);return r.json();}
async function quote(tk){
  if(!CFG.finnhubKey)return null;
  if(S.quotes[tk])return S.quotes[tk];
  try{const r=await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(tk)}&token=${encodeURIComponent(CFG.finnhubKey)}`);if(!r.ok)return null;const j=await r.json();if(!(j&&j.c>0))return null;S.quotes[tk]=j;return j;}catch(e){return null;}
}

/* ---------- Ticker tape ---------- */
function renderTape(){
  const syms=[{proName:"FOREXCOM:SPXUSD",title:"S&P 500"},{proName:"FOREXCOM:NSXUSD",title:"Nasdaq 100"},{proName:"FOREXCOM:DJI",title:"Dow 30"}]
    .concat(S.picks.map(p=>({proName:p.symbol||p.ticker,title:p.ticker})));
  tv($("#tape"),"ticker-tape",{symbols:syms,showSymbolLogo:true,isTransparent:true,displayMode:"adaptive",colorTheme:"dark"});
}

/* ---------- Portfolio ---------- */
function calc(p){
  const q=S.quotes[p.ticker],spy=S.quotes.SPY;if(!q)return null;
  const cur=q.c,ret=cur/p.entryPrice-1;const spyRet=spy&&p.spyEntryPrice?spy.c/p.spyEntryPrice-1:null;
  const shares=p.shares||(p.invested?p.invested/p.entryPrice:null);const invested=shares?(p.invested||shares*p.entryPrice):null;
  const value=shares?shares*cur:null;
  return{cur,ret,spyRet,alpha:spyRet==null?null:ret-spyRet,shares,invested,value,gain:value!=null?value-invested:null,spyValue:invested&&spyRet!=null?invested*(1+spyRet):null,day:q.dp/100};
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
  if(S.picks.length&&!CFG.finnhubKey){note.hidden=false;note.textContent="Live dollar values turn on once a Finnhub key is added to config.js. The charts on each pick are already live.";}
  else if(S.picks.length&&!all){note.hidden=false;note.textContent="Some live prices didn't load. Refresh the page to try again.";}
  else note.hidden=true;
}
function niceStep(raw){const p=Math.pow(10,Math.floor(Math.log10(raw)));const f=raw/p;return(f<1.5?1:f<3?2:f<7?5:10)*p;}
function renderCompare(){
  const rows=S.picks.map(p=>({p,c:calc(p)})).filter(r=>r.c&&r.c.spyRet!=null);const panel=$("#cmp-panel"),box=$("#cmp");
  panel.hidden=!rows.length;if(!rows.length)return;
  const W=Math.max(300,box.clientWidth||680),rowH=44,labW=56,padR=60,top=8,H=top+rows.length*rowH+22;
  const vals=rows.flatMap(r=>[r.c.ret,r.c.spyRet,0]);let mn=Math.min(...vals),mx=Math.max(...vals);const pad=(mx-mn)*0.08||0.05;mn-=pad;mx+=pad;
  const x=v=>labW+(v-mn)/(mx-mn)*(W-labW-padR);
  const svg=sv("svg",{viewBox:`0 0 ${W} ${H}`,role:"img","aria-label":"Each pick's return compared with the S&P 500 over the same dates"});
  const step=niceStep((mx-mn)/5);for(let v=Math.ceil(mn/step)*step;v<=mx;v+=step){const X=x(v);svg.append(sv("line",{x1:X,x2:X,y1:top,y2:H-20,stroke:"var(--line)","stroke-width":Math.abs(v)<1e-9?1.5:1}));const t=sv("text",{x:X,y:H-6,"text-anchor":"middle"});t.textContent=(v>=0?"+":"")+Math.round(v*100)+"%";svg.append(t);}
  rows.forEach((r,i)=>{const y0=top+i*rowH;const lab=sv("text",{x:0,y:y0+rowH/2+4,style:"fill:var(--ink);font-weight:500;font-size:13px"});lab.textContent=r.p.ticker;svg.append(lab);
    [[r.c.ret,"var(--gold)",y0+8],[r.c.spyRet,"var(--muted)",y0+24]].forEach(([v,col,y],j)=>{const a=x(0),b=x(v);const g=sv("g");
      g.append(sv("rect",{x:Math.min(a,b),y,width:Math.max(1,Math.abs(b-a)),height:13,rx:3,fill:col}));
      const t=sv("text",{x:v>=0?b+6:b-6,y:y+11,"text-anchor":v>=0?"start":"end",style:j===0?"fill:var(--ink)":"fill:var(--ink-2)"});t.textContent=fmtPct(v);g.append(t);
      const ti=sv("title");ti.textContent=`${j===0?r.p.ticker:"S&P 500"}: ${fmtPct(v)} since ${fmtDate(r.p.entryDate)}`;g.append(ti);svg.append(g);});});
  box.replaceChildren(svg);
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
  const grid=el("div",{class:"picks"});
  for(const p of S.picks){
    const c=calc(p);const sym=p.symbol||p.ticker;const mini=el("div",{class:"mini"});
    const d=p.debate;const tot=d?(d.votesFor||0)+(d.votesAgainst||0):0;
    grid.append(el("article",{class:"pick"},
      el("div",{class:"pick-top"},
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
      el("div",{},el("button",{class:"btn small",text:"Full chart & news →",onclick:()=>{openStock(sym);showTab("search",true);}}))));
    tv(mini,"mini-symbol-overview",{symbol:sym,width:"100%",height:170,dateRange:"12M",colorTheme:tvTheme(),isTransparent:true,autosize:false,largeChartUrl:""});
  }
  wrap.append(grid);
}
function renderPortfolio(){renderTiles();renderCompare();renderPicks();}

/* ---------- Search ---------- */
function normSym(raw){const v=String(raw||"").trim().toUpperCase().replace(/\s+/g,"");if(!v)return null;if(!/^[A-Z0-9.:\-!_]{1,24}$/.test(v))return null;return v;}
function openStock(sym){S.tk=sym;store.set("wvfc.tk",sym);if(!$("#search").hidden)renderSearch();renderWatch();renderQuick();}
function renderSearch(){
  const sym=S.tk,theme=tvTheme();rendered.search=sym+theme;
  tv($("#tv-info"),"symbol-info",{symbol:sym,width:"100%",colorTheme:theme,isTransparent:true});
  tv($("#tv-chart"),"advanced-chart",{autosize:true,symbol:sym,interval:"D",timezone:"America/Chicago",theme,style:"1",allow_symbol_change:true,calendar:false,hide_volume:false,studies:["MASimple@tv-basicstudies"],support_host:"https://www.tradingview.com"});
  document.querySelectorAll(".drop [data-sym]").forEach(e=>e.textContent=bare(sym));
  renderDrops();
  renderWatch();renderSearchBrief();renderQuick();
}
// The dropdowns load their widget only when open, and reload when the stock changes.
function renderDrops(){
  const sym=S.tk,theme=tvTheme();
  const fin=$("#drop-fin"),feed=$("#drop-feed");
  if(fin.open&&rendered.fin!==sym){rendered.fin=sym;tv($("#tv-fin"),"financials",{symbol:sym,colorTheme:theme,isTransparent:true,largeChartUrl:"",displayMode:"regular",width:"100%",height:"100%"});}
  if(feed.open&&rendered.feed!==sym){rendered.feed=sym;tv($("#tv-feed"),"timeline",{feedMode:"symbol",symbol:sym,colorTheme:theme,isTransparent:true,displayMode:"regular",width:"100%",height:"100%"});}
}
$("#drop-fin").addEventListener("toggle",renderDrops);$("#drop-feed").addEventListener("toggle",renderDrops);
function renderQuick(){
  const q=$("#quick");q.replaceChildren(el("span",{text:"Try:"}));
  const list=[...new Set(S.picks.map(p=>p.symbol||p.ticker).concat(["NASDAQ:AAPL","NASDAQ:NVDA","NASDAQ:MSFT","NASDAQ:AMZN","NASDAQ:TSLA","NYSE:JPM","NASDAQ:COST","NYSE:KO"]))].slice(0,10);
  list.forEach(s=>q.append(el("button",{class:"qchip"+(bare(s)===bare(S.tk)?" on":""),type:"button",text:bare(s),onclick:()=>openStock(s)})));
}
$("#searchform").addEventListener("submit",e=>{e.preventDefault();const s=normSym($("#q").value);if(!s){toast("Type a ticker, like AAPL or NYSE:F");return;}$("#q").value="";$("#q").blur();openStock(s);});
function saveWatch(){store.set("wvfc.watch",JSON.stringify(S.watch));}
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
function visibleBriefs(){return S.briefs.filter(b=>b.market).sort((a,b)=>(a.order||0)-(b.order||0)).concat(S.briefs.filter(b=>!b.market&&inPortfolio(b.ticker)).sort((a,b)=>a.ticker.localeCompare(b.ticker)));}
function briefForSymbol(sym){const t=bare(sym);return visibleBriefs().find(b=>bare(b.symbol||b.ticker)===t||b.ticker===t)||null;}
function renderNews(){
  const list=visibleBriefs();$("#cnt-news").textContent=list.length?String(list.length):"";
  const nl=$("#nlist"),br=$("#brief");nl.replaceChildren();
  if(!list.length){br.replaceChildren(el("div",{class:"empty",style:"border:0"},el("h3",{text:"No briefs yet"})));$("#news-meter-panel").hidden=true;return;}
  const counts={bullish:0,neutral:0,bearish:0};list.forEach(n=>counts[n.sentiment in counts?n.sentiment:"neutral"]++);
  $("#news-meter-panel").hidden=false;const mt=$("#news-meter");mt.replaceChildren();
  [["bullish","var(--up)"],["neutral","var(--flat)"],["bearish","var(--down)"]].forEach(([k,c])=>{if(counts[k])mt.append(el("span",{style:`flex:${counts[k]};background:${c}`,title:`${counts[k]} ${k}`}));});
  $("#news-legend").replaceChildren(...["bullish","neutral","bearish"].map(k=>el("span",{},el("i",{style:`background:var(--${k==="bullish"?"up":k==="bearish"?"down":"flat"})`}),`${SENT[k][0]} ${counts[k]}`)));
  if(!S.newsTk||!list.some(n=>n.ticker===S.newsTk))S.newsTk=list[0].ticker;
  const mk=list.filter(n=>n.market).length,sk=list.length-mk;const label=t=>el("div",{class:"eyebrow",style:"margin:6px 2px 0",text:t});
  list.forEach((n,i)=>{if(i===0&&mk)nl.append(label("The market"));if(i===mk&&sk)nl.append(label("Class portfolio"));
    nl.append(el("button",{class:"nitem","aria-current":String(n.ticker===S.newsTk),onclick:()=>{S.newsTk=n.ticker;renderNews();renderNewsFeed();if(innerWidth<820)$("#brief").scrollIntoView({behavior:"smooth",block:"start"});}},el("span",{class:"t",text:n.market?n.name:n.ticker}),sentiPill(n.sentiment),el("span",{class:"h",text:n.headline||""})));});
  if(!sk){nl.append(label("Class portfolio"),el("div",{class:"notice",text:S.picks.length?"Briefs for our picks are on the way.":"Briefs for our stocks show up here once they're in the Class Portfolio."}));}
  const n=list.find(x=>x.ticker===S.newsTk);
  br.replaceChildren(...[
    el("div",{class:"sechead"},el("div",{},el("div",{class:"eyebrow",text:n.market?`Market brief · ${n.name}`:`${n.ticker} · ${n.name||""}`}),el("h3",{text:n.headline||""})),sentiPill(n.sentiment)),
    el("p",{class:"lede",text:n.summary||""}),
    el("div",{class:"sides"},el("div",{class:"side-col bull"},el("h4",{text:"What the bulls say"}),el("ul",{},(n.bull||[]).map(x=>el("li",{text:x})))),el("div",{class:"side-col bear"},el("h4",{text:"What the bears say"}),el("ul",{},(n.bear||[]).map(x=>el("li",{text:x}))))),
    n.nextEvent?el("div",{class:"notice"},el("b",{text:"Coming up: "}),n.nextEvent):null,
    el("div",{},el("div",{class:"eyebrow",style:"margin-bottom:6px",text:`Sources (${(n.sources||[]).length})`}),el("ul",{class:"sources"},(n.sources||[]).map(s=>el("li",{},el("a",{href:s.url,target:"_blank",rel:"noopener noreferrer",text:s.title}),el("span",{class:"o",text:[s.outlet,s.date].filter(Boolean).join(" · ")}))))),
    el("div",{class:"meta",text:`Written by Claude from the articles above · updated ${n.updatedAt?fmtDate(n.updatedAt):"recently"}. Summaries can leave things out, so read the articles before you pitch.`}),
    el("div",{},el("button",{class:"btn small",text:`Open ${n.market?n.name:n.ticker} chart →`,onclick:()=>{openStock(n.symbol||n.ticker);showTab("search",true);}}))].filter(Boolean));
}
function renderNewsFeed(){
  const n=visibleBriefs().find(x=>x.ticker===S.newsTk);const key=(n?n.ticker:"mkt")+tvTheme();if(rendered.news===key)return;rendered.news=key;
  const theme=tvTheme();
  if(n&&!n.market){$("#feed-label").textContent=`Live headlines · ${n.ticker}`;tv($("#tv-newsfeed"),"timeline",{feedMode:"symbol",symbol:n.symbol||n.ticker,colorTheme:theme,isTransparent:true,displayMode:"regular",width:"100%",height:"100%"});}
  else{$("#feed-label").textContent="Live headlines · US stock market";tv($("#tv-newsfeed"),"timeline",{feedMode:"market",market:"stock",colorTheme:theme,isTransparent:true,displayMode:"regular",width:"100%",height:"100%"});}
}
// On Search, show the club's brief for the stock whenever one exists, even if it isn't in the portfolio.
function anyBriefFor(sym){const t=bare(sym);return S.briefs.find(b=>bare(b.symbol||b.ticker)===t||b.ticker===t)||null;}
function renderSearchBrief(){
  const box=$("#s-brief");const n=anyBriefFor(S.tk);box.hidden=!n;if(!n)return;
  const inNews=visibleBriefs().includes(n);
  box.replaceChildren(...[
    el("div",{class:"sechead"},el("div",{},el("div",{class:"eyebrow",text:`News brief · ${n.market?n.name:n.ticker}`}),el("h3",{text:n.headline||""})),sentiPill(n.sentiment)),
    el("p",{class:"lede",text:n.summary||""}),
    el("div",{class:"sides"},el("div",{class:"side-col bull"},el("h4",{text:"What the bulls say"}),el("ul",{},(n.bull||[]).map(x=>el("li",{text:x})))),el("div",{class:"side-col bear"},el("h4",{text:"What the bears say"}),el("ul",{},(n.bear||[]).map(x=>el("li",{text:x}))))),
    el("div",{class:"meta",text:`Written by Claude from ${(n.sources||[]).length} ${(n.sources||[]).length===1?"article":"articles"} · updated ${n.updatedAt?fmtDate(n.updatedAt):"recently"}`}),
    inNews?el("div",{},el("button",{class:"btn small",text:"Sources and full brief →",onclick:()=>{S.newsTk=n.ticker;renderNews();showTab("news",true);}})):el("ul",{class:"sources"},(n.sources||[]).map(s=>el("li",{},el("a",{href:s.url,target:"_blank",rel:"noopener noreferrer",text:s.title}),el("span",{class:"o",text:[s.outlet,s.date].filter(Boolean).join(" · ")}))))].filter(Boolean));
}

/* ---------- Boot ---------- */
let rsT;window.addEventListener("resize",()=>{clearTimeout(rsT);rsT=setTimeout(renderCompare,120);});
darkMQ.addEventListener&&darkMQ.addEventListener("change",()=>{rendered.search=null;rendered.news=null;renderPicks();const t=location.hash.slice(1);if(t==="search")renderSearch();if(t==="news")renderNewsFeed();});
async function boot(){
  renderWatch();renderQuick();
  const [pf,nw]=await Promise.allSettled([loadJSON("data/portfolio.json"),loadJSON("data/news.json")]);
  if(pf.status==="fulfilled")S.picks=(pf.value.picks||[]).filter(p=>p.ticker&&p.entryPrice>0&&p.entryDate);
  if(nw.status==="fulfilled"){S.briefs=nw.value.briefs||[];if(nw.value.updated)$("#news-asof").textContent="News briefs updated "+fmtDate(nw.value.updated);}
  renderTape();renderPortfolio();renderNews();
  showTab(location.hash.slice(1)||"portfolio");
  if(S.picks.length&&CFG.finnhubKey){await Promise.all(S.picks.map(p=>quote(p.ticker)).concat([quote("SPY")]));renderTiles();renderCompare();renderPicks();}
}
boot();
})();
