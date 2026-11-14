// Search page "The numbers" box: P/E, dividend, company size, 52-week range, next earnings day and more,
// with plain-words meanings, and a "Compare with" box that puts a second stock beside it.
// Numbers come from Finnhub through Supabase (supabase/stock-numbers.sql); price from paper_quote.
(function(){
"use strict";
const $=s=>document.querySelector(s);
const box=$("#s-nums");if(!box)return;
const el=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="class")e.className=v;else if(k==="text")e.textContent=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v);}for(const kid of kids.flat()){if(kid==null||kid===false)continue;e.append(kid.nodeType?kid:document.createTextNode(String(kid)));}return e;};
const store={get(k){try{return localStorage.getItem(k);}catch(e){return null;}},set(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v);}catch(e){}}};
const bare=sym=>String(sym||"").split(":").pop().toUpperCase();
const okSym=s=>/^[A-Z][A-Z0-9.\-]{0,9}$/.test(s);

let db=null,tk="",other=store.get("ss.compare")||"";
const cache={};   // symbol -> {n:numbers, p:price} or {err}

const num=v=>typeof v==="number"&&isFinite(v)?v:(typeof v==="string"&&v.trim()!==""&&isFinite(+v)?+v:null);
const money=v=>v==null?"—":"$"+v.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
function bigMoney(mil){if(mil==null)return"—";const d=mil*1e6;
  if(d>=1e12)return"$"+(d/1e12).toFixed(d>=1e13?1:2)+" trillion";if(d>=1e9)return"$"+(d/1e9).toFixed(d>=1e11?0:1)+" billion";return"$"+(d/1e6).toFixed(0)+" million";}
const pct=(v,sign)=>v==null?"—":(sign&&v>0?"+":"")+v.toFixed(Math.abs(v)<10?1:0)+"%";

// Each row: label, plain-words meaning, and how to show the value.
const ROWS=[
  {k:"Price",m:"What one share costs right now.",f:d=>money(d.p)},
  {k:"Company size",m:"What the whole company is worth (all its shares added up).",f:d=>bigMoney(num(d.n.marketCap))},
  {k:"P/E (price vs. profit)",m:"How many dollars you pay for each $1 the company earns in a year. Higher means people expect more growth.",
    f:d=>{const v=num(d.n.pe);return v==null||v<=0?(v!=null?"Losing money":"—"):v.toFixed(1)+"×";}},
  {k:"Profit per share (EPS)",m:"The company's profit for the last year, split across every share.",f:d=>money(num(d.n.eps))},
  {k:"Dividend",m:"Cash the company pays you each year just for owning the stock.",
    f:d=>{const y=num(d.n.divYield),ps=num(d.n.divPerShare);if(!y&&!ps)return"None";return pct(y)+" a year"+(ps?` (${money(ps)}/share)`:"");}},
  {k:"Profit margin",m:"How many cents of each $1 in sales the company keeps as profit.",f:d=>{const v=num(d.n.margin);return v==null?"—":Math.round(v)+"¢ per $1";}},
  {k:"Sales growth",m:"How much more (or less) the company sold than a year ago.",f:d=>pct(num(d.n.revGrowth),true),
    c:d=>{const v=num(d.n.revGrowth);return v==null?"":v>0?"up":v<0?"down":"";}},
  {k:"52-week range",m:"The lowest and highest price in the last year, and where it is now.",f:d=>range(d)},
  {k:"How jumpy (beta)",m:"1 means it moves like the whole market. 2 means about twice as much, 0.5 about half.",
    f:d=>{const b=num(d.n.beta);if(b==null)return"—";return b.toFixed(2)+(b>=1.3?" · jumpier than the market":b<=0.7?" · calmer than the market":" · about like the market");}},
  {k:"Next earnings",m:"The day the company reports its profits. The stock often jumps or drops right after.",
    f:d=>{if(!d.n.earnDate)return"Not announced yet";const dt=new Date(d.n.earnDate+"T12:00:00");
      return dt.toLocaleDateString("en-US",{month:"short",day:"numeric",year:dt.getFullYear()!==new Date().getFullYear()?"numeric":undefined})+(d.n.earnHour==="bmo"?" · before open":d.n.earnHour==="amc"?" · after close":"");}}];

function range(d){const lo=num(d.n.low52),hi=num(d.n.high52),p=d.p;if(lo==null||hi==null)return"—";
  const at=p!=null&&hi>lo?Math.min(1,Math.max(0,(p-lo)/(hi-lo))):null;
  return el("span",{class:"nrange"},el("span",{class:"nr-lo",text:money(lo)}),
    el("span",{class:"nr-bar"},at==null?null:el("i",{style:`left:${(at*100).toFixed(1)}%`})),
    el("span",{class:"nr-hi",text:money(hi)}));}

async function load(sym){
  if(cache[sym])return cache[sym];
  const r=cache[sym]={loading:true};
  try{
    const[nr,pr]=await Promise.all([db.rpc("stock_numbers",{sym}),db.rpc("paper_quote",{sym}).then(x=>x,()=>({}))]);
    if(nr.error)throw nr.error;
    r.n=nr.data||{};r.p=pr&&!pr.error&&pr.data?num(pr.data.price):null;
    if(Object.keys(r.n).length<=2&&r.p==null)r.err=`No numbers found for ${sym}.`;
  }catch(e){r.err=/stock_numbers|function/i.test(String(e&&e.message))?"The numbers aren't turned on yet.":String(e&&e.message||"Couldn't load the numbers. Try again.");delete r.loading;render();return r;}
  delete r.loading;render();return r;
}

function cell(d,row){if(!d||d.loading)return el("td",{class:"nload",text:"…"});if(d.err)return el("td",{class:"meta",text:"—"});
  const v=row.f(d);return el("td",{class:row.c?row.c(d):""},v);}

function render(){
  if(!db||!tk){box.hidden=true;return;}
  box.hidden=false;
  const A=cache[tk],B=other&&other!==tk?cache[other]:null,two=!!(other&&other!==tk);
  const input=el("input",{type:"text",class:"ncin",placeholder:"Ticker",maxlength:"10","aria-label":"Ticker to compare with",autocapitalize:"characters",value:two?other:""});
  const form=el("form",{class:"ncform",onsubmit:e=>{e.preventDefault();const s=bare(input.value.trim());if(!okSym(s)){input.focus();return;}setOther(s);}},
    el("label",{class:"meta",text:"Compare with"}),input,el("button",{class:"btn small",type:"submit",text:"Compare"}),
    two?el("button",{class:"btn small ghost",type:"button",text:"✕","aria-label":"Stop comparing",onclick:()=>setOther("")}):null);
  const head=el("tr",{},el("th",{scope:"col",class:"nk"},""),el("th",{scope:"col",text:tk}),two?el("th",{scope:"col",text:other}):null);
  const body=ROWS.map(row=>el("tr",{},el("th",{scope:"row",class:"nk"},el("div",{class:"nkl",text:row.k}),el("div",{class:"nkm",text:row.m})),
    cell(A,row),two?cell(B,row):null));
  const errs=[A&&A.err?`${tk}: ${A.err}`:"",B&&B.err?`${other}: ${B.err}`:""].filter(Boolean);
  box.replaceChildren(...[
    el("div",{class:"sechead nhead"},el("div",{class:"eyebrow",text:`The numbers · ${tk}${two?" vs "+other:""}`}),form),
    el("div",{class:"nwrap"},el("table",{class:"ntable"+(two?" duo":"")},el("thead",{},head),el("tbody",{},body))),
    errs.length?el("p",{class:"meta",style:"margin:8px 0 0",text:errs.join(" ")}):null,
    el("p",{class:"meta nfoot",text:"From Finnhub, updated twice a day. Facts to learn from, not advice to buy or sell."})].filter(Boolean));
}

function setOther(s){other=s;store.set("ss.compare",s||null);render();if(s&&db)load(s);}
function show(sym){tk=bare(sym);if(!db||!tk)return render();render();load(tk);if(other&&other!==tk)load(other);}

document.addEventListener("wvfc:login",e=>{db=e.detail.db;if(window.WVFC_APP)show(window.WVFC_APP.tk());});
document.addEventListener("wvfc:stock",e=>show(e.detail));
if(window.WVFC_SESSION){db=window.WVFC_SESSION.db;if(window.WVFC_APP)show(window.WVFC_APP.tk());}
})();
