// Member accounts for beta.html: log in, My Portfolio (from a Fidelity or Schwab file) and a watchlist saved to the account.
// Logins and data live in Supabase. Each table's row rules only let a member read and change their own rows.
(function(){
"use strict";
const CFG=window.WVFC_CONFIG||{};
const $=s=>document.querySelector(s);
const el=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="class")e.className=v;else if(k==="text")e.textContent=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v);}for(const kid of kids.flat()){if(kid==null||kid===false)continue;e.append(kid.nodeType?kid:document.createTextNode(String(kid)));}return e;};
const fmt$=v=>"$"+v.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtPct=v=>(v>=0?"+":"−")+Math.abs(v*100).toFixed(1)+"%";
const fmtShares=v=>v.toLocaleString("en-US",{maximumFractionDigits:4});
const cls=v=>v>0.0005?"up":v<-0.0005?"down":"flat";
const fmtDay=s=>new Date(s).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),2400);}
const root=document.documentElement;
const msg=$("#gate-msg");

if(!window.supabase||!CFG.supabaseUrl||!CFG.supabaseKey){root.classList.remove("unlocked");msg.textContent="Logins aren't set up yet.";return;}
const db=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey);
let user=null;

/* ---------- Log in and create account ---------- */
let mode="login";
function setMode(m){mode=m;const login=m==="login";
  $("#auth-title").textContent=login?"Log in":"Create an account";
  $("#auth-go").textContent=login?"Log in":"Create account";
  $("#auth-q").textContent=login?"New here?":"Already have an account?";
  $("#auth-switch").textContent=login?"Create an account":"Log in";
  $("#auth-pass").setAttribute("autocomplete",login?"current-password":"new-password");
  $("#auth-pass").placeholder=login?"Password":"Password (8 or more characters)";
  msg.textContent="";}
$("#auth-switch").addEventListener("click",()=>setMode(mode==="login"?"signup":"login"));
const AUTH_ERR=[[/invalid login credentials/i,"That email and password don't match. Try again."],[/already registered|already been registered/i,"That email already has an account. Log in instead."],
  [/email not confirmed/i,"Confirm your email first. Check your inbox for the link."],[/password should be|weak password/i,"Pick a longer password, at least 8 characters."],
  [/rate limit|too many/i,"Too many tries. Wait a minute and try again."],[/fetch|network/i,"Couldn't reach the login server. Check your internet and try again."]];
const authErr=e=>{const m=String(e&&e.message||e);const hit=AUTH_ERR.find(([r])=>r.test(m));return hit?hit[1]:m;};
$("#gate-form").addEventListener("submit",async e=>{e.preventDefault();
  const email=$("#auth-email").value.trim(),password=$("#auth-pass").value,go=$("#auth-go");
  go.disabled=true;msg.textContent="";
  try{
    const r=mode==="login"?await db.auth.signInWithPassword({email,password}):await db.auth.signUp({email,password});
    if(r.error)throw r.error;
    if(!r.data.session){setMode("login");msg.textContent="Account made. Check your email for the confirm link, then log in.";return;}
    // Reload so the charts draw at full size.
    location.reload();
  }catch(err){msg.textContent=authErr(err);$("#gate-form").classList.remove("shake");void $("#gate-form").offsetWidth;$("#gate-form").classList.add("shake");}
  finally{go.disabled=false;}
});
document.addEventListener("click",async e=>{
  if(!e.target.closest("#logout"))return;
  e.stopImmediatePropagation();
  try{await db.auth.signOut();}catch(err){}
  location.reload();
},true);

async function start(){
  let session=null;try{({data:{session}}=await db.auth.getSession());}catch(e){}
  if(!session){root.classList.remove("unlocked");setMode("login");$("#auth-email").focus();return;}
  user=session.user;root.classList.add("unlocked");
  $("#mine-who").textContent=`Your own stocks, saved to ${user.email}. Only you can see them.`;
  loadWatch();loadHoldings();
}

/* ---------- Watchlist saved to the account ---------- */
let savedWatch=new Set();
async function loadWatch(){
  const{data,error}=await db.from("watchlist").select("symbol").order("added_at",{ascending:false});
  if(error){toast("Your saved watchlist couldn't be loaded.");return;}
  const list=data.map(r=>r.symbol);
  let local=[];try{local=JSON.parse(localStorage.getItem("wvfc.watch")||"[]");}catch(e){}
  // First login on this device: keep the stocks already saved here.
  if(!list.length&&local.length){savedWatch=new Set();window.WVFC_ACCOUNT.saveWatch(local);return;}
  savedWatch=new Set(list);window.WVFC_APP&&window.WVFC_APP.setWatch(list);
}
window.WVFC_ACCOUNT={async saveWatch(list){
  if(!user)return;const want=new Set(list);
  const add=list.filter(s=>!savedWatch.has(s)),drop=[...savedWatch].filter(s=>!want.has(s));savedWatch=want;
  try{
    if(add.length){const{error}=await db.from("watchlist").upsert(add.map(symbol=>({symbol})),{onConflict:"user_id,symbol"});if(error)throw error;}
    if(drop.length){const{error}=await db.from("watchlist").delete().in("symbol",drop);if(error)throw error;}
  }catch(e){toast("Your watchlist couldn't be saved. Try again.");}
}};

/* ---------- Reading a Fidelity or Schwab positions file ---------- */
function parseCSV(text){
  const rows=[];let row=[],f="",q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){if(c==='"'){if(text[i+1]==='"'){f+='"';i++;}else q=false;}else f+=c;}
    else if(c==='"')q=true;else if(c===","){row.push(f);f="";}
    else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(f);rows.push(row);row=[];f="";}
    else f+=c;}
  if(f||row.length){row.push(f);rows.push(row);}
  return rows;
}
const head=h=>String(h).toLowerCase().replace(/\(.*?\)/g,"").replace(/[$%]/g,"").replace(/\s+/g," ").trim();
const COLS={symbol:["symbol"],name:["description","name","security description"],shares:["quantity","qty"],price:["last price","price"],value:["current value","mkt val","market value"],cost:["cost basis total","cost basis"]};
function num(s){s=String(s==null?"":s).trim();if(!s||s==="--"||/^n\/?a$/i.test(s))return null;
  const neg=/^\(.*\)$/.test(s)||/^[-−]/.test(s);const v=parseFloat(s.replace(/[^0-9.]/g,""));return isNaN(v)?null:neg?-v:v;}
const isCash=(sym,name)=>/\*\*$/.test(sym)||/^cash/i.test(sym)||/money market|cash & cash/i.test(name);
function parsePositions(text){
  const rows=parseCSV(text.replace(/^﻿/,""));
  const all=rows.map(r=>r.join(" ")).join(" ").toLowerCase();
  const broker=/current value|account name/.test(all)?"Fidelity":/mkt val|positions for/.test(all)?"Schwab":"your broker";
  let map=null;const out=new Map();let skipped=0,cash=0;
  for(const r of rows){
    const h=r.map(head);
    if(h.includes("symbol")&&h.some(x=>COLS.shares.includes(x))){map={};for(const[k,names]of Object.entries(COLS))map[k]=names.map(n=>h.indexOf(n)).find(i=>i>=0);continue;}
    if(!map)continue;
    const get=k=>map[k]==null?"":String(r[map[k]]||"").trim();
    const sym=get("symbol"),name=get("name");if(!sym)continue;
    if(/total|pending/i.test(sym))continue;
    if(isCash(sym,name)){const v=num(get("value"));if(v)cash+=v;continue;}
    if(!/^[A-Z][A-Z0-9.\/]{0,9}$/.test(sym)){if(num(get("shares"))!=null)skipped++;continue;}
    const shares=num(get("shares"));if(shares==null||shares===0)continue;
    const price=num(get("price"));let value=num(get("value"));if(value==null&&price!=null)value=shares*price;
    const cost=num(get("cost")),symbol=sym.replace("/",".");
    const prev=out.get(symbol);
    if(prev){prev.shares+=shares;prev.value=(prev.value||0)+(value||0);prev.cost=prev.cost!=null&&cost!=null?prev.cost+cost:null;}
    else out.set(symbol,{symbol,name:name||null,shares,price,value,cost});
  }
  const list=[...out.values()].sort((a,b)=>(b.value||0)-(a.value||0));
  if(cash>0)list.push({symbol:"CASH",name:"Cash",shares:null,price:null,value:cash,cost:null});
  return{broker,list,skipped,found:!!map};
}

/* ---------- My Portfolio ---------- */
let holdings=[];
async function loadHoldings(){
  const box=$("#mine-list");box.replaceChildren(el("p",{class:"meta",text:"Loading your stocks…"}));
  const{data,error}=await db.from("holdings").select("*");
  if(error){box.replaceChildren(el("p",{class:"notice",text:"Your stocks couldn't be loaded. Try again in a minute."}));return;}
  holdings=data.sort((a,b)=>(a.symbol==="CASH")-(b.symbol==="CASH")||(b.value||0)-(a.value||0));renderMine();
}
function holdingTable(rows,total){
  const td=(t,k)=>el("td",{class:k||"",text:t});
  const gainOf=h=>h.value!=null&&h.cost?h.value-h.cost:null;
  const head=el("thead",{},el("tr",{},["Stock","Name","Shares","Price","Worth now","Paid","Gain $","Gain %","% of total"].map((t,i)=>el("th",{class:i>1?"num":"",text:t}))));
  const body=el("tbody",{},rows.map(h=>{const g=gainOf(h),gp=g!=null?g/h.cost:null,cash=h.symbol==="CASH";
    return el("tr",{},
      el("td",{},cash?el("b",{text:"Cash"}):el("button",{type:"button",class:"linkbtn sym",text:h.symbol,title:`Open ${h.symbol} on Search`,onclick:()=>window.WVFC_APP&&window.WVFC_APP.openStock(h.symbol)})),
      td(cash?"":h.name||""),td(h.shares!=null?fmtShares(+h.shares):"–","num"),td(h.price!=null?fmt$(+h.price):"–","num"),
      td(h.value!=null?fmt$(+h.value):"–","num"),td(h.cost!=null?fmt$(+h.cost):"–","num"),
      td(cash||g==null?"–":(g>=0?"+":"−")+fmt$(Math.abs(g)),"num "+(cash||g==null?"":cls(gp))),
      td(cash||gp==null?"–":fmtPct(gp),"num "+(cash||gp==null?"":cls(gp))),
      td(h.value!=null&&total?Math.round(h.value/total*100)+"%":"–","num"));}));
  return el("div",{class:"tablewrap"},el("table",{class:"pos"},head,body));
}
function renderMine(){
  const box=$("#mine-list"),tiles=$("#mine-tiles");
  if(!holdings.length){tiles.hidden=true;
    box.replaceChildren(el("h3",{class:"h3",text:"No stocks saved yet"}),el("p",{class:"meta",text:"Add your stocks with your broker's positions file below. It takes about a minute."}));return;}
  const total=holdings.reduce((s,h)=>s+(+h.value||0),0);
  const withCost=holdings.filter(h=>h.value!=null&&h.cost&&h.symbol!=="CASH");
  const paid=withCost.reduce((s,h)=>s+(+h.cost),0),worth=withCost.reduce((s,h)=>s+(+h.value),0),gain=worth-paid;
  const stocks=holdings.filter(h=>h.symbol!=="CASH").length;
  const tile=(label,val,note,k)=>el("div",{class:"tile"},el("div",{class:"eyebrow",text:label}),el("div",{class:"v "+(k||""),text:val}),el("div",{class:"n",text:note}));
  tiles.hidden=false;
  tiles.replaceChildren(tile("Worth now",fmt$(total),"Everything in your file"),
    tile("Total gain",paid?(gain>=0?"+":"−")+fmt$(Math.abs(gain)):"–",paid?fmtPct(gain/paid)+" on what you paid":"Your file had no cost info",paid?cls(gain):""),
    tile("What you paid",paid?fmt$(paid):"–","For stocks with cost info"),tile("Stocks",String(stocks),stocks===1?"holding":"different holdings"));
  const when=holdings.reduce((m,h)=>h.updated_at>m?h.updated_at:m,"");
  let armed=false;
  const del=el("button",{type:"button",class:"btn ghost small",text:"Delete my saved stocks",onclick:async()=>{
    if(!armed){armed=true;del.textContent="Tap again to delete";setTimeout(()=>{armed=false;del.textContent="Delete my saved stocks";},4000);return;}
    const{error}=await db.from("holdings").delete().eq("user_id",user.id);if(error){toast("Couldn't delete. Try again.");return;}
    holdings=[];renderMine();toast("Your saved stocks were deleted.");}});
  box.replaceChildren(el("div",{class:"sechead"},el("div",{},el("h3",{class:"h3",text:"Your stocks"}),
      el("p",{class:"meta",text:`Prices are from your ${holdings[0].source||""} file${when?" on "+fmtDay(when):""}. Upload a new file to update them.`.replace("  "," ")})),del),
    holdingTable(holdings,total));
}

/* ---------- Upload ---------- */
$("#mine-file").addEventListener("change",async e=>{
  const file=e.target.files[0];e.target.value="";if(!file)return;
  const pv=$("#mine-preview");pv.hidden=false;
  if(file.size>2e6){pv.replaceChildren(el("p",{class:"notice",text:"That file is too big. Pick the positions file from your broker."}));return;}
  const r=parsePositions(await file.text());
  if(!r.found||!r.list.length){pv.replaceChildren(el("p",{class:"notice",text:"We couldn't find any stocks in that file. Make sure it's the Positions download (a .csv file) from Fidelity or Schwab."}));return;}
  const total=r.list.reduce((s,h)=>s+(h.value||0),0);
  const save=el("button",{type:"button",class:"btn primary",text:"Save to my account",onclick:async()=>{
    save.disabled=true;save.textContent="Saving…";
    try{
      let res=await db.from("holdings").delete().eq("user_id",user.id);if(res.error)throw res.error;
      res=await db.from("holdings").insert(r.list.map(h=>Object.assign({},h,{source:r.broker})));if(res.error)throw res.error;
      pv.hidden=true;pv.replaceChildren();toast(`Saved ${r.list.length} holdings`);loadHoldings();
    }catch(err){save.disabled=false;save.textContent="Save to my account";toast("Couldn't save. Try again.");}
  }});
  pv.replaceChildren(el("h3",{class:"h3",text:`Here's what we found in your ${r.broker} file`}),
    el("p",{class:"meta",text:`${r.list.length} holdings worth ${fmt$(total)}.`+(r.skipped?` We skipped ${r.skipped} we couldn't read, like options.`:"")+" Check it, then save."}),
    holdingTable(r.list,total),
    el("div",{class:"ideaact"},save,el("button",{type:"button",class:"btn",text:"Cancel",onclick:()=>{pv.hidden=true;pv.replaceChildren();}})));
  pv.scrollIntoView({behavior:"smooth",block:"start"});
});

start();
})();
