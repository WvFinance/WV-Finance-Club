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
if(!$("#staff"))return;

const DID={buy:"Bought",sell:"Sold",short:"Shorted",cover:"Bought back"};
const SIDE={buy:"Buy",sell:"Sell",short:"Short",cover:"Buy to cover"};
const KIND={limit:"Limit",stop:"Stop",stop_limit:"Stop-limit",trailing_stop:"Trailing stop"};
const STAT={open:"Waiting",filled:"Went through",canceled:"Canceled",failed:"Didn't go through"};

let ST=null,loaded=false,people=[],schools=[];
function start(d){if(ST)return;ST=d;
  const admin=d.role==="admin";
  $("#st-sub").textContent=admin?"Admin view: every student at every school. Only your account can see all schools. View only.":"What the students at your school are buying in Paper Trading. Only teachers can see this. View only.";
  if(!$("#staff").hidden)load();}
document.addEventListener("wvfc:staff",e=>start(e.detail));
if(window.WVFC_STAFF)start(window.WVFC_STAFF);
document.addEventListener("wvfc:tab",e=>{if(e.detail==="staff"&&ST&&!loaded)load();});

async function load(){
  loaded=true;$("#st-loading").hidden=false;$("#st-loading").textContent="Loading students…";
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
function render(){renderTiles();renderList();renderTeachers();}
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
  box.replaceChildren(el("h3",{class:"h3",text:"Students"}),el("p",{class:"meta",text:"Tap a student to see their stocks, trades and orders."}),
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

$("#st-school").addEventListener("change",()=>{$("#st-detail").hidden=true;render();});
$("#st-find").addEventListener("input",()=>{renderTiles();renderList();});
})();
