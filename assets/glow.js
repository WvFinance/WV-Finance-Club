// Midnight Glow extras for "Just me" accounts (styles in glow.css):
//  * friend bubbles at the top of Home, made from the Friends leaderboard
//  * a bottom tab bar on phones that works the same as the tabs at the top
(function(){
"use strict";
const P={home:"M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",trade:"M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4",
  news:"M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5",feed:"M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
  top3:"M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 6h3v2a3 3 0 0 1-3 3M7 6H4v2a3 3 0 0 0 3 3",board:"M4 20V10M10 20V4M16 20v-7M22 20H2"};
const ICON={portfolio:"home",mine:"home",trade:"trade",news:"news",feed:"feed",top3:"top3",district:"board"};
const SHORT={portfolio:"Class",trade:"Trade",top3:"Top 3"};
const svg=d=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

/* Bottom tab bar */
const bar=document.createElement("nav");bar.className="ssbbar";bar.setAttribute("aria-label","Sections");document.body.appendChild(bar);
const shown=t=>!t.hidden&&getComputedStyle(t).display!=="none";
function buildBar(){
  const tabs=[...document.querySelectorAll(".tabs .tab")].filter(t=>!t.hidden&&ICON[t.dataset.tab]).slice(0,5);
  bar.replaceChildren(...tabs.map(t=>{const b=document.createElement("button");b.type="button";b.dataset.tab=t.dataset.tab;
    const c=t.cloneNode(true);c.querySelectorAll(".count,.caret,.fddot").forEach(x=>x.remove());
    const label=SHORT[t.dataset.tab]||c.textContent.trim().replace(/^My Portfolio$/,"Mine");
    b.innerHTML=svg(P[ICON[t.dataset.tab]])+`<span></span>`+(t.querySelector(".fddot")?'<i class="dot"></i>':"");b.querySelector("span").textContent=label;
    b.addEventListener("click",()=>{t.click();scrollTo(0,0);});return b;}));
  syncBar();}
function syncBar(){bar.querySelectorAll("button").forEach(b=>{const t=document.querySelector(`.tabs .tab[data-tab="${b.dataset.tab}"]`);
  if(t&&t.getAttribute("aria-selected")==="true")b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");});}
const tabsEl=document.querySelector(".tabs");
if(tabsEl)new MutationObserver(()=>{clearTimeout(buildBar.t);buildBar.t=setTimeout(buildBar,50);}).observe(tabsEl,{subtree:true,childList:true,attributes:true,attributeFilter:["aria-selected","hidden"]});
buildBar();

/* Friend bubbles on Home */
const COLORS=["#7fb0ff","#5ee0a0","#ffb86b","#ff7a9a","#b69bff","#5fd4e6"];
const initials=n=>n.replace(/\(you\)/,"").trim().split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase();
function buildBubbles(){
  const fr=document.getElementById("mine-friends"),home=document.getElementById("mv-mine");if(!fr||!home)return;
  let row=document.getElementById("ssbub");
  const rows=[...fr.querySelectorAll(".ptboard li")].filter(li=>!li.classList.contains("me"));
  const invite=fr.querySelector(".invitebtn");
  if(!rows.length&&!invite){if(row)row.remove();return;}
  if(!row){row=document.createElement("div");row.id="ssbub";row.className="ssbub";row.setAttribute("aria-label","Your friends");
    const head=home.querySelector(".sechead");(head||home.firstChild).after(row);}
  const add=document.createElement("button");add.type="button";add.className="add";add.innerHTML='<span class="av">+</span><span class="nm">Invite</span>';
  add.addEventListener("click",()=>invite&&invite.click());
  row.replaceChildren(...(invite?[add]:[]),...rows.map((li,i)=>{const name=li.querySelector(".n").textContent,g=li.querySelector(".g");
    const b=document.createElement("button");b.type="button";const up=!g||!g.classList.contains("down");
    b.style.setProperty("--c",COLORS[i%COLORS.length]);b.style.setProperty("--ring",up?"#33d391":"#ff6b7a");
    b.innerHTML=`<span class="av"></span><span class="nm"></span><span class="pc ${up?"up":"down"}"></span>`;
    b.querySelector(".av").textContent=initials(name);b.querySelector(".nm").textContent=name.split(" ")[0];b.querySelector(".pc").textContent=g?g.textContent:"";
    b.addEventListener("click",()=>fr.scrollIntoView({behavior:"smooth",block:"center"}));return b;}));
}
const fr=document.getElementById("mine-friends");
if(fr)new MutationObserver(buildBubbles).observe(fr,{childList:true,subtree:true});
})();
