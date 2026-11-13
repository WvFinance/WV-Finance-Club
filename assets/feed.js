// Feed page: trades in the stocks you own or watch, your friends' Paper Trading trades (with their "why" and 👍 🔥 🤔 reactions) and
// stock trades reported by members of Congress. Friends' trades show shares only, never dollars.
// Database parts: supabase/feed.sql. Congress trades: the brief server's /congress (brief-server/src/congress.js).
(function(){
"use strict";
const $=s=>document.querySelector(s);
if(!$("#feed"))return;
const el=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="class")e.className=v;else if(k==="text")e.textContent=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v);}for(const kid of kids.flat()){if(kid==null||kid===false)continue;e.append(kid.nodeType?kid:document.createTextNode(String(kid)));}return e;};
function toast(msg){const t=$("#toast");if(!t)return;t.textContent=msg;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),2600);}
const errText=e=>String(e&&e.message||e||"Something went wrong. Try again.");

let db=null,loaded=false,filter="all",query="";
const F={pros:null,friends:null,friendsOff:false,congress:null,congressErr:"",follows:new Set(),followsOff:false,allSells:false};
const API=String(window.WVFC_CONFIG&&window.WVFC_CONFIG.briefApi||"").replace(/\/$/,"");

// Load right after sign-in (not only when Feed is opened) so the Feed tab can show a "new" dot.
function signedIn(d){if(db)return;db=d.db;if(!$("#feed").hidden)load();else setTimeout(()=>{if(!loaded)load();},2500);}
document.addEventListener("wvfc:login",e=>signedIn(e.detail));
if(window.WVFC_SESSION)signedIn(window.WVFC_SESSION);
document.addEventListener("wvfc:tab",e=>{if(e.detail==="feed"){markSeen();if(db){if(!loaded)load();else loadFriends();}}});
document.addEventListener("wvfc:mine",()=>{if(loaded)render();});
document.addEventListener("wvfc:traded",()=>{if(loaded)loadFriends();});

/* ---------- Loading ---------- */
async function load(){
  loaded=true;render();
  await Promise.all([loadFriends(),loadCongress(),loadFollows(),loadPros()]);
}
async function loadFriends(){
  const{data,error}=await db.rpc("feed_friends");
  F.friendsOff=!!error;F.friends=error?[]:(data||[]);render();
}
async function loadFollows(){
  const{data,error}=await db.from("feed_follows").select("member");
  F.followsOff=!!error;F.follows=new Set((data||[]).map(r=>r.member));render();
}
// Insider trades and big investors' moves, saved every weekday evening from the SEC's public records
// (scripts/update_pros.py writes data/pros.json).
async function loadPros(){
  try{const r=await fetch("data/pros.json",{cache:"no-cache"});if(!r.ok)throw 0;const j=await r.json();
    F.pros={insiders:Array.isArray(j.insiders)?j.insiders:[],funds:Array.isArray(j.funds)?j.funds:[],prices:j.prices&&typeof j.prices==="object"?j.prices:{}};}
  catch(e){F.pros={insiders:[],funds:[],prices:{}};}
  render();
}
async function loadCongress(){
  if(!API){F.congress=[];F.congressErr="Congress trades aren't turned on for this site yet.";render();return;}
  try{
    const r=await fetch(API+"/congress");const j=await r.json();
    if(!r.ok||!Array.isArray(j.trades))throw new Error(j.error||"Congress trades couldn't be loaded.");
    F.congress=j.trades;F.congressErr="";
  }catch(e){F.congress=[];F.congressErr="Congress trades couldn't be loaded right now. Try again later.";}
  render();
}

/* ---------- Words and dates ---------- */
const DID={buy:"Bought",sell:"Sold",short:"Shorted",cover:"Bought back"};
const TAG={buy:"buy",cover:"buy",sell:"sell",short:"sell"};
function ago(t){const s=(Date.now()-new Date(t))/1000;
  if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+" min ago";if(s<86400){const h=Math.floor(s/3600);return h+" hr ago";}
  const d=Math.floor(s/86400);if(d<7)return d===1?"yesterday":d+" days ago";
  return new Date(t).toLocaleDateString("en-US",{month:"short",day:"numeric"});}
const day=d=>d?new Date(d+"T12:00:00"):null;
const short=d=>d?day(d).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"";
const initials=n=>String(n||"?").split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase()||"?";
// "CA11" -> "California, district 11"; "AL" -> "Alabama"
const STATES={AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",DC:"D.C.",PR:"Puerto Rico"};
function where(t){const m=/^([A-Z]{2})(\d*)$/.exec(t.state||"");const st=m?(STATES[m[1]]||m[1]):"";
  return[t.chamber==="senate"?"U.S. Senate":t.chamber==="house"?"U.S. House":"Congress",st].filter(Boolean).join(" · ");}
const plural=(n,w)=>`${n} ${w}${n===1?"":"s"}`;
// "3 days", "2 weeks", "about 3 months": how long ago a day was.
function age(d){const n=Math.max(0,Math.round((Date.now()-day(d))/86400000));
  return n<14?plural(n,"day"):n<60?plural(Math.round(n/7),"week"):`about ${plural(Math.round(n/30),"month")}`;}
const first=n=>String(n||"").split(/\s+/)[0]||"They";

/* ---------- Your stocks ---------- */
const bare=s=>String(s||"").split(":").pop().toUpperCase();
function myStocks(){const a=window.WVFC_APP||{};
  return{own:new Set((a.mine?a.mine():[]).map(bare)),watch:new Set((a.watch?a.watch():[]).map(bare))};}
// A small "You own" / "On your watchlist" tag on any trade in one of your stocks.
function yoursTag(tk){const{own,watch}=myStocks();tk=bare(tk);
  return own.has(tk)?el("span",{class:"fdyours",text:"You own"}):watch.has(tk)?el("span",{class:"fdyours",text:"On your watchlist"}):"";}

/* ---------- Since reported: how the stock moved after the trade became public ---------- */
// Prices come from data/pros.json (scripts/update_pros.py saves each stock's close on the reported day and its newest close).
function since(tk,d){const p=((F.pros||{}).prices||{})[bare(tk)];const then=p&&p.on&&p.on[d];
  return then&&p.now?(p.now-then)/then*100:null;}
function sinceTag(tk,d){const v=since(tk,d);if(v==null)return"";
  const c=v>=0.05?"up":v<=-0.05?"down":"flat";
  return el("span",{class:"fdsince "+c,title:`How much ${tk}'s price changed from the day this trade was reported to the latest close`,
    text:`${tk} ${v>=0.05?"▲":v<=-0.05?"▼":""} ${Math.abs(v).toFixed(1)}% since reported`.replace("  "," ")});}

/* ---------- "What this means": one plain sentence per card, from simple rules (no AI) ---------- */
const meaning=txt=>el("p",{class:"fdmean"},el("b",{text:"What this means: "}),txt);
const BIG_SALE=5e6;   // insider sales under this are usually routine, so they're hidden unless you ask
function congressMeaning(t){
  const old=t.traded?` This trade happened ${age(t.traded)} ago, because Congress can wait up to 45 days to report.`:"";
  const small=/^\$?1,?001\b/.test(t.range||"")?" It's a small trade, under $15,000.":"";
  return t.side==="buy"?`${first(t.member)} put their own money into ${t.ticker}.${small}${old}`
    :`${first(t.member)} sold ${t.ticker}. That can mean they think it will drop, or they just wanted the cash.${small}${old}`;
}
function insiderMeaning(t){
  const co=String(t.company||t.ticker).replace(/\s*\(The\)$/i,"");
  if(t.side==="buy")return`${first(t.name)} works at ${co} and bought more of its stock with their own money. Insiders buy mostly for one reason: they think the price will go up.`;
  if(+t.value>=BIG_SALE)return`This is a big sale. Insiders often sell for normal reasons, like paying taxes or buying a house, but a sale this size is worth a look.`;
  return`Insiders sell for normal reasons all the time, like paying taxes, so a small sale like this usually isn't news.`;
}
function fundMeaning(t,m){
  const what={new:`started buying ${m.company}, a brand new stock for them`,more:`bought more ${m.company}`,less:`sold some of its ${m.company}`,sold:`sold all of its ${m.company}`}[m.move]||`changed its ${m.company} shares`;
  return`${t.fund}'s biggest move was that it ${what}. These moves are from months ago, so the fund may have changed its mind since.`;
}
// Dollars a fund moved in or out of one stock, to show the biggest moves first.
const moved=m=>m.move==="new"||m.move==="sold"||m.pct==null||!(1+m.pct>0)?+m.value||0:(+m.value||0)*Math.abs(m.pct)/(1+m.pct);

/* ---------- Buttons ---------- */
const openStock=s=>window.WVFC_APP&&window.WVFC_APP.openStock(s);
const practice=s=>window.WVFC_PAPER&&window.WVFC_PAPER.trade(s,"buy");
async function follow(m,btn){
  if(F.followsOff){toast("Following isn't set up yet.");return;}
  btn.disabled=true;
  const{data,error}=await db.rpc("feed_follow",{m});
  btn.disabled=false;
  if(error){toast(errText(error));return;}
  if(data)F.follows.add(m);else F.follows.delete(m);
  toast(data?`You're following ${m}.`:`You stopped following ${m}.`);render();
}
const EMO=[["up","👍","Like"],["fire","🔥","Fire"],["think","🤔","Hmm"]];
async function react(t,e){
  const had=t.mine.includes(e);
  // Show it right away, then check with the database.
  t.mine=had?t.mine.filter(x=>x!==e):[...t.mine,e];t[e]+=had?-1:1;render();
  const{error}=await db.rpc("feed_react",{tid:t.id,e});
  if(error){t.mine=had?[...t.mine,e]:t.mine.filter(x=>x!==e);t[e]+=had?1:-1;render();toast(errText(error));}
}
async function editWhy(t){
  const v=window.prompt("Why did you make this trade? Your friends will see it. (140 letters max)",t.why||"");
  if(v==null)return;
  const{data,error}=await db.rpc("feed_set_why",{tid:t.id,txt:v});
  if(error){toast(errText(error));return;}
  t.why=data;render();
}

/* ---------- Cards ---------- */
function friendCard(t){
  return el("article",{class:"fdcard"},
    el("div",{class:"fdav",text:initials(t.name)}),
    el("div",{class:"fdbody"},
      el("div",{class:"fdtop"},el("div",{},el("div",{class:"fdname",text:t.me?"You":t.name}),el("div",{class:"fdwho",text:t.me?"Your trade":"Friend"})),
        el("div",{class:"fdwhen",text:ago(t.at)})),
      el("div",{class:"fdtrade"},el("span",{class:"pttag "+(TAG[t.side]||"wait"),text:`${DID[t.side]||t.side} ${plural(+t.shares,"share")}`}),
        el("button",{type:"button",class:"linkbtn sym",text:t.symbol,title:`Open ${t.symbol} on Search`,onclick:()=>openStock(t.symbol)}),yoursTag(t.symbol)),
      t.why?el("p",{class:"fdwhy"},el("b",{text:"Why: "}),t.why):t.me?"":null,
      t.me?el("button",{type:"button",class:"linkbtn fdadd",text:t.why?"Change your reason":"Add why you made this trade",onclick:()=>editWhy(t)}):"",
      el("div",{class:"fdreact"},EMO.map(([k,em,label])=>el("button",{type:"button",class:"fdemo"+(t.mine.includes(k)?" on":""),"aria-pressed":String(t.mine.includes(k)),"aria-label":`${label}: ${t[k]}`,onclick:()=>react(t,k)},
        em,t[k]?el("span",{text:String(t[k])}):"")))));
}
function congressCard(t){
  const gap=t.traded&&t.reported?Math.round((day(t.reported)-day(t.traded))/86400000):null;
  const on=F.follows.has(t.member);
  return el("article",{class:"fdcard"},
    el("div",{class:"fdav gov",text:initials(t.member)}),
    el("div",{class:"fdbody"},
      el("div",{class:"fdtop"},el("div",{},el("div",{class:"fdname"},t.member," ",el("span",{class:"fdgov",text:"Congress"})),el("div",{class:"fdwho",text:where(t)})),
        el("div",{class:"fdwhen",text:t.reported?"Reported "+short(t.reported):""})),
      el("div",{class:"fdtrade"},el("span",{class:"pttag "+t.side,text:t.side==="buy"?"Bought":"Sold"}),
        el("button",{type:"button",class:"linkbtn sym",text:t.ticker,title:`Open ${t.ticker} on Search`,onclick:()=>openStock(t.ticker)}),
        t.range?el("span",{class:"fdrange",text:t.range.replace(/\s*-\s*/," to ")}):"",yoursTag(t.ticker)),
      t.traded?el("p",{class:"fdwhen2",text:`Traded ${short(t.traded)}${gap==null?"":gap<=0?", reported the same day":`, reported ${plural(gap,"day")} later`}`}):"",
      sinceTag(t.ticker,t.reported),
      meaning(congressMeaning(t)),
      el("div",{class:"fdbtns"},
        el("button",{type:"button",class:"btn small",text:"See "+t.ticker,onclick:()=>openStock(t.ticker)}),
        el("button",{type:"button",class:"btn small",text:"Buy Now",title:`Buy ${t.ticker} in Paper Trading`,onclick:()=>practice(t.ticker)}),
        el("button",{type:"button",class:"btn small"+(on?" fdon":""),text:on?"Following":"Follow",onclick:e=>follow(t.member,e.currentTarget)}))));
}

// 1234567 -> "about $1.2 million"
function about(v){v=+v;if(!(v>0))return"";
  if(v>=1e9)return`about $${(v/1e9).toFixed(v>=1e10?0:1)} billion`;
  if(v>=1e6)return`about $${(v/1e6).toFixed(v>=1e7?0:1)} million`;
  if(v>=1e3)return`about $${Math.round(v/1e3).toLocaleString("en-US")},000`;
  return`about $${Math.round(v)}`;}
const stockBtns=(tk,extra)=>el("div",{class:"fdbtns"},
  tk?el("button",{type:"button",class:"btn small",text:"See "+tk,onclick:()=>openStock(tk)}):"",
  tk?el("button",{type:"button",class:"btn small",text:"Buy Now",title:`Buy ${tk} in Paper Trading`,onclick:()=>practice(tk)}):"",extra||"");
function insiderCard(t){
  const gap=t.traded&&t.reported?Math.round((day(t.reported)-day(t.traded))/86400000):null;
  const n=+t.shares;
  return el("article",{class:"fdcard"},
    el("div",{class:"fdav ins",text:initials(t.name)}),
    el("div",{class:"fdbody"},
      el("div",{class:"fdtop"},el("div",{},el("div",{class:"fdname"},t.name," ",el("span",{class:"fdgov ins",text:"Insider"})),el("div",{class:"fdwho",text:`${t.role} at ${t.company}`})),
        el("div",{class:"fdwhen",text:t.reported?"Reported "+short(t.reported):""})),
      el("div",{class:"fdtrade"},el("span",{class:"pttag "+t.side,text:`${t.side==="buy"?"Bought":"Sold"} ${n.toLocaleString("en-US")} share${n===1?"":"s"}`}),
        el("button",{type:"button",class:"linkbtn sym",text:t.ticker,title:`Open ${t.ticker} on Search`,onclick:()=>openStock(t.ticker)}),
        t.value?el("span",{class:"fdrange",text:about(t.value)}):"",yoursTag(t.ticker)),
      t.traded?el("p",{class:"fdwhen2",text:`Traded ${short(t.traded)}${gap==null?"":gap<=0?", reported the same day":`, reported ${plural(gap,"day")} later`}`}):"",
      sinceTag(t.ticker,t.reported),
      meaning(insiderMeaning(t)),
      stockBtns(t.ticker)));
}
const MOVE={new:["buy","New buy"],more:["buy","Bought more"],less:["sell","Sold some"],sold:["sell","Sold all"]};
// One card per big investor, with its moves as short rows inside.
function fundGroup(moves,max){
  moves=[...moves].sort((a,b)=>moved(b)-moved(a));
  const t=moves[0],on=F.follows.has(t.fund),who=String(t.person||"");
  const rows=max?moves.slice(0,max):moves,more=moves.length-rows.length;
  return el("article",{class:"fdcard"},
    el("div",{class:"fdav fund",text:initials(t.fund)}),
    el("div",{class:"fdbody"},
      el("div",{class:"fdtop"},el("div",{},el("div",{class:"fdname",text:t.fund}),el("div",{class:"fdwho",text:who.charAt(0).toUpperCase()+who.slice(1)})),
        el("button",{type:"button",class:"btn small"+(on?" fdon":""),text:on?"Following":"Follow",onclick:e=>follow(t.fund,e.currentTarget)})),
      el("ul",{class:"fdmoves"},rows.map(m=>{const[k,label]=MOVE[m.move]||["wait",m.move];
        const pct=m.pct==null||m.move==="sold"||m.move==="new"?"":m.pct>=20?", many times more shares":m.pct>=1.5?`, about ${Math.round(1+m.pct)} times as many shares`:`, ${Math.abs(Math.round(m.pct*100))}% ${m.pct>0?"more":"fewer"} shares`;
        return el("li",{},el("span",{class:"pttag "+k,text:label}),
          el("span",{class:"fdmv"},m.ticker?el("button",{type:"button",class:"linkbtn sym",text:m.ticker,title:`Open ${m.ticker} on Search`,onclick:()=>openStock(m.ticker)}):"",
            el("span",{class:"fdrange",text:`${m.company} · ${about(m.value)}${pct}`}),yoursTag(m.ticker),sinceTag(m.ticker,m.reported)));})),
      meaning(fundMeaning(t,moves[0])),
      el("p",{class:"fdwhen2",text:`From the 3 months that ended ${short(t.asof)}${more>0?` · ${more} more ${more===1?"move":"moves"} in Big investors`:""}`})));
}

/* ---------- The page ---------- */
function emptyMsg(text,btn){return el("div",{class:"panel fdempty"},el("p",{class:"meta",text}),btn||"");}
const GROUPS=[
  ["mine","Your stocks","Trades by friends, Congress, insiders and big investors in stocks you own or watch."],
  ["friends","Friends","What you and your friends traded in Paper Trading."],
  ["congress","Congress","Members of Congress must report their trades within 45 days, and only give a dollar range."],
  ["insiders","Insiders","People who work at a company or sit on its board. Shows their buys and their big sales."],
  ["funds","Big investors","Big funds only report what they own every 3 months, up to 45 days late, so this is old news by the time you see it."]];
// Search: a stock ticker, company or person's name. Every word typed has to match.
const hit=(...f)=>{if(!query)return true;const h=f.filter(Boolean).join(" ").toLowerCase();return query.split(/\s+/).every(w=>h.includes(w));};
const byDay=k=>(a,b)=>(+day(b[k]||b.traded)||0)-(+day(a[k]||a.traded)||0);
// The cards for one group, newest first. max = how many to show (0 = all of them).
// Every trade in a stock you own or watch, newest first, as cards of any kind.
function mineCards(){
  const pros=F.pros||{insiders:[],funds:[]};const{own,watch}=myStocks();const has=tk=>own.has(bare(tk))||watch.has(bare(tk));
  const a=[];
  for(const t of F.friends||[])if(!t.me&&has(t.symbol)&&hit(t.symbol,t.name))a.push({at:+new Date(t.at),friend:true,card:()=>friendCard(t)});
  for(const t of F.congress||[])if(has(t.ticker)&&hit(t.ticker,t.member))a.push({at:+day(t.reported),card:()=>congressCard(t)});
  for(const t of pros.insiders)if(has(t.ticker)&&hit(t.ticker,t.name,t.company,t.role))a.push({at:+day(t.reported),card:()=>insiderCard(t)});
  const by=new Map();for(const t of pros.funds)if(has(t.ticker)&&hit(t.ticker,t.company,t.fund,t.person)){if(!by.has(t.fund))by.set(t.fund,[]);by.get(t.fund).push(t);}
  for(const m of by.values())a.push({at:+day(m[0].reported),card:()=>fundGroup(m,0)});
  return a.sort((x,y)=>(y.at||0)-(x.at||0));
}
// Insider sales under $5 million are usually routine (taxes, planned sales), so they're left out unless you search or ask.
const loud=t=>t.side==="buy"||+t.value>=BIG_SALE;
function groupCards(key,max,onlyFollowed){
  const pros=F.pros||{insiders:[],funds:[]};
  const cut=a=>max?a.slice(0,max):a.slice(0,80);
  if(key==="mine"){const a=mineCards();return{n:a.length,cards:cut(a).map(x=>x.card())};}
  if(key==="friends"){const a=(F.friends||[]).filter(t=>hit(t.symbol,t.me?"you":"",t.name));return{n:a.length,cards:cut(a).map(friendCard)};}
  if(key==="congress"){const a=(F.congress||[]).filter(t=>(!onlyFollowed||F.follows.has(t.member))&&hit(t.ticker,t.member)).sort(byDay("reported"));return{n:a.length,cards:cut(a).map(congressCard)};}
  if(key==="insiders"){const a=pros.insiders.filter(t=>(query||F.allSells||loud(t))&&hit(t.ticker,t.name,t.company,t.role)).sort(byDay("reported"));return{n:a.length,cards:cut(a).map(insiderCard)};}
  const by=new Map();for(const t of pros.funds){if(onlyFollowed&&!F.follows.has(t.fund))continue;if(!by.has(t.fund))by.set(t.fund,[]);by.get(t.fund).push(t);}
  // A fund's name matches: show all its moves. Otherwise keep only the moves for the stock searched.
  if(query)for(const[k,m]of[...by]){if(hit(k,m[0].person))continue;const keep=m.filter(t=>hit(t.ticker,t.company));if(keep.length)by.set(k,keep);else by.delete(k);}
  const a=[...by.values()].sort((x,y)=>(+day(y[0].reported)||0)-(+day(x[0].reported)||0));
  return{n:a.length,cards:cut(a).map(m=>fundGroup(m,max?3:0))};
}
function emptyFor(key){
  if(key==="mine"){const{own,watch}=myStocks();
    return own.size||watch.size?emptyMsg("Nobody here has traded your stocks lately. When they do, it shows up here first."):
      emptyMsg("Buy a stock in Paper Trading or add one to your watchlist, and trades in it will show up here first.",
        el("button",{type:"button",class:"btn primary",text:"Go to Paper Trading",onclick:()=>$("#tab-trade").click()}));}
  if(key==="friends")return F.friends==null?emptyMsg("Loading…"):F.friendsOff?emptyMsg("Friends' trades aren't turned on yet. Check back soon."):
    emptyMsg("No trades from you or your friends in the last 30 days. Make a trade in Paper Trading, or invite a friend from Home.",
      el("button",{type:"button",class:"btn primary",text:"Go to Paper Trading",onclick:()=>$("#tab-trade").click()}));
  if(key==="congress")return emptyMsg(F.congressErr||(F.congress==null?"Loading Congress trades…":"No Congress trades to show right now."));
  return emptyMsg(F.pros==null?"Loading…":key==="insiders"?"No insider trades to show yet. The list updates every weekday evening.":"No big investor moves to show yet. The list updates every weekday evening.");
}
function section(key,title,sub,max,onlyFollowed){
  const{n,cards}=groupCards(key,max,onlyFollowed);
  if((onlyFollowed||query)&&!n)return null;
  const more=max&&n>cards.length;
  return el("section",{class:"fdsec"},
    el("div",{class:"fdsechead"},el("h3",{class:"h3",text:title}),
      more?el("button",{type:"button",class:"linkbtn",text:"See all",onclick:()=>{filter=key;render();window.scrollTo({top:0});}}):""),
    el("p",{class:"meta fdsecsub",text:sub}),
    cards.length?cards:emptyFor(key),
    key==="insiders"&&!max&&!query?moreSells():"");
}
function moreSells(){
  const n=((F.pros||{}).insiders||[]).filter(t=>!loud(t)).length;if(!n)return"";
  return el("button",{type:"button",class:"btn fdmoresells",text:F.allSells?"Hide the smaller sales":`Show ${plural(n,"smaller sale")} too`,onclick:()=>{F.allSells=!F.allSells;render();}});
}
function renderList(){
  const box=$("#fd-list");
  if(F.friends==null&&F.congress==null&&F.pros==null){box.replaceChildren(el("p",{class:"meta",text:"Loading the feed…"}));return;}
  let out;
  if(filter==="all")out=GROUPS.map(([k,t,s])=>section(k,t,s,3)).filter(Boolean);
  else if(filter==="following"){
    out=GROUPS.filter(g=>g[0]==="congress"||g[0]==="funds").map(([k,t,s])=>section(k,t,s,0,true)).filter(Boolean);
    if(!out.length)out=[emptyMsg(F.follows.size?"The people you follow haven't reported any trades lately.":"Tap Follow on a member of Congress or a big investor and their trades will show up here.")];
  }else out=GROUPS.filter(g=>g[0]===filter).map(([k,t,s])=>section(k,t,s,0)).filter(Boolean);
  if(query&&!out.length)out=[emptyMsg(`Nothing matches "${$("#fd-q").value.trim()}" here. Try a ticker like AAPL, a company, or a person's name.`,
    el("button",{type:"button",class:"btn",text:"Clear search",onclick:()=>setQuery("")}))];
  box.replaceChildren(...out);
}
function renderSide(){
  const cg=F.congress||[];
  // Who to follow: the members of Congress who traded the most in the latest reports.
  const by=new Map();for(const t of cg){const r=by.get(t.member)||{t,n:0};r.n++;by.set(t.member,r);}
  const who=[...by.values()].sort((a,b)=>b.n-a.n).slice(0,4);
  const funds=[...new Map(((F.pros||{}).funds||[]).map(t=>[t.fund,t])).values()].slice(0,4);
  $("#fd-follow").replaceChildren(el("h3",{class:"h3",text:"Who to follow"}),
    el("p",{class:"meta",text:"Follow big investors and members of Congress to see their trades in Following."}),
    who.length||funds.length?el("ul",{class:"fdwholist"},funds.map(t=>{const on=F.follows.has(t.fund);return el("li",{},
      el("div",{class:"fdav fund sm",text:initials(t.fund)}),
      el("div",{class:"fdwl"},el("div",{class:"fdname",text:t.fund}),el("div",{class:"fdwho",text:"Big investor"})),
      el("button",{type:"button",class:"btn small"+(on?" fdon":""),text:on?"Following":"Follow",onclick:e=>follow(t.fund,e.currentTarget)}));}),who.map(({t,n})=>{const on=F.follows.has(t.member);return el("li",{},
      el("div",{class:"fdav gov sm",text:initials(t.member)}),
      el("div",{class:"fdwl"},el("div",{class:"fdname",text:t.member}),el("div",{class:"fdwho",text:`${t.chamber==="senate"?"Senate":"House"}${t.state?" · "+t.state.slice(0,2):""} · ${plural(n,"trade")}`})),
      el("button",{type:"button",class:"btn small"+(on?" fdon":""),text:on?"Following":"Follow",onclick:e=>follow(t.member,e.currentTarget)}));})):
      el("p",{class:"meta",text:F.congress==null?"Loading…":"Nobody to show right now."}));
  // Most bought: tickers with the most buys in the latest reports.
  const buys=new Map();for(const t of cg)if(t.side==="buy")buys.set(t.ticker,(buys.get(t.ticker)||0)+1);
  const top=[...buys.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  $("#fd-most").replaceChildren(el("h3",{class:"h3",text:"Most bought in Congress"}),
    el("p",{class:"meta",text:cg.length?`In the latest ${cg.length} reported trades.`:"From the latest reported trades."}),
    top.length?el("ol",{class:"ptboard fdmost"},top.map(([s,n],i)=>el("li",{},el("span",{class:"r",text:"#"+(i+1)}),
      el("span",{class:"n"},el("button",{type:"button",class:"linkbtn sym",text:s,onclick:()=>openStock(s)})),el("span",{class:"g up",text:plural(n,"buy")})))):
      el("p",{class:"meta",text:F.congress==null?"Loading…":"Nothing to show right now."}));
}
function render(){
  document.querySelectorAll("#feed .fdchip").forEach(b=>{const on=b.dataset.f===filter;b.classList.toggle("on",on);b.setAttribute("aria-pressed",String(on));});
  renderList();renderSide();
  if($("#feed").hidden)newDot();
}

/* ---------- "New" dot on the Feed tab ---------- */
// Counts friends' trades and trades in your stocks since you last opened Feed (saved in this browser only).
const SEEN="wvfc.feedSeen";
function lastSeen(){try{return +localStorage.getItem(SEEN)||0;}catch(e){return 0;}}
function markSeen(){try{localStorage.setItem(SEEN,String(Date.now()));}catch(e){}showDot(0);}
function newDot(){
  if(F.friends==null||F.pros==null)return;
  const s=lastSeen()||Date.now()-3*86400000;
  const q=query;query="";const mine=mineCards().filter(x=>!x.friend&&x.at>s);query=q;
  showDot((F.friends||[]).filter(t=>!t.me&&+new Date(t.at)>s).length+mine.length);
}
function showDot(n){
  const b=$("#tab-feed");if(!b)return;let d=b.querySelector(".fddot");
  if(!n){if(d)d.remove();b.removeAttribute("aria-label");return;}
  if(!d){d=el("span",{class:"fddot","aria-hidden":"true"});b.append(d);}
  b.setAttribute("aria-label",`Feed, ${n} new`);d.title=`${n} new since you last looked`;
}
function setQuery(v){const q=$("#fd-q");if(q.value!==v)q.value=v;query=v.trim().toLowerCase();$("#fd-qx").hidden=!v;render();}
$("#fd-q").addEventListener("input",e=>setQuery(e.target.value));
$("#fd-q").addEventListener("keydown",e=>{if(e.key==="Escape")setQuery("");});
$("#fd-qx").addEventListener("click",()=>{setQuery("");$("#fd-q").focus();});
document.querySelectorAll("#feed .fdchip").forEach(b=>b.addEventListener("click",()=>{filter=b.dataset.f;render();}));
})();
