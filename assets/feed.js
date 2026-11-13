// Feed page: your friends' Paper Trading trades (with their "why" and 👍 🔥 🤔 reactions) and
// stock trades reported by members of Congress. Friends' trades show shares only, never dollars.
// Database parts: supabase/feed.sql. Congress trades: the brief server's /congress (brief-server/src/congress.js).
(function(){
"use strict";
const $=s=>document.querySelector(s);
if(!$("#feed"))return;
const el=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="class")e.className=v;else if(k==="text")e.textContent=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v);}for(const kid of kids.flat()){if(kid==null||kid===false)continue;e.append(kid.nodeType?kid:document.createTextNode(String(kid)));}return e;};
function toast(msg){const t=$("#toast");if(!t)return;t.textContent=msg;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),2600);}
const errText=e=>String(e&&e.message||e||"Something went wrong. Try again.");

let db=null,loaded=false,filter="all";
const F={pros:null,friends:null,friendsOff:false,congress:null,congressErr:"",follows:new Set(),followsOff:false};
const API=String(window.WVFC_CONFIG&&window.WVFC_CONFIG.briefApi||"").replace(/\/$/,"");

function signedIn(d){if(db)return;db=d.db;if(!$("#feed").hidden)load();}
document.addEventListener("wvfc:login",e=>signedIn(e.detail));
if(window.WVFC_SESSION)signedIn(window.WVFC_SESSION);
document.addEventListener("wvfc:tab",e=>{if(e.detail==="feed"&&db){if(!loaded)load();else loadFriends();}});
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
    F.pros={insiders:Array.isArray(j.insiders)?j.insiders:[],funds:Array.isArray(j.funds)?j.funds:[]};}
  catch(e){F.pros={insiders:[],funds:[]};}
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
        el("button",{type:"button",class:"linkbtn sym",text:t.symbol,title:`Open ${t.symbol} on Search`,onclick:()=>openStock(t.symbol)})),
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
        t.range?el("span",{class:"fdrange",text:t.range.replace(/\s*-\s*/," to ")}):""),
      t.traded?el("p",{class:"fdnote",text:`Traded ${short(t.traded)}${gap==null?"":gap<=0?", reported the same day":`, reported ${short(t.reported)} (${plural(gap,"day")} later)`}. Members of Congress must report their trades within 45 days, and only give a dollar range.`}):"",
      el("div",{class:"fdbtns"},
        el("button",{type:"button",class:"btn small",text:"See "+t.ticker,onclick:()=>openStock(t.ticker)}),
        el("button",{type:"button",class:"btn small",text:"Practice-buy "+t.ticker,onclick:()=>practice(t.ticker)}),
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
  tk?el("button",{type:"button",class:"btn small",text:"Practice-buy "+tk,onclick:()=>practice(tk)}):"",extra||"");
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
        t.value?el("span",{class:"fdrange",text:about(t.value)}):""),
      el("p",{class:"fdnote",text:`Traded ${short(t.traded)}${gap==null?"":gap<=0?", reported the same day":`, reported ${short(t.reported)} (${plural(gap,"day")} later)`}. An insider works at the company or sits on its board, and must report trades in its stock within 2 business days.${t.side==="sell"?" Insiders sell for many reasons, like paying taxes, so a sale alone doesn't mean bad news.":""}`}),
      stockBtns(t.ticker)));
}
const MOVE={new:["buy","New buy"],more:["buy","Bought more"],less:["sell","Sold some"],sold:["sell","Sold all"]};
function fundCard(t){
  const on=F.follows.has(t.fund),[k,label]=MOVE[t.move]||["wait",t.move];
  const pct=t.pct!=null&&t.move!=="sold"?` (${Math.abs(Math.round(t.pct*100))}% ${t.pct>0?"more":"fewer"} shares)`:"";
  const who=String(t.person||"");
  return el("article",{class:"fdcard"},
    el("div",{class:"fdav fund",text:initials(t.fund)}),
    el("div",{class:"fdbody"},
      el("div",{class:"fdtop"},el("div",{},el("div",{class:"fdname"},t.fund," ",el("span",{class:"fdgov fund",text:"Big investor"})),el("div",{class:"fdwho",text:who.charAt(0).toUpperCase()+who.slice(1)})),
        el("div",{class:"fdwhen",text:t.reported?"Reported "+short(t.reported):""})),
      el("div",{class:"fdtrade"},el("span",{class:"pttag "+k,text:label}),
        t.ticker?el("button",{type:"button",class:"linkbtn sym",text:t.ticker,title:`Open ${t.ticker} on Search`,onclick:()=>openStock(t.ticker)}):"",
        el("span",{class:"fdrange",text:`${t.company} · ${about(t.value)}${pct}`})),
      el("p",{class:"fdnote",text:`From the 3 months that ended ${short(t.asof)}. Big funds only report what they own every 3 months, up to 45 days late, so this is old news by the time you see it.`}),
      stockBtns(t.ticker,el("button",{type:"button",class:"btn small"+(on?" fdon":""),text:on?"Following":"Follow",onclick:e=>follow(t.fund,e.currentTarget)}))));
}

/* ---------- The page ---------- */
function emptyMsg(text,btn){return el("div",{class:"panel fdempty"},el("p",{class:"meta",text}),btn||"");}
function renderList(){
  const box=$("#fd-list");
  const fr=F.friends,cg=F.congress;
  const pros=F.pros||{insiders:[],funds:[]};
  if(fr==null&&cg==null&&F.pros==null){box.replaceChildren(el("p",{class:"meta",text:"Loading the feed…"}));return;}
  const items=[];
  if(filter==="all"||filter==="friends")for(const t of fr||[])items.push({at:+new Date(t.at),card:()=>friendCard(t)});
  if(filter==="all"||filter==="congress"||filter==="following")
    for(const t of cg||[])if(filter!=="following"||F.follows.has(t.member))items.push({at:+day(t.reported||t.traded)||0,card:()=>congressCard(t)});
  if(filter==="all"||filter==="insiders")for(const t of pros.insiders)items.push({at:+day(t.reported||t.traded)||0,card:()=>insiderCard(t)});
  if(filter==="all"||filter==="funds"||filter==="following")
    for(const t of pros.funds)if(filter!=="following"||F.follows.has(t.fund))items.push({at:+day(t.reported)||0,card:()=>fundCard(t)});
  items.sort((a,b)=>b.at-a.at);
  const out=items.slice(0,80).map(i=>i.card());
  if(!out.length){
    if(filter==="following")out.push(emptyMsg(F.follows.size?"The people you follow haven't reported any trades lately.":"Tap Follow on a member of Congress or a big investor and their trades will show up here."));
    else if(filter==="friends"&&F.friendsOff)out.push(emptyMsg("Friends' trades aren't turned on yet. Check back soon."));
    else if(filter==="friends"||filter==="all")out.push(emptyMsg("No trades from you or your friends in the last 30 days. Make a trade in Paper Trading, or invite a friend from Home.",
      el("button",{type:"button",class:"btn primary",text:"Go to Paper Trading",onclick:()=>$("#tab-trade").click()})));
    else if(filter==="insiders"||filter==="funds")out.push(emptyMsg(F.pros==null?"Loading…":filter==="insiders"?"No insider trades to show yet. The list updates every weekday evening.":"No big investor moves to show yet. The list updates every weekday evening."));
    else out.push(emptyMsg(F.congressErr||(cg==null?"Loading Congress trades…":"No Congress trades to show right now.")));
  }else if((filter==="congress"||filter==="all")&&F.congressErr)out.push(el("p",{class:"meta",text:F.congressErr}));
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
}
document.querySelectorAll("#feed .fdchip").forEach(b=>b.addEventListener("click",()=>{filter=b.dataset.f;render();}));
})();
