// Industries tab: pick an industry (Tech, Banks, Energy...) and see the companies in it, biggest first.
// Data: data/industries.json, saved a few times each weekday by scripts/update_industries.py (free Yahoo prices).
// Tapping a company opens it in Search; Buy opens Paper Trading with it filled in.
(function(){
"use strict";
const $=s=>document.querySelector(s);
if(!$("#industries"))return;
const el=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="class")e.className=v;else if(k==="text")e.textContent=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v);}for(const kid of kids.flat()){if(kid==null||kid===false)continue;e.append(kid.nodeType?kid:document.createTextNode(String(kid)));}return e;};

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
let file=null,started=false,pick=null,sort="big",shown=PAGE;
const app=()=>window.WVFC_APP||{};
document.addEventListener("wvfc:tab",e=>{if(e.detail==="industries")start();});

function start(){
  const h=decodeURIComponent((location.hash.split("/")[1]||""));
  pick=h&&INFO.some(i=>i[0]===h)?h:null;if(!pick){sort="big";shown=PAGE;}
  if(started){render();return;}started=true;render();load();
}
async function load(){
  try{const r=await fetch("data/industries.json",{cache:"no-cache"});if(!r.ok)throw 0;file=await r.json();}catch(e){file={industries:{}};}
  render();
}

/* ---------- Drawing ---------- */
const pct=n=>{if(n==null)return "";const v=Math.round(n*10)/10;return (v>0?"+":v<0?"−":"")+Math.abs(v).toFixed(1)+"%";};
const tone=n=>n==null?"":n>=0.05?"up":n<=-0.05?"down":"flat";
const money=n=>n==null?"":"$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const icon=d=>{const s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("viewBox","0 0 24 24");s.setAttribute("aria-hidden","true");s.innerHTML=`<path d="${d}"/>`;return s;};
const rowsOf=name=>(file&&file.industries&&file.industries[name])||[];
// Typical move today: the middle stock's % change, so one wild stock doesn't skew it.
function median(rows){const v=rows.map(r=>r[3]).filter(x=>x!=null).sort((a,b)=>a-b);if(!v.length)return null;const m=v.length>>1;return v.length%2?v[m]:(v[m-1]+v[m])/2;}
function when(){
  if(!file||!file.updated)return "";
  const d=new Date(file.updated.replace("Z",":00Z"));if(isNaN(d))return "";
  return "Prices from "+d.toLocaleString("en-US",{weekday:"short",hour:"numeric",minute:"2-digit",timeZone:"America/Chicago"})+" Chicago time";
}
function go(name){pick=name;sort="big";shown=PAGE;try{history.replaceState(null,"","#industries"+(name?"/"+encodeURIComponent(name):""));}catch(e){}render();window.scrollTo({top:0});}

function tiles(){
  return el("div",{class:"inlist"},INFO.filter(i=>!file||rowsOf(i[0]).length).map(([name,about,d])=>{
    const rows=rowsOf(name),m=median(rows);
    return el("button",{type:"button",class:"intile",onclick:()=>go(name)},
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

function row(r){
  const [tk,name,price,day,month]=r;
  const look=()=>app().openStock&&app().openStock(tk);
  return el("li",{class:"inrow"},
    el("button",{type:"button",class:"intk",title:`Look up ${tk}`,onclick:look},
      el("b",{text:tk}),el("span",{class:"innm",text:name||""})),
    el("span",{class:"inpx"},el("b",{text:money(price)}),el("span",{class:"inchg "+tone(day),text:day==null?"":pct(day)+" today"})),
    el("span",{class:"inmo "+tone(month),text:month==null?"":pct(month)}),
    el("span",{class:"inbtns"},
      el("button",{type:"button",class:"btn small primary",text:"Buy",title:`Buy ${tk} in Paper Trading`,onclick:()=>window.WVFC_PAPER&&window.WVFC_PAPER.trade(tk,"buy")}),
      el("button",{type:"button",class:"inmore",text:"See →",title:`Look up ${tk}`,onclick:look})));
}

function detail(){
  const info=INFO.find(i=>i[0]===pick)||[pick,"",""];
  let rows=rowsOf(pick).slice();
  if(sort==="up")rows=rows.filter(r=>r[3]!=null).sort((a,b)=>b[3]-a[3]);
  if(sort==="down")rows=rows.filter(r=>r[3]!=null).sort((a,b)=>a[3]-b[3]);
  if(sort==="month")rows=rows.filter(r=>r[4]!=null).sort((a,b)=>b[4]-a[4]);
  const chip=(k,t)=>el("button",{type:"button",class:"inchip"+(sort===k?" on":""),"aria-pressed":String(sort===k),text:t,onclick:()=>{sort=k;shown=PAGE;render();}});
  const m=median(rowsOf(pick));
  return el("div",{class:"indetail"},
    el("button",{type:"button",class:"inback",onclick:()=>go(null),text:"‹ All industries"}),
    el("div",{class:"panel inpanel"},
      el("div",{class:"inhead"},
        el("span",{class:"inic big"},icon(info[2])),
        el("div",{},el("h3",{text:info[0]}),el("p",{class:"inabout",text:info[1]}),
          el("p",{class:"inmeta"},el("span",{text:`${rowsOf(pick).length} companies`}),m!=null?el("span",{class:"inday "+tone(m),text:`Typical stock today ${pct(m)}`}):null))),
      el("div",{class:"inchips",role:"group","aria-label":"Sort"},chip("big","Biggest"),chip("up","Up most today"),chip("down","Down most today"),chip("month","Best this month")),
      el("div",{class:"inrow incols","aria-hidden":"true"},el("span",{text:"Company"}),el("span",{text:"Price"}),el("span",{class:"inmo",text:"1 month"}),el("span",{})),
      rows.length?el("ol",{class:"inrows"},rows.slice(0,shown).map(row)):el("p",{class:"meta",text:file?"Prices aren't in yet. Check back soon.":"Loading…"}),
      rows.length>shown?el("button",{type:"button",class:"btn inshowmore",text:`Show ${Math.min(PAGE,rows.length-shown)} more`,onclick:()=>{shown+=PAGE;render();}}):null));
}

function render(){
  $("#in-when").textContent=when();
  $("#in-body").replaceChildren(pick?detail():tiles());
}
})();
