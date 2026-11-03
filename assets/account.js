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
let user=null;

/* ---------- Log in and create account ---------- */
let mode="login";
function setMode(m){mode=m;const login=m==="login";
  $("#auth-title").textContent=login?"Log in":"Create an account";
  $("#auth-go").textContent=login?"Log in":"Create account";
  $("#auth-q").textContent=login?"New here?":"Already have an account?";
  $("#auth-switch").textContent=login?"Create an account":"Log in";
  $("#auth-pass").setAttribute("autocomplete",login?"current-password":"new-password");
  $("#auth-pass").placeholder=login?"Password":"Make a password (8 or more characters)";
  $("#auth-club").hidden=login;$("#auth-club").required=!login;
  msg.textContent="";}
$("#auth-switch").addEventListener("click",()=>setMode(mode==="login"?"signup":"login"));
const AUTH_ERR=[[/invalid login credentials/i,"That email and password don't match. Try again."],[/already registered|already been registered/i,"That email already has an account. Log in instead."],
  [/email not confirmed/i,"Confirm your email first. Check your inbox for the link."],[/password should be|weak password/i,"Pick a longer password, at least 8 characters."],
  [/rate limit|too many/i,"Too many tries. Wait a minute and try again."],[/club password|school code/,"That's not a school code. Ask your club leader for it."],[/database error saving new user/i,"That school code or email wasn't accepted. Check both and try again."],[/fetch|network/i,"Couldn't reach the login server. Check your internet and try again."]];
async function sha(t){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
// New accounts need their school's code (like wvhs01). This first look only gives a clear message;
// the real check happens inside the database (supabase/district.sql).
async function checkSchool(code,email){
  if(!code)throw new Error("school code");
  const{data,error}=await db.rpc("school_for_code",{c:code});
  if(error){
    // The school list isn't set up yet (district.sql not run): use the old club password.
    if(/school_for_code|function|schema cache/i.test(error.message||"")&&!/fetch|network/i.test(error.message||"")){
      if(window.WVFC_PASS&&await sha(code)!==window.WVFC_PASS)throw new Error("school code");return;}
    throw error;}
  const s=data&&data[0];if(!s)throw new Error("school code");
  const dom=String(s.email_domain||"").replace(/^@/,"").toLowerCase();
  if(dom&&!email.toLowerCase().endsWith("@"+dom))throw new Error(`Use your ${s.name} school email (it ends in @${dom}).`);
}
const authErr=e=>{const m=String(e&&e.message||e);const hit=AUTH_ERR.find(([r])=>r.test(m));return hit?hit[1]:m;};
$("#gate-form").addEventListener("submit",async e=>{e.preventDefault();
  const email=$("#auth-email").value.trim(),password=$("#auth-pass").value,go=$("#auth-go");
  go.disabled=true;msg.textContent="";
  try{
    const code=$("#auth-club").value.trim().toLowerCase();
    if(mode==="signup")await checkSchool(code,email);
    // The database checks the school code again when the account is made, so this check can't be skipped.
    const r=mode==="login"?await db.auth.signInWithPassword({email,password}):await db.auth.signUp({email,password,options:{data:{school_code:code}}});
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
  window.WVFC_ROLE_READY=loadSchool();loadWatch();
  // The trading game (paper.js) may load after this runs, so it can also read WVFC_SESSION.
  window.WVFC_SESSION={db,user};
  document.dispatchEvent(new CustomEvent("wvfc:login",{detail:{db,user}}));
}

/* ---------- Which school the member belongs to ---------- */
// Accounts made before schools existed have no profile row; they're Waubonsie.
// Teachers and the admin also get the Students tab (staff.js). The admin can switch to view any school.
async function loadSchool(){
  let school="wvhs",role="student";
  try{const{data,error}=await db.from("profiles").select("school_id,role").maybeSingle();if(!error&&data){if(data.school_id)school=data.school_id;if(data.role)role=data.role;}}catch(e){}
  window.WVFC_ROLE=role;
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
