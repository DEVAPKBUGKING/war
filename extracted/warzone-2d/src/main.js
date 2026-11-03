import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, MAX_PLAYERS } from "./config.js";

const $ = (id) => document.getElementById(id);
const lobby = $("lobby"), game = $("game"), canvas = $("arena"), ctx = canvas.getContext("2d");
const mini = $("minimap"), mctx = mini.getContext("2d");
const W = canvas.width, H = canvas.height;
const TILE = 40, COLS = W / TILE, ROWS = H / TILE;
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let selectedClass = "assault", mode = "tdm", roomCode = "", channel = null, isOnline = false;
let players = new Map(), bullets = [], grenades = [], pickups = [], obstacles = [], keys = {};
let localId = crypto.randomUUID(), me = null, running = false, last = 0, elapsed = 0, matchLength = 300;
let fireHeld = false, pointer = {x: W/2, y:H/2}, lastShot = 0, grenadeReady = 0, reloadAt = 0;
let joystick = {x:0,y:0}, touchFire = false, feed = [];

const CLASS = {
  assault: {hp:100, speed:190, damage:22, rate:170, color:"#f4bd54"},
  scout: {hp:80, speed:245, damage:17, rate:125, color:"#5ed6c4"},
  heavy: {hp:145, speed:150, damage:29, rate:260, color:"#b59cff"}
};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rand=(a,b)=>a+Math.random()*(b-a);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const teamColor=t=>t==="red"?"#ff626b":"#55a9ff";

function buildMap(){
  obstacles=[];
  const blocks=[[4,3,3,2],[12,3,3,2],[7,7,2,3],[15,8,3,2],[3,11,3,2],[11,12,3,2],[19,3,2,3],[20,12,2,2]];
  for(const [x,y,w,h] of blocks) obstacles.push({x:x*TILE,y:y*TILE,w:w*TILE,h:h*TILE});
  pickups=[];
  for(let i=0;i<8;i++) pickups.push({x:rand(70,W-70),y:rand(70,H-70),type:i%2?"speed":"med",active:true,respawn:0});
}
function spawnPlayer(id,name,team,cls,bot=false){
  const c=CLASS[cls]||CLASS.assault;
  const x=team==="red"?rand(65,180):rand(W-180,W-65);
  const p={id,name,team,cls,x,y:rand(70,H-70),angle:team==="red"?0:Math.PI,hp:c.hp,maxHp:c.hp,speed:c.speed,kills:0,deaths:0,ammo:30,bot,alive:true,respawn:0,score:0,lastNet:0};
  p.x=x;
  return p;
}
function collides(x,y,r=13){
  if(x<r||y<r||x>W-r||y>H-r)return true;
  return obstacles.some(o=>x+r>o.x&&x-r<o.x+o.w&&y+r>o.y&&y-r<o.y+o.h);
}
function move(p,dx,dy){
  const nx=p.x+dx,ny=p.y+dy;
  if(!collides(nx,p.y))p.x=nx;
  if(!collides(p.x,ny))p.y=ny;
}
function addFeed(text){
  feed.unshift({text,time:Date.now()});feed=feed.slice(0,6);
  $("killFeed").innerHTML=feed.map(f=>`<div>${escapeHtml(f.text)}</div>`).join("");
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function startGame({online=false,code=""}={}){
  isOnline=online;roomCode=code;mode=$("mode").value;
  const name=$("playerName").value.trim().slice(0,16)||"Soldier";
  me=spawnPlayer(localId,name,Math.random()<.5?"red":"blue",selectedClass);
  players=new Map([[localId,me]]);bullets=[];grenades=[];feed=[];elapsed=0;buildMap();
  if(!online){
    const count=mode==="survival"?7:9;
    for(let i=0;i<count;i++){
      const team=mode==="survival"?"red":(i%2?"red":"blue");
      const cls=["assault","scout","heavy"][i%3];
      const bot=spawnPlayer("bot-"+i,["Rook","Viper","Mako","Ghost","Nova","Brick","Echo","Raven","Bolt"][i],team,cls,true);
      players.set(bot.id,bot);
    }
  }
  $("matchMode").textContent=mode==="tdm"?"TEAM DEATHMATCH":mode==="control"?"ZONE CONTROL":"SURVIVAL";
  $("roomLabel").textContent=online?`ROOM ${code}`:"PRACTICE MATCH";
  $("gameMessage").style.display="none";
  lobby.classList.add("hidden");game.classList.remove("hidden");running=true;last=performance.now();
  if(online) connectRoom(code);
  requestAnimationFrame(loop);
}
function endGame(){running=false;if(channel){supabase.removeChannel(channel);channel=null;}game.classList.add("hidden");lobby.classList.remove("hidden");$("connection").textContent="● OFFLINE";$("connection").className="pill offline";}
async function connectRoom(code){
  if(!supabase){addFeed("Supabase belum dikonfigurasi.");return;}
  $("connection").textContent="● CONNECTING";$("connection").className="pill";
  channel=supabase.channel("warzone-"+code,{config:{presence:{key:localId},broadcast:{self:false}}});
  channel.on("presence",{event:"sync"},()=>syncPresence());
  channel.on("broadcast",{event:"state"},({payload})=>{if(payload.id!==localId)updateRemote(payload);});
  channel.on("broadcast",{event:"shot"},({payload})=>{if(payload.id!==localId)bullets.push({...payload,remote:true});});
  channel.on("broadcast",{event:"kill"},({payload})=>{addFeed(payload.text);});
  channel.on("broadcast",{event:"damage"},({payload})=>{
    const target=players.get(payload.targetId);
    if(target){target.hp=payload.hp;target.alive=payload.alive;target.kills=payload.kills??target.kills;target.deaths=payload.deaths??target.deaths;target.respawn=payload.respawn??target.respawn;}
  });
  const status=await channel.subscribe(async s=>{
    if(s==="SUBSCRIBED"){
      $("connection").textContent="● ONLINE";$("connection").className="pill online";
      await channel.track({id:localId,name:me.name,team:me.team,cls:me.cls,x:me.x,y:me.y,hp:me.hp,kills:0,deaths:0});
      addFeed("Terhubung ke room "+code);
    }else if(s==="CHANNEL_ERROR"||s==="TIMED_OUT"){addFeed("Koneksi room terputus.");}
  });
}
function syncPresence(){
  if(!channel)return;
  const state=channel.presenceState(), seen=new Set([localId]);
  for(const list of Object.values(state))for(const item of list){
    if(!item.id||item.id===localId)continue;seen.add(item.id);
    if(!players.has(item.id))players.set(item.id,spawnPlayer(item.id,item.name||"Player",item.team||"blue",item.cls||"assault"));
    const p=players.get(item.id);Object.assign(p,{name:item.name||p.name,team:item.team||p.team,cls:item.cls||p.cls,x:item.x??p.x,y:item.y??p.y,hp:item.hp??p.hp,kills:item.kills??p.kills,deaths:item.deaths??p.deaths,bot:false});
  }
  for(const [id,p] of players)if(!p.bot&&id!==localId&&!seen.has(id))players.delete(id);
  if(players.size>MAX_PLAYERS)addFeed("Room mencapai batas pemain.");
}
function updateRemote(d){
  let p=players.get(d.id);if(!p){p=spawnPlayer(d.id,d.name||"Player",d.team||"blue",d.cls||"assault");players.set(d.id,p);}
  Object.assign(p,{name:d.name||p.name,x:d.x,y:d.y,angle:d.angle,hp:d.hp,alive:d.alive,kills:d.kills,deaths:d.deaths,team:d.team,cls:d.cls});
}
function broadcast(event,payload){if(channel&&isOnline)channel.send({type:"broadcast",event,payload});}
function shoot(p,angle){
  if(!p.alive||p.ammo<=0||Date.now()-p.lastShot<(CLASS[p.cls]||CLASS.assault).rate)return;
  p.lastShot=Date.now();p.ammo--;
  const d={id:crypto.randomUUID(),owner:p.id,team:p.team,x:p.x+Math.cos(angle)*20,y:p.y+Math.sin(angle)*20,vx:Math.cos(angle)*520,vy:Math.sin(angle)*520,damage:CLASS[p.cls].damage,life:1.15};
  bullets.push(d);if(p.id===localId)broadcast("shot",d);
}
function throwGrenade(p){
  if(!p.alive||Date.now()<grenadeReady)return;grenadeReady=Date.now()+5000;
  const a=p.angle;grenades.push({x:p.x,y:p.y,vx:Math.cos(a)*250,vy:Math.sin(a)*250,life:1.1,team:p.team,owner:p.id});
}
function damage(target,amount,owner){
  if(!target.alive||target.id===owner)return;
  target.hp-=amount;
  if(target.hp<=0){
    target.hp=0;target.alive=false;target.deaths++;target.respawn=Date.now()+2200;
    const killer=players.get(owner);if(killer){killer.kills++;killer.score+=100;}
    const msg=`${killer?.name||"Unknown"} ➜ ${target.name}`;
    addFeed(msg);broadcast("kill",{text:msg});
  }
  if(isOnline&&owner===localId)broadcast("damage",{targetId:target.id,hp:target.hp,alive:target.alive,kills:target.kills,deaths:target.deaths,respawn:target.respawn});
}
function botThink(p,dt){
  if(!p.alive)return;
  const enemies=[...players.values()].filter(q=>q.alive&&q.team!==p.team);
  if(!enemies.length)return;
  enemies.sort((a,b)=>distance(p,a)-distance(p,b));const target=enemies[0];
  const d=distance(p,target);p.angle=Math.atan2(target.y-p.y,target.x-p.x);
  if(d>190)move(p,Math.cos(p.angle)*p.speed*dt,Math.sin(p.angle)*p.speed*dt);
  else if(d<115)move(p,-Math.cos(p.angle)*p.speed*.55*dt,-Math.sin(p.angle)*p.speed*.55*dt);
  if(d<520&&Math.random()<dt*2.2)shoot(p,p.angle+rand(-.13,.13));
}
function update(dt){
  elapsed+=dt;
  if(!me.alive&&Date.now()>me.respawn){
    const fresh=spawnPlayer(me.id,me.name,me.team,me.cls);Object.assign(me,{x:fresh.x,y:fresh.y,hp:me.maxHp,ammo:30,alive:true});
    $("gameMessage").style.display="none";
  }
  if(me.alive){
    let dx=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0)+joystick.x;
    let dy=(keys.s||keys.arrowdown?1:0)-(keys.w||keys.arrowup?1:0)+joystick.y;
    const len=Math.hypot(dx,dy)||1;const sprint=keys.shift?1.35:1;
    move(me,dx/len*me.speed*sprint*dt,dy/len*me.speed*sprint*dt);
    me.angle=Math.atan2(pointer.y-me.y,pointer.x-me.x);
    if(fireHeld||touchFire)shoot(me,me.angle);
    if(isOnline&&channel&&Date.now()-me.lastNet>100){
      me.lastNet=Date.now();channel.track({id:localId,name:me.name,team:me.team,cls:me.cls,x:me.x,y:me.y,angle:me.angle,hp:me.hp,alive:me.alive,kills:me.kills,deaths:me.deaths});
    }
  }else{$("gameMessage").style.display="block";}
  for(const p of players.values())if(p.bot)botThink(p,dt);
  for(const b of bullets){
    b.x+=b.vx*dt;b.y+=b.vy*dt;b.life-=dt;
    if(collides(b.x,b.y,3))b.life=0;
    if(b.owner===localId||(!isOnline&&b.owner.startsWith("bot-"))){
      for(const p of players.values())if(p.id!==b.owner&&p.team!==b.team&&p.alive&&distance(b,p)<17){damage(p,b.damage,b.owner);b.life=0;break;}
    }else if(isOnline&&b.owner!==localId&&b.team!==me.team&&distance(b,me)<17){damage(me,b.damage,b.owner);b.life=0;}
  }
  bullets=bullets.filter(b=>b.life>0&&b.x>0&&b.y>0&&b.x<W&&b.y<H);
  for(const g of grenades){
    g.x+=g.vx*dt;g.y+=g.vy*dt;g.vx*=.97;g.vy*=.97;g.life-=dt;
    if(g.life<=0){
      for(const p of players.values())if(p.team!==g.team&&p.alive&&distance(g,p)<105)damage(p,65*(1-distance(g,p)/140),g.owner);
      g.dead=true;
    }
  }
  grenades=grenades.filter(g=>!g.dead);
  for(const item of pickups){
    if(!item.active){if(Date.now()>item.respawn)item.active=true;continue;}
    if(me.alive&&distance(me,item)<23){if(item.type==="med")me.hp=Math.min(me.maxHp,me.hp+35);else me.speed=CLASS[me.cls].speed*1.25;item.active=false;item.respawn=Date.now()+10000;setTimeout(()=>{if(me)me.speed=CLASS[me.cls].speed;},4500);}
  }
  if(mode==="control"){
    const zone={x:W/2,y:H/2,r:75};for(const p of players.values())if(p.alive&&distance(p,zone)<zone.r){if(p.team==="red"){}}
  }
  if(elapsed>=matchLength){elapsed=0;addFeed("Waktu match selesai — ronde baru dimulai.");for(const p of players.values()){p.kills=0;p.deaths=0;p.score=0;}}
}
function draw(){
  ctx.clearRect(0,0,W,H);ctx.fillStyle="#182a2c";ctx.fillRect(0,0,W,H);
  ctx.strokeStyle="rgba(150,190,170,.09)";ctx.lineWidth=1;
  for(let x=0;x<W;x+=TILE){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=0;y<H;y+=TILE){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  // central objective
  ctx.beginPath();ctx.arc(W/2,H/2,72,0,Math.PI*2);ctx.fillStyle="rgba(246,190,82,.07)";ctx.fill();ctx.strokeStyle="rgba(246,190,82,.45)";ctx.setLineDash([7,7]);ctx.stroke();ctx.setLineDash([]);
  for(const o of obstacles){ctx.fillStyle="#34464a";ctx.fillRect(o.x,o.y,o.w,o.h);ctx.strokeStyle="#52686b";ctx.strokeRect(o.x+2,o.y+2,o.w-4,o.h-4);ctx.fillStyle="rgba(0,0,0,.15)";ctx.fillRect(o.x,o.y+o.h-6,o.w,6);}
  for(const item of pickups)if(item.active){ctx.beginPath();ctx.arc(item.x,item.y,10,0,Math.PI*2);ctx.fillStyle=item.type==="med"?"#57d69b":"#e4c35b";ctx.fill();ctx.fillStyle="#142022";ctx.font="bold 11px sans-serif";ctx.textAlign="center";ctx.fillText(item.type==="med"?"+":"»",item.x,item.y+4);}
  for(const g of grenades){ctx.beginPath();ctx.arc(g.x,g.y,7,0,Math.PI*2);ctx.fillStyle="#f0d16a";ctx.fill();}
  for(const b of bullets){ctx.beginPath();ctx.arc(b.x,b.y,3.5,0,Math.PI*2);ctx.fillStyle="#ffe6a3";ctx.fill();}
  for(const p of players.values()){
    if(!p.alive)continue;
    const color=p.id===localId?"#f4bd54":teamColor(p.team);
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.angle);
    ctx.fillStyle="rgba(0,0,0,.3)";ctx.beginPath();ctx.ellipse(1,5,15,12,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(0,0,12,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="#172126";ctx.fillRect(2,-4,20,8);ctx.fillStyle="#dce4df";ctx.fillRect(14,-2,11,4);
    ctx.restore();
    ctx.fillStyle="#dce5df";ctx.font="11px sans-serif";ctx.textAlign="center";ctx.fillText(p.name,p.x,p.y-22);
    ctx.fillStyle="#172126";ctx.fillRect(p.x-16,p.y-18,32,4);ctx.fillStyle=p.hp>40?"#65d39c":"#ff666b";ctx.fillRect(p.x-16,p.y-18,32*clamp(p.hp/p.maxHp,0,1),4);
  }
  drawMini();
  const reds=[...players.values()].filter(p=>p.team==="red").reduce((a,p)=>a+p.kills,0);
  const blues=[...players.values()].filter(p=>p.team==="blue").reduce((a,p)=>a+p.kills,0);
  $("redScore").textContent=reds;$("blueScore").textContent=blues;
  $("hp").textContent=Math.ceil(me.hp);$("ammo").textContent=`${me.ammo} / ∞`;$("kd").textContent=`${me.kills} / ${me.deaths}`;
  $("timer").textContent=new Date(Math.max(0,matchLength-elapsed)*1000).toISOString().slice(14,19);
  const sorted=[...players.values()].sort((a,b)=>b.kills-a.kills);
  $("leaderboard").innerHTML=sorted.slice(0,8).map((p,i)=>`<div class="leader-row"><span>${i+1}. ${escapeHtml(p.name)}</span><b>${p.kills}</b></div>`).join("");
}
function drawMini(){
  mctx.fillStyle="#101a20";mctx.fillRect(0,0,220,140);
  for(const o of obstacles){mctx.fillStyle="#52676a";mctx.fillRect(o.x/W*220,o.y/H*140,o.w/W*220,o.h/H*140);}
  for(const p of players.values())if(p.alive){mctx.beginPath();mctx.arc(p.x/W*220,p.y/H*140,p.id===localId?4:3,0,Math.PI*2);mctx.fillStyle=p.id===localId?"#f4bd54":teamColor(p.team);mctx.fill();}
}
function loop(now){if(!running)return;const dt=Math.min((now-last)/1000,.04);last=now;update(dt);draw();requestAnimationFrame(loop);}
function setPointer(e){
  const r=canvas.getBoundingClientRect();pointer.x=(e.clientX-r.left)*W/r.width;pointer.y=(e.clientY-r.top)*H/r.height;
}
canvas.addEventListener("pointermove",setPointer);
canvas.addEventListener("pointerdown",e=>{if(e.pointerType==="mouse"){setPointer(e);fireHeld=true;}});
window.addEventListener("pointerup",()=>fireHeld=false);
window.addEventListener("keydown",e=>{keys[e.key.toLowerCase()]=true;if(e.key.toLowerCase()==="r"&&me)me.ammo=30;if(e.key.toLowerCase()==="g"&&me)throwGrenade(me);});
window.addEventListener("keyup",e=>keys[e.key.toLowerCase()]=false);
$("mobileFire").addEventListener("touchstart",e=>{e.preventDefault();touchFire=true;},{passive:false});
$("mobileFire").addEventListener("touchend",()=>touchFire=false);
$("mobileReload").onclick=()=>{if(me)me.ammo=30;};
$("mobileGrenade").onclick=()=>{if(me)throwGrenade(me);};
const joy=$("joystick"),stick=$("stick");
function joyMove(e){const r=joy.getBoundingClientRect(),t=e.touches[0];let x=t.clientX-(r.left+r.width/2),y=t.clientY-(r.top+r.height/2);const d=Math.hypot(x,y),s=Math.min(1,42/(d||1));joystick={x:x*s/42,y:y*s/42};stick.style.transform=`translate(${joystick.x*34}px,${joystick.y*34}px)`;}
joy.addEventListener("touchstart",e=>{e.preventDefault();joyMove(e);},{passive:false});
joy.addEventListener("touchmove",e=>{e.preventDefault();joyMove(e);},{passive:false});
joy.addEventListener("touchend",()=>{joystick={x:0,y:0};stick.style.transform="translate(0,0)";});
document.querySelectorAll(".class-option").forEach(b=>b.onclick=()=>{document.querySelectorAll(".class-option").forEach(x=>x.classList.remove("selected"));b.classList.add("selected");selectedClass=b.dataset.class;});
$("quickPlay").onclick=()=>startGame();
$("createRoom").onclick=async()=>{
  if(!supabase){$("onlineHint").textContent="Isi SUPABASE_URL dan SUPABASE_ANON_KEY di src/config.js, lalu deploy ulang.";return;}
  const code=Math.random().toString(36).slice(2,7).toUpperCase();$("roomCode").value=code;startGame({online:true,code});
};
$("joinRoom").onclick=()=>{const code=$("roomCode").value.trim().toUpperCase();if(!code)return;if(!supabase){$("onlineHint").textContent="Online perlu konfigurasi Supabase di src/config.js.";return;}startGame({online:true,code});};
$("leaveGame").onclick=endGame;
if(!supabase)$("onlineHint").textContent="Latihan vs bot langsung aktif. Multiplayer online aktif setelah konfigurasi Supabase.";
