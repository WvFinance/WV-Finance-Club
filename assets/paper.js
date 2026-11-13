// Trading game: $50,000 of pretend money, real prices, one leaderboard for the whole district.
// The My Portfolio tab shows the same game stocks and waiting orders, without the order form.
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
const G={acct:null,pos:[],prices:{},trades:[],board:[],orders:[]};
// The News tab needs the game too: it shows news for the stocks you own.
const onGame=()=>!$("#trade").hidden||!$("#search").hidden||!!$("#mine")&&!$("#mine").hidden||!!$("#news")&&!$("#news").hidden;
function signedIn(d){if(db)return;db=d.db;user=d.user;renderTradeBar();if(onGame())load();if($("#dv-dpeople")&&!$("#dv-dpeople").hidden&&!$("#district").hidden)renderDistrictPeople();loadChallenge();}
document.addEventListener("wvfc:login",e=>signedIn(e.detail));
if(window.WVFC_SESSION)signedIn(window.WVFC_SESSION);
document.addEventListener("wvfc:tab",e=>{if((e.detail==="trade"||e.detail==="search"||e.detail==="mine"||e.detail==="news")&&db&&!loaded)load();});
const goTrade=()=>$("#tab-trade").click();
if($("#mine")){$("#mine-trade").addEventListener("click",goTrade);$("#mine-join-go").addEventListener("click",goTrade);}
function mineShow(which){if(!$("#mine"))return;$("#mine-loading").hidden=which!=="loading"&&which!=="error";$("#mine-join").hidden=which!=="join";$("#mine-game").hidden=which!=="game";$("#mine-trade").hidden=which!=="game";}
const errText=e=>String(e&&e.message||e||"Something went wrong. Try again.");

/* ---------- Market hours (Chicago time) ---------- */
function marketOpen(){
  const p=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",weekday:"short",hour:"numeric",minute:"numeric",hourCycle:"h23"}).formatToParts(new Date()).map(x=>[x.type,x.value]));
  const m=+p.hour*60+ +p.minute;return!["Sat","Sun"].includes(p.weekday)&&m>=510&&m<=900;
}
function renderMarket(){const open=marketOpen();const m=$("#pt-market");
  m.textContent=open?"The market is open. Market orders go through right away at the real price.":"The market is closed (weekdays 8:30am to 3pm Chicago time). You can still place limit and stop orders: they wait for the market to open.";
  m.className="meta "+(open?"open":"closed");}

/* ---------- Loading ---------- */
async function load(){
  loaded=true;
  // A teacher's Paper Trading tab is their school's Class Portfolio instead of the game (staff.js).
  if(await (window.WVFC_ROLE_READY||Promise.resolve())==="teacher"){$("#pt-loading").hidden=true;window.WVFC_APP&&window.WVFC_APP.setMine&&window.WVFC_APP.setMine([]);return;}
  renderMarket();
  const{data:acct,error}=await db.from("paper_accounts").select("*").maybeSingle();
  $("#pt-loading").hidden=true;
  if(error){$("#pt-loading").hidden=false;$("#pt-loading").textContent="The game couldn't be loaded. Try again in a minute.";
    mineShow("error");if($("#mine"))$("#mine-loading").textContent="Your stocks couldn't be loaded. Try again in a minute.";loaded=false;return;}
  if(!acct){window.WVFC_APP&&window.WVFC_APP.setMine&&window.WVFC_APP.setMine([]);$("#pt-game").hidden=true;$("#pt-join").hidden=false;mineShow("join");if(!$("#pt-name").value)$("#pt-name").value=(String(user.user_metadata&&user.user_metadata.name||"").trim()||(user.email||"").split("@")[0]).slice(0,30);return;}
  G.acct=acct;$("#pt-join").hidden=true;$("#pt-game").hidden=false;mineShow("game");
  const[pos,tr,od]=await Promise.all([db.from("paper_positions").select("*"),db.from("paper_trades").select("*").order("at",{ascending:false}).limit(1000),
    db.from("paper_orders").select("*").order("created_at",{ascending:false}).limit(40)]);
  G.pos=pos.data||[];G.trades=tr.data||[];G.orders=od.error?[]:(od.data||[]);
  renderAll();
  if(pendingFill){const[s,sd]=pendingFill;pendingFill=null;if(!$("#trade").hidden)fill(s,"",sd);}
  // Fresh prices for what they own, then the leaderboard.
  await Promise.all(G.pos.map(p=>quote(p.symbol).catch(()=>null)));
  const b=await db.rpc("paper_board");G.board=b.data||[];
  renderAll();
  loadExtras();
}
async function quote(sym){const{data,error}=await db.rpc("paper_quote",{sym});if(error)throw error;G.prices[data.symbol]=data;return data;}

/* ---------- Join ---------- */
$("#pt-join").addEventListener("submit",async e=>{e.preventDefault();const m=$("#pt-join-msg");m.textContent="";
  const{error}=await db.rpc("paper_join",{display_name:$("#pt-name").value});
  if(error){m.textContent=errText(error);return;}
  toast("You're in! You have $50,000 to trade.");load();});


/* ---------- Rendering ---------- */
// A short has negative shares and a negative cost (the cash it brought in), so price × shares is what it's worth.
const priceOf=p=>G.prices[p.symbol]?+G.prices[p.symbol].price:+p.cost/+p.shares;
const money=v=>(v<0?"−":"")+fmt$(Math.abs(v));
const SIDE={buy:"Buy",sell:"Sell",short:"Short",cover:"Buy to cover"};
const DID={buy:"Bought",sell:"Sold",short:"Shorted",cover:"Bought back"};
const KIND={market:"Market",limit:"Limit",stop:"Stop",stop_limit:"Stop-limit",trailing_stop:"Trailing stop",auto:"Automatic"};
const when=t=>new Date(t).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
// Tells the News tab which stocks this member owns, so it shows their news.
function shareMine(){window.WVFC_APP&&window.WVFC_APP.setMine&&window.WVFC_APP.setMine(G.pos.map(p=>p.symbol));}
function renderAll(){shareMine();renderTradeBar();renderTiles();renderOrders();renderTrades();renderBoard();renderEst();renderMine();}
function renderMine(){if(!$("#mine"))return;renderTiles($("#mine-tiles"));renderHold($("#mine-hold"),true);renderOrders($("#mine-orders"),true);renderChart();renderFriends();renderMineView();}

/* ---------- Personal Home drop-down views (My stocks, by sector, vs S&P 500, My trades) ---------- */
let mView="mine";
document.addEventListener("wvfc:mview",e=>{mView=e.detail;renderMineView();});
const joinFirst=()=>el("p",{class:"meta",text:"Join Paper Trading first. Once you buy stocks, they show up here."});
function renderMineView(){
  if(!$("#mine")||$("#mine").hidden)return;
  if(mView==="mystocks"&&!G.acct)$("#mine-stocks-box").replaceChildren(el("div",{class:"panel"},joinFirst()));
  if(mView==="mysectors")renderMineSectors();
  if(mView==="myhistory"){const b=$("#mine-hist");if(!G.acct)b.replaceChildren(joinFirst());else renderChart(b,true);}
  if(mView==="mytrades"){const b=$("#mine-trades");if(!G.acct)b.replaceChildren(joinFirst());else renderTrades(b,true);}
}
let secAsk=0;
async function renderMineSectors(){
  const box=$("#mine-sec");if(!box)return;
  if(!G.acct){box.replaceChildren(joinFirst());return;}
  const app=window.WVFC_APP;if(!app||!app.sectorPie)return;
  const ask=++secAsk,sec=await app.sectorsFor(G.pos.map(p=>p.symbol));if(ask!==secAsk)return;
  const by={};for(const p of G.pos){const k=sec[p.symbol]||"Other";by[k]=(by[k]||0)+Math.abs(priceOf(p)*p.shares);}
  const cash=+G.acct.cash;
  app.sectorPie(box,by,"The pie fills in once you buy a stock in Paper Trading. Each slice is a type of business, like Tech or Banks.","What I own by sector",
    G.pos.length?el("p",{class:"meta",style:"margin-top:14px",text:`Plus ${money(cash)} in cash that isn't in a stock yet.`+(Object.keys(by).includes("Funds")?" Funds hold lots of companies at once.":"")}):null);
}

/* ---------- Home: money over time and the friends leaderboard (supabase/home-extras.sql) ---------- */
G.daily=null;G.friends=null;G.invite=null;G.extrasOff=false;
async function loadExtras(){
  if(!$("#mine-chart"))return;
  const[d,f,c]=await Promise.all([db.from("paper_daily").select("day,value").order("day"),db.rpc("friends_board"),db.rpc("my_invite_code")]);
  // Before home-extras.sql is run these don't exist yet, so the two panels stay hidden.
  if(d.error&&f.error){G.extrasOff=true;renderChart();renderFriends();renderMineView();return;}
  G.daily=d.error?[]:(d.data||[]);G.friends=f.error?null:(f.data||[]);G.invite=c.error?null:c.data;
  renderChart();renderFriends();renderMineView();
}
const SVGNS="http://www.w3.org/2000/svg";
const sv=(tag,attrs={})=>{const e=document.createElementNS(SVGNS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;};
const chiDay=t=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago"}).format(t?new Date(t):new Date());
function spyOn(day){const P=window.WVFC_APP&&window.WVFC_APP.prices&&window.WVFC_APP.prices();if(!P||!P.closes||!P.closes.SPY)return null;
  const c=P.closes.SPY,d=P.dates||[];let v=null;for(let i=0;i<d.length&&d[i]<=day;i++)if(c[i]!=null)v=c[i];return v;}
function renderChart(box,big){
  box=box||$("#mine-chart");if(!box||!G.acct)return;
  if(big&&(G.extrasOff||!G.daily)){box.replaceChildren(el("p",{class:"meta",text:G.extrasOff?"This chart isn't turned on yet.":"Loading…"}));return;}
  if(G.extrasOff||!G.daily){box.hidden=true;return;}box.hidden=false;
  const start=chiDay(G.acct.started_at||G.acct.created_at),today=chiDay();
  const now=+G.acct.cash+G.pos.reduce((s,p)=>s+priceOf(p)*p.shares,0);
  const pts=[{day:start,v:START}].concat(G.daily.filter(r=>r.day>start&&r.day<today).map(r=>({day:r.day,v:+r.value})),[{day:today,v:now}]);
  if(pts.length>1&&pts[pts.length-1].day===pts[0].day)pts.shift();
  const s0=spyOn(start);
  const spy=s0?pts.map(p=>{const c=spyOn(p.day);return c?START*c/s0:null;}):[];
  const pct=v=>v/START-1;
  const all=pts.map(p=>pct(p.v)).concat(spy.filter(x=>x!=null).map(pct),[0]);
  let lo=Math.min(...all),hi=Math.max(...all);const pad=Math.max((hi-lo)*.15,.01);lo-=pad;hi+=pad;
  const W=Math.round(Math.max(300,Math.min(760,(box.clientWidth||760)-36))),H=big?(W<500?240:300):(W<500?200:220),L=48,R=10,T=10,B=26,n=pts.length;
  const x=i=>L+(n<2?0:(W-L-R)*i/(n-1)),y=v=>T+(H-T-B)*(1-(pct(v)-lo)/(hi-lo));
  const svg=sv("svg",{viewBox:`0 0 ${W} ${H}`,width:"100%",role:"img","aria-label":"Your account value over time compared with the S&P 500"});
  const step=(hi-lo)/4;for(let i=0;i<=4;i++){const v=lo+step*i,yy=T+(H-T-B)*(1-i/4);
    svg.append(sv("line",{x1:L,x2:W-R,y1:yy,y2:yy,stroke:"var(--line)","stroke-width":1}));
    const t=sv("text",{x:L-8,y:yy+4,"text-anchor":"end","font-size":11,fill:"var(--muted)","font-family":"var(--f-mono)"});t.textContent=(v>=0?"+":"")+(v*100).toFixed(1)+"%";svg.append(t);}
  const line=(vals,color,w)=>{const d=vals.map((v,i)=>v==null?null:`${x(i).toFixed(1)} ${y(v).toFixed(1)}`).filter(Boolean);if(d.length<2)return;svg.append(sv("path",{d:"M"+d.join(" L"),fill:"none",stroke:color,"stroke-width":w,"stroke-linejoin":"round","stroke-linecap":"round"}));};
  line(spy,"#8a8a86",2);line(pts.map(p=>p.v),"var(--gold)",3);
  const lab=(i,a)=>{const t=sv("text",{x:x(i),y:H-6,"text-anchor":a,"font-size":11,fill:"var(--muted)","font-family":"var(--f-mono)"});const[yy,m,dd]=pts[i].day.split("-").map(Number);t.textContent=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]+" "+dd;svg.append(t);};
  lab(0,"start");if(n>1)lab(n-1,"end");
  const ab=v=>Math.abs(v*100).toFixed(2)+"%";const g=pct(now),sp=spy.length&&spy[spy.length-1]!=null?pct(spy[spy.length-1]):null;
  box.replaceChildren(big?"":el("h3",{class:"h3",text:"Your money over time"}),
    el("p",{class:"meta",text:sp==null?`You're ${g>=0?"up":"down"} ${ab(g)} since you started.`:`You're ${g>=0?"up":"down"} ${ab(g)} since you started. The same money in the S&P 500 would be ${sp>=0?"up":"down"} ${ab(sp)}.`}),
    el("div",{class:"chartleg"},el("span",{},el("i",{style:"background:var(--gold)"}),"You"),sp==null?"":el("span",{},el("i",{style:"background:#8a8a86"}),"Same money in the S&P 500")),
    svg,G.daily.length<2?el("p",{class:"meta",text:"Your account value is saved every weekday after the market closes, so this line fills in a little more each day."}):"");
}
function renderFriends(){
  const box=$("#mine-friends");if(!box||!G.acct)return;
  if(G.extrasOff||!G.friends){box.hidden=true;return;}box.hidden=false;
  const link=G.invite?location.origin+location.pathname+"?invite="+G.invite:"";
  const rows=G.friends;
  box.replaceChildren(el("h3",{class:"h3",text:"Friends leaderboard"}),
    el("p",{class:"meta",text:rows.length>1?"You and your friends, ranked by how much your $50,000 has grown.":"Invite friends with your link. When they sign up, you'll see each other here."}),
    rows.length?el("ol",{class:"ptboard"},rows.map(r=>el("li",{class:r.me?"me":""},el("span",{class:"r",text:"#"+r.rank}),el("span",{class:"n",text:r.name+(r.me?" (you)":"")}),
      el("span",{class:"g "+cls(+r.gain_pct),text:fmtPct(+r.gain_pct)}),el("span",{class:"v",text:fmt$(r.value)})))):"",
    link?el("button",{type:"button",class:"btn invitebtn",text:"Invite a friend",onclick:()=>shareInvite(link)}):"");
}
async function shareInvite(link){
  const text="Practice investing with me on Simple Street. We each get $50,000 of pretend money to see who grows it the most.";
  try{if(navigator.share){await navigator.share({title:"Simple Street",text,url:link});return;}}catch(e){if(e&&e.name==="AbortError")return;}
  try{await navigator.clipboard.writeText(link);toast("Invite link copied. Send it to a friend!");}
  catch(e){window.prompt("Copy your invite link:",link);}
}
function renderTiles(box){
  const stocks=G.pos.reduce((s,p)=>s+priceOf(p)*p.shares,0),value=+G.acct.cash+stocks,gain=value-START;
  const me=G.board.find(r=>r.me);
  const tile=(label,val,note,k)=>el("div",{class:"tile"},el("div",{class:"eyebrow",text:label}),el("div",{class:"v "+(k||""),text:val}),el("div",{class:"n",text:note}));
  (box||$("#pt-tiles")).replaceChildren(tile("Account value",fmt$(value),G.pos.some(p=>p.shares<0)?"Cash plus stocks, minus shorts":"Cash plus stocks"),tile("Total gain",signed$(gain),fmtPct(gain/START)+" since you started",cls(gain)),
    tile("Cash to spend",money(+G.acct.cash),"Pretend money"),window.WVFC_INDIVIDUAL?tile("Your rank",me?"#"+me.rank:"–",me?`out of ${G.board.length}${G.board.length>=100?"+":""} players`:G.board.length?"Make a trade to get ranked":"Loading…"):
      tile("Your class rank",me?"#"+(classBoard().find(r=>r.me)||me).rank:"–",me?`out of ${classBoard().length} players at your school`:"Loading…"));
}
function orderText(o){
  const n=`${+o.shares} ${o.symbol}`;
  if(o.kind==="limit")return `${SIDE[o.side]} ${n} at ${fmt$(o.limit_price)} or ${o.side==="buy"||o.side==="cover"?"less":"more"}`;
  if(o.kind==="stop")return `${SIDE[o.side]} ${n} if it ${o.side==="buy"||o.side==="cover"?"rises":"falls"} to ${fmt$(o.stop_price)}`;
  if(o.kind==="stop_limit")return `${SIDE[o.side]} ${n} if it ${o.side==="buy"||o.side==="cover"?"rises":"falls"} to ${fmt$(o.stop_price)}, at ${fmt$(o.limit_price)} or ${o.side==="buy"||o.side==="cover"?"less":"more"}`;
  return `${SIDE[o.side]} ${n} if it ${o.side==="buy"||o.side==="cover"?"rises":"drops"} ${+o.trail_pct}% from its ${o.side==="buy"||o.side==="cover"?"low":"high"}`+(o.mark?` (${o.side==="buy"||o.side==="cover"?"low":"high"} so far ${fmt$(o.mark)})`:"");
}
function renderOrders(box,mine){
  box=box||$("#pt-orders");const open=G.orders.filter(o=>o.status==="open"),
    done=mine?[]:G.orders.filter(o=>o.status!=="open"&&Date.now()-new Date(o.done_at||o.created_at)<7*864e5).slice(0,5);
  if(!open.length&&!done.length){box.hidden=true;return;}box.hidden=false;
  const STAT={filled:"Went through",canceled:"Canceled",failed:"Didn't go through"};
  box.replaceChildren(el("h3",{class:"h3",text:"Your waiting orders"}),
    el("p",{class:"meta",text:mine?"Orders that will buy or sell once the stock reaches your price.":"Waiting orders are checked every 2 minutes while the market is open, so the price you get can be a little different from your line."}),
    open.length?el("ul",{class:"ptlist"},open.map(o=>el("li",{},
      el("span",{class:"pttag wait",text:KIND[o.kind]+(o.triggered?" · stop hit":"")}),el("span",{text:orderText(o)}),
      el("span",{class:"o",text:"placed "+when(o.created_at)}),
      el("button",{type:"button",class:"btn small",text:"Cancel",onclick:e=>cancel(o.id,e.currentTarget)})))):el("p",{class:"meta",text:"No waiting orders right now."}),
    done.length?el("h4",{class:"pth4",text:"Lately"}):"",
    done.length?el("ul",{class:"ptlist done"},done.map(o=>el("li",{},
      el("span",{class:"pttag "+(o.status==="filled"?"buy":o.status==="failed"?"sell":"wait"),text:STAT[o.status]}),
      el("span",{text:orderText(o)+(o.note?`. ${o.note}`:"")}),el("span",{class:"o",text:when(o.done_at||o.created_at)})))):"");
}
async function cancel(id,b){b.disabled=true;
  const{error}=await db.rpc("paper_cancel_order",{oid:id});
  if(error){toast(errText(error));b.disabled=false;return;}
  toast("Order canceled");load();}
function renderHold(box,mine){
  if(!G.pos.length){box.replaceChildren(el("h3",{class:"h3",text:"Your stocks"}),el("p",{class:"meta",text:mine?"You don't own any stocks yet. Go to Paper Trading to buy your first one.":"You don't own any stocks yet. Type a ticker above and place an order."}));return;}
  const total=+G.acct.cash+G.pos.reduce((s,p)=>s+priceOf(p)*p.shares,0);
  const td=(t,k)=>el("td",{class:k||"",text:t});
  const rows=G.pos.map(p=>({p,px:priceOf(p)})).map(r=>Object.assign(r,{value:r.px*r.p.shares,gain:r.px*r.p.shares-r.p.cost})).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
  const head=el("thead",{},el("tr",{},(mine?["Stock","Shares","Paid per share","Price now","Worth now","Gain $","Gain %","% of account",""]:["Stock","Shares","Paid per share","Price now","Worth now","Gain $","Gain %",""]).map((t,i,a)=>el("th",{class:i&&i<a.length-1?"num":"",text:t}))));
  const body=el("tbody",{},rows.map(({p,px,value,gain})=>{const sh=p.shares<0,gp=gain/Math.abs(p.cost);return el("tr",{},
    el("td",{},el("button",{type:"button",class:"linkbtn sym",text:p.symbol,title:`Open ${p.symbol} on Search`,onclick:()=>window.WVFC_APP&&window.WVFC_APP.openStock(p.symbol)}),sh?el("span",{class:"pttag short",text:"Short"}):""),
    td(String(Math.abs(p.shares)),"num"),td(fmt$(p.cost/p.shares),"num"),td(fmt$(px),"num"),td(money(value),"num"),td(signed$(gain),"num "+cls(gp)),td(fmtPct(gp),"num "+cls(gp)),
    mine?td(total>0?Math.round(Math.abs(value)/total*100)+"%":"–","num"):"",
    el("td",{},el("button",{type:"button",class:"btn small",text:sh?"Cover":"Sell",onclick:()=>{if(mine)goTrade();fill(p.symbol,Math.abs(p.shares),sh?"cover":"sell");}})));}));
  box.replaceChildren(el("h3",{class:"h3",text:"Your stocks"}),
    el("p",{class:"meta",text:G.pos.some(p=>p.shares<0)?"Prices update every few minutes while the market is open. A short makes money when the price goes down.":"Prices update every few minutes while the market is open."}),
    el("div",{class:"tablewrap"},el("table",{class:"pos"},head,body)));
}
// Order History: every trade this member has made, newest first.
let histAll=false;
function renderTrades(box,mine){
  box=box||$("#pt-trades");const title=mine?"":el("h3",{class:"h3",text:"Order History"});
  if(!G.trades.length){box.replaceChildren(title,el("p",{class:"meta",text:mine?"You haven't made any trades yet. Go to Paper Trading to buy your first stock. Every trade you make will be saved here.":"You haven't made any trades yet. Type a ticker above and place an order. Every trade you make will be saved here."}));return;}
  const list=histAll?G.trades:G.trades.slice(0,25);
  const td=(t,k)=>el("td",{class:k||"",text:t});
  const head=el("thead",{},el("tr",{},["Date","Action","Stock","Shares","Price","Total","Order type"].map((t,i)=>el("th",{class:i>=3&&i<=5?"num":"",text:t}))));
  const body=el("tbody",{},list.map(t=>el("tr",{},
    td(when(t.at)),el("td",{},el("span",{class:"pttag "+t.side,text:DID[t.side]||t.side})),
    el("td",{},el("button",{type:"button",class:"linkbtn sym",text:t.symbol,title:`Open ${t.symbol} on Search`,onclick:()=>window.WVFC_APP&&window.WVFC_APP.openStock(t.symbol)})),
    td(String(+t.shares),"num"),td(fmt$(t.price),"num"),td(fmt$(t.total),"num"),
    td(t.how==="auto"?"Automatic (price doubled)":(KIND[t.how]||"Market")))));
  box.replaceChildren(title,
    el("p",{class:"meta",text:`${mine?"":"Every trade you've made, newest first. "}${G.trades.length} trade${G.trades.length===1?"":"s"} so far.`}),
    el("div",{class:"tablewrap"},el("table",{class:"pos"},head,body)),
    G.trades.length>25?el("button",{type:"button",class:"btn small",style:"margin-top:12px",text:histAll?"Show fewer":`Show all ${G.trades.length}`,onclick:()=>{histAll=!histAll;renderTrades();renderMineView();}}):"");
}
// Class Leaderboard: only players from your school, ranked among themselves.
function classBoard(){
  const me=G.board.find(r=>r.me);if(!me||window.WVFC_INDIVIDUAL)return G.board;
  const mine=G.board.filter(r=>r.school===me.school);
  return mine.map(r=>({...r,rank:1+mine.filter(o=>+o.value>+r.value).length}));
}
function boardList(rows,showSchool){
  return el("ol",{class:"ptboard"},rows.map(r=>el("li",{class:r.me?"me":""},
    el("span",{class:"r",text:"#"+r.rank}),el("span",{class:"n",text:r.name+(r.me?" (you)":"")},showSchool&&r.school?el("small",{class:"sc",text:r.school}):null),
    el("span",{class:"g "+cls(+r.gain_pct),text:fmtPct(+r.gain_pct)}),el("span",{class:"v",text:fmt$(r.value)}))));
}
function renderBoard(){
  const box=$("#pt-board");
  if(!G.board.length){box.replaceChildren(el("p",{class:"meta",text:"Loading…"}));return;}
  box.replaceChildren(boardList(classBoard().slice(0,25),false));
}
// District Individual Leaderboard (District tab): every player in the district.
async function renderDistrictPeople(){
  const box=$("#dpeople-body");if(!box)return;
  if(!db){box.replaceChildren(el("p",{class:"meta",text:"Log in to see the leaderboard."}));return;}
  if(!G.board.length)box.replaceChildren(el("p",{class:"meta",text:"Loading…"}));
  const b=await db.rpc("paper_board");
  if(b.error&&!G.board.length){box.replaceChildren(el("p",{class:"meta",text:"The leaderboard couldn't be loaded. Try again in a minute."}));return;}
  if(b.data)G.board=b.data;
  // Class accounts only: personal ("Just me") accounts have no school and stay off the district board.
  const rows=window.WVFC_INDIVIDUAL?G.board:G.board.filter(r=>r.school).map((r,_,all)=>({...r,rank:1+all.filter(o=>+o.value>+r.value).length}));
  box.replaceChildren(rows.length?boardList(rows.slice(0,50),true):el("p",{class:"meta",text:"No one is playing Paper Trading yet."}),
    el("p",{class:"meta",style:"margin-top:12px",text:"Everyone starts with $50,000 of pretend money. Showing the top 50."}));
}
document.addEventListener("wvfc:dpeople",()=>renderDistrictPeople());

/* ---------- Weekly Challenge: school vs school, Monday to Friday (supabase/weekly-challenge.sql) ---------- */
let wk=null,wkErr=false;
async function loadChallenge(){
  if(!db)return;
  const{data,error}=await db.rpc("challenge_board");
  wkErr=!!error;wk=error?null:(data||[]);
  renderBanner();if($("#dv-dweek")&&!$("#dv-dweek").hidden&&!$("#district").hidden)renderChallenge();
}
const pctOf=v=>v==null?"–":fmtPct(+v);
// The winner of last week, and who leads this week, as one short line at the top of the Class Portfolio.
function renderBanner(){
  const b=$("#wk-banner");if(!b)return;
  const now=(wk||[]).filter(r=>r.players>0),last=(wk||[]).filter(r=>r.last_players>0).sort((a,c)=>+c.last_gain-+a.last_gain);
  if(!now.length&&!last.length){b.hidden=true;return;}
  b.replaceChildren(el("span",{class:"trophy","aria-hidden":"true",text:"🏆"}),
    el("span",{},last.length?el("b",{text:`Last week's winner: ${last[0].school} (${pctOf(last[0].last_gain)})`}):el("b",{text:"Weekly Challenge"}),
      now.length?el("span",{text:` · This week ${now[0].school} leads with ${pctOf(now[0].week_gain)}`}):"",
      el("span",{class:"more",text:" See the scores →"})));
  b.hidden=false;
}
function renderChallenge(){
  const box=$("#dweek-body");if(!box)return;
  if(!db){box.replaceChildren(el("p",{class:"meta",text:"Log in to see the challenge."}));return;}
  if(wkErr){box.replaceChildren(el("p",{class:"meta",text:"The Weekly Challenge starts soon."}));return;}
  if(!wk){box.replaceChildren(el("p",{class:"meta",text:"Loading…"}));return;}
  const ranked=wk.filter(r=>r.players>0),none=wk.filter(r=>!(r.players>0));
  const row=(r,i,gain,n)=>el("li",{class:r.mine?"me":""},el("span",{class:"r",text:"#"+(i+1)}),
    el("span",{class:"n",text:r.school+(r.mine?" (your school)":"")},el("small",{class:"sc",text:`${n} player${n===1?"":"s"}`})),
    el("span",{class:"g "+cls(+gain),text:pctOf(gain)}),el("span",{class:"v",text:""}));
  const last=wk.filter(r=>r.last_players>0).sort((a,c)=>+c.last_gain-+a.last_gain);
  const d=wk[0]&&wk[0].week?new Date(wk[0].week+"T12:00:00"):null;
  box.replaceChildren(el("h3",{class:"h3",text:d?`This week (since Monday, ${d.toLocaleDateString("en-US",{month:"short",day:"numeric"})})`:"This week"}),
    ranked.length?el("ol",{class:"ptboard schools"},ranked.map((r,i)=>row(r,i,r.week_gain,r.players))):el("p",{class:"meta",text:"No one has traded yet this week."}),
    none.length?el("p",{class:"meta",style:"margin-top:10px",text:`No players yet: ${none.map(r=>r.school).join(", ")}.`}):"",
    el("h3",{class:"h3",style:"margin-top:22px",text:"Last week"}),
    last.length?el("ol",{class:"ptboard schools"},last.map((r,i)=>row(r,i,r.last_gain,r.last_players))):el("p",{class:"meta",text:"The first winner will show here after a full week."}));
}
document.addEventListener("wvfc:dweek",()=>{renderChallenge();loadChallenge();});

/* ---------- Order form ---------- */
const symIn=$("#pt-sym"),qtyIn=$("#pt-qty"),kindIn=$("#pt-kind"),msg=$("#pt-msg");
const cleanSym=()=>symIn.value.trim().toUpperCase();
const side=()=>(document.querySelector('input[name="pt-side"]:checked')||{}).value||"buy";
const buying=()=>side()==="buy"||side()==="cover";
let shown=null;
function fill(sym,qty,sd){symIn.value=sym;qtyIn.value=qty||"";
  const r=document.querySelector(`input[name="pt-side"][value="${sd||"buy"}"]`);if(r)r.checked=true;
  formChanged();checkPrice();$("#pt-form").scrollIntoView({behavior:"smooth",block:"start"});}
async function checkPrice(){
  const s=cleanSym();msg.textContent="";if(!s){$("#pt-price").textContent="";shown=null;renderEst();return;}
  $("#pt-price").textContent="Checking…";
  try{const q=await quote(s);shown=q;const own=G.pos.find(p=>p.symbol===q.symbol);
    const day=q.prev_close?q.price/q.prev_close-1:null;
    $("#pt-price").replaceChildren(el("b",{text:`${q.symbol} is ${fmt$(q.price)}`}),day!=null?el("span",{class:cls(day),text:` ${fmtPct(day)} today`}):"",
      own?el("span",{class:"meta",text:own.shares<0?` · you're shorting ${-own.shares}`:` · you own ${+own.shares}`}):"");}
  catch(e){shown=null;$("#pt-price").textContent="";msg.textContent=errText(e);}
  renderEst();
}
function help(){
  const k=kindIn.value,sd=side(),b=buying(),up=b?"rises":"falls";
  const act={buy:"buys",sell:"sells",short:"shorts",cover:"buys back your short"}[sd];
  let t={
    market:`Trades right away at the price now. Only works while the market is open.`,
    limit:b?`Waits until the price drops to your limit price or lower, then ${act}. You never pay more than your limit.`
           :`Waits until the price rises to your limit price or higher, then ${act}. You never get less than your limit.`,
    stop:sd==="sell"?`Stop loss: if the price falls to your stop price, it sells at the price then. It protects you from losing too much.`
        :sd==="cover"?`If the price rises to your stop price, it buys back your short. It protects a short from losing too much.`
        :`If the price ${up} to your stop price, it ${act} at the price then.`,
    stop_limit:`When the price ${up} to your stop price, it turns into a limit order: it only ${act.split(" ")[0]} at your limit price or ${b?"lower":"higher"}. If the price moves too fast, it might not trade at all.`,
    trailing_stop:b?`Follows the lowest price since you placed it. If the price rises this % above that low, it ${act}.`
                   :`Follows the highest price since you placed it. If the price drops this % below that high, it ${act}. The line moves up as the stock goes up, so it locks in gains.`
  }[k];
  if(sd==="short")t+=" Shorting is a bet that the price goes down: you sell borrowed shares now and buy them back later. If the price goes up, you lose money. Rules: all your shorts together can be worth at most half your account, and a short is bought back automatically if the price doubles.";
  return t;
}
function formChanged(){
  const k=kindIn.value;
  $("#pt-stop-box").hidden=!(k==="stop"||k==="stop_limit");
  $("#pt-limit-box").hidden=!(k==="limit"||k==="stop_limit");
  $("#pt-trail-box").hidden=k!=="trailing_stop";
  $("#pt-why-box").hidden=k!=="market";
  $("#pt-help").textContent=help();
  const go=$("#pt-go");go.textContent=k==="market"?SIDE[side()]+" now":"Place "+KIND[k].toLowerCase()+" order";
  go.className="btn "+(side()==="sell"||side()==="short"?"sell":"primary");
  renderEst();
}
function renderEst(){const q=+qtyIn.value,est=$("#pt-est"),k=kindIn.value,lim=+$("#pt-limit").value;
  if(!(q>0)){est.textContent="";return;}
  const cash=`You have ${money(G.acct?+G.acct.cash:0)} in cash.`;
  if((k==="limit"||k==="stop_limit")&&lim>0){est.textContent=`About ${fmt$(q*lim)} for ${q} shares at your limit. ${cash}`;return;}
  est.textContent=shown&&shown.symbol===cleanSym()?`About ${fmt$(q*shown.price)} for ${q} shares at today's price. ${cash}`:"";}
$("#pt-check").addEventListener("click",checkPrice);
symIn.addEventListener("change",checkPrice);
symIn.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();checkPrice();}});
qtyIn.addEventListener("input",renderEst);
$("#pt-limit").addEventListener("input",renderEst);
kindIn.addEventListener("change",formChanged);
$("#pt-side").addEventListener("change",formChanged);
formChanged();
$("#pt-form").addEventListener("submit",async e=>{e.preventDefault();
  if(busy)return;const sym=cleanSym(),qty=+qtyIn.value,k=kindIn.value,sd=side();msg.textContent="";
  if(!sym){msg.textContent="Type a ticker first, like NVDA.";return;}
  if(!(qty>0)||qty!==Math.floor(qty)){msg.textContent="Enter a whole number of shares, like 5.";return;}
  const num=id=>{const v=$(id).value.trim();return v===""?null:+v;};
  const args={sym,side:sd,qty,kind:k,limit_price:num("#pt-limit"),stop_price:num("#pt-stop"),trail_pct:num("#pt-trail")};
  if((k==="limit"||k==="stop_limit")&&!(args.limit_price>0)){msg.textContent="Enter a limit price.";return;}
  if((k==="stop"||k==="stop_limit")&&!(args.stop_price>0)){msg.textContent="Enter a stop price.";return;}
  if(k==="trailing_stop"&&!(args.trail_pct>=1&&args.trail_pct<=50)){msg.textContent="Enter a trailing percent between 1 and 50.";return;}
  busy=true;const b=$("#pt-go"),label=b.textContent;b.disabled=true;b.textContent="…";
  try{
    if(k==="market"){const{data,error}=await db.rpc("paper_trade",{sym,side:sd,qty});if(error)throw error;
      toast(`${DID[data.side]} ${+data.shares} ${data.symbol} at ${fmt$(data.price)}`);
      // The reason goes on the Feed (supabase/feed.sql). If that isn't set up yet, the trade still counts.
      const why=$("#pt-why").value.trim();if(why&&data.id){await db.rpc("feed_set_why",{tid:data.id,txt:why});}
      $("#pt-why").value="";document.dispatchEvent(new CustomEvent("wvfc:traded"));}
    else{const{data,error}=await db.rpc("paper_place_order",args);if(error)throw error;
      toast(data.status==="filled"?`Your ${KIND[k].toLowerCase()} order went through right away`:data.status==="failed"?`Your order didn't go through: ${data.note}`:`Order placed. It will wait until ${data.symbol} reaches your price.`);}
    qtyIn.value="";$("#pt-limit").value="";$("#pt-stop").value="";$("#pt-trail").value="";$("#pt-est").textContent="";await load();}
  catch(e){msg.textContent=errText(e);}
  finally{busy=false;b.disabled=false;b.textContent=label;}
});

/* ---------- Buy / Sell bar on the stock search page ---------- */
// Teachers trade for the Class Portfolio (staff.js), everyone else uses this game's order form.
function classTrader(){return window.WVFC_ROLE==="teacher";}
function searchSym(){return window.WVFC_APP&&window.WVFC_APP.tk?window.WVFC_APP.tk():"";}
function renderTradeBar(){const bar=$("#s-trade");if(!bar)return;const sym=searchSym();
  if(!sym||!db){bar.hidden=true;return;}bar.hidden=false;
  const own=$("#s-trade-own"),sell=$("#s-sell");
  if(classTrader()){$("#s-trade-title").textContent="Class Portfolio";
    const app=window.WVFC_APP,has=app&&app.picks&&app.picks().some(p=>String(p.ticker).toUpperCase()===sym);
    own.textContent=has?`The class owns ${sym}.`:`The class doesn't own ${sym} yet.`;sell.disabled=!has;return;}
  $("#s-trade-title").textContent="Paper Trading";
  if(!loaded||!G.acct){own.textContent=`Practice buying and selling ${sym} with pretend money.`;sell.disabled=false;return;}
  const p=G.pos.find(x=>x.symbol===sym),n=p?+p.shares:0;
  own.textContent=n>0?`You own ${n} share${n===1?"":"s"} of ${sym}.`:n<0?`You're shorting ${-n} share${n===-1?"":"s"} of ${sym}.`:`You don't own any ${sym} yet.`;
  sell.disabled=!(n>0);sell.title=n>0?"":`You can only sell stock you own.`;
}
let pendingFill=null;
function tradeFromSearch(sd,s){const sym=s||searchSym();if(!sym)return;
  if(classTrader()){document.dispatchEvent(new CustomEvent("wvfc:classtrade",{detail:{sym,side:sd}}));return;}
  goTrade();if(db&&G.acct)fill(sym,"",sd);else{symIn.value=sym;pendingFill=[sym,sd];}
  setTimeout(()=>{if(!qtyIn.closest("[hidden]"))qtyIn.focus({preventScroll:true});},400);}
$("#s-buy").addEventListener("click",()=>tradeFromSearch("buy"));
// The Feed's "Buy Now" button opens the order form with that stock filled in.
window.WVFC_PAPER={trade:(sym,sd)=>tradeFromSearch(sd||"buy",sym)};
$("#s-sell").addEventListener("click",()=>tradeFromSearch("sell"));
document.addEventListener("wvfc:stock",renderTradeBar);
document.addEventListener("wvfc:tab",e=>{if(e.detail==="search")renderTradeBar();});
setInterval(()=>{if(loaded&&!$("#trade").hidden)renderMarket();},60000);
})();
