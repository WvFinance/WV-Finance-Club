// Search page "What Wall Street experts say" box, under the watchlist beside the chart.
// How many analysts (experts at big banks who study the company) say Strong Buy, Buy, Hold, Sell or
// Strong Sell, and their average price goal for the next year. Comes from the brief server's /ratings
// (brief-server/src/ratings.js: Yahoo Finance, then Nasdaq), saved there for 12 hours per stock.
(function(){
"use strict";
const box=document.querySelector("#s-rate");if(!box)return;
const CFG=window.WVFC_CONFIG||{};
const el=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="class")e.className=v;else if(k==="text")e.textContent=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v);}for(const kid of kids.flat()){if(kid==null||kid===false)continue;e.append(kid.nodeType?kid:document.createTextNode(String(kid)));}return e;};
const bare=s=>String(s||"").split(":").pop().toUpperCase();
const money=v=>"$"+Number(v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const cache={};let tk="";

// Each kind of rating, best to worst, with its bar color.
const KINDS=[["strongBuy","Strong Buy","sb"],["buy","Buy","b"],["hold","Hold","h"],["sell","Sell","s"],["strongSell","Strong Sell","ss"]];

function verdict(r){
  const t=r.analysts;if(!t)return null;
  const score=(5*r.strongBuy+4*r.buy+3*r.hold+2*r.sell+r.strongSell)/t;
  if(r.simple){const top=Math.max(r.buy,r.hold,r.sell);return top===r.buy?["Buy","up"]:top===r.sell?["Sell","down"]:["Hold","flat"];}
  return score>=4.5?["Strong Buy","up"]:score>=3.5?["Buy","up"]:score>=2.5?["Hold","flat"]:score>=1.5?["Sell","down"]:["Strong Sell","down"];
}

function head(){return el("div",{class:"eyebrow",text:"What Wall Street experts say"});}

function render(){
  if(!tk){box.hidden=true;return;}
  box.hidden=false;
  const r=cache[tk];
  if(!r||r.loading){box.replaceChildren(head(),el("p",{class:"meta rt-msg",text:"Loading…"}));return;}
  if(r.err||!r.analysts){box.replaceChildren(head(),el("p",{class:"meta rt-msg",text:r.err||`No analysts rate ${tk} right now. Smaller companies and funds often have none.`}));return;}
  const [word,cls]=verdict(r);
  const kinds=r.simple?KINDS.filter(k=>["buy","hold","sell"].includes(k[0])):KINDS;
  const most=Math.max(...kinds.map(k=>r[k[0]]))||1;
  const rows=kinds.map(([k,label,c])=>el("div",{class:"rt-row"},
    el("span",{class:"rt-k",text:label}),
    el("span",{class:"rt-bar"},el("i",{class:"rt-"+c,style:`width:${(r[k]/most*100).toFixed(1)}%`})),
    el("span",{class:"rt-n",text:String(r[k])})));
  let goal=null;
  if(r.target){
    const diff=r.price?(r.target/r.price-1)*100:null;
    goal=el("div",{class:"rt-goal"},
      el("div",{class:"rt-gl"},el("span",{class:"rt-k",text:"Price goal"}),el("b",{text:money(r.target)}),
        diff==null?null:el("span",{class:"rt-gd "+(diff>=0?"up":"down"),text:`${diff>=0?"+":"−"}${Math.abs(diff).toFixed(0)}% from now`})),
      el("p",{class:"meta",text:"Where experts think the price will be in a year, on average."+(r.targetLow&&r.targetHigh?` Lowest guess ${money(r.targetLow)}, highest ${money(r.targetHigh)}.`:"")}));
  }
  box.replaceChildren(head(),
    el("div",{class:"rt-top"},el("span",{class:"rt-word "+cls,text:word}),el("span",{class:"meta",text:`${r.analysts} analyst${r.analysts===1?"":"s"}`})),
    el("div",{class:"rt-rows"},rows),goal,
    el("p",{class:"meta rt-foot",text:`Analysts are experts at big banks who study ${tk}. They're often wrong, so use this to learn, not as advice. From ${r.source}.`}));
}

async function load(sym){
  if(cache[sym])return render();
  const r=cache[sym]={loading:true};render();
  if(!CFG.briefApi){r.err="Expert ratings aren't turned on.";delete r.loading;return render();}
  try{
    const res=await fetch(`${CFG.briefApi}/ratings?symbol=${encodeURIComponent(sym)}`);
    const j=await res.json();
    if(!res.ok||j.error)throw new Error(j.error||res.status);
    Object.assign(r,j);
  }catch(e){r.err="Couldn't load expert ratings right now. Try again later.";setTimeout(()=>{if(cache[sym]===r)delete cache[sym];},60000);}
  delete r.loading;if(sym===tk)render();
}

function show(sym){tk=bare(sym);if(!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(tk)){tk="";return render();}load(tk);}
document.addEventListener("wvfc:stock",e=>show(e.detail));
if(window.WVFC_APP&&window.WVFC_APP.tk&&!document.querySelector("#search").hidden)show(window.WVFC_APP.tk());
})();
