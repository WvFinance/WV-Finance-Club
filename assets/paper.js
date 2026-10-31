// Trading game: $50,000 of pretend money, real prices, a club leaderboard.
// Prices and trades are handled by the database (supabase/paper-trading.sql), so nobody can send in a fake price.
(function(){
"use strict";
const $=s=>document.querySelector(s);
const el=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="class")e.className=v;else if(k==="text")e.textContent=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v);}for(const kid of kids.flat()){if(kid==null||kid===false)continue;e.append(kid.nodeType?kid:document.createTextNode(String(kid)));}return e;};
const fmt$=v=>"$"+(+v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtPct=v=>(v>=0?"+":"−")+Math.abs(v*100).toFixed(2)+"%";
const signed$=v=>(v>=0?"+":"−")+fmt$(Math.abs(v));
const cls=v=>v>0.00005?"up":v<-0.00005?"down":"flat";
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),2600);}
const START=50000;
if(!$("#trade"))return;

let db=null,user=null,loaded=false,busy=false;
const G={acct:null,pos:[],prices:{},trades:[],board:[]};
function signedIn(d){if(db)return;db=d.db;user=d.user;if(!$("#trade").hidden)load();}
document.addEventListener("wvfc:login",e=>signedIn(e.detail));
if(window.WVFC_SESSION)signedIn(window.WVFC_SESSION);
document.addEventListener("wvfc:tab",e=>{if(e.detail==="trade"&&db&&!loaded)load();});
const errText=e=>String(e&&e.message||e||"Something went wrong. Try again.");

/* ---------- Market hours (Chicago time) ---------- */
function marketOpen(){
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",weekday:"short",hour:"numeric",minute:"numeric",hourCycle:"h23"}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  const m=+p.hour*60+ +p.minute;return!["Sat","Sun"].includes(p.weekday)&&m>=510&&m<=900;
}
function renderMarket(){const open=marketOpen();const m=$("#pt-market");
  m.textContent=open?"The market is open. Trades go through right away at the real price.":"The market is closed. You can check prices, and trades go through on weekdays from 8:30am to 3pm Chicago time.";
  m.className="meta "+(open?"open":"closed");}

/* ---------- Loading ---------- */
async function load(){
  loaded=true;renderMarket();
  const{data:acct,error}=await db.from("paper_accounts").select("*").maybeSingle();
  $("#pt-loading").hidden=true;
  if(error){$("#pt-loading").hidden=false;$("#pt-loading").textContent="The game couldn't be loaded. Try again in a minute.";loaded=false;return;}
  if(!acct){$("#pt-game").hidden=true;$("#pt-join").hidden=false;if(!$("#pt-name").value)$("#pt-name").value=(user.email||"").split("@")[0].slice(0,30);return;}
  G.acct=acct;$("#pt-join").hidden=true;$("#pt-game").hidden=false;
  const[pos,tr]=await Promise.all([db.from("paper_positions").select("*"),db.from("paper_trades").select("*").order("at",{ascending:false}).limit(10)]);
  G.pos=pos.data||[];G.trades=tr.data||[];
  renderAll();
  // Fresh prices for what they own, then the leaderboard.
  await Promise.all(G.pos.map(p=>quote(p.symbol).catch(()=>null)));
  const b=await db.rpc("paper_board");G.board=b.data||[];
  renderAll();
}
async function quote(sym){const{data,error}=await db.rpc("paper_quote",{sym});if(error)throw error;G.prices[data.symbol]=data;return data;}

/* ---------- Join ---------- */
$("#pt-join").addEventListener("submit",async e=>{e.preventDefault();const m=$("#pt-join-msg");m.textContent="";
  const{error}=await db.rpc("paper_join",{display_name:$("#pt-name").value});
  if(error){m.textContent=errText(error);return;}
  toast("You're in! You have $50,000 to trade.");load();});

/* ---------- Rendering ---------- */
const priceOf=p=>G.prices[p.symbol]?+G.prices[p.symbol].price:+p.cost/+p.shares;
function renderAll(){renderTiles();renderHold();renderTrades();renderBoard();renderEst();}
function renderTiles(){
  const stocks=G.pos.reduce((s,p)=>s+priceOf(p)*p.shares,0),value=+G.acct.cash+stocks,gain=value-START;
  const me=G.board.find(r=>r.me);
  const tile=(label,val,note,k)=>el("div",{class:"tile"},el("div",{class:"eyebrow",text:label}),el("div",{class:"v "+(k||""),text:val}),el("div",{class:"n",text:note}));
  $("#pt-tiles").replaceChildren(tile("Account value",fmt$(value),"Cash plus stocks"),tile("Total gain",signed$(gain),fmtPct(gain/START)+" since you started",cls(gain)),
    tile("Cash to spend",fmt$(G.acct.cash),"Pretend money"),tile("Your rank",me?"#"+me.rank:"–",me?`out of ${G.board.length} players`:"Loading…"));
}
function renderHold(){
  const box=$("#pt-hold");
  if(!G.pos.length){box.replaceChildren(el("h3",{class:"h3",text:"Your stocks"}),el("p",{class:"meta",text:"You don't own any stocks yet. Type a ticker above and press Buy."}));return;}
  const td=(t,k)=>el("td",{class:k||"",text:t});
  const rows=G.pos.map(p=>({p,px:priceOf(p)})).map(r=>Object.assign(r,{value:r.px*r.p.shares,gain:r.px*r.p.shares-r.p.cost})).sort((a,b)=>b.value-a.value);
  const head=el("thead",{},el("tr",{},["Stock","Shares","Paid per share","Price now","Worth now","Gain $","Gain %",""].map((t,i)=>el("th",{class:i&&i<7?"num":"",text:t}))));
  const body=el("tbody",{},rows.map(({p,px,value,gain})=>{const gp=gain/p.cost;return el("tr",{},
    el("td",{},el("button",{type:"button",class:"linkbtn sym",text:p.symbol,title:`Open ${p.symbol} on Search`,onclick:()=>window.WVFC_APP&&window.WVFC_APP.openStock(p.symbol)})),
    td(String(+p.shares),"num"),td(fmt$(p.cost/p.shares),"num"),td(fmt$(px),"num"),td(fmt$(value),"num"),td(signed$(gain),"num "+cls(gp)),td(fmtPct(gp),"num "+cls(gp)),
    el("td",{},el("button",{type:"button",class:"btn small",text:"Sell",onclick:()=>fill(p.symbol,+p.shares)})));}));
  box.replaceChildren(el("h3",{class:"h3",text:"Your stocks"}),el("p",{class:"meta",text:"Prices update every few minutes while the market is open."}),el("div",{class:"tablewrap"},el("table",{class:"pos"},head,body)));
}
function renderTrades(){
  const box=$("#pt-trades");
  if(!G.trades.length){box.hidden=true;return;}box.hidden=false;
  box.replaceChildren(el("h3",{class:"h3",text:"Your recent trades"}),el("ul",{class:"ptlist"},G.trades.map(t=>el("li",{},
    el("span",{class:"pttag "+t.side,text:t.side==="buy"?"Bought":"Sold"}),
    el("span",{text:`${+t.shares} ${t.symbol} at ${fmt$(t.price)} = ${fmt$(t.total)}`}),
    el("span",{class:"o",text:new Date(t.at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})})))));
}
function renderBoard(){
  const box=$("#pt-board");
  if(!G.board.length){box.replaceChildren(el("p",{class:"meta",text:"Loading…"}));return;}
  box.replaceChildren(el("ol",{class:"ptboard"},G.board.slice(0,25).map(r=>el("li",{class:r.me?"me":""},
    el("span",{class:"r",text:"#"+r.rank}),el("span",{class:"n",text:r.name+(r.me?" (you)":"")}),
    el("span",{class:"g "+cls(+r.gain_pct),text:fmtPct(+r.gain_pct)}),el("span",{class:"v",text:fmt$(r.value)})))));
}

/* ---------- Trading ---------- */
const symIn=$("#pt-sym"),qtyIn=$("#pt-qty"),msg=$("#pt-msg");
const cleanSym=()=>symIn.value.trim().toUpperCase();
let shown=null;
function fill(sym,qty){symIn.value=sym;qtyIn.value=qty||"";checkPrice();$("#pt-form").scrollIntoView({behavior:"smooth",block:"start"});}
async function checkPrice(){
  const s=cleanSym();msg.textContent="";if(!s){$("#pt-price").textContent="";shown=null;renderEst();return;}
  $("#pt-price").textContent="Checking…";
  try{const q=await quote(s);shown=q;const own=G.pos.find(p=>p.symbol===q.symbol);
    const day=q.prev_close?q.price/q.prev_close-1:null;
    $("#pt-price").replaceChildren(el("b",{text:`${q.symbol} is ${fmt$(q.price)}`}),day!=null?el("span",{class:cls(day),text:` ${fmtPct(day)} today`}):"",own?el("span",{class:"meta",text:` · you own ${+own.shares}`}):"");}
  catch(e){shown=null;$("#pt-price").textContent="";msg.textContent=errText(e);}
  renderEst();
}
function renderEst(){const q=+qtyIn.value,est=$("#pt-est");
  est.textContent=shown&&q>0&&shown.symbol===cleanSym()?`About ${fmt$(q*shown.price)} for ${q} shares. You have ${fmt$(G.acct?G.acct.cash:0)} in cash.`:"";}
$("#pt-check").addEventListener("click",checkPrice);
symIn.addEventListener("change",checkPrice);
symIn.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();checkPrice();}});
qtyIn.addEventListener("input",renderEst);
$("#pt-form").addEventListener("submit",e=>e.preventDefault());
async function trade(side){
  if(busy)return;const sym=cleanSym(),qty=+qtyIn.value;msg.textContent="";
  if(!sym){msg.textContent="Type a ticker first, like NVDA.";return;}
  if(!(qty>0)||qty!==Math.floor(qty)){msg.textContent="Enter a whole number of shares, like 5.";return;}
  busy=true;const b=$(side==="buy"?"#pt-buy":"#pt-sell"),label=b.textContent;b.disabled=true;b.textContent="…";
  try{const{data,error}=await db.rpc("paper_trade",{sym,side,qty});if(error)throw error;
    toast(`${side==="buy"?"Bought":"Sold"} ${+data.shares} ${data.symbol} at ${fmt$(data.price)}`);
    qtyIn.value="";$("#pt-est").textContent="";await load();}
  catch(e){msg.textContent=errText(e);}
  finally{busy=false;b.disabled=false;b.textContent=label;}
}
$("#pt-buy").addEventListener("click",()=>trade("buy"));
$("#pt-sell").addEventListener("click",()=>trade("sell"));
setInterval(()=>{if(loaded&&!$("#trade").hidden)renderMarket();},60000);
})();
