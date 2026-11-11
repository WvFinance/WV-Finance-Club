// Users tab: every personal account ("Just me" sign-ups and personal accounts from the Class/Personal switcher).
// Shows only on the admin's personal account. View only. The database decides who may see it (supabase/personal-users.sql).
(function(){
"use strict";
const $=s=>document.querySelector(s);
const el=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(k==="class")e.className=v;else if(k==="text")e.textContent=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else if(v!==false&&v!=null)e.setAttribute(k,v===true?"":v);}for(const kid of kids.flat()){if(kid==null||kid===false)continue;e.append(kid.nodeType?kid:document.createTextNode(String(kid)));}return e;};
const fmt$=v=>"$"+(+v).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const money=v=>(v<0?"−":"")+fmt$(Math.abs(v));
const signed$=v=>(v>=0?"+":"−")+fmt$(Math.abs(v));
const fmtPct=v=>(v>=0?"+":"−")+Math.abs(v*100).toFixed(2)+"%";
const cls=v=>v>0.00005?"up":v<-0.00005?"down":"flat";
const when=t=>t?new Date(t).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"–";
const day=t=>t?new Date(t).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"–";
const errText=e=>String(e&&e.message||e||"Something went wrong. Try again.");
if(!$("#users"))return;

const DID={buy:"Bought",sell:"Sold",short:"Shorted",cover:"Bought back"};
const SIDE={buy:"Buy",sell:"Sell",short:"Short",cover:"Buy to cover"};
const KIND={limit:"Limit",stop:"Stop",stop_limit:"Stop-limit",trailing_stop:"Trailing stop"};
const STAT={open:"Waiting",filled:"Went through",canceled:"Canceled",failed:"Didn't go through"};

let U=null,loaded=false,people=[];
function start(d){if(U)return;U=d;if(!$("#users").hidden)load();}
document.addEventListener("wvfc:users",e=>start(e.detail));
if(window.WVFC_USERS)start(window.WVFC_USERS);
document.addEventListener("wvfc:tab",e=>{if(U&&!loaded&&e.detail==="users")load();});

async function load(){
  loaded=true;$("#us-loading").hidden=false;$("#us-loading").textContent="Loading users…";
  const{data,error}=await U.db.rpc("users_list");
  if(error){loaded=false;$("#us-loading").textContent=/users_list|schema cache/i.test(error.message||"")?"This page isn't set up yet. Run supabase/personal-users.sql in Supabase first.":errText(error);return;}
  people=data||[];
  $("#us-loading").hidden=true;$("#us-body").hidden=false;render();
}
function shown(){
  const q=$("#us-find").value.trim().toLowerCase();
  return people.filter(p=>!q||(p.name||"").toLowerCase().includes(q)||(p.email||"").toLowerCase().includes(q));
}
function render(){renderTiles();renderList();}
const tile=(label,val,note,k)=>el("div",{class:"tile"},el("div",{class:"eyebrow",text:label}),el("div",{class:"v "+(k||""),text:val}),el("div",{class:"n",text:note}));
function renderTiles(){
  const list=shown(),play=list.filter(p=>p.joined);
  const avg=play.length?play.reduce((s,p)=>s+(+p.gain_pct),0)/play.length:null;
  $("#us-tiles").replaceChildren(tile("Users",String(list.length),"Personal accounts"),tile("Playing",String(play.length),"Joined Paper Trading"),
    tile("Trades made",String(list.reduce((s,p)=>s+(p.trades||0),0)),"By these users"),tile("Average gain",avg==null?"–":fmtPct(avg),"Of users playing",avg==null?"":cls(avg)));
}
function renderList(){
  const list=shown().sort((a,b)=>(b.joined-a.joined)||((+b.gain_pct||0)-(+a.gain_pct||0)));
  const box=$("#us-list");
  if(!list.length){box.replaceChildren(el("h3",{class:"h3",text:"Users"}),el("p",{class:"meta",text:people.length?"No users match.":"Nobody has made a personal account yet."}));return;}
  const td=(t,k)=>el("td",{class:k||"",text:t});
  box.replaceChildren(el("h3",{class:"h3",text:"Users"}),el("p",{class:"meta",text:"Tap a name to see their stocks, trades and orders."}),
    el("div",{class:"tablewrap"},el("table",{class:"pos sttable"},
      el("thead",{},el("tr",{},["User","Joined","Account value","Gain %","Stocks","Trades","Waiting orders","Last trade"].map((t,i)=>el("th",{class:i?"num":"",text:t})))),
      el("tbody",{},list.map(p=>el("tr",{},
        el("td",{},el("button",{type:"button",class:"linkbtn",text:p.name||p.email,onclick:()=>openUser(p)}),p.name?el("small",{class:"stmail",text:p.email}):""),
        td(day(p.created_at),"num"),
        td(p.joined?fmt$(p.value):"Not playing yet","num"),td(p.joined?fmtPct(+p.gain_pct):"–","num "+(p.joined?cls(+p.gain_pct):"")),
        td(String(p.stocks),"num"),td(String(p.trades),"num"),td(String(p.open_orders),"num"),td(when(p.last_trade),"num")))))));
}

/* ---------- One user ---------- */
async function openUser(p){
  const box=$("#us-detail");box.hidden=false;
  box.replaceChildren(el("p",{class:"meta",text:`Loading ${p.name||p.email}…`}));
  box.scrollIntoView({behavior:"smooth",block:"start"});
  const head=el("div",{class:"sechead"},el("div",{},el("h3",{class:"h3",text:p.name||p.email}),el("p",{class:"meta",text:`${p.email} · joined ${day(p.created_at)}`})),
    el("button",{type:"button",class:"btn small",text:"Close",onclick:()=>{box.hidden=true;}}));
  if(!p.joined){box.replaceChildren(head,el("p",{class:"meta",text:"This user hasn't started Paper Trading yet."}));return;}
  const{data,error}=await U.db.rpc("users_one",{target:p.user_id});
  if(error){box.replaceChildren(head,el("p",{class:"meta",text:errText(error)}));return;}
  const pos=(data.positions||[]).map(x=>{const px=x.price!=null?+x.price:+x.cost/+x.shares,value=px*x.shares,gain=value-x.cost;return{...x,px,value,gain,gp:gain/Math.abs(x.cost)};}).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
  const gain=+p.value-50000;
  const td=(t,k)=>el("td",{class:k||"",text:t});
  box.replaceChildren(head,
    el("div",{class:"tiles"},tile("Account value",fmt$(p.value),"Cash plus stocks"),tile("Total gain",signed$(gain),fmtPct(gain/50000)+" since starting",cls(gain)),
      tile("Cash",money(+p.cash),"Pretend money"),tile("Stocks",String(pos.length),pos.length===1?"Stock owned":"Stocks owned")),
    el("h4",{class:"pth4",text:"Stocks they own"}),
    pos.length?el("div",{class:"tablewrap"},el("table",{class:"pos"},
      el("thead",{},el("tr",{},["Stock","Shares","Paid per share","Price now","Worth now","Gain $","Gain %"].map((t,i)=>el("th",{class:i?"num":"",text:t})))),
      el("tbody",{},pos.map(x=>el("tr",{},el("td",{},el("b",{class:"stsym",text:x.symbol}),x.shares<0?el("span",{class:"pttag short",text:"Short"}):""),
        td(String(Math.abs(x.shares)),"num"),td(fmt$(x.cost/x.shares),"num"),td(fmt$(x.px),"num"),td(money(x.value),"num"),td(signed$(x.gain),"num "+cls(x.gp)),td(fmtPct(x.gp),"num "+cls(x.gp)))))))
      :el("p",{class:"meta",text:"No stocks right now."}),
    el("h4",{class:"pth4",text:"Orders"}),
    (data.orders||[]).length?el("ul",{class:"ptlist"},data.orders.map(o=>el("li",{},
      el("span",{class:"pttag "+(o.status==="filled"?"buy":o.status==="failed"?"sell":"wait"),text:STAT[o.status]||o.status}),
      el("span",{text:`${KIND[o.kind]||o.kind}: ${SIDE[o.side]||o.side} ${+o.shares} ${o.symbol}`+(o.limit_price?` · limit ${fmt$(o.limit_price)}`:"")+(o.stop_price?` · stop ${fmt$(o.stop_price)}`:"")+(o.trail_pct?` · trail ${+o.trail_pct}%`:"")+(o.note?`. ${o.note}`:"")}),
      el("span",{class:"o",text:when(o.done_at||o.created_at)})))):el("p",{class:"meta",text:"No orders."}),
    el("h4",{class:"pth4",text:"Recent trades"}),
    (data.trades||[]).length?el("ul",{class:"ptlist"},data.trades.map(t=>el("li",{},
      el("span",{class:"pttag "+t.side,text:DID[t.side]||t.side}),el("span",{text:`${+t.shares} ${t.symbol} at ${fmt$(t.price)} = ${fmt$(t.total)}`}),
      el("span",{class:"o",text:when(t.at)})))):el("p",{class:"meta",text:"No trades yet."}));
}
$("#us-find").addEventListener("input",render);
})();
