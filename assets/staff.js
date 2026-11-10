// Students tab, for teacher and admin accounts only. View only: nobody can trade for a student here.
// A teacher sees the students at their own school. The admin sees every school.
// The database decides what each account may see (supabase/teachers.sql), so hiding this tab is not the lock.
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
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),2600);}
const errText=e=>String(e&&e.message||e||"Something went wrong. Try again.");
if(!$("#staff")||!$("#trade"))return;

const DID={buy:"Bought",sell:"Sold",short:"Shorted",cover:"Bought back"};
const SIDE={buy:"Buy",sell:"Sell",short:"Short",cover:"Buy to cover"};
const KIND={limit:"Limit",stop:"Stop",stop_limit:"Stop-limit",trailing_stop:"Trailing stop"};
const STAT={open:"Waiting",filled:"Went through",canceled:"Canceled",failed:"Didn't go through"};

let ST=null,loaded=false,people=[],schools=[];
function start(d){if(ST)return;ST=d;
  const admin=d.role==="admin";
  // Teachers (club sponsors) have no separate Students tab: their Paper Trading tab becomes the Class Portfolio,
  // with their students below it.
  if(!admin){const t=$("#trade");for(const id of ["#pt-loading","#pt-join","#pt-game"])$(id).style.display="none";
    t.querySelector(".sechead h2").textContent="Class Trading";
    t.querySelector(".sechead .sub").textContent="You're the club sponsor, so you buy and sell for your school's Class Portfolio here. Below that is what your students are buying in Paper Trading (view only).";
    t.append($("#st-loading"),$("#st-body"));}
  if(admin)$("#st-sub").textContent=admin?"Admin view: every school's Class Portfolio and students. Only your account can see all schools. Students' game accounts are view only.":"Buy and sell for your school's Class Portfolio, and see what your students are buying in Paper Trading (view only). Only teachers can see this tab.";
  const home=admin?"#staff":"#trade";if($(home)&&!$(home).hidden)load();}
document.addEventListener("wvfc:staff",e=>start(e.detail));
if(window.WVFC_STAFF)start(window.WVFC_STAFF);
document.addEventListener("wvfc:tab",e=>{if(ST&&!loaded&&e.detail===(ST.role==="admin"?"staff":"trade"))load();});

async function load(){
  loaded=true;if(ST.role==="admin")loadAdmin();$("#st-loading").hidden=false;$("#st-loading").textContent="Loading students…";
  const{data,error}=await ST.db.rpc("staff_students");
  if(error){loaded=false;$("#st-loading").textContent=/staff_students|schema cache/i.test(error.message||"")?"This page isn't set up yet. Run supabase/teachers.sql in Supabase first.":errText(error);return;}
  people=data||[];
  $("#st-loading").hidden=true;$("#st-body").hidden=false;
  if(ST.role==="admin"){
    const seen=new Map();for(const p of people)if(p.school_id&&!seen.has(p.school_id))seen.set(p.school_id,p.school);
    try{const r=await fetch("data/schools.json",{cache:"no-cache"});for(const s of (await r.json()).schools||[])seen.set(s.id,s.name);}catch(e){}
    schools=[...seen].map(([id,name])=>({id,name}));
    const sel=$("#st-school");sel.hidden=false;
    sel.replaceChildren(el("option",{value:"all",text:"All schools"}),...schools.map(s=>el("option",{value:s.id,text:s.name})));
    sel.value=schools.some(s=>s.id===ST.school)?ST.school:"all";
  }
  render();
}
const students=()=>people.filter(p=>p.role!=="teacher"&&p.role!=="admin");
function shown(){
  const school=ST.role==="admin"?$("#st-school").value:"all",q=$("#st-find").value.trim().toLowerCase();
  return students().filter(p=>(school==="all"||p.school_id===school)&&(!q||(p.name||"").toLowerCase().includes(q)||(p.email||"").toLowerCase().includes(q)));
}
function render(){renderClass();renderTiles();renderList();renderTeachers();}
function renderTiles(){
  const list=shown(),play=list.filter(p=>p.joined);
  const avg=play.length?play.reduce((s,p)=>s+(+p.gain_pct),0)/play.length:null;
  const tile=(label,val,note,k)=>el("div",{class:"tile"},el("div",{class:"eyebrow",text:label}),el("div",{class:"v "+(k||""),text:val}),el("div",{class:"n",text:note}));
  $("#st-tiles").replaceChildren(tile("Students",String(list.length),"With an account"),tile("Playing",String(play.length),"Joined Paper Trading"),
    tile("Trades made",String(list.reduce((s,p)=>s+(p.trades||0),0)),"By these students"),tile("Average gain",avg==null?"–":fmtPct(avg),"Of students playing",avg==null?"":cls(avg)));
}
function renderList(){
  const list=shown().sort((a,b)=>(b.joined-a.joined)||((+b.gain_pct||0)-(+a.gain_pct||0)));
  const all=ST.role==="admin"&&$("#st-school").value==="all";
  const box=$("#st-list");
  if(!list.length){box.replaceChildren(el("h3",{class:"h3",text:"Students"}),el("p",{class:"meta",text:students().length?"No students match.":"No students have made an account yet."}));return;}
  const cols=["Student"].concat(all?["School"]:[],["Account value","Gain %","Stocks","Trades","Waiting orders","Last trade"]);
  const td=(t,k)=>el("td",{class:k||"",text:t});
  box.replaceChildren(el("h3",{class:"h3",text:ST.role==="admin"?"Students":"Your students"}),el("p",{class:"meta",text:"Tap a student to see their stocks, trades and orders."}),
    el("div",{class:"tablewrap"},el("table",{class:"pos sttable"},
      el("thead",{},el("tr",{},cols.map((t,i)=>el("th",{class:i>(all?1:0)?"num":"",text:t})))),
      el("tbody",{},list.map(p=>el("tr",{},
        el("td",{},el("button",{type:"button",class:"linkbtn",text:p.name||p.email,onclick:()=>openStudent(p)}),p.name?el("small",{class:"stmail",text:p.email}):""),
        all?td(p.school||"–"):"",
        td(p.joined?fmt$(p.value):"Not playing yet","num"),td(p.joined?fmtPct(+p.gain_pct):"–","num "+(p.joined?cls(+p.gain_pct):"")),
        td(String(p.stocks),"num"),td(String(p.trades),"num"),td(String(p.open_orders),"num"),td(when(p.last_trade),"num")))))));
}

/* ---------- One student ---------- */
async function openStudent(p){
  const box=$("#st-detail");box.hidden=false;
  box.replaceChildren(el("p",{class:"meta",text:`Loading ${p.name||p.email}…`}));
  box.scrollIntoView({behavior:"smooth",block:"start"});
  const{data,error}=await ST.db.rpc("staff_student",{target:p.user_id});
  if(error){box.replaceChildren(el("p",{class:"meta",text:errText(error)}));return;}
  const pos=(data.positions||[]).map(x=>{const px=x.price!=null?+x.price:+x.cost/+x.shares,value=px*x.shares,gain=value-x.cost;return{...x,px,value,gain,gp:gain/Math.abs(x.cost)};}).sort((a,b)=>Math.abs(b.value)-Math.abs(a.value));
  const head=el("div",{class:"sechead"},el("div",{},el("h3",{class:"h3",text:p.name||p.email}),el("p",{class:"meta",text:[p.email,p.school].filter(Boolean).join(" · ")})),
    el("button",{type:"button",class:"btn small",text:"Close",onclick:()=>{box.hidden=true;}}));
  if(!p.joined){box.replaceChildren(head,el("p",{class:"meta",text:"This student hasn't joined Paper Trading yet."}));return;}
  const tile=(label,val,note,k)=>el("div",{class:"tile"},el("div",{class:"eyebrow",text:label}),el("div",{class:"v "+(k||""),text:val}),el("div",{class:"n",text:note}));
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

/* ---------- Admin: teachers ---------- */
function renderTeachers(){
  const box=$("#st-teachers");if(ST.role!=="admin"){box.hidden=true;return;}box.hidden=false;
  const list=people.filter(p=>p.role==="teacher");
  const inp=el("input",{class:"ptinp",type:"email",placeholder:"Teacher's email",["aria-label"]:"Teacher's email",required:true});
  const m=el("p",{class:"ptmsg",role:"alert"});
  const form=el("form",{class:"ptrow",onsubmit:async e=>{e.preventDefault();m.textContent="";await setRole(inp.value,"teacher",m);}},inp,el("button",{class:"btn primary",type:"submit",text:"Make a teacher"}));
  box.replaceChildren(el("h3",{class:"h3",text:"Teachers"}),
    el("p",{class:"meta",text:"A teacher first makes an account with their school's code, like a student. Then type their email here. They'll see only their own school's students."}),
    form,m,
    list.length?el("ul",{class:"ptlist"},list.map(t=>el("li",{},el("b",{text:t.email}),el("span",{class:"meta",text:t.school||""}),
      el("button",{type:"button",class:"btn small",style:"margin-left:auto",text:"Remove teacher",onclick:e=>{e.currentTarget.disabled=true;setRole(t.email,"student",m);}})))):el("p",{class:"meta",text:"No teachers yet."}));
}
async function setRole(email,role,m){
  const{data,error}=await ST.db.rpc("staff_set_role",{target_email:email,new_role:role});
  if(error){m.textContent=errText(error);$("#st-teachers").querySelectorAll("button").forEach(b=>b.disabled=false);return;}
  toast(role==="teacher"?`${email} is now a teacher at ${data}.`:`${email} is no longer a teacher.`);
  loaded=false;await load();
}

/* ---------- Class Portfolio: teachers buy and sell for their school ---------- */
// The database looks up the real price and checks the teacher's school (supabase/class-portfolio.sql).
const SECTORS=["Tech","Banks","Health","Energy","Shopping","Food & drinks","Media","Industrial","Real estate","Utilities","Materials","Other"];
let stocks=null,classBusy=false;
async function stockList(){if(!stocks){try{const r=await fetch("data/stocks.json");stocks=new Map(((await r.json()).stocks||[]).map(x=>[x[0],x]));}catch(e){stocks=new Map();}}return stocks;}
const schoolName=id=>{const s=schools.find(x=>x.id===id);return s?s.name:(people.find(p=>p.school_id===id)||{}).school||"your school";};
async function renderClass(){
  const box=$("#st-class"),app=window.WVFC_APP;if(!app||!app.picks){box.hidden=true;return;}box.hidden=false;
  const picks=app.picks(),rows=(await app.classRows()).filter(r=>r.school_id===ST.school&&r.sold_at).sort((a,b)=>b.sold_at<a.sold_at?-1:1);
  const name=schoolName(ST.school);
  const m=el("p",{class:"ptmsg",role:"alert"});
  const inp=(id,attrs)=>el("input",Object.assign({class:"ptinp",id},attrs));
  const form=el("form",{class:"stbuy",autocomplete:"off",onsubmit:e=>{e.preventDefault();buy(m);}},
    el("div",{},el("label",{class:"ptlabel",for:"cb-sym",text:"Stock ticker"}),inp("cb-sym",{maxlength:10,placeholder:"Like COST",autocapitalize:"characters",spellcheck:"false",required:true})),
    el("div",{},el("label",{class:"ptlabel",for:"cb-amt",text:"Dollars to spend"}),inp("cb-amt",{type:"number",min:1,step:"0.01",inputmode:"decimal",placeholder:"Like 1000",required:true})),
    el("div",{},el("label",{class:"ptlabel",for:"cb-sec",text:"Sector"}),el("select",{class:"ptinp",id:"cb-sec"},SECTORS.map(x=>el("option",{value:x,text:x})))),
    el("div",{},el("label",{class:"ptlabel",for:"cb-who",text:"Pitched by (optional)"}),inp("cb-who",{maxlength:60,placeholder:"Student's name"})),
    el("div",{class:"wide"},el("label",{class:"ptlabel",for:"cb-why",text:"Why we bought it (optional)"}),inp("cb-why",{maxlength:400,placeholder:"The pitch in one sentence"})),
    el("div",{class:"wide"},el("button",{class:"btn primary",type:"submit",id:"cb-go",text:"Buy for the Class Portfolio"})));
  const td=(t,k)=>el("td",{class:k||"",text:t});
  const held=picks.map(p=>({p,c:app.calc(p)}));
  box.replaceChildren(el("h3",{class:"h3",text:`${name} Class Portfolio`}),
    el("p",{class:"meta",text:(ST.role==="admin"?`You're trading for ${name}. Use the Viewing menu at the top to pick another school. `:"Only the club sponsor can buy and sell here. ")+"Trades use the real price right now, looked up by the database."}),
    form,m,
    el("h4",{class:"pth4",text:"What the class owns"}),
    picks.length?el("div",{class:"tablewrap"},el("table",{class:"pos"},
      el("thead",{},el("tr",{},["Stock","Bought","Paid per share","Money in","Worth now",""].map((t,i,a)=>el("th",{class:i&&i<a.length-1?"num":"",text:t})))),
      el("tbody",{},held.map(({p,c})=>el("tr",{},el("td",{},el("b",{class:"stsym",text:p.ticker}),el("small",{class:"stmail",text:p.name||""})),
        td(p.entryDate,"num"),td(fmt$(p.entryPrice),"num"),td(fmt$(p.invested||(p.shares||0)*p.entryPrice),"num"),td(c&&c.value!=null?fmt$(c.value):"–","num"),
        el("td",{},el("button",{type:"button",class:"btn small sell",text:"Sell",onclick:e=>sell(p,e.currentTarget,m)})))))))
      :el("p",{class:"meta",text:"The Class Portfolio is empty. Buy its first stock above."}),
    rows.length?el("h4",{class:"pth4",text:"Sold"}):"",
    rows.length?el("ul",{class:"ptlist"},rows.slice(0,20).map(r=>{const g=r.sold_price/r.entry_price-1;return el("li",{},
      el("span",{class:"pttag sell",text:"Sold"}),el("span",{text:`${r.ticker}: bought at ${fmt$(r.entry_price)}, sold at ${fmt$(r.sold_price)}`}),
      el("span",{class:cls(g),text:fmtPct(g)}),el("span",{class:"o",text:when(r.sold_at)}));})):"");
}
async function buy(m){
  if(classBusy)return;m.textContent="";
  const sym=$("#cb-sym").value.trim().toUpperCase(),amt=+$("#cb-amt").value;
  if(!sym){m.textContent="Type a ticker first, like COST.";return;}
  if(!(amt>=1)){m.textContent="Enter how many dollars to spend.";return;}
  const st=(await stockList()).get(sym);
  classBusy=true;const b=$("#cb-go");b.disabled=true;
  try{
    const{data,error}=await ST.db.rpc("class_buy",{school:ST.school,sym,dollars:amt,stock_name:st?st[1]:null,stock_symbol:st&&st[2]?`${st[2]}:${sym}`:null,
      stock_sector:$("#cb-sec").value,pitched:$("#cb-who").value,why:$("#cb-why").value});
    if(error)throw error;
    toast(`Bought ${(+data.shares).toFixed(2)} shares of ${data.ticker} at ${fmt$(data.entry_price)} for the Class Portfolio`);
    await window.WVFC_APP.refreshPicks();renderClass();
  }catch(e){m.textContent=/class_buy|schema cache/i.test(errText(e))?"Class Portfolio trading isn't set up yet. Run supabase/class-portfolio.sql in Supabase first.":errText(e);b.disabled=false;}
  finally{classBusy=false;}
}
async function sell(p,b,m){
  if(classBusy)return;m.textContent="";
  if(b.dataset.sure!=="1"){b.dataset.sure="1";b.textContent="Sure? Sell";return;}
  classBusy=true;b.disabled=true;
  try{
    const r=p.dbId?await ST.db.rpc("class_sell",{pick:p.dbId})
      :await ST.db.rpc("class_sell_file",{school:ST.school,sym:p.ticker,bought:p.entryDate,paid:p.entryPrice,amount:p.invested||null,qty:p.shares||null,stock_name:p.name||null,stock_sector:p.sector||null});
    if(r.error)throw r.error;
    toast(`Sold ${p.ticker} at ${fmt$(r.data.sold_price)}`);
    await window.WVFC_APP.refreshPicks();renderClass();
  }catch(e){m.textContent=/class_sell|schema cache/i.test(errText(e))?"Class Portfolio trading isn't set up yet. Run supabase/class-portfolio.sql in Supabase first.":errText(e);b.disabled=false;}
  finally{classBusy=false;}
}


// Buy / Sell buttons on the stock search page (paper.js) bring a teacher here with the ticker filled in.
document.addEventListener("wvfc:classtrade",e=>{const{sym,side}=e.detail||{};if(!sym||!ST)return;
  $(ST.role==="admin"?"#tab-staff":"#tab-trade").click();
  let tries=0;const go=()=>{const box=$("#st-class"),inp=$("#cb-sym");
    if(!inp){if(++tries<50)setTimeout(go,100);return;}
    if(side==="sell"){const row=[...box.querySelectorAll("tbody tr")].find(r=>(r.querySelector(".stsym")||{}).textContent===sym);
      (row||box).scrollIntoView({behavior:"smooth",block:"center"});if(row){row.classList.add("flash");setTimeout(()=>row.classList.remove("flash"),2000);}return;}
    inp.value=sym;box.scrollIntoView({behavior:"smooth",block:"start"});$("#cb-amt").focus({preventScroll:true});};
  go();});
/* ---------- Admin only: who's using the site, and is everything working (supabase/usage.sql) ---------- */
const chiDay=(d=new Date())=>d.toLocaleDateString("en-CA",{timeZone:"America/Chicago"});
const dayName=s=>{if(!s)return"never";const[y,m,d]=String(s).slice(0,10).split("-").map(Number);return new Date(y,m-1,d).toLocaleDateString("en-US",{month:"short",day:"numeric"});};
const ago=t=>{if(!t)return"never";const m=Math.round((Date.now()-new Date(t))/6e4);return m<60?m+" min ago":m<1440?Math.round(m/60)+" hr ago":(m<2880?"1 day ago":Math.round(m/1440)+" days ago");};
// The last weekday that should have a closing price by now (prices are saved about 4pm Chicago).
function lastTradingDay(){const now=new Date(),t=new Date(now.toLocaleString("en-US",{timeZone:"America/Chicago"}));
  if(t.getHours()<17)t.setDate(t.getDate()-1);while(t.getDay()===0||t.getDay()===6)t.setDate(t.getDate()-1);
  return t.getFullYear()+"-"+String(t.getMonth()+1).padStart(2,"0")+"-"+String(t.getDate()).padStart(2,"0");}
async function getJSON(u){try{const r=await fetch(u,{cache:"no-cache"});return r.ok?await r.json():null;}catch(e){return null;}}
const tick=(ok,label,note)=>el("li",{class:"hrow"},el("span",{class:"hdot "+(ok===true?"ok":ok===false?"bad":"warn"),"aria-label":ok===true?"Working":ok===false?"Needs a look":"Check"}),
  el("span",{},el("b",{text:label}),el("small",{text:note})));
async function loadAdmin(){
  $("#adm").hidden=false;
  $("#adm-usage").replaceChildren(el("h3",{class:"h3",text:"Who's using Simple Street"}),el("p",{class:"meta",text:"Loading…"}));
  $("#adm-health").replaceChildren(el("h3",{class:"h3",text:"Site health"}),el("p",{class:"meta",text:"Checking…"}));
  const[u,st,prices,news,owned]=await Promise.all([ST.db.rpc("admin_usage"),ST.db.rpc("admin_status"),getJSON("data/prices.json"),getJSON("data/news.json"),getJSON("data/owned.json")]);
  renderUsage(u);renderHealth(st,prices,news,owned);
}
function renderUsage(u){
  const box=$("#adm-usage"),head=el("h3",{class:"h3",text:"Who's using Simple Street"});
  if(u.error){box.replaceChildren(head,el("p",{class:"meta",text:/admin_usage|schema cache/i.test(u.error.message||"")?"Not turned on yet. Run supabase/usage.sql in Supabase's SQL Editor once.":errText(u.error)}));return;}
  const d=u.data||{},w=(d.weeks||[])[0]||{};
  const tile=(label,val,note)=>el("div",{class:"tile"},el("div",{class:"eyebrow",text:label}),el("div",{class:"v",text:String(val)}),el("div",{class:"n",text:note}));
  const td=(t,k)=>el("td",{class:k||"",text:String(t)});
  box.replaceChildren(head,
    el("p",{class:"meta",text:"One person with a class and a personal account counts once. Visits are counted from "+dayName(d.visits_since||chiDay())+"; trades and sign-ups go further back."}),
    el("div",{class:"tiles"},tile("People",d.people||0,"With an account"),tile("Visited",w.visitors||0,"This week"),tile("Traded",w.traders||0,"This week"),tile("New",w.new_people||0,"Joined this week")),
    el("h4",{class:"admh",text:"By school, this week"}),
    el("div",{class:"tablewrap"},el("table",{class:"pos"},el("thead",{},el("tr",{},["School","People","Playing","Visited","Traded"].map((t,i)=>el("th",{class:i?"num":"",text:t})))),
      el("tbody",{},(d.schools||[]).map(s=>el("tr",{},td(s.school),td(s.people,"num"),td(s.playing,"num"),td(s.visitors,"num"),td(s.traders,"num")))))),
    el("h4",{class:"admh",text:"Week by week"}),
    el("div",{class:"tablewrap"},el("table",{class:"pos"},el("thead",{},el("tr",{},["Week of","Visited","New","Traded","Trades"].map((t,i)=>el("th",{class:i?"num":"",text:t})))),
      el("tbody",{},(d.weeks||[]).map(r=>el("tr",{},td(dayName(r.wk)),td(r.visitors,"num"),td(r.new_people,"num"),td(r.traders,"num"),td(r.trades,"num")))))));
}
function renderHealth(st,prices,news,owned){
  const items=[],today=chiDay(),want=lastTradingDay();
  const last=prices&&prices.dates?prices.dates.at(-1):null;
  items.push(tick(last?last>=want:false,"Closing prices",last?"Newest day: "+dayName(last)+(last>=want?"":" (expected "+dayName(want)+")"):"Couldn't read data/prices.json"));
  const rec=news&&news.market&&news.market.date;
  items.push(tick(!rec?false:rec>=want?true:rec>=(last||want)?null:false,"Market recap (the Why)",rec?"Last written for "+dayName(rec)+". Runs at 5pm on weekdays.":"No recap found"));
  const briefs=news&&Array.isArray(news.briefs)?news.briefs:[];
  const checked=briefs.map(b=>b.checkedAt||b.updatedAt).filter(Boolean).sort().at(-1);
  const wd=new Date(new Date().toLocaleString("en-US",{timeZone:"America/Chicago"}));const morningDue=wd.getDay()>0&&wd.getDay()<6&&wd.getHours()>=7;
  const checkedDay=checked?chiDay(new Date(checked)):null;
  items.push(tick(!checked?false:checkedDay===today||!morningDue?true:null,"Morning news check",checked?"Last check: "+dayName(checkedDay)+". Runs at 5:38am on weekdays.":"No briefs found"));
  const old=briefs.filter(b=>b.updatedAt&&(Date.now()-new Date(b.updatedAt))>8*864e5).length;
  items.push(tick(old?null:true,"Brief freshness",briefs.length+" briefs, "+(old?old+" not rewritten in over a week (the Friday rewrite should fix these)":"all rewritten in the last week")));
  items.push(tick(owned&&owned.tickers?true:null,"Owned stocks list",owned&&owned.tickers?owned.tickers.length+(owned.tickers.length===1?" stock":" stocks")+" owned in the game, saved with the closing prices":"Not saved yet (needs owned-stocks.sql)"));
  const box=$("#adm-health"),head=el("h3",{class:"h3",text:"Site health"});
  const parts=[head,el("p",{class:"meta",text:"Green is working, yellow is worth a check, red needs fixing."}),el("h4",{class:"admh",text:"Data the robots save"}),el("ul",{class:"hlist"},items)];
  if(st.error){parts.push(el("p",{class:"meta",text:/admin_status|schema cache/i.test(st.error.message||"")?"Database checks aren't turned on yet. Run supabase/usage.sql in Supabase's SQL Editor once.":errText(st.error)}));box.replaceChildren(...parts);return;}
  const s=st.data||{};
  const marketOpen=wd.getDay()>0&&wd.getDay()<6&&(wd.getHours()*60+wd.getMinutes())>=510&&(wd.getHours()*60+wd.getMinutes())<900;
  const live=[tick(s.prices_at?(!marketOpen||(Date.now()-new Date(s.prices_at))<20*6e4):null,"Game prices",s.prices_at?"Last updated "+ago(s.prices_at)+(marketOpen?"":" (market closed)"):"No prices saved yet"),
    tick(s.daily_last?s.daily_last>=want:null,"Daily account values",s.daily_last?"Last saved for "+dayName(s.daily_last):"Not saved yet"),
    tick(s.news_at?true:null,"Headlines",s.news_at?"Last fetched "+ago(s.news_at):"None fetched yet")];
  const jobs=(s.jobs||[]).map(j=>tick(!j.active?false:j.last_status==="failed"?false:j.last_status?true:null,"Timer: "+j.name,(j.active?"On":"Off")+" · last run "+ago(j.last_run)+(j.last_status?" · "+(j.last_status==="succeeded"?"worked":j.last_status):"")));
  const files=(s.files||[]).map(f=>tick(f.on,f.file,f.on?"Run":"Not run yet: paste it into Supabase's SQL Editor and press Run"));
  parts.push(el("h4",{class:"admh",text:"Inside the database"}),el("ul",{class:"hlist"},live,jobs),
    el("h4",{class:"admh",text:"Setup files"}),el("ul",{class:"hlist cols"},files));
  box.replaceChildren(...parts);
}
$("#st-school").addEventListener("change",()=>{$("#st-detail").hidden=true;render();});
$("#st-find").addEventListener("input",()=>{renderTiles();renderList();});
})();
