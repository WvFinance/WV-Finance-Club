// Member accounts: log in and a watchlist saved to the account. My Portfolio shows the trading game stocks (paper.js).
// Logins and data live in Supabase. Each table's row rules only let a member read and change their own rows.
(function(){
"use strict";
const CFG=window.WVFC_CONFIG||{};
const $=s=>document.querySelector(s);
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove("show"),2400);}
const root=document.documentElement;
const msg=$("#gate-msg");

if(!window.supabase||!CFG.supabaseUrl||!CFG.supabaseKey){root.classList.remove("unlocked");msg.textContent="Logins aren't set up yet.";return;}
const db=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey);
// An invite link (?invite=code) is kept until the visitor logs in or signs up, then makes them friends.
try{const inv=new URLSearchParams(location.search).get("invite");
  if(inv&&/^[a-z0-9]{4,16}$/i.test(inv)){localStorage.setItem("ss.invite",inv.toLowerCase());history.replaceState(null,"",location.pathname+location.hash);}}catch(e){}
const pendingInvite=()=>{try{return localStorage.getItem("ss.invite");}catch(e){return null;}};
let user=null;

/* ---------- Log in and create account ---------- */
// Steps: "login", "choose" (Join a class or Just me), then "class" or "me" (the sign-up form).
let mode="login",kind="class";
const card=$("#gate-form");
function setMode(m){mode=m;const login=m==="login",choose=m==="choose",signup=m==="class"||m==="me";
  $("#g-choose").hidden=!choose;$("#g-fields").hidden=choose;card.classList.toggle("wide",choose);
  $("#g-back").hidden=!signup;
  const tag=$("#g-tag");tag.hidden=!signup;tag.textContent=m==="class"?"Join a class":"Just me";tag.classList.toggle("g",m==="class");
  $("#auth-title").textContent=login?"Log in":m==="class"?"Join your class":"Start investing on your own";
  $("#auth-go").textContent=login?"Log in":"Create account";
  $("#l-club").hidden=m!=="class";$("#g-found").hidden=true;$("#l-name").hidden=!signup;
  $("#l-email").textContent=m==="class"?"School email":"Email";
  $("#auth-email").placeholder=m==="class"?"you@school.org":"you@email.com";
  $("#auth-pass").setAttribute("autocomplete",login?"current-password":"new-password");
  $("#auth-pass").placeholder=login?"Your password":"At least 8 characters";
  const hint=$("#g-hint");hint.hidden=!signup;hint.textContent=m==="class"?"Don't have a code? Ask your teacher or club leader.":"Joining a class later? You can add a class code anytime from your Home page.";
  $("#auth-q").textContent=login?"New here?":"Already have an account?";
  $("#auth-switch").textContent=login?"Create an account":"Log in";
  msg.textContent="";
  if(m==="class")$("#auth-club").focus();else if(m==="me")$("#auth-name").focus();}
$("#auth-switch").addEventListener("click",()=>setMode(mode==="login"?"choose":"login"));
$("#g-back").addEventListener("click",()=>setMode("choose"));
document.querySelectorAll(".gchoice").forEach(b=>b.addEventListener("click",()=>{kind=b.dataset.kind;
  document.querySelectorAll(".gchoice").forEach(x=>x.setAttribute("aria-checked",String(x===b)));}));
document.querySelectorAll(".gchoice").forEach(b=>b.addEventListener("dblclick",()=>setMode(kind)));
$("#g-continue").addEventListener("click",()=>setMode(kind));
const AUTH_ERR=[[/invalid login credentials/i,"That email and password don't match. Try again."],[/already registered|already been registered/i,"That email already has an account. Log in instead."],
  [/email not confirmed/i,"Confirm your email first. Check your inbox for the link."],[/password should be|weak password/i,"Pick a longer password, at least 8 characters."],
  [/rate limit|too many/i,"Too many tries. Wait a minute and try again."],[/club password|school code|class code/,"That's not a class code. Ask your teacher or club leader for it."],[/database error saving new user/i,"That class code or email wasn't accepted. Check both and try again."],[/fetch|network/i,"Couldn't reach the login server. Check your internet and try again."]];
// New class accounts need their school's code (like wvhs01). This first look only gives a clear message;
// the real check happens inside the database (supabase/district.sql and supabase/individual.sql).
async function checkSchool(code,email){
  if(!code)throw new Error("class code");
  const{data,error}=await db.rpc("school_for_code",{c:code});
  if(error)throw error;
  const s=data&&data[0];if(!s)throw new Error("class code");
  const dom=String(s.email_domain||"").replace(/^@/,"").toLowerCase();
  if(email&&dom&&!email.toLowerCase().endsWith("@"+dom))throw new Error(`Use your ${s.name} school email (it ends in @${dom}).`);
  return s;
}
// Shows which club a code belongs to while it's typed.
let codeT=null;
$("#auth-club").addEventListener("input",()=>{clearTimeout(codeT);const f=$("#g-found"),code=$("#auth-club").value.trim().toLowerCase();
  if(code.length<4){f.hidden=true;return;}
  codeT=setTimeout(async()=>{try{const s=await checkSchool(code,"");f.textContent="✓ "+s.name;f.className="gfound";}catch(e){f.textContent="That's not a class code yet. Check it with your teacher.";f.className="gfound bad";}f.hidden=false;},350);});
const authErr=e=>{const m=String(e&&e.message||e);const hit=AUTH_ERR.find(([r])=>r.test(m));return hit?hit[1]:m;};
card.addEventListener("submit",async e=>{e.preventDefault();
  if(mode==="choose")return setMode(kind);
  const email=$("#auth-email").value.trim(),password=$("#auth-pass").value,name=$("#auth-name").value.trim(),go=$("#auth-go");
  msg.textContent="";
  const need=!email||!/^\S+@\S+\.\S+$/.test(email)?"Type your email.":password.length<8?(mode==="login"?"Type your password.":"Pick a password with at least 8 characters."):
    mode!=="login"&&!name?"Type your name.":mode==="class"&&!$("#auth-club").value.trim()?"Type your class code.":"";
  if(need){msg.textContent=need;return;}
  go.disabled=true;
  try{
    let r;
    if(mode==="login")r=await db.auth.signInWithPassword({email,password});
    else if(mode==="class"){const code=$("#auth-club").value.trim().toLowerCase();await checkSchool(code,email);
      // The database checks the class code again when the account is made, so this check can't be skipped.
      r=await db.auth.signUp({email,password,options:{data:{school_code:code,name}}});}
    else r=await db.auth.signUp({email,password,options:{data:{account:"individual",name}}});
    if(r.error){if(mode==="me"&&/class code|school code|database error/i.test(r.error.message||""))throw new Error("Just me accounts aren't turned on yet. Try again soon, or join with a class code.");throw r.error;}
    if(!r.data.session){setMode("login");msg.textContent="Account made. Check your email for the confirm link, then log in.";return;}
    try{localStorage.removeItem("wvfc.theme");}catch(e){}
    // Reload so the charts draw at full size.
    location.reload();
  }catch(err){msg.textContent=authErr(err);card.classList.remove("shake");void card.offsetWidth;card.classList.add("shake");}
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
  if(!session){root.classList.remove("unlocked");
    if(pendingInvite()){kind="me";document.querySelectorAll(".gchoice").forEach(x=>x.setAttribute("aria-checked",String(x.dataset.kind==="me")));setMode("choose");
      $("#g-choose .gsub").textContent="A friend invited you! How do you want to use Simple Street?";}
    else{setMode("login");$("#auth-email").focus();}return;}
  user=session.user;root.classList.add("unlocked");
  acceptInvite();
  window.WVFC_ROLE_READY=loadSchool();loadWatch();
  // The trading game (paper.js) may load after this runs, so it can also read WVFC_SESSION.
  window.WVFC_SESSION={db,user};
  document.dispatchEvent(new CustomEvent("wvfc:login",{detail:{db,user}}));
}

async function acceptInvite(){
  const c=pendingInvite();if(!c)return;
  const{data,error}=await db.rpc("accept_invite",{c});
  // If the friends feature isn't set up yet, keep the invite and try again next time.
  if(error&&/function|schema cache|does not exist/i.test(error.message||""))return;
  try{localStorage.removeItem("ss.invite");}catch(e){}
  if(error){toast(error.message);return;}
  if(data)toast(`You and ${data} are now friends on Simple Street!`);
}

/* ---------- Which school the member belongs to ---------- */
// Accounts made before schools existed have no profile row; they're Waubonsie.
// Teachers and the admin also get the Students tab (staff.js). The admin can switch to view any school.
async function loadSchool(){
  let school="wvhs",role="student";
  // A profile with no school is a "Just me" account (supabase/individual.sql).
  try{const{data,error}=await db.from("profiles").select("school_id,role").maybeSingle();if(!error&&data){school=data.school_id||"me";if(data.role)role=data.role;}}catch(e){}
  window.WVFC_ROLE=role;window.WVFC_INDIVIDUAL=school==="me"&&role!=="admin";
  window.WVFC_NAME=String(user.user_metadata&&user.user_metadata.name||"").trim();
  if(school==="me"&&role==="admin")school="wvhs";
  if(role==="admin")school=await adminSchoolPick(school);
  if(role==="teacher"){$("#tab-mine").hidden=true;$("#tab-trade").textContent="Class Trading";}
  if(role==="teacher"||role==="admin"){$("#tab-staff").hidden=role!=="admin";
    window.WVFC_STAFF={db,role,school};document.dispatchEvent(new CustomEvent("wvfc:staff",{detail:window.WVFC_STAFF}));}
  window.WVFC_APP&&window.WVFC_APP.setSchool(school);
  return role;
}
// Admin only: a "Viewing" menu at the top to look at any school as if logged in there.
async function adminSchoolPick(own){
  let schools=[];try{const r=await fetch("data/schools.json",{cache:"no-cache"});schools=(await r.json()).schools||[];}catch(e){}
  if(!schools.length)return own;
  let pick=own;try{const v=localStorage.getItem("wvfc.viewSchool");if(schools.some(s=>s.id===v))pick=v;}catch(e){}
  const sel=$("#school-pick");
  sel.replaceChildren(...schools.map(s=>{const o=document.createElement("option");o.value=s.id;o.textContent=s.name;o.selected=s.id===pick;return o;}));
  sel.addEventListener("change",()=>{try{localStorage.setItem("wvfc.viewSchool",sel.value);}catch(e){}location.reload();});
  $("#school-pick-wrap").hidden=false;
  return pick;
}

/* ---------- Join a class later (Home page of a Just me account) ---------- */
$("#join-class").addEventListener("submit",async e=>{e.preventDefault();
  const code=$("#join-code").value.trim(),jm=$("#join-msg"),b=$("#join-go");jm.textContent="";
  if(!code){jm.textContent="Type your class code.";return;}
  b.disabled=true;
  try{const{data,error}=await db.rpc("join_class",{c:code});if(error)throw error;
    toast(`You joined ${data}!`);try{localStorage.removeItem("wvfc.theme");}catch(e){}setTimeout(()=>location.reload(),900);}
  catch(err){jm.textContent=String(err&&err.message||err);b.disabled=false;}
});

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

start();
})();
