// Top 3 Today tab: three short lists of stocks worth a look, each with a one-line reason.
//  * Most bought on Simple Street: what people bought most in Paper Trading this week (supabase/top3.sql, counts only).
//  * Wall Street's favorites and Biggest movers with good news: data/top3.json, saved every weekday morning
//    by scripts/update_top3.py from free public pages.
// Ideas to research, not advice: the tab says so.
(function(){
"use strict";
const $=s=>document.querySelector(s);
if(!$("#top3"))return;
const el=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="class")e.className=v;else if(k==="text")e.textContent=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v);}for(const kid of kids.flat()){if(kid==null||kid===false)continue;e.append(kid.nodeType?kid:document.createTextNode(String(kid)));}return e;};

let db=null,file=null,bought=null,boughtOff=false,started=false;
const app=()=>window.WVFC_APP||{};
document.addEventListener("wvfc:login",e=>{db=e.detail.db;if(started)loadBought();});
if(window.WVFC_SESSION)db=window.WVFC_SESSION.db;
document.addEventListener("wvfc:tab",e=>{if(e.detail==="top3")start();});
document.addEventListener("wvfc:traded",()=>{if(started)loadBought();});

function start(){if(started){render();return;}started=true;render();loadFile();loadBought();}
async function loadFile(){
  try{const r=await fetch("data/top3.json",{cache:"no-cache"});if(!r.ok)throw 0;file=await r.json();}catch(e){file={analysts:[],movers:[]};}
  render();
}
async function loadBought(){
  if(!db)return;
  const{data,error}=await db.rpc("top3_bought");
  boughtOff=!!error;bought=error?[]:(data||[]);render();
}

/* ---------- Drawing ---------- */
const pct=n=>(n>0?"+":n<0?"−":"")+Math.abs(n).toFixed(1)+"%";
const money=n=>"$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const short=d=>d?new Date(d+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}):"";
const plural=(n,w)=>`${n} ${w}${n===1?"":"s"}`;
// Price and the last 5 market days, when the morning list has them.
const facts=tk=>{const all=file?[...(file.analysts||[]),...(file.movers||[])]:[];return all.find(x=>x.ticker===tk)||null;};

// Small line icons for the three lists.
const ICON={
  people:'<path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7 0a3 3 0 1 0 0-6M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 14c2.8 0 5 2.2 5 5"/>',
  experts:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  rocket:'<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>'};
const icon=k=>{const s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("viewBox","0 0 24 24");s.setAttribute("aria-hidden","true");s.innerHTML=ICON[k];return s;};

// One pick: rank, ticker and name, a big number on the right, the reason, then the buttons.
function card(i,p,stat,why,extra){
  const f=p.price!=null?p:facts(p.ticker);
  const name=p.name||(app().stockName?app().stockName(p.ticker):"")||"";
  const look=()=>app().openStock&&app().openStock(p.ticker);
  return el("li",{class:"t3card"},
    el("div",{class:"t3row"},
      el("span",{class:"t3n",text:String(i+1)}),
      el("button",{type:"button",class:"t3tk",title:`Look up ${p.ticker}`,onclick:look},
        el("b",{text:p.ticker}),
        el("span",{class:"t3name"},el("span",{class:"t3nm",text:name||""}),f&&f.price!=null?el("span",{class:"t3px",text:(name?" · ":"")+money(f.price)}):null)),
      el("div",{class:"t3stat "+(stat.tone||"")},el("b",{text:stat.big}),el("span",{text:stat.small}))),
    why?el("p",{class:"t3why",text:why}):"",
    extra||"",
    el("div",{class:"t3btns"},
      el("button",{type:"button",class:"btn small primary",text:"Buy Now",title:`Buy ${p.ticker} in Paper Trading`,onclick:()=>window.WVFC_PAPER&&window.WVFC_PAPER.trade(p.ticker,"buy")}),
      el("button",{type:"button",class:"t3more",text:"See the stock →",onclick:look})));
}
function box(kind,title,sub,list){
  return el("div",{class:"panel t3box t3-"+kind},
    el("div",{class:"t3head"},el("span",{class:"t3ic"},icon(kind)),el("div",{},el("h3",{text:title}),el("p",{class:"t3sub",text:sub}))),
    list);
}
const msg=t=>el("p",{class:"meta t3msg",text:t});

function render(){
  // 1. Most bought on Simple Street
  let one;
  if(bought==null)one=msg("Loading…");
  else if(boughtOff)one=msg("This list turns on soon.");
  else if(!bought.length)one=msg("Nobody has bought a stock in Paper Trading this week yet. Be the first!");
  else one=el("ol",{class:"t3list"},bought.map((b,i)=>card(i,{ticker:b.ticker},{big:String(b.buyers),small:b.buyers===1?"buyer":"buyers"},
    `${b.buyers===1?"1 person":b.buyers+" people"} bought it on Simple Street this week${b.buys>b.buyers?`, ${plural(b.buys,"buy")} in all`:""}.`)));
  // 2. Wall Street's favorites
  const an=file&&file.analysts||[];
  const two=file==null?msg("Loading…"):an.length?el("ol",{class:"t3list"},an.map((p,i)=>card(i,p,
    {big:Math.round(p.buy/p.analysts*100)+"%",small:"say Buy"},p.why))):msg("Check back tomorrow morning.");
  // 3. Biggest movers with good news
  const mv=file&&file.movers||[];
  const three=file==null?msg("Loading…"):mv.length?el("ol",{class:"t3list"},mv.map((p,i)=>card(i,p,
    {big:pct(p.week),small:"this week",tone:"up"},"",p.headline&&p.headline.title?
    el("a",{class:"t3news",href:p.headline.url,target:"_blank",rel:"noopener"},
      el("span",{class:"t3q",text:p.headline.title}),
      el("span",{class:"t3src",text:[p.headline.source,short(p.headline.date)].filter(Boolean).join(" · ")})):null))):msg("No big movers with good news this week. Check back tomorrow morning.");
  const when=file&&file.updated?new Date(file.updated).toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"}):"";
  $("#t3-grid").replaceChildren(
    box("people","Most bought on Simple Street","What people bought most in Paper Trading this week.",one),
    box("experts","Wall Street's favorites","Stocks the most Wall Street experts rate as a Buy.",two),
    box("rocket","Biggest movers with good news","Big gainers this week with good headlines.",three));
  $("#t3-when").textContent=when?`Updated ${when}`:"";
}
})();
