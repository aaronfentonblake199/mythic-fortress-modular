import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const SAVE_VERSION  = 3;
const SAVE_KEY      = "mf_idle_v8";

// 21×21 grid → heart at exact center (10,10)
const GRID_SIZE     = 21;
const HEART_COL     = 10;
const HEART_ROW     = 10;
const BASE_TICK     = 80;
const SEC_PER_TICK  = BASE_TICK / 1000;

// Difficulty scaling
const DIFF_HP_RATE  = 0.10;
const DIFF_DMG_RATE = 0.07;
const diffCurve = ms => {
  const min = ms / 60000;
  const lf  = 1 + Math.log1p(min) * 0.4;
  return { hpScale:1+min*DIFF_HP_RATE*lf, dmgScale:1+min*DIFF_DMG_RATE*lf };
};
const SPAWN_RATE_MIN   = 750;
const SPAWN_RATE_MAX   = 3200;
const SPAWN_RATE_DECAY = 9;
const PERK_INTERVAL    = 75000;

const XP_PER_SEC  = 0.8;
const XP_PER_KILL = 3;
const XP_PER_BOSS = 30;
const XP_PER_TIER = 50;
const XP_MIN_RUN  = 20;

const GOLD_START      = 130;
const GOLD_KILL_MULT  = 1.2;
const WALL_COST       = 20;
const WALL_HP_BASE    = 100;
const REPAIR_COST     = 12;

const LEVEL_TIME_THRESHOLDS = [0,30,60,90,120,150,180,225,270,330,400];
// Difficulty unlocks at level 7 of previous tier
const HARD_UNLOCK_LEVEL      = 7;
const NIGHTMARE_UNLOCK_LEVEL = 7;

// Tower upgrades
const TOWER_MAX_LEVEL     = 5;
const TOWER_UPGRADE_BASE  = { arrow:30, cannon:55, ballista:70, support:45 };
const TOWER_UPGRADE_SCALE = 1.7;
const TOWER_LVL_DMG_MULT  = 0.22;
const TOWER_LVL_SPD_MULT  = 0.10;
const TOWER_LVL_RNG_BONUS = 0.3;

// Wall regen
const WALL_REGEN_PER_LEVEL = 1.5;
const WALL_REGEN_MAX_PCT   = 0.30;

// Castle run leveling
const CASTLE_RUN_MAX_LEVEL = 5;
const CASTLE_RUN_COSTS     = [0, 80, 160, 280, 420, 600];
const CASTLE_LVL_HP_BONUS  = 60;
const CASTLE_LVL_DMG_BONUS = 0.06;
const CASTLE_LVL_GOLD_BONUS = 0.5;

// Ascension costs (gold, paid by player, after survival unlocks it)
const ASCENSION_COSTS = [0, 100, 200, 350]; // cost to ascend from tier 0→1, 1→2, 2→3

// Run investments
const RUN_UPGRADES = [
  { id:"run_dmg",    label:"Forge Boost",    icon:"⚔️", baseCost:40, costScale:1.5, desc:"+10% all tower dmg",       action:"boostDmg"    },
  { id:"run_spd",    label:"Oil Gears",       icon:"⚡", baseCost:40, costScale:1.5, desc:"+10% attack speed",         action:"boostSpd"    },
  { id:"run_gold",   label:"Tax Collector",   icon:"💰", baseCost:55, costScale:1.6, desc:"+3 gold/sec passive",       action:"goldIncome"  },
  { id:"run_range",  label:"Eagle Sight",     icon:"👁️", baseCost:50, costScale:1.5, desc:"+1 tile range all towers",  action:"boostRange"  },
  { id:"run_repair", label:"Mason Pact",      icon:"🔩", baseCost:35, costScale:1.4, desc:"Wall repair -20% cheaper",  action:"repairDisc"  },
  { id:"run_heart",  label:"Warden Rite",     icon:"❤️", baseCost:60, costScale:1.6, desc:"+25% heart atk & dmg",     action:"heartBoost"  },
  { id:"run_wall",   label:"Thick Mortar",    icon:"🧱", baseCost:45, costScale:1.5, desc:"+20% wall HP (all walls)",  action:"wallHp"      },
  { id:"repair_all", label:"Repair All",      icon:"🔧", baseCost:25, costScale:1.0, desc:"All walls restored to full",action:"repairWalls" },
];

// ═══════════════════════════════════════════════════════════════
// DIFFICULTY TIERS — level-based unlocks
// ═══════════════════════════════════════════════════════════════
const DIFFICULTY_TIERS = [
  { id:"normal",    label:"Normal",    icon:"🛡️", enemyHpMult:1.0, enemyDmgMult:1.0, goldMult:1.0,  xpMult:1.0,
    desc:"Standard. Balanced for new players.", unlockCondition:null },
  { id:"hard",      label:"Hard",      icon:"⚔️", enemyHpMult:1.5, enemyDmgMult:1.3, goldMult:1.25, xpMult:1.6,
    desc:"Tougher enemies. More rewards.", unlockCondition:{ difficulty:"normal", minLevel:HARD_UNLOCK_LEVEL } },
  { id:"nightmare", label:"Nightmare", icon:"💀", enemyHpMult:2.5, enemyDmgMult:2.0, goldMult:1.6,  xpMult:2.8,
    desc:"Extreme. Veterans only.", unlockCondition:{ difficulty:"hard", minLevel:NIGHTMARE_UNLOCK_LEVEL } },
];

// ─── ASCENSION TIERS ─── player-activated, survival unlocks option
const ASCENSION_TIERS = [
  { name:"Wooden Hold",    minSec:0,   color:"#8B5E3C", wallColor:"#C68642", bg:"#140a04", passiveBuff:0,    heartColor:"#C68642" },
  { name:"Stone Keep",     minSec:60,  color:"#7A7A8C", wallColor:"#A0A0B8", bg:"#0c0c12", passiveBuff:0.10, heartColor:"#A0A0B8" },
  { name:"Runic Citadel",  minSec:150, color:"#5A3FAA", wallColor:"#8B6FE8", bg:"#070510", passiveBuff:0.25, heartColor:"#8B6FE8" },
  { name:"Mythic Bastion", minSec:300, color:"#AA7A00", wallColor:"#FFD700", bg:"#0a0800", passiveBuff:0.45, heartColor:"#FFD700" },
];

// ─── TOWER TYPES ───
const TOWER_TYPES = {
  arrow:   { label:"Arrow",    icon:"🏹", cost:30, dmg:9,  range:7.0,  speed:11, color:"#7CFC00",
             shortDesc:"Fast, reliable — early staple",
             fullDesc:"Fires rapidly at the nearest enemy. Best general-purpose tower. Ideal vs runners and swarms." },
  cannon:  { label:"Cannon",   icon:"💣", cost:60, dmg:42, range:11.0, speed:38, splash:3.5, color:"#FF6347",
             shortDesc:"Slow, AoE — anti-swarm",
             fullDesc:"Fires an exploding shell with wide splash. Excellent chokepoint control. Upgrade for devastating AoE." },
  ballista:{ label:"Ballista", icon:"⚡", cost:80, dmg:70, range:14.0, speed:52, color:"#00BFFF",
             shortDesc:"High dmg, long range — anti-boss",
             fullDesc:"Massive single-target damage at long range. Best vs bosses and brutes." },
  support: { label:"Support",  icon:"✨", cost:50, dmg:0,  range:6.0,  speed:0,  buff:0.30, color:"#FFD700",
             shortDesc:"Buffs nearby towers",
             fullDesc:"Boosts nearby tower damage by 30%. Does not attack. Upgrade for wider aura." },
};

const HEART_TOWER = { dmg:9, range:7.0, speed:13, color:"#ff4466" };

// ─── ENEMY TYPES ───
const ENEMY_TYPES = {
  raider: { label:"Raider", icon:"⚔️", hp:65,  spd:2.5, dmg:9,  gold:6,  color:"#e74c3c",
            fullDesc:"Baseline enemy. Teaches you to build any defence." },
  runner: { label:"Runner", icon:"💨", hp:28,  spd:5.0, dmg:4,  gold:5,  color:"#e67e22",
            fullDesc:"Very fast, low HP. Close gaps and use Arrow towers." },
  brute:  { label:"Brute",  icon:"🪨", hp:240, spd:1.2, dmg:24, gold:14, color:"#8e44ad",
            fullDesc:"Slow but durable. Invest in Ballistae." },
  siege:  { label:"Siege",  icon:"🏗️", hp:160, spd:1.0, dmg:48, gold:16, color:"#c0392b",
            fullDesc:"Targets walls preferentially. Prioritise with Arrow towers.", targetWalls:true },
  swarm:  { label:"Swarm",  icon:"🐝", hp:14,  spd:3.8, dmg:3,  gold:2,  color:"#f39c12",
            fullDesc:"Trivial alone, lethal in groups. Build a Cannon before 60s." },
  boss:   { label:"BOSS",   icon:"👹", hp:950, spd:0.8, dmg:58, gold:95, color:"#ff00ff", isBoss:true,
            fullDesc:"Every 90 seconds. Massive HP and damage. Always have a Ballista ready." },
};

// ─── PERK POOL ───
const PERK_POOL = [
  { id:"atk_spd",          rarity:"common",   label:"Swift Strikes",    desc:"+25% tower attack speed", icon:"⚡", apply:s=>({...s,atkSpdMult:(s.atkSpdMult||1)*0.75}) },
  { id:"wall_hp",          rarity:"common",   label:"Reinforced Walls", desc:"+50% wall max HP, existing walls healed", icon:"🧱", apply:s=>applyWallHpBuff(s,1.5) },
  { id:"gold_gain",        rarity:"common",   label:"War Treasury",     desc:"+35% gold from kills", icon:"💰", apply:s=>({...s,goldMult:(s.goldMult||1)*1.35}) },
  { id:"range_up",         rarity:"common",   label:"Eagle Eyes",       desc:"+2 tile range all towers", icon:"👁️", apply:s=>({...s,rangeBonus:(s.rangeBonus||0)+2.0}) },
  { id:"dmg_up",           rarity:"common",   label:"Forged Steel",     desc:"+25% tower damage", icon:"⚔️", apply:s=>({...s,dmgMult:(s.dmgMult||1)*1.25}) },
  { id:"gold_now",         rarity:"common",   label:"War Chest",        desc:"+120 gold immediately", icon:"🏆", apply:s=>({...s,gold:s.gold+120}) },
  { id:"repair_all",       rarity:"common",   label:"Emergency Repairs",desc:"All walls fully restored", icon:"🔧", apply:s=>repairAllWalls(s) },
  { id:"spawn_slow",       rarity:"common",   label:"Cursed Fog",       desc:"Enemy spawns slowed 40 seconds", icon:"🌫️", apply:s=>({...s,spawnSlowTimer:(s.spawnSlowTimer||0)+40000}) },
  { id:"crit",             rarity:"uncommon", label:"Sharpened Blades", desc:"Towers gain 20% crit (2× dmg)", icon:"🗡️", apply:s=>({...s,critChance:(s.critChance||0)+0.20}) },
  { id:"splash_up",        rarity:"uncommon", label:"Blast Radius",     desc:"Cannon splash +80%", icon:"💥", apply:s=>({...s,splashMult:(s.splashMult||1)*1.8}) },
  { id:"heart_atk",        rarity:"uncommon", label:"Awakened Keep",    desc:"Heart atk speed +50%, dmg +50%", icon:"❤️", apply:s=>({...s,heartAtkMult:(s.heartAtkMult||1)*1.5}) },
  { id:"passive_gold",     rarity:"uncommon", label:"Tax Mandate",      desc:"+6 gold/sec passive", icon:"🏦", apply:s=>({...s,passiveGoldRate:s.passiveGoldRate+6}) },
  { id:"wall_spikes",      rarity:"uncommon", label:"Spiked Walls",     desc:"Enemies take 8 dmg when attacking walls", icon:"🩸", apply:s=>({...s,wallSpikes:true}) },
  { id:"chain_lightning",  rarity:"rare",     label:"Chain Lightning",  desc:"Arrow towers arc to 2 extra enemies (50% dmg)", icon:"🌩️", apply:s=>({...s,chainLightning:true}) },
  { id:"explosive_walls",  rarity:"rare",     label:"Explosive Walls",  desc:"Destroyed walls deal 50 AoE damage", icon:"🧨", apply:s=>({...s,explosiveWalls:true}) },
  { id:"double_or_nothing",rarity:"rare",     label:"Mercenary Pact",   desc:"2× kill gold, enemies 25% faster", icon:"💸", apply:s=>({...s,goldMult:(s.goldMult||1)*2,enemySpeedMult:(s.enemySpeedMult||1)*1.25}) },
  { id:"iron_skin",        rarity:"rare",     label:"Iron Fortress",    desc:"All structures triple HP now", icon:"🛡️", apply:s=>applyIronSkin(s) },
  { id:"castle_boost",     rarity:"uncommon", label:"Royal Decree",     desc:"Castle levels up for free", icon:"🏰", apply:s=>applyCastleLevelUp(s,true) },
];
const RARITY_COLOR = { common:"#aaa", uncommon:"#4ecf8a", rare:"#c380ff" };

// ═══════════════════════════════════════════════════════════════
// META PROGRESSION
// ═══════════════════════════════════════════════════════════════
const CASTLE_UPGRADES = [
  { id:"start_gold",   label:"War Chest",      icon:"💰", desc:"+40 starting gold per level",          maxLevel:5, baseCost:40,  effect:l=>({startGoldBonus:l*40}) },
  { id:"wall_hp",      label:"Thick Walls",    icon:"🧱", desc:"+15% wall max HP per level",           maxLevel:5, baseCost:50,  effect:l=>({permWallHpMult:1+l*0.15}) },
  { id:"tower_dmg",    label:"Siege Mastery",  icon:"⚔️", desc:"+8% tower damage per level",          maxLevel:5, baseCost:60,  effect:l=>({permDmgMult:1+l*0.08}) },
  { id:"atk_spd",      label:"Rapid Fire",     icon:"⚡", desc:"+8% attack speed per level",          maxLevel:5, baseCost:60,  effect:l=>({permSpdMult:Math.max(0.4,1-l*0.08)}) },
  { id:"heart_hp",     label:"Fortified Keep", icon:"❤️", desc:"+80 heart HP per level",              maxLevel:5, baseCost:70,  effect:l=>({permHeartHp:300+l*80}) },
  { id:"passive_gold", label:"Treasury",       icon:"🏦", desc:"+1 passive gold/sec per level",       maxLevel:5, baseCost:80,  effect:l=>({permPassiveGold:l}) },
  { id:"repair_eff",   label:"Mason Guild",    icon:"🔩", desc:"Wall repair -15% cost per level",     maxLevel:3, baseCost:70,  effect:l=>({permRepairDisc:l*0.15}) },
  { id:"heart_atk",    label:"Warden's Eye",   icon:"🎯", desc:"+15% heart atk damage+speed/level",   maxLevel:3, baseCost:90,  effect:l=>({permHeartAtkMult:1+l*0.15}) },
];
const RESEARCH_UPGRADES = [
  { id:"card_quality",  label:"Arcane Library",  icon:"📚", desc:"Rare perks appear more often",                   maxLevel:1, baseCost:120, effect:()=>({researchCardBonus:true}) },
  { id:"kill_gold",     label:"Bounty Board",    icon:"💀", desc:"+20% gold from kills per level",                 maxLevel:3, baseCost:100, effect:l=>({researchGoldMult:1+l*0.2}) },
  { id:"boss_gold",     label:"Trophy Hall",     icon:"👹", desc:"Boss kills grant +75% bonus gold",               maxLevel:1, baseCost:150, effect:()=>({researchBossGold:true}) },
  { id:"support_buff",  label:"Support Mastery", icon:"✨", desc:"+15% support aura strength per level",           maxLevel:2, baseCost:110, effect:l=>({researchSupportBuff:l*0.15}) },
  { id:"wall_ring",     label:"Iron Formation",  icon:"🛡️", desc:"Unlock reinforced outer wall ring",              maxLevel:1, baseCost:180, effect:()=>({researchWallRing:true}) },
  { id:"cannon_splash", label:"Powder Master",   icon:"💥", desc:"+30% cannon splash per level",                   maxLevel:2, baseCost:120, effect:l=>({researchSplashMult:1+l*0.3}) },
  { id:"chain_unlock",  label:"Lightning Rune",  icon:"🌩️", desc:"Unlocks Chain Lightning perk",                  maxLevel:1, baseCost:200, effect:()=>({researchChainUnlock:true}) },
  { id:"xp_boost",      label:"Scholar's Mark",  icon:"⭐", desc:"+25% XP per run per level",                     maxLevel:3, baseCost:140, effect:l=>({researchXpMult:1+l*0.25}) },
  { id:"wall_regen",    label:"Living Stone",     icon:"🌿", desc:"Walls regen HP (up to 30% of max) per level",   maxLevel:3, baseCost:130, effect:l=>({researchWallRegen:l*WALL_REGEN_PER_LEVEL}) },
];

function getUpgradeCost(upg,lvl){ return Math.round(upg.baseCost*Math.pow(1.55,lvl)); }
function getTowerUpgradeCost(type,lvl){
  if(lvl>=TOWER_MAX_LEVEL) return Infinity;
  return Math.round((TOWER_UPGRADE_BASE[type]||40)*Math.pow(TOWER_UPGRADE_SCALE,lvl-1));
}
function getTowerLevelStats(type,level){
  const tdef=TOWER_TYPES[type];
  if(!tdef) return{dmgMult:1,spdMult:1,rangeBns:0,buffBns:0,rangeBuff:0};
  const b=Math.max(0,(level||1)-1);
  return{dmgMult:1+b*TOWER_LVL_DMG_MULT,spdMult:Math.max(0.3,1-b*TOWER_LVL_SPD_MULT),rangeBns:b*TOWER_LVL_RNG_BONUS,buffBns:tdef.buff?b*0.08:0,rangeBuff:tdef.buff?b*0.4:0};
}
function getRunUpgradeCost(item,count){
  return item.costScale===1.0?item.baseCost:Math.round(item.baseCost*Math.pow(item.costScale,count));
}

// ═══════════════════════════════════════════════════════════════
// SAVE / LOAD
// ═══════════════════════════════════════════════════════════════
function makeBlankSave(){
  return{
    version:SAVE_VERSION,
    totalXp:0,lifetimeKills:0,lifetimeBosses:0,bestTime:0,bestTierIdx:0,bestLevel:0,
    // Level 7+ per difficulty tier unlocks next difficulty
    bestLevelByDiff:{ normal:0, hard:0, nightmare:0 },
    castleUpgrades:{},researchUpgrades:{},
    settings:{preferredSpeed:1},
  };
}
function loadSave(){
  try{
    const raw=localStorage.getItem(SAVE_KEY);
    if(!raw) return makeBlankSave();
    const p=JSON.parse(raw);
    const blank=makeBlankSave();
    const merged={ ...blank, ...p, version:SAVE_VERSION };
    // Migrate: ensure bestLevelByDiff exists
    if(!merged.bestLevelByDiff) merged.bestLevelByDiff={ normal:0, hard:0, nightmare:0 };
    return merged;
  }catch{ return makeBlankSave(); }
}
function saveGame(d){ try{localStorage.setItem(SAVE_KEY,JSON.stringify({...d,version:SAVE_VERSION}));}catch{} }
function resetSave(){ try{localStorage.removeItem(SAVE_KEY);}catch{} return makeBlankSave(); }

// Check if a difficulty tier is unlocked based on best level per difficulty
function isDifficultyUnlocked(tierId, save){
  const dt=DIFFICULTY_TIERS.find(d=>d.id===tierId);
  if(!dt||!dt.unlockCondition) return true;
  const{difficulty,minLevel}=dt.unlockCondition;
  return (save.bestLevelByDiff?.[difficulty]||0)>=minLevel;
}

function computePerks(save){
  const p={
    startGoldBonus:0,permWallHpMult:1,permDmgMult:1,permSpdMult:1,permHeartHp:300,
    permPassiveGold:0,permRepairDisc:0,permHeartAtkMult:1,
    researchCardBonus:false,researchGoldMult:1,researchBossGold:false,
    researchSupportBuff:0,researchWallRing:false,researchSplashMult:1,
    researchChainUnlock:false,researchXpMult:1,researchWallRegen:0,
  };
  for(const u of CASTLE_UPGRADES)  {const l=save.castleUpgrades?.[u.id]||0;  if(l>0)Object.assign(p,u.effect(l));}
  for(const u of RESEARCH_UPGRADES){const l=save.researchUpgrades?.[u.id]||0;if(l>0)Object.assign(p,u.effect(l));}
  return p;
}
function calcXp(gs,tierIdx,perks,diffTier){
  const sec=gs.elapsed/1000;
  const base=Math.round(sec*XP_PER_SEC+gs.kills*XP_PER_KILL+gs.bossKills*XP_PER_BOSS+tierIdx*XP_PER_TIER);
  return Math.round(Math.max(XP_MIN_RUN,base)*(perks.researchXpMult||1)*(diffTier.xpMult||1));
}
function calcRunLevel(elapsed){
  const sec=elapsed/1000;let level=1;
  for(let i=1;i<LEVEL_TIME_THRESHOLDS.length;i++) if(sec>=LEVEL_TIME_THRESHOLDS[i]) level=i+1;
  return Math.min(level,10);
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
const mkId    = ()=>Math.random().toString(36).slice(2,9);
const dist    = (a,b)=>Math.sqrt((a.x-b.x)**2+(a.y-b.y)**2);
const clamp   = (v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const rnd     = (lo,hi)=>lo+Math.floor(Math.random()*(hi-lo+1));
const rndItem = arr=>arr[Math.floor(Math.random()*arr.length)];
const getTier    = idx=>ASCENSION_TIERS[clamp(idx,0,ASCENSION_TIERS.length-1)];
const getTierIdx = ms=>{let i=0;ASCENSION_TIERS.forEach((t,j)=>{if(ms/1000>=t.minSec)i=j;});return i;};
// Which tier has been UNLOCKED by survival time (player still must pay to ascend)
const getUnlockedTierIdx = ms=>getTierIdx(ms);

function getDifficulty(ms,dt){const c=diffCurve(ms);return{hpMult:c.hpScale*dt.enemyHpMult,dmgMult:c.dmgScale*dt.enemyDmgMult};}
function getSpawnInterval(ms,slow){if(slow>0)return 5000;return Math.max(SPAWN_RATE_MIN,SPAWN_RATE_MAX-(ms/1000)*SPAWN_RATE_DECAY);}
function getSpawnPool(ms){const s=ms/1000;if(s<25)return["raider","raider","swarm"];if(s<70)return["raider","runner","swarm","swarm"];if(s<130)return["raider","runner","brute","swarm","siege"];return["raider","runner","brute","swarm","siege","siege"];}
function isBossTime(e,p){return Math.floor(e/90000)>Math.floor(p/90000)&&e>0;}

function spawnEnemy(type,diff,speedMult=1){
  const base=ENEMY_TYPES[type];if(!base)return null;
  const edge=rnd(0,2);let x,y;
  if(edge===0){x=rnd(0,GRID_SIZE-1);y=0;}
  else if(edge===1){x=0;y=rnd(0,GRID_SIZE-1);}
  else{x=GRID_SIZE-1;y=rnd(0,GRID_SIZE-1);}
  return{id:mkId(),type,x:x+0.5,y:y+0.5,maxHp:Math.round(base.hp*diff.hpMult),hp:Math.round(base.hp*diff.hpMult),spd:base.spd*speedMult,dmg:Math.round(base.dmg*diff.dmgMult),gold:base.gold,targetWalls:base.targetWalls||false,isBoss:base.isBoss||false,attackCd:0};
}

function repairAllWalls(state){
  const cells={};for(const[k,c]of Object.entries(state.cells))cells[k]=c.type==="wall"?{...c,hp:c.maxHp}:c;
  return{...state,cells};
}
function applyWallHpBuff(state,mult){
  // BUG FIX #6: applies to ALL existing walls, maintains damage ratio
  const cells={};
  for(const[k,c]of Object.entries(state.cells)){
    if(c.type==="wall"){
      const newMax=Math.round(c.maxHp*mult);
      const ratio=c.maxHp>0?c.hp/c.maxHp:1;
      cells[k]={...c,maxHp:newMax,hp:Math.round(newMax*ratio)};
    }else cells[k]=c;
  }
  return{...state,cells,wallHpMult:(state.wallHpMult||1)*mult};
}
function applyIronSkin(state){
  const cells={};
  for(const[k,c]of Object.entries(state.cells))cells[k]=(c.type==="wall"||c.type==="heart")?{...c,maxHp:c.maxHp*3,hp:c.maxHp*3}:c;
  return{...state,cells};
}
function applyCastleLevelUp(state,free=false){
  const lvl=state.castleLevel||1;if(lvl>=CASTLE_RUN_MAX_LEVEL)return state;
  const cost=free?0:CASTLE_RUN_COSTS[lvl];
  if(!free&&state.gold<cost)return state;
  const heartKey=`${HEART_COL},${HEART_ROW}`;const heart=state.cells[heartKey];
  const newCells=heart?{...state.cells,[heartKey]:{...heart,maxHp:heart.maxHp+CASTLE_LVL_HP_BONUS,hp:Math.min(heart.hp+CASTLE_LVL_HP_BONUS,heart.maxHp+CASTLE_LVL_HP_BONUS)}}:state.cells;
  return{...state,gold:free?state.gold:state.gold-cost,castleLevel:lvl+1,cells:newCells};
}
function lightenHex(hex,amount){
  const h=hex.replace("#","");const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return`#${[r,g,b].map(v=>Math.min(255,Math.round(v+(255-v)*amount)).toString(16).padStart(2,"0")).join("")}`;
}

// 21×21 grid — heart at (10,10), wall ring at radius 2 (1 tile gap)
function getInitialGrid(perks){
  const cells={};const hc=HEART_COL,hr=HEART_ROW;
  const hp=perks.permHeartHp||300;
  cells[`${hc},${hr}`]={type:"heart",hp,maxHp:hp};
  const wallHp=Math.round(WALL_HP_BASE*(perks.permWallHpMult||1));

  const defaultRing=[];
  for(let dc=-2;dc<=2;dc++)for(let dr=-2;dr<=2;dr++){
    if(Math.abs(dc)===2||Math.abs(dr)===2)defaultRing.push([hc+dc,hr+dr]);
  }
  const outerRing=[];
  if(perks.researchWallRing){
    for(let dc=-3;dc<=3;dc++)for(let dr=-3;dr<=3;dr++){
      if(Math.abs(dc)===3||Math.abs(dr)===3)outerRing.push([hc+dc,hr+dr]);
    }
  }
  for(const[c,r]of[...defaultRing,...outerRing]){
    if(c>=0&&c<GRID_SIZE&&r>=0&&r<GRID_SIZE&&!(c===hc&&r===hr))
      cells[`${c},${r}`]={type:"wall",hp:wallHp,maxHp:wallHp,level:1,damageTaken:0};
  }
  return cells;
}

function pickPerks(researchUpgrades,count=3){
  const hasChain=(researchUpgrades?.chain_unlock||0)>=1;
  const cardBonus=(researchUpgrades?.card_quality||0)>=1;
  const pool=PERK_POOL.filter(p=>!(p.id==="chain_lightning"&&!hasChain));
  const weighted=[];
  for(const p of pool){const w=p.rarity==="rare"?(cardBonus?3:1):p.rarity==="uncommon"?3:5;for(let i=0;i<w;i++)weighted.push(p);}
  const chosen=[],seen=new Set();
  for(const p of[...weighted].sort(()=>Math.random()-0.5)){if(!seen.has(p.id)&&chosen.length<count){chosen.push(p);seen.add(p.id);}}
  return chosen;
}

// ═══════════════════════════════════════════════════════════════
// INITIAL STATE
// ═══════════════════════════════════════════════════════════════
function makeInitialState(perks,save,diffTier){
  return{
    phase:"playing",
    xpAwarded:false,
    showUpgradeModal:false,showShop:false,showSettings:false,settingsTab:"credits",
    showTowerPanel:false,selectedTowerKey:null,
    showTowerList:false,      // NEW: upgrade list panel
    showAscensionModal:false, // NEW: player-triggered ascension
    elapsed:0,prevElapsed:0,
    diffTier,
    gold:GOLD_START+(perks.startGoldBonus||0),
    passiveGoldRate:perks.permPassiveGold||0,passiveGoldAcc:0,
    kills:0,bossKills:0,totalGoldEarned:0,
    cells:getInitialGrid(perks),
    enemies:[],projectiles:[],towerCds:{},heartCd:0,
    castleLevel:1,
    wallRegenAcc:0,
    runUpgradeCounts:{},
    selected:null,perks:[],rewardCards:[],
    upgradeTimer:PERK_INTERVAL,
    spawnTimer:3000,spawnSlowTimer:0,
    log:[],speedMult:1,enemySpeedMult:1,
    atkSpdMult:perks.permSpdMult||1,
    wallHpMult:perks.permWallHpMult||1,
    goldMult:(perks.researchGoldMult||1)*(diffTier.goldMult||1)*GOLD_KILL_MULT,
    critChance:0,rangeBonus:0,
    dmgMult:perks.permDmgMult||1,
    splashMult:perks.researchSplashMult||1,
    supportBuff:0.30+(perks.researchSupportBuff||0),
    repairDisc:perks.permRepairDisc||0,
    heartAtkMult:perks.permHeartAtkMult||1,
    bossGoldBonus:perks.researchBossGold||false,
    chainLightning:false,explosiveWalls:false,wallSpikes:false,
    wallRegenRate:perks.researchWallRegen||0,
    // Ascension: survival unlocks option, player pays gold to activate
    currentAscensionIdx:0,    // tier the player is CURRENTLY on
    unlockedAscensionIdx:0,   // highest tier survival has unlocked
    statWindow:[],totalWallDmg:0,totalHeartDmg:0,firstWallBroken:null,worstEnemy:{},
    _researchUpgrades:save.researchUpgrades||{},
  };
}

// ═══════════════════════════════════════════════════════════════
// GAME TICK
// ═══════════════════════════════════════════════════════════════
function gameTick(state){
  if(state.phase!=="playing")return state;
  const prevElapsed=state.elapsed;
  let s={...state,elapsed:state.elapsed+BASE_TICK,prevElapsed,enemies:[...state.enemies],projectiles:[...state.projectiles],spawnSlowTimer:Math.max(0,state.spawnSlowTimer-BASE_TICK)};

  const diff=getDifficulty(s.elapsed,s.diffTier);
  // Use player's current ascension tier for passive buff
  const tier=getTier(s.currentAscensionIdx);
  const passiveB=tier.passiveBuff;

  // Update unlocked ascension tier based on survival
  const newUnlockedIdx=getUnlockedTierIdx(s.elapsed);
  const unlockedAscensionIdx=Math.max(s.unlockedAscensionIdx,newUnlockedIdx);

  const castleLvl=s.castleLevel||1;
  const castleDmgBonus=1+(castleLvl-1)*CASTLE_LVL_DMG_BONUS;
  const castleGoldRate=(castleLvl-1)*CASTLE_LVL_GOLD_BONUS;

  let gold=s.gold;
  let pAcc=s.passiveGoldAcc+((s.passiveGoldRate+castleGoldRate)/1000)*BASE_TICK;
  if(pAcc>=1){gold+=Math.floor(pAcc);pAcc-=Math.floor(pAcc);}

  let upgradeTimer=s.upgradeTimer-BASE_TICK;
  let showUpgradeModal=s.showUpgradeModal,rewardCards=s.rewardCards;
  if(upgradeTimer<=0&&!showUpgradeModal){upgradeTimer=PERK_INTERVAL;showUpgradeModal=true;rewardCards=pickPerks(s._researchUpgrades);}

  let spawnTimer=s.spawnTimer-BASE_TICK;
  const enemies=[...s.enemies];
  if(isBossTime(s.elapsed,prevElapsed)){const b=spawnEnemy("boss",diff,s.enemySpeedMult||1);if(b)enemies.push(b);}
  if(spawnTimer<=0){
    const pool=getSpawnPool(s.elapsed);
    const en=spawnEnemy(rndItem(pool),diff,s.enemySpeedMult||1);if(en)enemies.push(en);
    if(Math.random()<0.14)for(let i=0;i<rnd(2,4);i++){const sw=spawnEnemy("swarm",diff,s.enemySpeedMult||1);if(sw)enemies.push(sw);}
    spawnTimer=getSpawnInterval(s.elapsed,s.spawnSlowTimer);
  }

  const cells={...s.cells};
  let wallRegenAcc=s.wallRegenAcc;
  if(s.wallRegenRate>0){
    wallRegenAcc+=(s.wallRegenRate/1000)*BASE_TICK;
    if(wallRegenAcc>=1){
      const pts=Math.floor(wallRegenAcc);wallRegenAcc-=pts;
      for(const[k,c]of Object.entries(cells)){
        if(c.type==="wall"&&c.hp<c.maxHp){const cap=Math.round(c.maxHp*WALL_REGEN_MAX_PCT);if(c.hp<cap)cells[k]={...c,hp:Math.min(cap,c.hp+pts)};}
      }
    }
  }

  let kills=s.kills,bossKills=s.bossKills,totalGoldEarned=s.totalGoldEarned;
  let totalWallDmg=s.totalWallDmg,totalHeartDmg=s.totalHeartDmg,firstWallBroken=s.firstWallBroken;
  const worstEnemy={...s.worstEnemy};const log=[...s.log];const livingEnemies=[];

  for(let en of enemies){
    en={...en};
    if(en.hp<=0){
      let earned=Math.round(en.gold*(s.goldMult||1));
      if(en.isBoss){if(s.bossGoldBonus)earned=Math.round(earned*1.75);bossKills++;log.push(`👹 Boss slain! +${earned}💰`);}
      gold+=earned;totalGoldEarned+=earned;kills++;continue;
    }
    const cx=Math.floor(en.x),cy=Math.floor(en.y);
    const adjKeys=[`${cx},${cy}`,`${cx},${cy-1}`,`${cx},${cy+1}`,`${cx-1},${cy}`,`${cx+1},${cy}`];
    const adjacent=adjKeys.filter(k=>cells[k]&&["wall","heart","tower"].includes(cells[k].type));
    if(adjacent.length>0){
      en.attackCd=(en.attackCd||0)-1;
      if(en.attackCd<=0){
        let tk=adjacent[0];
        if(en.targetWalls){const wt=adjacent.find(k=>cells[k]?.type==="wall");if(wt)tk=wt;}
        const tc={...cells[tk]};const dmgDealt=Math.min(Math.max(0,tc.hp),en.dmg);
        tc.hp-=en.dmg;
        worstEnemy[en.type]=(worstEnemy[en.type]||0)+dmgDealt;
        if(tc.type==="wall"){totalWallDmg+=dmgDealt;tc.damageTaken=(tc.damageTaken||0)+dmgDealt;}
        if(tc.type==="heart")totalHeartDmg+=dmgDealt;
        if(s.wallSpikes&&tc.type==="wall")en.hp=Math.max(0,en.hp-8);
        if(tc.hp<=0){
          if(tc.type==="heart")return{...s,cells:{...cells,[tk]:{...tc,hp:0}},phase:"gameover",totalWallDmg,totalHeartDmg,worstEnemy,kills,bossKills,totalGoldEarned,gold};
          if(tc.type==="wall"&&s.explosiveWalls){for(const xe of livingEnemies)if(dist({x:cx+0.5,y:cy+0.5},{x:xe.x,y:xe.y})<2.5)xe.hp=Math.max(0,xe.hp-50);log.push("💥 Wall exploded!");}
          if(tc.type==="wall"&&!firstWallBroken)firstWallBroken={time:s.elapsed,key:tk};
          delete cells[tk];log.push("🧱 Wall breached!");
        }else{cells[tk]=tc;}
        en.attackCd=15;
      }
      livingEnemies.push(en);continue;
    }
    const dx=(HEART_COL+0.5)-en.x,dy=(HEART_ROW+0.5)-en.y,d=Math.sqrt(dx*dx+dy*dy);
    if(d>0.05){const move=en.spd*SEC_PER_TICK;en.x=clamp(en.x+(dx/d)*move,0.05,GRID_SIZE-0.05);en.y=clamp(en.y+(dy/d)*move,0.05,GRID_SIZE-0.05);}
    livingEnemies.push(en);
  }

  // Clear stale tower panel
  let{selectedTowerKey,showTowerPanel}=s;
  if(selectedTowerKey&&selectedTowerKey!=="heart"&&!cells[selectedTowerKey]){selectedTowerKey=null;showTowerPanel=false;}

  const towerCds={...s.towerCds};
  for(const k of Object.keys(towerCds))if(!cells[k])delete towerCds[k];
  const projs=[];const supBuff=s.supportBuff||0.30;let heartCd=s.heartCd-1;

  for(const[key,cell]of Object.entries(cells)){
    if(cell.type==="heart"){
      if(heartCd<=0){
        const hm=s.heartAtkMult||1;let nearest=null,nearestD=Infinity;
        for(const en of livingEnemies){if(en.hp<=0)continue;const d=dist({x:HEART_COL+0.5,y:HEART_ROW+0.5},en);if(d<=HEART_TOWER.range&&d<nearestD){nearest=en;nearestD=d;}}
        if(nearest){
          let dmg=Math.round(HEART_TOWER.dmg*hm*(s.dmgMult||1)*castleDmgBonus*(1+passiveB));
          if(Math.random()<(s.critChance||0))dmg*=2;
          nearest.hp=Math.max(0,nearest.hp-dmg);heartCd=Math.max(2,Math.round(HEART_TOWER.speed/hm));
          projs.push({id:mkId(),tx:nearest.x,ty:nearest.y,life:5,color:HEART_TOWER.color});
        }else heartCd=0;
      }
      continue;
    }
    if(cell.type!=="tower")continue;
    const tdef=TOWER_TYPES[cell.towerType];if(!tdef||tdef.dmg===0)continue;
    towerCds[key]=(towerCds[key]||0)-1;if(towerCds[key]>0)continue;
    const[tc,tr]=key.split(",").map(Number);
    const lvStats=getTowerLevelStats(cell.towerType,cell.towerLevel||1);
    const range=tdef.range+(s.rangeBonus||0)+lvStats.rangeBns;
    let buffMult=1+passiveB;
    for(const[k2,c2]of Object.entries(cells)){
      if(c2.type==="tower"&&c2.towerType==="support"){
        const[sx,sy]=k2.split(",").map(Number);const sv=getTowerLevelStats("support",c2.towerLevel||1);
        if(dist({x:tc,y:tr},{x:sx,y:sy})<=TOWER_TYPES.support.range+sv.rangeBuff)buffMult+=supBuff+sv.buffBns;
      }
    }
    let nearest=null,nearestD=Infinity;
    for(const en of livingEnemies){if(en.hp<=0)continue;const d=dist({x:tc+0.5,y:tr+0.5},en);if(d<=range&&d<nearestD){nearest=en;nearestD=d;}}
    if(nearest){
      let dmg=Math.round(tdef.dmg*(s.dmgMult||1)*castleDmgBonus*lvStats.dmgMult*buffMult);
      if(Math.random()<(s.critChance||0))dmg*=2;
      towerCds[key]=Math.max(2,Math.round(tdef.speed*(s.atkSpdMult||1)*lvStats.spdMult));
      if(tdef.splash){const splashR=tdef.splash*(s.splashMult||1);for(const en of livingEnemies)if(dist(nearest,en)<=splashR)en.hp=Math.max(0,en.hp-dmg);}
      else{
        nearest.hp=Math.max(0,nearest.hp-dmg);
        if(s.chainLightning&&cell.towerType==="arrow"){
          const ch=livingEnemies.filter(e=>e!==nearest&&e.hp>0&&dist(nearest,e)<4.0).slice(0,2);
          for(const ce of ch){ce.hp=Math.max(0,ce.hp-Math.round(dmg*0.5));projs.push({id:mkId(),tx:ce.x,ty:ce.y,life:3,color:"#aaff00"});}
        }
      }
      projs.push({id:mkId(),tx:nearest.x,ty:nearest.y,life:3,color:tdef.color});
    }
  }

  const snap={t:s.elapsed,gold,kills};
  const statWindow=[...s.statWindow.filter(w=>s.elapsed-w.t<5000),snap];
  const aliveProjs=[...s.projectiles,...projs].map(p=>({...p,life:p.life-1})).filter(p=>p.life>0);

  return{...s,gold,passiveGoldAcc:pAcc,kills,bossKills,totalGoldEarned,totalWallDmg,totalHeartDmg,firstWallBroken,worstEnemy,cells,enemies:livingEnemies,projectiles:aliveProjs,towerCds,heartCd,spawnTimer,upgradeTimer,showUpgradeModal,rewardCards,statWindow,wallRegenAcc,selectedTowerKey,showTowerPanel,unlockedAscensionIdx,log:log.slice(-4)};
}

function computeStats(gs){
  const w=gs.statWindow;if(w.length<2)return{dps:"—",gps:"—"};
  const dt=(w[w.length-1].t-w[0].t)/1000;if(dt<0.5)return{dps:"—",gps:"—"};
  return{dps:((w[w.length-1].kills-w[0].kills)/dt).toFixed(1),gps:((w[w.length-1].gold-w[0].gold)/dt).toFixed(1)};
}

// ═══════════════════════════════════════════════════════════════
// BUILD LOGIC
// ═══════════════════════════════════════════════════════════════
function applyBuild(state,col,row){
  const key=`${col},${row}`;const cell=state.cells[key];const tool=state.selected?.tool;
  const addLog=msg=>({...state,log:[...state.log.slice(-3),msg]});

  if(!tool){
    if(cell?.type==="tower")return{...state,showTowerPanel:true,selectedTowerKey:key,showShop:false,showTowerList:false};
    if(cell?.type==="heart")return{...state,showTowerPanel:true,selectedTowerKey:"heart",showShop:false,showTowerList:false};
    return{...state,showTowerPanel:false,selectedTowerKey:null};
  }
  if(tool==="sell"&&cell&&cell.type!=="heart"){
    const refund=cell.type==="wall"?10:Math.round((TOWER_TYPES[cell.towerType]?.cost||20)*0.5);
    const c2={...state.cells};delete c2[key];const cds={...state.towerCds};delete cds[key];
    return{...state,cells:c2,towerCds:cds,gold:state.gold+refund,log:[...state.log.slice(-3),`💸 Sold for ${refund}💰`],showTowerPanel:false,selectedTowerKey:null};
  }
  if(tool==="upgrade_tower"&&cell?.type==="tower"){
    const lvl=cell.towerLevel||1;if(lvl>=TOWER_MAX_LEVEL)return addLog("✅ Tower max level");
    const cost=getTowerUpgradeCost(cell.towerType,lvl);if(state.gold<cost)return addLog(`❌ Need 💰${cost}`);
    return{...state,gold:state.gold-cost,cells:{...state.cells,[key]:{...cell,towerLevel:lvl+1}},log:[...state.log.slice(-3),`⬆️ ${TOWER_TYPES[cell.towerType]?.label} → Lv${lvl+1}`]};
  }
  if(tool==="castle_up"){
    const lvl=state.castleLevel||1;if(lvl>=CASTLE_RUN_MAX_LEVEL)return addLog("✅ Castle max level");
    const cost=CASTLE_RUN_COSTS[lvl];if(state.gold<cost)return addLog(`❌ Need 💰${cost}`);
    const next=applyCastleLevelUp(state);return{...next,log:[...state.log.slice(-3),`🏰 Castle → Lv${next.castleLevel}!`]};
  }
  if(tool==="upgrade"&&cell?.type==="wall"){
    const cost=25;if(state.gold<cost)return addLog("❌ Need 💰25 for wall upgrade");
    const newHp=Math.round(cell.maxHp*1.6);
    return{...state,gold:state.gold-cost,cells:{...state.cells,[key]:{...cell,maxHp:newHp,hp:newHp,level:(cell.level||1)+1}}};
  }
  if(tool==="repair"&&cell?.type==="wall"){
    if(cell.hp>=cell.maxHp)return addLog("✅ Wall already full");
    const cost=Math.max(5,Math.round(REPAIR_COST*(1-(state.repairDisc||0))));
    if(state.gold<cost)return addLog(`❌ Need 💰${cost} to repair`);
    return{...state,gold:state.gold-cost,cells:{...state.cells,[key]:{...cell,hp:cell.maxHp}}};
  }
  if(tool==="wall"&&!cell){
    if(state.gold<WALL_COST)return addLog(`❌ Need 💰${WALL_COST}`);
    const hp=Math.round(WALL_HP_BASE*(state.wallHpMult||1));
    return{...state,gold:state.gold-WALL_COST,cells:{...state.cells,[key]:{type:"wall",hp,maxHp:hp,level:1,damageTaken:0}}};
  }
  if(TOWER_TYPES[tool]&&!cell){
    const tdef=TOWER_TYPES[tool];if(state.gold<tdef.cost)return addLog(`❌ Need 💰${tdef.cost}`);
    return{...state,gold:state.gold-tdef.cost,cells:{...state.cells,[key]:{type:"tower",towerType:tool,towerLevel:1,hp:60,maxHp:60}}};
  }
  return state;
}

function applyRunUpgrade(state,item){
  const count=state.runUpgradeCounts?.[item.id]||0;
  const cost=getRunUpgradeCost(item,count);
  if(state.gold<cost)return{...state,log:[...state.log.slice(-3),`❌ Need 💰${cost}`]};
  let s={...state,gold:state.gold-cost,runUpgradeCounts:{...state.runUpgradeCounts,[item.id]:count+1}};
  if(item.action==="repairWalls") s=repairAllWalls(s);
  if(item.action==="boostDmg")   s={...s,dmgMult:(s.dmgMult||1)*1.1};
  if(item.action==="boostSpd")   s={...s,atkSpdMult:(s.atkSpdMult||1)*0.9};
  if(item.action==="goldIncome") s={...s,passiveGoldRate:s.passiveGoldRate+3};
  if(item.action==="boostRange") s={...s,rangeBonus:(s.rangeBonus||0)+1.0};
  if(item.action==="repairDisc") s={...s,repairDisc:Math.min(0.8,(s.repairDisc||0)+0.2)};
  if(item.action==="heartBoost") s={...s,heartAtkMult:(s.heartAtkMult||1)*1.25};
  // BUG FIX #6: wallHp upgrade applies to ALL existing walls (maintain damage ratio)
  if(item.action==="wallHp")     s=applyWallHpBuff(s,1.2);
  return{...s,log:[...s.log.slice(-3),`✅ ${item.label}!`]};
}

function buildFailureAnalysis(gs){
  const sorted=Object.entries(gs.worstEnemy||{}).sort((a,b)=>b[1]-a[1]);const wt=sorted[0];
  const towers=Object.values(gs.cells).filter(c=>c.type==="tower").length;
  const walls=Object.values(gs.cells).filter(c=>c.type==="wall").length;
  const runLevel=calcRunLevel(gs.elapsed);const suggestions=[];
  if(wt?.[0]==="swarm")   suggestions.push("Swarms caused the most damage — build a Cannon before 60 seconds.");
  if(wt?.[0]==="runner")  suggestions.push("Runners slipped through — close wall gaps and use Arrow towers.");
  if(wt?.[0]==="boss")    suggestions.push("Boss damage was decisive — invest in a Ballista before 90 seconds.");
  if(wt?.[0]==="siege")   suggestions.push("Siege units destroyed your walls — prioritise them with Arrow towers.");
  if(wt?.[0]==="brute")   suggestions.push("Brutes absorbed too much — upgraded Ballistae deal massive single-target DPS.");
  if(gs.totalHeartDmg>gs.totalWallDmg*0.4)suggestions.push("Enemies bypassed your walls — add more layers and close gaps.");
  if(towers<3)suggestions.push("You had fewer than 3 towers — aim for 3–4 before 60 seconds.");
  if(walls<5) suggestions.push("Sparse walls let enemies through — a full outer ring dramatically helps.");
  if(runLevel<=3)suggestions.push(`You reached Level ${runLevel} — place walls and an Arrow tower in the first 30 seconds.`);
  if(suggestions.length===0)suggestions.push("Solid run! Try upgrading towers to Level 2–3 for a major DPS boost.");
  return{worstType:wt?.[0],worstDmg:wt?.[1]||0,towers,walls,runLevel,suggestions};
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function MythicFortress(){
  const [screen,setScreen]   = useState("menu");
  const [gs,setGs]           = useState(null);
  const [save,setSave]       = useState(()=>loadSave());
  const [runResult,setRunResult] = useState(null);
  const [diffTierId,setDiffTierId] = useState("normal");
  const [buyMult,setBuyMult] = useState(1);
  // BUG FIX #5: useRef flag prevents double XP on any re-render
  const xpAwardedRef = useRef(false);

  // Dynamic cell size — fills screen width
  const [cellSize,setCellSize] = useState(()=>Math.floor(Math.min(window.innerWidth,520)/GRID_SIZE));
  useEffect(()=>{
    const update=()=>{
      const maxW=Math.min(window.innerWidth,520);
      setCellSize(Math.floor(maxW/GRID_SIZE));
    };
    update();
    window.addEventListener("resize",update);
    return()=>window.removeEventListener("resize",update);
  },[]);

  const startRun=useCallback(()=>{
    const p=computePerks(save);
    const dt=DIFFICULTY_TIERS.find(d=>d.id===diffTierId)||DIFFICULTY_TIERS[0];
    xpAwardedRef.current=false;
    setGs(makeInitialState(p,save,dt));
    setScreen("game");setRunResult(null);
  },[save,diffTierId]);

  const goMeta=useCallback(()=>setScreen("meta"),[]);
  const goMenu=useCallback(()=>setScreen("menu"),[]);

  useEffect(()=>{
    if(!gs||gs.phase!=="playing")return;
    const id=setInterval(()=>{
      setGs(prev=>{
        if(!prev||prev.phase!=="playing")return prev;
        const steps=prev.speedMult>=5?5:prev.speedMult>=2?2:1;
        let s=prev;for(let i=0;i<steps;i++)s=gameTick(s);return s;
      });
    },BASE_TICK);
    return()=>clearInterval(id);
  },[gs?.phase]);

  // BUG FIX #5: ref-guarded XP award, runs exactly once per run
  useEffect(()=>{
    if(gs?.phase!=="gameover") return;
    if(xpAwardedRef.current)   return;
    xpAwardedRef.current=true;

    const tierIdx  = getTierIdx(gs.elapsed);
    const perks    = computePerks(save);
    const dt       = gs.diffTier||DIFFICULTY_TIERS[0];
    const xpEarned = calcXp(gs,tierIdx,perks,dt);
    const runLevel = calcRunLevel(gs.elapsed);
    const diffId   = dt.id;

    const newSave={
      ...save,
      totalXp:save.totalXp+xpEarned,
      lifetimeKills:save.lifetimeKills+gs.kills,
      lifetimeBosses:save.lifetimeBosses+gs.bossKills,
      bestTime:Math.max(save.bestTime,gs.elapsed),
      bestTierIdx:Math.max(save.bestTierIdx,tierIdx),
      bestLevel:Math.max(save.bestLevel||0,runLevel),
      bestLevelByDiff:{
        ...(save.bestLevelByDiff||{normal:0,hard:0,nightmare:0}),
        [diffId]:Math.max((save.bestLevelByDiff?.[diffId]||0),runLevel),
      },
    };
    setSave(newSave);saveGame(newSave);
    setRunResult({xpEarned,gs,tierIdx,runLevel,analysis:buildFailureAnalysis(gs)});
  },[gs?.phase]);

  const handleCellTap=useCallback((c,r)=>setGs(p=>(!p||p.phase!=="playing")?p:applyBuild(p,c,r)),[]);
  const handleSelectTool=useCallback(tool=>setGs(p=>p?{...p,selected:tool?{tool}:null,showTowerPanel:false,selectedTowerKey:null,showTowerList:false}:p),[]);
  const handleClearTool=useCallback(()=>setGs(p=>p?{...p,selected:null}:p),[]);
  const handlePerkSelect=useCallback(perk=>{setGs(prev=>{if(!prev)return prev;const u=perk.apply(prev);return{...u,showUpgradeModal:false,perks:[...prev.perks,perk.id],rewardCards:[],upgradeTimer:PERK_INTERVAL};});},[]);
  const handleRunUpgrade=useCallback(item=>setGs(prev=>prev?applyRunUpgrade(prev,item):prev),[]);
  const handleTowerUpgrade=useCallback(key=>{
    setGs(prev=>{
      if(!prev)return prev;
      if(key==="castle")return applyBuild({...prev,selected:{tool:"castle_up"}},HEART_COL,HEART_ROW);
      const cell=prev.cells[key];if(!cell||cell.type!=="tower")return prev;
      return applyBuild({...prev,selected:{tool:"upgrade_tower"}},+key.split(",")[0],+key.split(",")[1]);
    });
  },[]);
  const handleSpeedChange=useCallback(m=>setGs(p=>p?{...p,speedMult:m}:p),[]);
  const handleToggleShop=useCallback(()=>setGs(p=>p?{...p,showShop:!p.showShop,showSettings:false,showTowerPanel:false,showTowerList:false}:p),[]);
  const handleToggleSettings=useCallback(()=>setGs(p=>p?{...p,showSettings:!p.showSettings,showShop:false}:p),[]);
  const handleSetSettingsTab=useCallback(t=>setGs(p=>p?{...p,settingsTab:t}:p),[]);
  const handleCloseTowerPanel=useCallback(()=>setGs(p=>p?{...p,showTowerPanel:false,selectedTowerKey:null,selected:null}:p),[]);
  const handleToggleTowerList=useCallback(()=>setGs(p=>p?{...p,showTowerList:!p.showTowerList,showShop:false,showTowerPanel:false,showSettings:false}:p),[]);

  // Ascension: player pays gold to advance to next unlocked tier
  const handleAscend=useCallback(()=>{
    setGs(prev=>{
      if(!prev)return prev;
      const nextIdx=prev.currentAscensionIdx+1;
      if(nextIdx>prev.unlockedAscensionIdx)return{...prev,log:[...prev.log.slice(-3),"⏳ Survive longer to unlock next tier"]};
      const cost=ASCENSION_COSTS[prev.currentAscensionIdx]||0;
      if(prev.gold<cost)return{...prev,log:[...prev.log.slice(-3),`❌ Need 💰${cost} to ascend`]};
      const nextTier=getTier(nextIdx);
      return{...prev,gold:prev.gold-cost,currentAscensionIdx:nextIdx,showAscensionModal:false,log:[...prev.log.slice(-3),`✨ Ascended to ${nextTier.name}!`]};
    });
  },[]);

  const handleMetaUpgrade=useCallback((type,id,mult)=>{
    setSave(prev=>{
      const key=type==="castle"?"castleUpgrades":"researchUpgrades";
      const all=type==="castle"?CASTLE_UPGRADES:RESEARCH_UPGRADES;
      const upg=all.find(u=>u.id===id);if(!upg)return prev;
      const cur=prev[key]?.[id]||0;
      const times=mult==="max"?upg.maxLevel-cur:Math.min(Number(mult),upg.maxLevel-cur);
      if(times<=0)return prev;
      let xp=prev.totalXp,lvl=cur,updated={...(prev[key]||{})};
      for(let i=0;i<times;i++){const c=getUpgradeCost(upg,lvl);if(xp<c)break;xp-=c;lvl++;updated[id]=lvl;}
      const next={...prev,totalXp:xp,[key]:updated};saveGame(next);return next;
    });
  },[]);

  const handleResetSave=useCallback(()=>{
    if(window.confirm("Reset all progress? This cannot be undone.")){
      const blank=resetSave();setSave(blank);setScreen("menu");setGs(null);
    }
  },[]);

  const currentTier = gs ? getTier(gs.currentAscensionIdx) : ASCENSION_TIERS[0];

  return(
    <div style={{minHeight:"100vh",background:gs?.phase==="playing"?currentTier.bg:"#0a0a0f",display:"flex",flexDirection:"column",alignItems:"center",fontFamily:"'Segoe UI',system-ui,sans-serif",color:"#fff",transition:"background 2s ease",userSelect:"none",position:"relative",WebkitTapHighlightColor:"transparent"}}>
      {screen==="menu"&&<MenuScreen onStart={startRun} onMeta={goMeta} save={save} diffTierId={diffTierId} onSetDiff={setDiffTierId}/>}
      {screen==="game"&&gs&&(
        <GameScreen gs={gs} tier={currentTier} cellSize={cellSize}
          onCellTap={handleCellTap} onSelectTool={handleSelectTool} onClearTool={handleClearTool}
          onPerkSelect={handlePerkSelect} onRunUpgrade={handleRunUpgrade}
          onTowerUpgrade={handleTowerUpgrade} onCloseTowerPanel={handleCloseTowerPanel}
          onToggleTowerList={handleToggleTowerList}
          onSpeedChange={handleSpeedChange}
          onToggleShop={handleToggleShop} onToggleSettings={handleToggleSettings}
          onSetSettingsTab={handleSetSettingsTab}
          onAscend={handleAscend}
          onToggleAscensionModal={()=>setGs(p=>p?{...p,showAscensionModal:!p.showAscensionModal}:p)}
          onRestart={()=>{setScreen("menu");setGs(null);}}
          onGoMeta={goMeta} runResult={runResult}/>
      )}
      {screen==="meta"&&<MetaScreen save={save} onUpgrade={handleMetaUpgrade} onStart={startRun} onMenu={goMenu} runResult={runResult} buyMult={buyMult} onSetBuyMult={setBuyMult} onReset={handleResetSave}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SCREENS
// ═══════════════════════════════════════════════════════════════

function MenuScreen({onStart,onMeta,save,diffTierId,onSetDiff}){
  const dt=DIFFICULTY_TIERS.find(d=>d.id===diffTierId)||DIFFICULTY_TIERS[0];
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",gap:18,padding:20,background:"radial-gradient(ellipse at 50% 25%, #1e0c38 0%, #05050e 70%)"}}>
      <div style={{textAlign:"center"}}>
        <div style={{fontSize:52,marginBottom:4}}>🏰</div>
        <h1 style={{fontSize:28,fontWeight:900,margin:0,letterSpacing:3,textTransform:"uppercase",background:"linear-gradient(135deg,#FFD700,#FF6B35,#C41E3A)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Mythic Fortress</h1>
        <div style={{color:"#8a7fc0",fontSize:10,letterSpacing:2,marginTop:3}}>IDLE SIEGE · ROGUELITE</div>
      </div>

      <div style={{width:"100%",maxWidth:340}}>
        <div style={{fontSize:9,color:"#555",textAlign:"center",letterSpacing:1,marginBottom:6,textTransform:"uppercase"}}>Select Difficulty</div>
        <div style={{display:"flex",gap:6}}>
          {DIFFICULTY_TIERS.map(d=>{
            const unlocked=isDifficultyUnlocked(d.id,save);
            const sel=diffTierId===d.id;
            const uc=d.unlockCondition;
            const unlockHint=uc?`${uc.difficulty.charAt(0).toUpperCase()+uc.difficulty.slice(1)} Lv${uc.minLevel}`:null;
            return(
              <button key={d.id} onClick={()=>unlocked&&onSetDiff(d.id)} style={{flex:1,padding:"10px 4px",borderRadius:10,cursor:unlocked?"pointer":"default",background:sel?"rgba(255,215,0,0.12)":"rgba(255,255,255,0.04)",border:`1px solid ${sel?"#FFD70066":unlocked?"#2a2a2a":"#161616"}`,color:sel?"#FFD700":unlocked?"#aaa":"#333",fontSize:11,fontWeight:sel?700:400}}>
                <div style={{fontSize:18}}>{d.icon}</div>
                <div style={{marginTop:2}}>{d.label}</div>
                {!unlocked&&unlockHint&&<div style={{fontSize:8,color:"#444",marginTop:3}}>Reach {unlockHint}</div>}
                {unlocked&&d.id!=="normal"&&<div style={{fontSize:8,color:"#888",marginTop:2}}>✓ Unlocked</div>}
              </button>
            );
          })}
        </div>
        <div style={{fontSize:10,color:"#666",textAlign:"center",marginTop:6,lineHeight:1.4}}>{dt.desc}</div>
        {diffTierId!=="normal"&&<div style={{fontSize:10,color:"#888",textAlign:"center",marginTop:2}}>Gold ×{dt.goldMult} · XP ×{dt.xpMult}</div>}
      </div>

      {save.totalXp>0&&<div style={{fontSize:11,color:"#555"}}>⭐{save.totalXp} XP · Best {formatTime(save.bestTime)}{save.bestLevel>0?` · Lv${save.bestLevel}`:""}</div>}
      <div style={{display:"flex",gap:10}}>
        <button onClick={onStart} style={{background:"linear-gradient(135deg,#FFD700,#FF8C00)",border:"none",borderRadius:14,padding:"16px 36px",fontSize:17,fontWeight:800,color:"#1a0a00",cursor:"pointer",boxShadow:"0 0 22px rgba(255,200,0,0.4)",minHeight:52}}>⚔️ SIEGE</button>
        <button onClick={onMeta} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.18)",borderRadius:14,padding:"16px 20px",fontSize:16,fontWeight:700,color:"#ddd",cursor:"pointer",minHeight:52}}>⭐ Research</button>
      </div>
    </div>
  );
}

function GameScreen({gs,tier,cellSize,onCellTap,onSelectTool,onClearTool,onPerkSelect,onRunUpgrade,onTowerUpgrade,onCloseTowerPanel,onToggleTowerList,onSpeedChange,onToggleShop,onToggleSettings,onSetSettingsTab,onAscend,onToggleAscensionModal,onRestart,onGoMeta,runResult}){
  if(gs.phase==="gameover")return<GameOverScreen gs={gs} tier={tier} runResult={runResult} onGoMeta={onGoMeta} onRestart={onRestart}/>;
  const stats=computeStats(gs);
  const level=calcRunLevel(gs.elapsed);
  return(
    <div style={{display:"flex",flexDirection:"column",width:"100%",maxWidth:520,padding:"0",minHeight:"100vh",position:"relative"}}>
      <div style={{padding:"6px 8px 0"}}>
        <TopHUD gs={gs} tier={tier} level={level} onToggleSettings={()=>{onSetSettingsTab("credits");onToggleSettings();}} onToggleAscensionModal={onToggleAscensionModal}/>
        <TierBadge gs={gs} tier={tier}/>
      </div>
      <Grid gs={gs} tier={tier} cellSize={cellSize} onCellTap={onCellTap}/>
      <div style={{padding:"0 8px"}}>
        <LiveStats gs={gs} stats={stats} level={level}/>
        <SpeedBar speedMult={gs.speedMult} onChange={onSpeedChange}/>
        <Toolbar gs={gs} tier={tier} onSelectTool={onSelectTool} onClearTool={onClearTool} onToggleShop={onToggleShop} onToggleTowerList={onToggleTowerList}/>
        <LogBar entries={gs.log}/>
      </div>
      {gs.showShop&&<ShopOverlay gs={gs} tier={tier} onBuy={onRunUpgrade} onClose={onToggleShop}/>}
      {gs.showTowerList&&!gs.showShop&&<TowerListPanel gs={gs} tier={tier} onUpgrade={onTowerUpgrade} onClose={onToggleTowerList}/>}
      {gs.showTowerPanel&&!gs.showShop&&!gs.showTowerList&&<TowerPanel gs={gs} tier={tier} onUpgrade={onTowerUpgrade} onClose={onCloseTowerPanel}/>}
      {gs.showUpgradeModal&&<PerkModal gs={gs} tier={tier} onSelect={onPerkSelect}/>}
      {gs.showAscensionModal&&<AscensionModal gs={gs} tier={tier} onAscend={onAscend} onClose={onToggleAscensionModal}/>}
      {gs.showSettings&&<SettingsOverlay gs={gs} tier={tier} onClose={onToggleSettings} onSetTab={onSetSettingsTab}/>}
    </div>
  );
}

function TopHUD({gs,tier,level,onToggleSettings,onToggleAscensionModal}){
  const heart=gs.cells[`${HEART_COL},${HEART_ROW}`];
  const hpPct=heart?heart.hp/heart.maxHp:0;
  const nextSec=Math.ceil(gs.upgradeTimer/1000);
  const urgent=nextSec<=12;
  const castLvl=gs.castleLevel||1;
  const canAscend=gs.unlockedAscensionIdx>gs.currentAscensionIdx;
  return(
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3,gap:4,flexWrap:"wrap"}}>
      <div style={{display:"flex",alignItems:"center",gap:5}}>
        <span style={{fontSize:14}}>❤️</span>
        <div style={{width:55,height:8,background:"#222",borderRadius:4,overflow:"hidden"}}><div style={{width:`${hpPct*100}%`,height:"100%",background:`hsl(${hpPct*120},75%,50%)`,transition:"width 0.3s"}}/></div>
        <span style={{fontSize:10,color:"#666"}}>{heart?.hp||0}</span>
      </div>
      <div style={{display:"flex",gap:7,alignItems:"center"}}>
        <span style={{fontSize:13,color:"#FFD700",fontWeight:700}}>💰{gs.gold}</span>
        {gs.passiveGoldRate>0&&<span style={{fontSize:10,color:"#888"}}>+{(gs.passiveGoldRate+(castLvl-1)*CASTLE_LVL_GOLD_BONUS).toFixed(1)}/s</span>}
        <span style={{fontSize:10,color:"#999"}}>⏱{formatTime(gs.elapsed)}</span>
        <span style={{fontSize:10,color:"#666"}}>☠️{gs.kills}</span>
      </div>
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        <div style={{fontSize:10,color:urgent?"#FFD700":"#444",padding:"2px 5px",borderRadius:4,border:urgent?"1px solid #FFD70033":"none"}}>🃏{nextSec}s</div>
        <div style={{fontSize:10,color:"#888",padding:"2px 6px",borderRadius:4,background:"rgba(255,215,0,0.06)",border:"1px solid #FFD70022"}}>🏰L{castLvl}</div>
        {canAscend&&(
          <button onClick={onToggleAscensionModal} style={{background:"rgba(138,63,170,0.2)",border:"1px solid #8B6FE8",borderRadius:5,color:"#8B6FE8",fontSize:10,padding:"2px 6px",cursor:"pointer",fontWeight:700,animation:"none"}}>✨ Ascend</button>
        )}
        <button onClick={onToggleSettings} style={{background:"none",border:"1px solid #222",borderRadius:5,color:"#444",fontSize:10,padding:"3px 7px",cursor:"pointer",minHeight:28}}>⚙️</button>
      </div>
    </div>
  );
}

function TierBadge({gs,tier}){
  const sec=gs.elapsed/1000;
  const currentIdx=gs.currentAscensionIdx;
  const nextTier=ASCENSION_TIERS[currentIdx+1];
  const unlockSec=nextTier?.minSec||0;
  const pct=nextTier?Math.min(1,sec/unlockSec):1;
  return(
    <div style={{textAlign:"center",marginBottom:2}}>
      <div style={{fontSize:10,color:tier.wallColor,letterSpacing:2,fontWeight:700,textTransform:"uppercase"}}>{tier.name}</div>
      {nextTier&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,marginTop:1}}>
          <div style={{width:65,height:3,background:"#1a1a1a",borderRadius:2,overflow:"hidden"}}><div style={{width:`${pct*100}%`,height:"100%",background:tier.wallColor,transition:"width 1s"}}/></div>
          <span style={{fontSize:9,color:"#444"}}>→{nextTier.name} ({nextTier.minSec}s)</span>
        </div>
      )}
    </div>
  );
}

// ─── CANVAS GRID — no gridlines, dynamic cell size ───
function Grid({gs,tier,cellSize,onCellTap}){
  const ref=useRef(null);
  const S=cellSize||20;const W=GRID_SIZE*S;

  useEffect(()=>{
    const cv=ref.current;if(!cv)return;
    const ctx=cv.getContext("2d");
    ctx.clearRect(0,0,W,W);

    // NO GRIDLINES — draw subtle alternating background tiles only
    for(let r=0;r<GRID_SIZE;r++)for(let c=0;c<GRID_SIZE;c++){
      ctx.fillStyle=(r+c)%2===0?"rgba(255,255,255,0.018)":"rgba(0,0,0,0.08)";
      ctx.fillRect(c*S,r*S,S,S);
    }

    // Buildable inner zone hint (1 tile around heart)
    const hc=HEART_COL,hr=HEART_ROW;
    for(let dc=-1;dc<=1;dc++)for(let dr=-1;dr<=1;dr++){
      if(dc===0&&dr===0)continue;const c=hc+dc,r=hr+dr;
      if(c>=0&&c<GRID_SIZE&&r>=0&&r<GRID_SIZE&&!gs.cells[`${c},${r}`]){
        ctx.fillStyle="rgba(255,255,120,0.05)";ctx.fillRect(c*S,r*S,S,S);
      }
    }

    // Structures
    for(const[key,cell]of Object.entries(gs.cells)){
      const[c,r]=key.split(",").map(Number);const x=c*S,y=r*S;
      if(cell.type==="heart"){
        ctx.fillStyle="#120600";ctx.fillRect(x,y,S,S);
        const hpPct=cell.hp/cell.maxHp;
        ctx.shadowColor=tier.heartColor;ctx.shadowBlur=5+hpPct*8;
        ctx.font=`${S*0.72}px serif`;ctx.textAlign="center";ctx.fillText("🏰",x+S/2,y+S*0.8);
        ctx.shadowBlur=0;
        hpBar(ctx,x,y+S-4,S,4,hpPct);
        if(gs.heartCd<=3){ctx.strokeStyle="rgba(255,70,100,0.7)";ctx.lineWidth=2;ctx.strokeRect(x+1,y+1,S-2,S-2);}
      }else if(cell.type==="wall"){
        const lvl=cell.level||1;
        const col=lvl>=3?lightenHex(tier.wallColor,0.35):lvl===2?tier.wallColor+"cc":tier.wallColor+"88";
        ctx.fillStyle=col;ctx.fillRect(x,y,S,S);
        ctx.fillStyle="rgba(255,255,255,0.14)";ctx.fillRect(x,y,S,3);
        const dp=1-cell.hp/cell.maxHp;
        if(dp>0.3){ctx.strokeStyle="rgba(0,0,0,0.45)";ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(x+2,y+3);ctx.lineTo(x+S-2,y+S-2);ctx.stroke();}
        if(lvl>=2){ctx.font=`${S*0.38}px sans-serif`;ctx.fillStyle="#fff";ctx.textAlign="center";ctx.fillText(`${lvl}`,x+S/2,y+S*0.52);}
        hpBar(ctx,x,y+S-4,S,4,cell.hp/cell.maxHp);
      }else if(cell.type==="tower"){
        const tdef=TOWER_TYPES[cell.towerType]||{};const tLvl=cell.towerLevel||1;
        ctx.fillStyle=tdef.color+"14";ctx.fillRect(x,y,S,S);
        const ba=Math.min(0.95,0.35+tLvl*0.14);
        ctx.strokeStyle=tdef.color+Math.round(ba*255).toString(16).padStart(2,"0");
        ctx.lineWidth=1.2+tLvl*0.2;ctx.strokeRect(x+0.5,y+0.5,S-1,S-1);
        ctx.font=`${S*0.6}px serif`;ctx.textAlign="center";ctx.fillText(tdef.icon||"🗼",x+S/2,y+S*0.74);
        if(tLvl>=2){ctx.font=`${S*0.32}px sans-serif`;ctx.fillStyle=tdef.color;ctx.textAlign="center";ctx.fillText(`L${tLvl}`,x+S/2,y+S-4);}
        hpBar(ctx,x,y+S-4,S,4,cell.hp/cell.maxHp);
        if(gs.selectedTowerKey===key){ctx.strokeStyle="#FFD700";ctx.lineWidth=2;ctx.strokeRect(x+1,y+1,S-2,S-2);}
        if(tLvl<TOWER_MAX_LEVEL){ctx.fillStyle="#FFD700";ctx.beginPath();ctx.arc(x+S-3,y+3,2.5,0,Math.PI*2);ctx.fill();}
      }
    }

    // Enemies
    for(const en of gs.enemies){
      if(en.hp<=0)continue;
      const edef=ENEMY_TYPES[en.type];const px=en.x*S,py=en.y*S;
      ctx.fillStyle="rgba(0,0,0,0.18)";ctx.beginPath();ctx.ellipse(px,py+3,S*0.3,S*0.13,0,0,Math.PI*2);ctx.fill();
      ctx.font=`${en.isBoss?S*1.1:S*0.68}px serif`;ctx.textAlign="center";ctx.fillText(edef.icon,px,py+(en.isBoss?S*0.52:S*0.3));
      const bw=en.isBoss?S*1.7:S*0.9;
      hpBar(ctx,px-bw/2,py-S*0.55,bw,en.isBoss?5:3,en.hp/en.maxHp,en.isBoss?"#ff00ff":edef.color);
    }

    // Projectiles
    for(const p of gs.projectiles){ctx.fillStyle=p.color+"cc";ctx.beginPath();ctx.arc(p.tx*S,p.ty*S,2.5,0,Math.PI*2);ctx.fill();}
  },[gs,tier,S,W]);

  return(
    <canvas ref={ref} width={W} height={W}
      style={{display:"block",width:"100%",height:"auto",cursor:"pointer",touchAction:"none"}}
      onClick={e=>{
        const rect=e.currentTarget.getBoundingClientRect();
        const scale=W/rect.width;
        const col=Math.floor((e.clientX-rect.left)*scale/S);
        const row=Math.floor((e.clientY-rect.top)*scale/S);
        if(col>=0&&col<GRID_SIZE&&row>=0&&row<GRID_SIZE)onCellTap(col,row);
      }}/>
  );
}

const hpBar=(ctx,x,y,w,h,pct,col)=>{ctx.fillStyle="rgba(0,0,0,0.5)";ctx.fillRect(x,y,w,h);ctx.fillStyle=col||`hsl(${clamp(pct,0,1)*120},75%,50%)`;ctx.fillRect(x,y,w*clamp(pct,0,1),h);};

function LiveStats({gs,stats,level}){
  const n=gs.enemies.length;const hasBoss=gs.enemies.some(e=>e.isBoss);
  const towers=Object.values(gs.cells).filter(c=>c.type==="tower").length;
  const walls=Object.values(gs.cells).filter(c=>c.type==="wall").length;
  const nxtT=LEVEL_TIME_THRESHOLDS[level]||null;
  const secL=nxtT?Math.max(0,Math.round(nxtT-gs.elapsed/1000)):null;
  return(
    <div style={{display:"flex",justifyContent:"center",gap:8,fontSize:10,color:"#555",margin:"3px 0",flexWrap:"wrap"}}>
      <span style={{color:"#888"}}>👾{n}</span>
      {hasBoss&&<span style={{color:"#ff00ff",fontWeight:700}}>👹BOSS!</span>}
      <span>🗼{towers}</span><span>🧱{walls}</span>
      <span style={{color:"#7CFC00"}}>⚡{stats.dps}/s</span>
      <span style={{color:"#FFD700"}}>💰{stats.gps}/s</span>
      <span style={{color:"#aaa",fontWeight:700}}>Lv{level}</span>
      {secL!==null&&<span style={{color:"#444"}}>→Lv{level+1} {secL}s</span>}
      {gs.wallRegenRate>0&&<span style={{color:"#4ecf8a"}}>🌿{gs.wallRegenRate}/s</span>}
    </div>
  );
}

function SpeedBar({speedMult,onChange}){
  return(
    <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:6,margin:"4px 0"}}>
      <span style={{fontSize:10,color:"#444"}}>Speed:</span>
      {[1,2,5].map(x=>(<button key={x} onClick={()=>onChange(x)} style={{background:speedMult===x?"rgba(255,215,0,0.14)":"rgba(255,255,255,0.05)",border:`1px solid ${speedMult===x?"#FFD700":"rgba(255,255,255,0.1)"}`,borderRadius:7,padding:"5px 16px",cursor:"pointer",color:speedMult===x?"#FFD700":"#666",fontSize:12,fontWeight:speedMult===x?800:400,minHeight:34}}>{x}×</button>))}
    </div>
  );
}

function Toolbar({gs,tier,onSelectTool,onClearTool,onToggleShop,onToggleTowerList}){
  const sel=gs.selected?.tool;
  const tools=[
    {id:"wall",    label:"Wall",    icon:"🧱",cost:WALL_COST},
    {id:"arrow",   label:"Arrow",   icon:"🏹",cost:30},
    {id:"cannon",  label:"Cannon",  icon:"💣",cost:60},
    {id:"ballista",label:"Ballista",icon:"⚡",cost:80},
    {id:"support", label:"Support", icon:"✨",cost:50},
    {id:"upgrade", label:"Wall+",   icon:"⬆️",cost:25},
    {id:"repair",  label:"Repair",  icon:"🔧",cost:REPAIR_COST},
    {id:"sell",    label:"Sell",    icon:"💸",cost:null},
  ];
  return(
    <div style={{marginTop:4}}>
      <div style={{display:"flex",gap:3,flexWrap:"wrap",justifyContent:"center",marginBottom:3}}>
        {tools.map(t=>{
          const can=t.cost===null||gs.gold>=t.cost;
          return(<button key={t.id} onClick={()=>onSelectTool(t.id)} style={{background:sel===t.id?tier.color:can?"rgba(255,255,255,0.07)":"rgba(255,255,255,0.02)",border:`1px solid ${sel===t.id?tier.wallColor:can?"rgba(255,255,255,0.12)":"rgba(255,255,255,0.03)"}`,borderRadius:7,padding:"5px 5px",cursor:"pointer",color:can?"#fff":"#3a3a3a",display:"flex",flexDirection:"column",alignItems:"center",gap:1,minWidth:40,fontSize:9,minHeight:52}}>
            <span style={{fontSize:16}}>{t.icon}</span>
            <span>{t.label}</span>
            {t.cost!==null&&<span style={{color:can?"#FFD700":"#3a2200",fontSize:8}}>💰{t.cost}</span>}
          </button>);
        })}
        <button onClick={onToggleTowerList} style={{background:gs.showTowerList?"rgba(0,191,255,0.18)":"rgba(255,255,255,0.05)",border:`1px solid ${gs.showTowerList?"#00BFFF":"rgba(255,255,255,0.1)"}`,borderRadius:7,padding:"5px 5px",cursor:"pointer",color:gs.showTowerList?"#00BFFF":"#fff",display:"flex",flexDirection:"column",alignItems:"center",gap:1,minWidth:40,fontSize:9,minHeight:52}}>
          <span style={{fontSize:16}}>⬆️</span><span>Upgrade</span><span style={{fontSize:8,color:gs.showTowerList?"#00BFFF":"#888"}}>Towers</span>
        </button>
        <button onClick={onToggleShop} style={{background:gs.showShop?"#102010":"rgba(255,255,255,0.05)",border:`1px solid ${gs.showShop?"#3a8a3a":"rgba(255,255,255,0.1)"}`,borderRadius:7,padding:"5px 5px",cursor:"pointer",color:"#fff",display:"flex",flexDirection:"column",alignItems:"center",gap:1,minWidth:40,fontSize:9,minHeight:52}}>
          <span style={{fontSize:16}}>🏪</span><span>Invest</span>
        </button>
      </div>
      <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:6,marginBottom:2}}>
        <div style={{fontSize:9,color:"#555",flex:1,textAlign:"center"}}>
          {!sel?"Tap tower 🟡 or heart to upgrade · Select tool then tap grid":
           sel==="sell"?"Tap structure to sell":
           sel==="repair"?"Tap damaged wall to repair":
           sel==="upgrade"?"Tap wall to upgrade HP (+60%, 💰25)":
           sel==="wall"?`Tap empty tile — wall 💰${WALL_COST}`:
           TOWER_TYPES[sel]?`Tap empty tile · ${TOWER_TYPES[sel].shortDesc}`:""}
        </div>
        {sel&&<button onClick={onClearTool} style={{background:"rgba(255,255,255,0.07)",border:"1px solid #333",borderRadius:5,padding:"3px 9px",color:"#aaa",fontSize:9,cursor:"pointer",minHeight:28}}>✕ Cancel</button>}
      </div>
    </div>
  );
}

function LogBar({entries}){
  return(<div style={{minHeight:22,marginBottom:3}}>
    {entries.slice().reverse().map((e,i)=>(<div key={i} style={{fontSize:9,color:`rgba(180,180,180,${1-i*0.28})`,textAlign:"center",lineHeight:1.4}}>{e}</div>))}
  </div>);
}

// ─── TOWER LIST PANEL — all placed towers with upgrade buttons ───
function TowerListPanel({gs,tier,onUpgrade,onClose}){
  const towers=Object.entries(gs.cells).filter(([,c])=>c.type==="tower");
  return(
    <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(5,3,12,0.98)",border:`1px solid #00BFFF44`,borderRadius:"14px 14px 0 0",padding:"12px 12px",zIndex:16,maxHeight:"55vh",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <span style={{fontWeight:800,fontSize:13,color:"#00BFFF"}}>⬆️ Upgrade Towers</span>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#444",fontSize:16,cursor:"pointer",minWidth:32,minHeight:32}}>✕</button>
      </div>
      {towers.length===0&&<div style={{textAlign:"center",color:"#555",fontSize:11,padding:"12px 0"}}>No towers placed yet.<br/>Place towers on the grid first.</div>}
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {towers.map(([key,cell])=>{
          const tdef=TOWER_TYPES[cell.towerType];if(!tdef)return null;
          const tLvl=cell.towerLevel||1;const maxed=tLvl>=TOWER_MAX_LEVEL;
          const cost=getTowerUpgradeCost(cell.towerType,tLvl);
          const canAfford=!maxed&&gs.gold>=cost;
          const[col,row]=key.split(",").map(Number);
          return(
            <div key={key} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,0.04)",borderRadius:9,padding:"8px 10px",border:`1px solid ${tdef.color}22`}}>
              <span style={{fontSize:22}}>{tdef.icon}</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:12,color:tdef.color}}>{tdef.label} <span style={{color:"#666",fontSize:10}}>({col},{row})</span></div>
                <div style={{display:"flex",gap:3,marginTop:3}}>
                  {Array.from({length:TOWER_MAX_LEVEL},(_,i)=>(<div key={i} style={{width:10,height:5,borderRadius:2,background:i<tLvl?tdef.color:"#1a1a1a"}}/>))}
                  <span style={{fontSize:9,color:"#555",marginLeft:4}}>Lv{tLvl}/{TOWER_MAX_LEVEL}</span>
                </div>
                {!maxed&&<div style={{fontSize:9,color:"#888",marginTop:2}}>Next: +{Math.round(TOWER_LVL_DMG_MULT*100)}% dmg, +{Math.round(TOWER_LVL_SPD_MULT*100)}% spd</div>}
              </div>
              {!maxed?(
                <button onClick={()=>canAfford&&onUpgrade(key)} style={{background:canAfford?`${tdef.color}22`:"rgba(255,255,255,0.02)",border:`1px solid ${canAfford?tdef.color+"66":"#222"}`,borderRadius:8,padding:"6px 10px",cursor:canAfford?"pointer":"default",color:canAfford?tdef.color:"#444",fontSize:10,fontWeight:700,minWidth:70,textAlign:"center",minHeight:38}}>
                  {canAfford?`💰${cost}`:`Need 💰${cost}`}
                </button>
              ):(
                <div style={{fontSize:10,color:tdef.color,minWidth:50,textAlign:"center",fontWeight:700}}>MAX ✓</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TOWER PANEL (tap-to-open) ───
function TowerPanel({gs,tier,onUpgrade,onClose}){
  const key=gs.selectedTowerKey;if(!key)return null;
  const isHeart=key==="heart";
  const castLvl=gs.castleLevel||1;

  if(isHeart){
    const cost=castLvl<CASTLE_RUN_MAX_LEVEL?CASTLE_RUN_COSTS[castLvl]:null;
    const canAfford=cost!==null&&gs.gold>=cost;
    const heart=gs.cells[`${HEART_COL},${HEART_ROW}`];
    return(
      <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(6,4,14,0.97)",border:`1px solid ${tier.heartColor}55`,borderRadius:"14px 14px 0 0",padding:"12px 14px",zIndex:15}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontWeight:800,fontSize:13,color:tier.heartColor}}>🏰 Fortress Heart — Lv{castLvl}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#444",fontSize:16,cursor:"pointer",minWidth:32,minHeight:32}}>✕</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,marginBottom:8}}>
          {[["❤️ HP",heart?.hp||0],["⚔️ Dmg",`+${Math.round((castLvl-1)*CASTLE_LVL_DMG_BONUS*100)}%`],["💰 /s",`+${((castLvl-1)*CASTLE_LVL_GOLD_BONUS).toFixed(1)}`]].map(([l,v])=>(
            <div key={l} style={{background:"rgba(255,255,255,0.05)",borderRadius:6,padding:"5px 8px",textAlign:"center"}}>
              <div style={{fontSize:9,color:"#666"}}>{l}</div><div style={{fontSize:12,color:"#ddd",fontWeight:700}}>{v}</div>
            </div>
          ))}
        </div>
        {cost!==null?(<>
          <div style={{fontSize:10,color:"#999",marginBottom:8}}>Lv{castLvl+1}: +{CASTLE_LVL_HP_BONUS}HP · +{Math.round(CASTLE_LVL_DMG_BONUS*100)}% dmg · +{CASTLE_LVL_GOLD_BONUS}/s gold</div>
          <button onClick={()=>onUpgrade("castle")} style={{width:"100%",background:canAfford?"linear-gradient(135deg,#FFD700,#FF8C00)":"rgba(255,255,255,0.04)",border:"none",borderRadius:10,padding:"12px",color:canAfford?"#1a0a00":"#444",fontWeight:800,fontSize:14,cursor:canAfford?"pointer":"default",minHeight:46}}>
            {canAfford?`⬆️ Level Up — 💰${cost}`:`💰${cost} required`}
          </button>
        </>):<div style={{textAlign:"center",fontSize:12,color:"#FFD700",padding:8}}>🏰 Castle at max level!</div>}
      </div>
    );
  }

  const cell=gs.cells[key];if(!cell||cell.type!=="tower")return null;
  const tdef=TOWER_TYPES[cell.towerType];if(!tdef)return null;
  const tLvl=cell.towerLevel||1;const maxed=tLvl>=TOWER_MAX_LEVEL;
  const cost=getTowerUpgradeCost(cell.towerType,tLvl);
  const canAfford=!maxed&&gs.gold>=cost;
  const curr=getTowerLevelStats(cell.towerType,tLvl);
  const next=maxed?curr:getTowerLevelStats(cell.towerType,tLvl+1);
  return(
    <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(6,4,14,0.97)",border:`1px solid ${tdef.color}44`,borderRadius:"14px 14px 0 0",padding:"12px 14px",zIndex:15}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <div style={{fontWeight:800,fontSize:13,color:tdef.color}}>{tdef.icon} {tdef.label} Tower — Lv{tLvl}</div>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#444",fontSize:16,cursor:"pointer",minWidth:32,minHeight:32}}>✕</button>
      </div>
      <div style={{display:"flex",gap:4,marginBottom:8}}>
        {Array.from({length:TOWER_MAX_LEVEL},(_,i)=>(<div key={i} style={{flex:1,height:4,borderRadius:2,background:i<tLvl?tdef.color:"#222"}}/>))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,marginBottom:8}}>
        {[["⚔️ DMG",`×${curr.dmgMult.toFixed(2)}`,maxed?null:`×${next.dmgMult.toFixed(2)}`],["⚡ SPD",`×${(1/curr.spdMult).toFixed(2)}`,maxed?null:`×${(1/next.spdMult).toFixed(2)}`],["📏 RNG",`+${curr.rangeBns.toFixed(1)}`,maxed?null:`+${next.rangeBns.toFixed(1)}`]].map(([l,cur,nxt])=>(
          <div key={l} style={{background:"rgba(255,255,255,0.05)",borderRadius:6,padding:"5px 6px",textAlign:"center"}}>
            <div style={{fontSize:9,color:"#666"}}>{l}</div>
            <div style={{fontSize:11,color:"#ccc",fontWeight:700}}>{cur}</div>
            {nxt&&<div style={{fontSize:9,color:tdef.color}}>→{nxt}</div>}
          </div>
        ))}
      </div>
      {!maxed?(
        <button onClick={()=>onUpgrade(key)} style={{width:"100%",background:canAfford?`linear-gradient(135deg,${tdef.color}88,${tdef.color}44)`:"rgba(255,255,255,0.03)",border:`1px solid ${canAfford?tdef.color+"66":"#222"}`,borderRadius:10,padding:"12px",color:canAfford?"#fff":"#444",fontWeight:800,fontSize:13,cursor:canAfford?"pointer":"default",minHeight:46}}>
          {canAfford?`⬆️ Lv${tLvl+1} — 💰${cost}`:`💰${cost} required`}
        </button>
      ):(
        <div style={{textAlign:"center",fontSize:12,color:tdef.color,padding:8,fontWeight:700}}>⭐ Max level!</div>
      )}
    </div>
  );
}

// ─── ASCENSION MODAL ───
function AscensionModal({gs,tier,onAscend,onClose}){
  const nextIdx=gs.currentAscensionIdx+1;
  const nextTier=ASCENSION_TIERS[nextIdx];
  const cost=ASCENSION_COSTS[gs.currentAscensionIdx]||0;
  const canAfford=gs.gold>=cost;
  const canAscend=nextIdx<=gs.unlockedAscensionIdx;
  if(!nextTier)return null;
  return(
    <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:22,padding:20}}>
      <div style={{background:"#0a0510",border:`2px solid ${nextTier.wallColor}`,borderRadius:16,padding:20,maxWidth:320,width:"100%",boxShadow:`0 0 40px ${nextTier.color}55`}}>
        <div style={{textAlign:"center",marginBottom:14}}>
          <div style={{fontSize:32}}>✨</div>
          <div style={{fontWeight:900,fontSize:16,color:nextTier.wallColor}}>Ascend to {nextTier.name}</div>
          <div style={{fontSize:10,color:"#777",marginTop:3}}>Unlocked by surviving {nextTier.minSec}s — pay gold to activate</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
          {[["🎨 Visual theme",nextTier.name],[`⚔️ Passive buff`,`+${Math.round(nextTier.passiveBuff*100)}% tower dmg`],["🌟 Permanence","Active until end of run"],["💰 Cost",`${cost} gold`]].map(([l,v])=>(
            <div key={l} style={{background:"rgba(255,255,255,0.05)",borderRadius:7,padding:"7px 9px"}}>
              <div style={{fontSize:9,color:"#666"}}>{l}</div>
              <div style={{fontSize:11,color:"#ccc",fontWeight:700,marginTop:2}}>{v}</div>
            </div>
          ))}
        </div>
        {!canAscend&&<div style={{textAlign:"center",fontSize:11,color:"#888",marginBottom:12}}>Survive to {nextTier.minSec}s to unlock this ascension.</div>}
        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid #333",borderRadius:10,padding:"12px",color:"#777",cursor:"pointer",fontSize:12}}>Not yet</button>
          <button onClick={onAscend} disabled={!canAscend||!canAfford} style={{flex:2,background:canAscend&&canAfford?`linear-gradient(135deg,${nextTier.color},${nextTier.wallColor})`:"rgba(255,255,255,0.03)",border:"none",borderRadius:10,padding:"12px",color:canAscend&&canAfford?"#fff":"#444",fontWeight:800,fontSize:14,cursor:canAscend&&canAfford?"pointer":"default"}}>
            {!canAscend?"Locked":!canAfford?`Need 💰${cost}`:`✨ Ascend — 💰${cost}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function PerkModal({gs,tier,onSelect}){
  return(
    <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.84)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:20,padding:16}}>
      <div style={{background:tier.bg,border:`2px solid ${tier.wallColor}`,borderRadius:16,padding:16,maxWidth:320,width:"100%",boxShadow:`0 0 30px ${tier.color}44`}}>
        <div style={{textAlign:"center",marginBottom:12}}>
          <div style={{fontSize:26}}>🃏</div>
          <div style={{fontWeight:900,fontSize:15,color:tier.wallColor}}>Choose a Perk</div>
          <div style={{fontSize:10,color:"#555",marginTop:2}}>Combat continues behind this panel</div>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {gs.rewardCards.map(card=>(<button key={card.id} onClick={()=>onSelect(card)} style={{background:"rgba(255,255,255,0.05)",border:`2px solid ${RARITY_COLOR[card.rarity]||"#444"}33`,borderRadius:10,padding:"11px 12px",cursor:"pointer",color:"#fff",display:"flex",gap:10,alignItems:"center",textAlign:"left",minHeight:52}}>
            <span style={{fontSize:22}}>{card.icon}</span>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:2}}>
                <span style={{fontWeight:800,fontSize:12,color:tier.wallColor}}>{card.label}</span>
                <span style={{fontSize:8,color:RARITY_COLOR[card.rarity],background:`${RARITY_COLOR[card.rarity]}18`,padding:"1px 5px",borderRadius:3,textTransform:"uppercase"}}>{card.rarity}</span>
              </div>
              <div style={{fontSize:10,color:"#bbb"}}>{card.desc}</div>
            </div>
          </button>))}
        </div>
        <div style={{textAlign:"center",fontSize:9,color:"#444",marginTop:8}}>{gs.perks.length} perks active</div>
      </div>
    </div>
  );
}

// ─── SHOP ───
function ShopOverlay({gs,tier,onBuy,onClose}){
  return(
    <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(6,4,14,0.98)",border:`1px solid ${tier.color}44`,borderRadius:"14px 14px 0 0",padding:"12px 12px",zIndex:10,maxHeight:"55vh",overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <span style={{fontWeight:800,fontSize:13,color:tier.wallColor}}>🏪 Run Investments</span>
        <span style={{fontSize:12,color:"#FFD700"}}>💰{gs.gold}</span>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#555",fontSize:16,cursor:"pointer",minWidth:32,minHeight:32}}>✕</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
        {RUN_UPGRADES.map(item=>{
          const count=gs.runUpgradeCounts?.[item.id]||0;
          const cost=getRunUpgradeCost(item,count);const can=gs.gold>=cost;
          return(<button key={item.id} onClick={()=>can&&onBuy(item)} style={{background:can?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.02)",border:`1px solid ${can?tier.color+"55":"#181818"}`,borderRadius:8,padding:"9px 10px",cursor:can?"pointer":"default",color:can?"#fff":"#2a2a2a",textAlign:"left",minHeight:72}}>
            <div style={{fontSize:16,marginBottom:2}}>{item.icon}</div>
            <div style={{fontWeight:700,fontSize:10}}>{item.label}</div>
            <div style={{fontSize:9,color:can?"#888":"#333",marginTop:1}}>{item.desc}</div>
            <div style={{fontSize:10,color:can?"#FFD700":"#442200",marginTop:3}}>💰{cost}{count>0?` (×${count+1})`:""}</div>
          </button>);
        })}
      </div>
    </div>
  );
}

function SettingsOverlay({gs,tier,onClose,onSetTab}){
  const tab=gs.settingsTab||"credits";
  return(
    <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.95)",display:"flex",flexDirection:"column",zIndex:30,overflowY:"auto"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",borderBottom:"1px solid #181818"}}>
        <div style={{display:"flex",gap:5}}>
          {[["credits","📜 Credits"],["encyclopedia","📖 Guide"]].map(([id,lbl])=>(<button key={id} onClick={()=>onSetTab(id)} style={{background:tab===id?tier.color+"33":"none",border:`1px solid ${tab===id?tier.wallColor:"#222"}`,borderRadius:7,padding:"7px 12px",cursor:"pointer",color:tab===id?tier.wallColor:"#555",fontSize:11,minHeight:36}}>{lbl}</button>))}
        </div>
        <button onClick={onClose} style={{background:"none",border:"1px solid #2a2a2a",borderRadius:6,color:"#666",padding:"6px 12px",cursor:"pointer",fontSize:11,minHeight:36}}>Close</button>
      </div>
      <div style={{padding:"12px 14px",flex:1,overflowY:"auto"}}>
        {tab==="credits"&&<CreditsPanel/>}
        {tab==="encyclopedia"&&<EncyclopediaPanel/>}
      </div>
    </div>
  );
}

const CREDITS_DATA=[
  {cat:"Game Code",items:[{name:"Mythic Fortress: Idle Siege v8",author:"Original",license:"N/A",url:null}]},
  {cat:"Active Visual Assets — Current Build",items:[
    {name:"All in-game icons (emoji)",author:"Unicode / OS platform font",license:"Platform terms — not standalone assets",url:null},
    {name:"STATUS: Development placeholders only",author:"Replace with OGA sprites before production release",license:"N/A",url:null},
  ]},
  {cat:"Planned Assets (not yet integrated — OGA verified)",items:[
    {name:"Castle Tiles for RPGs",author:"Hyptosis",license:"CC-BY 3.0",url:"https://opengameart.org/content/castle-tiles-for-rpgs"},
    {name:"Fantasy Tower Defense Pack",author:"bevouliin",license:"CC0",url:"https://opengameart.org/content/fantasy-tower-defense"},
    {name:"Tower Defense Graphics",author:"Clint Bellanger",license:"CC-BY 3.0",url:"https://opengameart.org/content/tower-defense-graphics"},
    {name:"Tiny 16: Basic (enemies)",author:"Lanea Zimmermann (Sharm)",license:"CC-BY 3.0",url:"https://opengameart.org/content/tiny-16-basic"},
    {name:"RPG Enemies — 11 Creatures",author:"Skorpio",license:"CC-BY-SA 3.0",url:"https://opengameart.org/content/rpg-enemies-11-creatures"},
    {name:"Gold Coin sprite",author:"qubodup",license:"CC0",url:"https://opengameart.org/content/gold-coin-0"},
    {name:"Battle Theme A (music)",author:"cynicmusic",license:"CC0",url:"https://opengameart.org/content/battle-theme-a"},
    {name:"Arrow Impact SFX",author:"Michel Baradari",license:"CC0",url:"https://opengameart.org/content/arrow-impact"},
  ]},
];
function CreditsPanel(){return(<div>{CREDITS_DATA.map(s=>(<div key={s.cat} style={{marginBottom:14}}><div style={{fontSize:9,color:"#444",letterSpacing:1,textTransform:"uppercase",marginBottom:5,borderBottom:"1px solid #141414",paddingBottom:3}}>{s.cat}</div>{s.items.map(item=>(<div key={item.name} style={{background:"rgba(255,255,255,0.025)",borderRadius:6,padding:"6px 10px",marginBottom:4}}><div style={{fontSize:11,color:"#ccc",fontWeight:600}}>{item.name}</div><div style={{fontSize:9,color:"#555",marginTop:1}}>By {item.author} · {item.license}</div>{item.url&&<a href={item.url} target="_blank" rel="noopener noreferrer" style={{fontSize:9,color:"#4a7aaa",display:"block",marginTop:2}}>🔗 {item.url.slice(8,55)}…</a>}</div>))}</div>))}</div>);}

const ENCYCLOPEDIA=[
  {section:"⚔️ Towers & Upgrades",entries:[...Object.entries(TOWER_TYPES).map(([,t])=>({name:`${t.icon} ${t.label}`,stats:`Cost:💰${t.cost} · DMG:${t.dmg||"—"} · Range:${t.range} · CD:${t.speed||"—"}`,body:t.fullDesc})),{name:"🏰 Fortress Heart",stats:`DMG:${HEART_TOWER.dmg} · Range:${HEART_TOWER.range} · CD:${HEART_TOWER.speed}`,body:"Auto-attacks nearby enemies. Tap the heart to level it up. Scales with castle level."},{name:"⬆️ How to Upgrade Towers",stats:`Lv1–${TOWER_MAX_LEVEL}`,body:`Tap any tower without a tool selected to open its upgrade panel, OR use the ⬆️ Upgrade Towers button in the toolbar to see all towers at once. Each level adds +${Math.round(TOWER_LVL_DMG_MULT*100)}% damage, +${Math.round(TOWER_LVL_SPD_MULT*100)}% speed, +${TOWER_LVL_RNG_BONUS} range. A gold dot marks towers that can still be upgraded.`}]},
  {section:"🏰 Castle & Ascension",entries:[{name:"Castle Leveling (Gold)",stats:`Lv1–${CASTLE_RUN_MAX_LEVEL}`,body:`Tap the heart to spend gold leveling the castle. Each level: +${CASTLE_LVL_HP_BONUS}HP, +${Math.round(CASTLE_LVL_DMG_BONUS*100)}% global dmg, +${CASTLE_LVL_GOLD_BONUS} gold/sec. Costs: ${CASTLE_RUN_COSTS.slice(1).join("→")} gold.`},{name:"✨ Mythic Ascension (Player Choice)",stats:"4 tiers, gold-activated",body:`Ascension tiers are UNLOCKED by survival time but must be ACTIVATED by you with gold. Tap ✨ Ascend when the button appears in the HUD. Each tier changes the visual theme and grants a passive damage bonus to all towers. Ascension costs: ${ASCENSION_COSTS.join("→")} gold per tier.`}]},
  {section:"🌿 Wall Regeneration",entries:[{name:"Living Stone (Research)",stats:`Cap ${WALL_REGEN_MAX_PCT*100}% of max HP`,body:"Research in Citadel. Walls slowly recover HP over time, capped at 30% of max. Repair is still needed above the cap. Rate shown as 🌿X/s in the status bar."}]},
  {section:"👾 Enemies",entries:Object.entries(ENEMY_TYPES).map(([,e])=>({name:`${e.icon} ${e.label}`,stats:`HP:${e.hp} · Speed:${e.spd}c/s · DMG:${e.dmg} · Gold:${e.gold}`,body:e.fullDesc}))},
  {section:"🔓 Difficulty Unlocks",entries:[{name:"How Difficulties Unlock",stats:"Level-based",body:`Hard unlocks when you reach Level ${HARD_UNLOCK_LEVEL} on Normal. Nightmare unlocks when you reach Level ${NIGHTMARE_UNLOCK_LEVEL} on Hard. Each difficulty also grants higher gold and XP multipliers.`},{name:"Level System",stats:"Levels 1–10",body:`Your run level is based on survival time. L1(0s)→L2(30s)→L3(60s)→L4(90s)→L5(120s)→L6(150s)→L7(180s)→L8(225s)→L9(270s)→L10(330s). Level 10 = difficulty mastered.`}]},
  {section:"🏪 Run Investments",entries:RUN_UPGRADES.map(u=>({name:`${u.icon} ${u.label}`,stats:`Base: 💰${u.baseCost} · Scale: ×${u.costScale}`,body:u.desc+" Cost increases with each purchase."}))},
  {section:"💰 Gold & ⭐ XP",entries:[{name:"💰 Gold",stats:"Run currency",body:`Start: ${GOLD_START}+perks. Kill mult: ×${GOLD_KILL_MULT}. Earned from kills, passive income, castle level.`},{name:"⭐ XP",stats:"Permanent",body:`Formula: (sec×${XP_PER_SEC})+(kills×${XP_PER_KILL})+(bosses×${XP_PER_BOSS})+(tier×${XP_PER_TIER}). Min ${XP_MIN_RUN} XP per run.`}]},
  {section:"🏰 Castle Upgrades",entries:CASTLE_UPGRADES.map(u=>({name:`${u.icon} ${u.label}`,stats:`Max Lv${u.maxLevel} · ⭐${u.baseCost}`,body:u.desc}))},
  {section:"🔬 Research",entries:RESEARCH_UPGRADES.map(u=>({name:`${u.icon} ${u.label}`,stats:`Max Lv${u.maxLevel} · ⭐${u.baseCost}`,body:u.desc}))},
];
function EncyclopediaPanel(){
  const[os,setOs]=useState(null);const[oe,setOe]=useState(null);
  return(<div>{ENCYCLOPEDIA.map(sec=>(<div key={sec.section} style={{marginBottom:6}}>
    <button onClick={()=>setOs(os===sec.section?null:sec.section)} style={{width:"100%",background:"rgba(255,255,255,0.04)",border:"1px solid #1e1e1e",borderRadius:8,padding:"10px 12px",cursor:"pointer",color:"#bbb",display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:700,minHeight:42}}>
      <span>{sec.section}</span><span style={{color:"#333"}}>{os===sec.section?"▲":"▼"}</span>
    </button>
    {os===sec.section&&(<div style={{paddingLeft:8,marginTop:3}}>{sec.entries.map(e=>(<div key={e.name} style={{marginBottom:3}}>
      <button onClick={()=>setOe(oe===e.name?null:e.name)} style={{width:"100%",background:"rgba(255,255,255,0.02)",border:"1px solid #141414",borderRadius:6,padding:"8px 10px",cursor:"pointer",color:"#999",textAlign:"left",fontSize:11,minHeight:36}}>{e.name}</button>
      {oe===e.name&&(<div style={{background:"rgba(255,255,255,0.015)",borderRadius:"0 0 6px 6px",padding:"8px 10px",border:"1px solid #101010",borderTop:"none"}}>
        <div style={{fontSize:9,color:"#666",fontFamily:"monospace",marginBottom:4}}>{e.stats}</div>
        <div style={{fontSize:11,color:"#bbb",lineHeight:1.6}}>{e.body}</div>
      </div>)}
    </div>))}</div>)}
  </div>))}</div>);
}

function MetaScreen({save,onUpgrade,onStart,onMenu,runResult,buyMult,onSetBuyMult,onReset}){
  const[tab,setTab]=useState("castle");
  return(<div style={{display:"flex",flexDirection:"column",width:"100%",maxWidth:480,minHeight:"100vh",background:"radial-gradient(ellipse at 50% 10%, #0d0820 0%, #050508 70%)",padding:"12px 12px 24px"}}>
    <div style={{textAlign:"center",marginBottom:8}}>
      <div style={{fontSize:24}}>⭐</div>
      <div style={{fontWeight:900,fontSize:18,color:"#FFD700"}}>Citadel Research</div>
      <div style={{fontSize:11,color:"#777",marginTop:1}}>Permanent upgrades between runs</div>
      <div style={{fontSize:14,color:"#FFD700",marginTop:5,fontWeight:700}}>⭐ {save.totalXp} XP</div>
    </div>
    {runResult&&(<div style={{background:"rgba(255,215,0,0.05)",border:"1px solid #FFD70020",borderRadius:9,padding:"8px 12px",marginBottom:8,textAlign:"center"}}>
      <div style={{fontSize:12,color:"#FFD700",fontWeight:700}}>Last run: +{runResult.xpEarned} XP · Lv{runResult.runLevel}</div>
      <div style={{fontSize:10,color:"#666",marginTop:2}}>{formatTime(runResult.gs.elapsed)} · {runResult.gs.kills} kills · {runResult.gs.bossKills} bosses</div>
    </div>)}
    <div style={{display:"flex",gap:5,marginBottom:8,justifyContent:"center",flexWrap:"wrap"}}>
      {[["Best","⏱",formatTime(save.bestTime)],["Kills","☠️",save.lifetimeKills],["Bosses","👹",save.lifetimeBosses],["Lv","🏆",save.bestLevel||1]].map(([l,i,v])=>(<div key={l} style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"6px 10px",textAlign:"center",minWidth:62}}><div style={{fontSize:9,color:"#444"}}>{i} {l}</div><div style={{fontSize:11,color:"#ccc",fontWeight:700}}>{v}</div></div>))}
    </div>
    {/* Difficulty unlock status */}
    <div style={{background:"rgba(255,255,255,0.02)",borderRadius:8,padding:"7px 10px",marginBottom:8}}>
      <div style={{fontSize:9,color:"#555",marginBottom:5,letterSpacing:1,textTransform:"uppercase"}}>Difficulty Progress</div>
      {DIFFICULTY_TIERS.filter(d=>d.unlockCondition).map(d=>{
        const uc=d.unlockCondition;const curLvl=save.bestLevelByDiff?.[uc.difficulty]||0;const unlocked=isDifficultyUnlocked(d.id,save);
        return(<div key={d.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
          <span style={{fontSize:14}}>{d.icon}</span>
          <div style={{flex:1}}><div style={{fontSize:10,color:unlocked?"#aaa":"#555",fontWeight:unlocked?700:400}}>{d.label} {unlocked?"✓ Unlocked":""}</div>
          {!unlocked&&<div style={{fontSize:9,color:"#444"}}>{uc.difficulty.charAt(0).toUpperCase()+uc.difficulty.slice(1)} Lv{curLvl}/{uc.minLevel}</div>}</div>
          {!unlocked&&<div style={{width:60,height:4,background:"#1a1a1a",borderRadius:2,overflow:"hidden"}}><div style={{width:`${Math.min(1,curLvl/uc.minLevel)*100}%`,height:"100%",background:"#5a3faa"}}/></div>}
        </div>);
      })}
    </div>
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,marginBottom:8}}>
      <span style={{fontSize:10,color:"#555"}}>Buy:</span>
      {[1,5,10,"max"].map(m=>(<button key={m} onClick={()=>onSetBuyMult(m)} style={{background:buyMult===m?"rgba(255,215,0,0.1)":"rgba(255,255,255,0.04)",border:`1px solid ${buyMult===m?"#FFD70044":"#1a1a1a"}`,borderRadius:6,padding:"5px 10px",cursor:"pointer",color:buyMult===m?"#FFD700":"#666",fontSize:10,fontWeight:buyMult===m?700:400,minHeight:32}}>{m==="max"?"MAX":m===1?"×1":`×${m}`}</button>))}
    </div>
    <div style={{display:"flex",gap:5,marginBottom:8}}>
      {[["castle","🏰 Castle"],["research","🔬 Research"]].map(([id,lbl])=>(<button key={id} onClick={()=>setTab(id)} style={{flex:1,background:tab===id?"rgba(255,215,0,0.08)":"rgba(255,255,255,0.03)",border:`1px solid ${tab===id?"#FFD70044":"#161616"}`,borderRadius:8,padding:"9px",cursor:"pointer",color:tab===id?"#FFD700":"#666",fontSize:12,fontWeight:tab===id?700:400,minHeight:42}}>{lbl}</button>))}
    </div>
    <div style={{flex:1,overflowY:"auto"}}>
      {(tab==="castle"?CASTLE_UPGRADES:RESEARCH_UPGRADES).map(upg=>{
        const uk=tab==="castle"?"castleUpgrades":"researchUpgrades";const cur=save[uk]?.[upg.id]||0;const maxed=cur>=upg.maxLevel;
        let pl=0,pc=0;
        if(!maxed){const times=buyMult==="max"?upg.maxLevel-cur:Math.min(Number(buyMult),upg.maxLevel-cur);let xp=save.totalXp,lvl=cur;for(let i=0;i<times;i++){const c=getUpgradeCost(upg,lvl);if(xp<c)break;xp-=c;lvl++;pl++;pc+=c;}}
        const ca=!maxed&&pl>0;
        return(<div key={upg.id} style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${maxed?"#FFD70022":"#111"}`,borderRadius:10,padding:"10px 12px",marginBottom:6,display:"flex",gap:8,alignItems:"center"}}>
          <div style={{fontSize:20,minWidth:26,textAlign:"center"}}>{upg.icon}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:12,fontWeight:700,color:maxed?"#FFD700":"#ccc"}}>{upg.label}</div>
            <div style={{fontSize:10,color:"#555",marginTop:1,lineHeight:1.3}}>{upg.desc}</div>
            <div style={{display:"flex",gap:3,marginTop:4}}>{Array.from({length:upg.maxLevel},(_,i)=>(<div key={i} style={{width:10,height:10,borderRadius:3,background:i<cur?"#FFD700":"#181818",border:"1px solid #222"}}/>))}<span style={{fontSize:9,color:"#444",marginLeft:3}}>Lv{cur}/{upg.maxLevel}</span></div>
          </div>
          {!maxed?(<button onClick={()=>ca&&onUpgrade(tab,upg.id,buyMult)} style={{background:ca?"rgba(255,215,0,0.1)":"rgba(255,255,255,0.02)",border:`1px solid ${ca?"#FFD70033":"#1a1a1a"}`,borderRadius:8,padding:"6px 10px",cursor:ca?"pointer":"default",color:ca?"#FFD700":"#333",fontSize:10,fontWeight:700,minWidth:56,textAlign:"center",minHeight:44}}>
            {ca?<><div>⭐{pc}</div>{pl>1&&<div style={{fontSize:8,color:"#aaa"}}>×{pl}</div>}</>:<div style={{fontSize:9}}>⭐{getUpgradeCost(upg,cur)}</div>}
          </button>):(<div style={{fontSize:10,color:"#FFD700",minWidth:42,textAlign:"center"}}>MAX✓</div>)}
        </div>);
      })}
    </div>
    <div style={{display:"flex",gap:8,marginTop:12}}>
      <button onClick={onMenu} style={{flex:1,background:"rgba(255,255,255,0.04)",border:"1px solid #1a1a1a",borderRadius:10,padding:"12px",color:"#666",cursor:"pointer",fontSize:12,minHeight:46}}>← Menu</button>
      <button onClick={onStart} style={{flex:2,background:"linear-gradient(135deg,#FFD700,#FF8C00)",border:"none",borderRadius:10,padding:"12px",color:"#1a0a00",fontSize:14,fontWeight:800,cursor:"pointer",minHeight:46}}>⚔️ New Run</button>
    </div>
    <button onClick={onReset} style={{marginTop:8,background:"none",border:"1px solid #2a0a0a",borderRadius:8,padding:"8px",color:"#554444",cursor:"pointer",fontSize:10,width:"100%"}}>⚠️ Reset Save Data</button>
  </div>);
}

function GameOverScreen({gs,tier,runResult,onGoMeta,onRestart}){
  const[tab,setTab]=useState("summary");
  const xp=runResult?.xpEarned||0;const level=runResult?.runLevel||calcRunLevel(gs.elapsed);
  const analysis=runResult?.analysis||buildFailureAnalysis(gs);
  return(<div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",padding:"20px 16px",background:"radial-gradient(ellipse at 50% 20%, #2a0505 0%, #060606 70%)"}}>
    <div style={{fontSize:48,marginBottom:4}}>💀</div>
    <h1 style={{margin:0,fontSize:24,color:"#e74c3c",fontWeight:900,letterSpacing:2}}>FORTRESS FALLEN</h1>
    <div style={{color:"#555",fontSize:11,marginBottom:12}}>{tier.name} · Level {level} · {formatTime(gs.elapsed)}</div>
    <div style={{display:"flex",gap:5,marginBottom:10,width:"100%",maxWidth:320}}>
      {[["summary","📊 Summary"],["analysis","🔍 Analysis"]].map(([id,lbl])=>(<button key={id} onClick={()=>setTab(id)} style={{flex:1,background:tab===id?"rgba(231,76,60,0.12)":"rgba(255,255,255,0.04)",border:`1px solid ${tab===id?"#e74c3c55":"#1a1a1a"}`,borderRadius:8,padding:"8px",cursor:"pointer",color:tab===id?"#e74c3c":"#666",fontSize:11,fontWeight:tab===id?700:400,minHeight:38}}>{lbl}</button>))}
    </div>
    {tab==="summary"&&(<div style={{background:"rgba(255,255,255,0.03)",borderRadius:12,padding:"14px 20px",border:"1px solid rgba(255,255,255,0.06)",width:"100%",maxWidth:300,marginBottom:12}}>
      {[["⏱ Time",formatTime(gs.elapsed)],["🏆 Level",`${level}/10`],["☠️ Kills",gs.kills],["👹 Bosses",gs.bossKills],["🌟 Tier",tier.name],["🏰 Castle",`Lv${gs.castleLevel||1}`],["🃏 Perks",gs.perks.length],["💰 Earned",gs.totalGoldEarned],["⭐ XP",`+${xp}`]].map(([l,v])=>(<div key={l} style={{display:"flex",justifyContent:"space-between",gap:16,marginBottom:6,fontSize:12}}><span style={{color:"#555"}}>{l}</span><span style={{color:String(l).includes("XP")?"#FFD700":"#ccc",fontWeight:700}}>{v}</span></div>))}
    </div>)}
    {tab==="analysis"&&(<div style={{width:"100%",maxWidth:320,marginBottom:12,display:"flex",flexDirection:"column",gap:8}}>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"10px 14px",border:"1px solid #161616"}}>
        <div style={{fontSize:11,color:"#e74c3c",fontWeight:700,marginBottom:5}}>⚠️ Primary Threat</div>
        {analysis.worstType?(<><div style={{fontSize:13,color:"#ddd"}}>{ENEMY_TYPES[analysis.worstType]?.icon} {ENEMY_TYPES[analysis.worstType]?.label}</div><div style={{fontSize:10,color:"#666",marginTop:2}}>{analysis.worstDmg} total damage</div></>):<div style={{fontSize:10,color:"#555"}}>No data</div>}
      </div>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"10px 14px",border:"1px solid #161616"}}>
        <div style={{fontSize:11,color:"#aaa",fontWeight:700,marginBottom:5}}>📊 Damage Breakdown</div>
        {[["🧱 Walls",gs.totalWallDmg],["❤️ Heart",gs.totalHeartDmg]].map(([l,v])=>(<div key={l} style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:4}}><span style={{color:"#666"}}>{l}</span><span style={{color:"#bbb",fontWeight:700}}>{v} dmg</span></div>))}
        {gs.firstWallBroken&&<div style={{fontSize:10,color:"#555",marginTop:4}}>First wall at {formatTime(gs.firstWallBroken.time)}</div>}
      </div>
      <div style={{background:"rgba(255,255,255,0.03)",borderRadius:10,padding:"10px 14px",border:"1px solid #161616"}}>
        <div style={{fontSize:11,color:"#4ecf8a",fontWeight:700,marginBottom:5}}>💡 Suggestions</div>
        {analysis.suggestions.map((s,i)=>(<div key={i} style={{fontSize:11,color:"#888",marginBottom:5,lineHeight:1.4,paddingLeft:8,borderLeft:"2px solid #4ecf8a33"}}>→ {s}</div>))}
      </div>
    </div>)}
    <div style={{display:"flex",gap:8}}>
      <button onClick={onRestart} style={{background:"linear-gradient(135deg,#e74c3c,#c0392b)",border:"none",borderRadius:12,padding:"14px 26px",fontSize:14,fontWeight:800,color:"#fff",cursor:"pointer",minHeight:50}}>⚔️ Again</button>
      <button onClick={onGoMeta} style={{background:"rgba(255,215,0,0.1)",border:"1px solid #FFD70044",borderRadius:12,padding:"14px 26px",fontSize:14,fontWeight:800,color:"#FFD700",cursor:"pointer",minHeight:50}}>⭐ Research</button>
    </div>
  </div>);
}

function formatTime(ms){const s=Math.floor(ms/1000);return`${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;}
