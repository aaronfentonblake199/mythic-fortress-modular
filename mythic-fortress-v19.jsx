import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const SAVE_VERSION  = 14;
const SAVE_KEY      = "mf_idle_v19";

const GRID_SIZE     = 65;
const HEART_COL     = 32;
const HEART_ROW     = 32;
const BASE_TICK     = 80;
const SEC_PER_TICK  = BASE_TICK / 1000;

// ─── PHASE 2 BALANCE ──────────────────────────────────────────────
// Target pacing:
//   0–30s:  First decision. Place 1 arrow tower + fill wall gaps.
//   60–90s: First fortress upgrade affordable. Choose: upgrade vs more towers.
//  90–150s: First boss at 90s. Pressure spike. Cannon becomes essential.
// 150–300s: Keep Lv3. Strategic trade-offs between upgrade, repair, economy.
// 300–420s: Keep Lv4/5. Late-game pressure. Ascension unlocks.

// Difficulty scaling — gentler in first 3 minutes, steeper afterwards
const DIFF_HP_RATE  = 0.07;   // HP growth per minute (log-scaled)
const DIFF_DMG_RATE = 0.045;  // Damage growth per minute
const diffCurve = ms => {
  const min = ms / 60000;
  const lf  = 1 + Math.log1p(min) * 0.40;
  return { hpScale:1+min*DIFF_HP_RATE*lf, dmgScale:1+min*DIFF_DMG_RATE*lf };
};
// Spawn rate: slow opening (4.5s gaps) → fast late (0.7s gaps)
// Decay is steeper so pressure builds noticeably around 60–90s
const SPAWN_RATE_MIN   = 700;   // ms between spawns at peak
const SPAWN_RATE_MAX   = 4500;  // ms between spawns at start (1 enemy every 4.5s)
const SPAWN_RATE_DECAY = 10;    // ms² drop per second elapsed
const PERK_INTERVAL    = 120000; // perk card every 120s (2 minutes)

const XP_PER_SEC  = 0.8;
const XP_PER_KILL = 3;
const XP_PER_BOSS = 30;
const XP_PER_TIER = 50;
const XP_MIN_RUN  = 20;

// ─── PHASE 2 BALANCE — Economy & Costs ──────────────────────────
// Starting gold: 130 — forces a real opening decision.
// Kill gold mult 1.5: a raider kill (~7 base) → 10–11 gold.
// Walls cost 18: affordable for defensive layers, not mandatory spam.
// Wall HP 110: survives ~3 raider hits before repair is needed.
// Repair cost 8: viable ongoing maintenance strategy.
const GOLD_START       = 130;
const GOLD_KILL_MULT   = 1.5;
const WALL_COST        = 18;
const WALL_HP_BASE     = 110;
const REPAIR_COST      = 8;

const LEVEL_TIME_THRESHOLDS  = [0,30,60,90,120,150,180,225,270,330,400];
const HARD_UNLOCK_LEVEL      = 7;
const NIGHTMARE_UNLOCK_LEVEL = 7;

// Tower per-instance upgrades — punchier at each level
const TOWER_MAX_LEVEL     = 5;
const TOWER_UPGRADE_BASE  = { arrow:22, cannon:40, ballista:55, support:32 };
const TOWER_UPGRADE_SCALE = 1.6;
const TOWER_LVL_DMG_MULT  = 0.28;  // +28% damage per level — very punchier
const TOWER_LVL_SPD_MULT  = 0.10;
const TOWER_LVL_RNG_BONUS = 0.3;

// Wall regen (unchanged)
const WALL_REGEN_PER_LEVEL = 1.5;
const WALL_REGEN_MAX_PCT   = 0.30;

// Keep upgrade costs — escalating curve designed so Lv2 is a meaningful early investment:
//   Lv2: ~2 min (save up while building towers)
//   Lv3: ~4–5 min (earned after sustained play)
//   Lv4–10: increasingly expensive strategic gate
const CASTLE_RUN_MAX_LEVEL  = 10;
const CASTLE_RUN_COSTS      = [0, 120, 260, 475, 750, 1100, 1600, 2200, 3000, 4000, 5500];
const CASTLE_LVL_HP_BONUS   = 60;
const CASTLE_LVL_GOLD_BONUS = 0.7;

// Ascension (gold cost per tier transition)
const ASCENSION_COSTS = [0, 90, 180, 320]; // was [0,100,200,350] — slightly more accessible

// ─── RADIUS SYSTEMS (three independent concerns) ─────────────────
//
// 1. BUILD RADIUS — per keep level (KEEP_BLUEPRINTS.buildRadius).
//    Player can only place structures within this Chebyshev radius.
//
// 2. CAMERA / VIEW RADIUS — tied to Keep level. NOT to tower range.
//    Placing Ballista or buying range upgrades must NOT zoom out the map.
//    Minimum tile size is preserved for mobile playability.
//    VIEW_RADIUS_BY_LEVEL[keepLevel-1] is the view floor for that level.
//    unlockedViewRadius starts at level 1 floor and only ever increases when
//    the Keep upgrades. Destroying walls/towers never shrinks the view.
const VIEW_RADIUS_BY_LEVEL = [7, 9, 11, 13, 15, 15, 16, 16, 17, 17];  // keep Lv 1–10
const ZOOM_MIN_RADIUS = 7;    // absolute minimum view radius (Lv1 start)
const ZOOM_MAX_RADIUS = 16;   // hard cap — prevents tiles becoming unplayably small
const ZOOM_SPEED      = 0.04; // smooth lerp per render frame
//
// 3. SPAWN DISTANCE — tied to attack range + fortress perimeter, NOT to camera.
//    Enemies spawn outside: fortressOuterRadius + MAX_EFFECTIVE_RANGE + SPAWN_PADDING.
//    It is acceptable and expected for spawns to be off-screen; enemies will
//    enter view well before reaching the walls.
//
// MAX_EFFECTIVE_RANGE: hard design cap on combat range used in spawning and in combat.
// Ballista+research can exceed this but it is clamped here for all purposes.
// Keeps spawn logic simple and prevents design explosion.
const MAX_EFFECTIVE_RANGE = 14;  // tiles — same as Ballista base range
const SPAWN_PADDING       = 3;   // tiles of buffer beyond max range

// Run investments (shop)
const RUN_UPGRADES = [
  { id:"run_dmg",    label:"Forge Boost",   icon:"⚔️", baseCost:40, costScale:1.5, desc:"+10% all tower dmg",        action:"boostDmg"    },
  { id:"run_spd",    label:"Oil Gears",      icon:"⚡", baseCost:40, costScale:1.5, desc:"+10% attack speed",          action:"boostSpd"    },
  { id:"run_gold",   label:"Tax Collector",  icon:"💰", baseCost:55, costScale:1.6, desc:"+3 gold/sec passive",        action:"goldIncome"  },
  { id:"run_range",  label:"Eagle Sight",    icon:"👁️", baseCost:50, costScale:1.5, desc:"+1 tile range all towers",   action:"boostRange"  },
  { id:"run_repair", label:"Mason Pact",     icon:"🔩", baseCost:35, costScale:1.4, desc:"Wall repair -20% cheaper",   action:"repairDisc"  },
  { id:"run_heart",  label:"Warden Rite",    icon:"❤️", baseCost:60, costScale:1.6, desc:"+25% heart atk & dmg",      action:"heartBoost"  },
  { id:"run_wall",   label:"Thick Mortar",   icon:"🧱", baseCost:45, costScale:1.5, desc:"+20% wall HP (all walls)",   action:"wallHp"      },
  { id:"repair_all", label:"Repair All",     icon:"🔧", baseCost:25, costScale:1.0, desc:"All walls restored to full", action:"repairWalls" },
];

// ═══════════════════════════════════════════════════════════════
// DIFFICULTY TIERS
// ═══════════════════════════════════════════════════════════════
const DIFFICULTY_TIERS = [
  { id:"normal",    label:"Normal",    icon:"🛡️",
    enemyHpMult:1.0, enemyDmgMult:1.0, enemySpeedMult:1.0, goldMult:1.0,  xpMult:1.0,
    desc:"Standard. Balanced for new players.", unlockCondition:null },
  { id:"hard",      label:"Hard",      icon:"⚔️",
    enemyHpMult:2.0, enemyDmgMult:1.7, enemySpeedMult:1.1, goldMult:1.1,  xpMult:1.8,
    desc:"Significantly tougher. More rewards.", unlockCondition:{ difficulty:"normal", minLevel:HARD_UNLOCK_LEVEL } },
  { id:"nightmare", label:"Nightmare", icon:"💀",
    enemyHpMult:3.5, enemyDmgMult:2.8, enemySpeedMult:1.2, goldMult:1.25, xpMult:3.0,
    desc:"Brutal. Only for veterans.", unlockCondition:{ difficulty:"hard", minLevel:NIGHTMARE_UNLOCK_LEVEL } },
];

// ─── ASCENSION TIERS ───
const ASCENSION_TIERS = [
  { name:"Wooden Hold",    minSec:0,   color:"#8B5E3C", wallColor:"#C68642", bg:"#140a04", passiveBuff:0,    heartColor:"#C68642" },
  { name:"Stone Keep",     minSec:60,  color:"#7A7A8C", wallColor:"#A0A0B8", bg:"#0c0c12", passiveBuff:0.10, heartColor:"#A0A0B8" },
  { name:"Runic Citadel",  minSec:150, color:"#5A3FAA", wallColor:"#8B6FE8", bg:"#070510", passiveBuff:0.25, heartColor:"#8B6FE8" },
  { name:"Mythic Bastion", minSec:300, color:"#AA7A00", wallColor:"#FFD700", bg:"#0a0800", passiveBuff:0.45, heartColor:"#FFD700" },
];

// ─── TOWER TYPES ─────────────────────────────────────────────────
// Reduced base damage so the heart doesn't solo early game.
// Arrow ~9 DPS (7 dmg × ~9/7 atkps). Ballista ~7.7 DPS single target.
// These force actual tower investment in the first 60 seconds.
const TOWER_TYPES = {
  arrow:   { label:"Arrow",    icon:"🏹", cost:25, dmg:7,  range:7.5,  speed:9,  color:"#7CFC00",
             shortDesc:"Fast · reliable · best first tower",
             fullDesc:"Fires rapidly at the nearest enemy. Best opening tower — versatile vs all types. Upgrade to Lv2 for a huge spike." },
  cannon:  { label:"Cannon",   icon:"💣", cost:50, dmg:42, range:11.0, speed:34, splash:3.5, color:"#FF6347",
             shortDesc:"AoE blast · anti-swarm · chokepoint king",
             fullDesc:"Slow-firing but hits all enemies in the blast zone. Essential vs swarm waves. Place near where enemies cluster." },
  ballista:{ label:"Ballista", icon:"⚡", cost:70, dmg:62, range:14.0, speed:48, color:"#00BFFF",
             shortDesc:"Long range · single target · boss killer",
             fullDesc:"Huge single-target damage at extreme range. The best investment before the first boss (90s). Place deep in the fortress." },
  support: { label:"Support",  icon:"✨", cost:40, dmg:0,  range:6.5,  speed:0,  buff:0.30, color:"#FFD700",
             shortDesc:"+30% dmg to nearby towers",
             fullDesc:"Boosts all towers in aura radius by 30%. One support effectively adds 30% DPS to every nearby tower. Place centrally." },
};

const HEART_TOWER = { dmg:6, range:5.5, speed:13, color:"#ff4466" };

// ═══════════════════════════════════════════════════════════════
// FORTRESS EXPANSION BLUEPRINT SYSTEM
// Keep Level controls the physical layout of the fortress.
// Each level defines: buildable radius, wall rings, socket positions.
// ═══════════════════════════════════════════════════════════════
const HC = HEART_COL, HR = HEART_ROW;

// Returns array of [col, row] for all tiles in a chebyshev ring at radius r
function ringTiles(cx, cy, r) {
  const tiles = [];
  for (let dc = -r; dc <= r; dc++) for (let dr = -r; dr <= r; dr++) {
    if (Math.max(Math.abs(dc), Math.abs(dr)) === r) tiles.push([cx+dc, cy+dr]);
  }
  return tiles;
}

// Returns array of [col, row] for partial outer wall segments (sides only, no corners) at radius r
function wallSegmentTiles(cx, cy, r) {
  const tiles = [];
  for (let dc = -r; dc <= r; dc++) for (let dr = -r; dr <= r; dr++) {
    const a = Math.abs(dc), b = Math.abs(dr);
    if (Math.max(a,b) === r && !(a===r && b===r)) tiles.push([cx+dc, cy+dr]); // no corner tiles
  }
  return tiles;
}

// Bastion / corner socket positions at a given radius
function bastionTiles(cx, cy, r) {
  return [[-r,-r],[-r,r],[r,-r],[r,r]].map(([dc,dr])=>[cx+dc,cy+dr]);
}

// ─── SOCKET POSITION HELPERS ───
// Inner diagonal positions relative to heart (inside radius-2 wall ring)
function innerDiagonalTiles(cx, cy) {
  return [[-1,-1],[-1,1],[1,-1],[1,1]].map(([dc,dr])=>[cx+dc,cy+dr]);
}
// Cardinal midpoints on a ring edge (not corners) — useful for mid-wall sockets
function cardinalTiles(cx, cy, r) {
  return [[0,-r],[0,r],[-r,0],[r,0]].map(([dc,dr])=>[cx+dc,cy+dr]);
}

// Keep-level blueprint definitions — 10 levels
// STRICT RULES:
//   wallRings  — ALL ring tiles become walls. Outer radius defines the perimeter.
//   sockets    — strictly at radii LESS than the outermost wall ring. Never on wall tiles.
//   buildRadius — must be >= outermost ring radius.
//   autoTowers — Lv6+ only: [{towerType, socketIndex}] pairs auto-placed during upgrade.
//                Only placed on valid empty sockets (never overwrites player towers/walls).
//
// Layout per level:
//  Lv1:  r2 walls. Inner ward.
//  Lv2:  r2 walls (reinforced). r1 diagonal sockets.
//  Lv3:  r2+r4 walls. r3 corner sockets between rings.
//  Lv4:  r2+r5 walls. r3+r4 sockets between rings.
//  Lv5:  r2+r5+r7 walls. r6 gap open for towers. r3+r4+r6 sockets.
//  Lv6:  same walls. Auto-place 2 Arrow towers on r1 sockets.
//  Lv7:  r2+r5+r8 walls. r7 gap. Auto-place 1 Cannon.
//  Lv8:  same. Auto-place 2 Ballistae on r6 sockets.
//  Lv9:  r2+r5+r8 walls. Auto-place 2 Support towers centrally.
//  Lv10: r2+r5+r9 final walls. Auto-place final defensive network.
const KEEP_BLUEPRINTS = [
  // ── LEVELS 1–5: expansion + sockets ──────────────────────────────────
  {
    keepLevel:1, buildRadius:2, wallRings:[2], sockets:[],
    label:"Inner Ward",
    unlockDesc:"Heart protected by inner ring · Limited build area",
    heartHpBonus:0, castleDmgBonus:0,
  },
  {
    keepLevel:2, buildRadius:3, wallRings:[2],
    sockets:[...innerDiagonalTiles(HC,HR)],        // r1 — inside r2 ✓
    label:"Outer Court",
    unlockDesc:"Inner ring reinforced · 4 interior sockets · Build expanded to r3",
    heartHpBonus:60, castleDmgBonus:0.06,
  },
  {
    keepLevel:3, buildRadius:4, wallRings:[2,4],
    sockets:[
      ...innerDiagonalTiles(HC,HR),                // r1 inside r2 ✓
      ...bastionTiles(HC,HR,3),                    // r3 inside r4 ✓
    ],
    label:"Outer Rampart",
    unlockDesc:"Outer wall ring at r4 · r3 sockets between rings · Build to r4",
    heartHpBonus:120, castleDmgBonus:0.12,
  },
  {
    keepLevel:4, buildRadius:5, wallRings:[2,5],
    sockets:[
      ...innerDiagonalTiles(HC,HR),                // r1 inside r2 ✓
      ...bastionTiles(HC,HR,3),                    // r3 inside r5 ✓
      ...cardinalTiles(HC,HR,3),                   // r3 cardinals inside r5 ✓
      ...bastionTiles(HC,HR,4),                    // r4 inside r5 ✓
    ],
    label:"Grand Citadel",
    unlockDesc:"Wall ring at r5 · 12 sockets inside walls · Build to r5",
    heartHpBonus:180, castleDmgBonus:0.18,
  },
  {
    // Lv5: outer ring at r7, r6 left open as a buildable gap for tower placement
    keepLevel:5, buildRadius:7, wallRings:[2,5,7],
    sockets:[
      ...innerDiagonalTiles(HC,HR),                // r1 inside r2 ✓
      ...bastionTiles(HC,HR,3),                    // r3 inside r5 ✓
      ...cardinalTiles(HC,HR,3),                   // r3 cardinals inside r5 ✓
      ...bastionTiles(HC,HR,4),                    // r4 inside r5 ✓
      ...bastionTiles(HC,HR,6),                    // r6 inside r7 ✓ (the gap ring)
      ...cardinalTiles(HC,HR,6),                   // r6 cardinals inside r7 ✓
    ],
    label:"Fortress Wall",
    unlockDesc:"Triple ring at r2/r5/r7 · r6 gap open for towers · 16 sockets",
    heartHpBonus:240, castleDmgBonus:0.22,
  },
  // ── LEVELS 6–10: auto-tower placement ──────────────────────────────
  {
    keepLevel:6, buildRadius:7, wallRings:[2,5,7],
    sockets:[
      ...innerDiagonalTiles(HC,HR),
      ...bastionTiles(HC,HR,3), ...cardinalTiles(HC,HR,3),
      ...bastionTiles(HC,HR,4),
      ...bastionTiles(HC,HR,6), ...cardinalTiles(HC,HR,6),
    ],
    // Auto-place 2 Arrow towers on the first 2 available r1 diagonal sockets
    autoTowers:[
      {towerType:"arrow", preferSockets:innerDiagonalTiles(HC,HR)},
      {towerType:"arrow", preferSockets:innerDiagonalTiles(HC,HR)},
    ],
    label:"Garrisoned Ward",
    unlockDesc:"Auto-place 2 Arrow towers at inner sockets · Garrison activated",
    heartHpBonus:300, castleDmgBonus:0.25,
  },
  {
    keepLevel:7, buildRadius:8, wallRings:[2,5,8],
    sockets:[
      ...innerDiagonalTiles(HC,HR),
      ...bastionTiles(HC,HR,3), ...cardinalTiles(HC,HR,3),
      ...bastionTiles(HC,HR,4),
      ...bastionTiles(HC,HR,6), ...cardinalTiles(HC,HR,6),
      ...bastionTiles(HC,HR,7),                    // r7 inside r8 ✓
    ],
    autoTowers:[
      {towerType:"cannon", preferSockets:bastionTiles(HC,HR,3)},
    ],
    label:"Cannon Rampart",
    unlockDesc:"Outer ring at r8 · r7 sockets · Auto-place 1 Cannon at inner ring",
    heartHpBonus:360, castleDmgBonus:0.28,
  },
  {
    keepLevel:8, buildRadius:8, wallRings:[2,5,8],
    sockets:[
      ...innerDiagonalTiles(HC,HR),
      ...bastionTiles(HC,HR,3), ...cardinalTiles(HC,HR,3),
      ...bastionTiles(HC,HR,4),
      ...bastionTiles(HC,HR,6), ...cardinalTiles(HC,HR,6),
      ...bastionTiles(HC,HR,7),
    ],
    autoTowers:[
      {towerType:"ballista", preferSockets:bastionTiles(HC,HR,6)},
      {towerType:"ballista", preferSockets:bastionTiles(HC,HR,6)},
    ],
    label:"Ballista Citadel",
    unlockDesc:"Auto-place 2 Ballistae at r6 outer sockets · Long-range defence",
    heartHpBonus:420, castleDmgBonus:0.30,
  },
  {
    keepLevel:9, buildRadius:9, wallRings:[2,5,8],
    sockets:[
      ...innerDiagonalTiles(HC,HR),
      ...bastionTiles(HC,HR,3), ...cardinalTiles(HC,HR,3),
      ...bastionTiles(HC,HR,4),
      ...bastionTiles(HC,HR,6), ...cardinalTiles(HC,HR,6),
      ...bastionTiles(HC,HR,7),
      ...bastionTiles(HC,HR,8),                    // r8 inside r8 — same ring, skip (use cardinals instead)
      ...cardinalTiles(HC,HR,8),                   // r8 cardinals — already on wall, skip for sockets
    ].filter(([c,r])=>{                             // safety filter: no socket on any wall ring tile
      const dr=Math.abs(r-HR), dc=Math.abs(c-HC);
      const cheb=Math.max(dr,dc);
      return ![2,5,8].includes(cheb);
    }),
    autoTowers:[
      {towerType:"support", preferSockets:cardinalTiles(HC,HR,3)},
      {towerType:"support", preferSockets:cardinalTiles(HC,HR,3)},
    ],
    label:"Command Fortress",
    unlockDesc:"Auto-place 2 Support towers at inner ring cardinals · Aura network",
    heartHpBonus:480, castleDmgBonus:0.33,
  },
  {
    keepLevel:10, buildRadius:9, wallRings:[2,5,9],
    sockets:[
      ...innerDiagonalTiles(HC,HR),
      ...bastionTiles(HC,HR,3), ...cardinalTiles(HC,HR,3),
      ...bastionTiles(HC,HR,4),
      ...bastionTiles(HC,HR,6), ...cardinalTiles(HC,HR,6),
      ...bastionTiles(HC,HR,7),
      ...bastionTiles(HC,HR,8),
    ].filter(([c,r])=>{
      const cheb=Math.max(Math.abs(r-HR),Math.abs(c-HC));
      return ![2,5,9].includes(cheb);
    }),
    autoTowers:[
      {towerType:"ballista", preferSockets:bastionTiles(HC,HR,8)},
      {towerType:"cannon",   preferSockets:cardinalTiles(HC,HR,6)},
      {towerType:"arrow",    preferSockets:innerDiagonalTiles(HC,HR)},
    ],
    label:"Mythic Fortress",
    unlockDesc:"Final ring at r9 · Full defensive network · 3 auto-placed towers",
    heartHpBonus:600, castleDmgBonus:0.40,
  },
];

function getKeepBlueprint(keepLevel) {
  return KEEP_BLUEPRINTS[Math.min(keepLevel, KEEP_BLUEPRINTS.length) - 1];
}

// Returns set of "key" strings that are within buildable radius for this keep level
function getBuildableKeys(keepLevel) {
  const bp = getKeepBlueprint(keepLevel);
  const keys = new Set();
  for (let dc = -bp.buildRadius; dc <= bp.buildRadius; dc++) {
    for (let dr = -bp.buildRadius; dr <= bp.buildRadius; dr++) {
      if (Math.max(Math.abs(dc), Math.abs(dr)) <= bp.buildRadius) {
        const c = HC+dc, r = HR+dr;
        if (c>=0 && c<GRID_SIZE && r>=0 && r<GRID_SIZE) keys.add(`${c},${r}`);
      }
    }
  }
  return keys;
}

// Build the fortress cells resulting from a keep upgrade.
//
// Wall rings always become plain "wall" tiles — the full ring, including corners.
// Socket positions are always INSIDE the innermost wall ring and never coincide
// with wall tiles. Sockets are soft placement hints only, not physical structures.
//
// reinforced=true (Iron Formation research): new blueprint walls start at level 2.
function applyFortressExpansion(cells, newKeepLevel, wallHpMult, permWallHpMult, reinforced=false) {
  const bp = getKeepBlueprint(newKeepLevel);
  const baseWallHp = Math.round(WALL_HP_BASE * (wallHpMult || 1) * (permWallHpMult || 1));
  const newCells = { ...cells };

  // ── Wall rings: ALL ring tiles become plain walls ──
  for (const ringR of bp.wallRings) {
    const isInnerRing = ringR === 2;
    for (const [c, r] of ringTiles(HC, HR, ringR)) {
      if (c < 0 || c >= GRID_SIZE || r < 0 || r >= GRID_SIZE) continue;
      const key = `${c},${r}`;
      const existing = newCells[key];

      if (!existing) {
        // Determine starting level: outer rings start at 2; reinforced bumps to 2
        const startLevel = reinforced ? 2 : (newKeepLevel >= 3 && !isInnerRing ? 2 : 1);
        const hp = Math.round(baseWallHp * (startLevel >= 2 ? 1.4 : 1));
        newCells[key] = { type:"wall", hp, maxHp:hp, level:startLevel, damageTaken:0, blueprint:true };
      } else if (existing.type === "wall" && isInnerRing && newKeepLevel >= 2) {
        // Reinforce existing inner ring to level 2
        if ((existing.level||1) < 2) {
          const newMax = Math.round(existing.maxHp * 1.5);
          newCells[key] = { ...existing, maxHp:newMax, hp:Math.min(existing.hp + Math.round(existing.maxHp*0.5), newMax), level:2 };
        }
      } else if (existing.type === "wall" && reinforced && (existing.level||1) < 2) {
        // Iron Formation: reinforce any non-reinforced blueprint wall
        const newMax = Math.round(existing.maxHp * 1.6);
        newCells[key] = { ...existing, maxHp:newMax, hp:newMax, level:2, researchReinforced:true };
      }
    }
  }

  // ── Sockets: placed on empty tiles only, guaranteed to not overlap walls ──
  // Blueprint design ensures bp.sockets never coincide with wallRing positions.
  for (const [c, r] of bp.sockets) {
    if (c < 0 || c >= GRID_SIZE || r < 0 || r >= GRID_SIZE) continue;
    const key = `${c},${r}`;
    const existing = newCells[key];
    // Skip if already occupied by anything (wall, tower, heart, socket)
    if (!existing) {
      newCells[key] = { type:"socket", hp:1, maxHp:1, socketLevel:newKeepLevel };
    }
  }

  return newCells;
}


// ─── ENEMY TYPES ─────────────────────────────────────────────────
// On 45×45 grid, heart at (22,22). Enemies spawn ~18–22 tiles away.
// Travel time at spd=2.2: ~8–10 seconds. Fast enough to feel urgent.
// Travel time at spd=1.0: ~18–22 seconds. Brutes are slow and visible.
const ENEMY_TYPES = {
  raider: { label:"Raider", icon:"⚔️", hp:50,  spd:2.5, dmg:8,  gold:7,  color:"#e74c3c",
            waveTag:"mixed",
            fullDesc:"Standard attacker. Manageable with one Arrow tower. Your first combat lesson." },
  runner: { label:"Runner", icon:"💨", hp:20,  spd:6.0, dmg:3,  gold:6,  color:"#e67e22",
            waveTag:"fast",
            fullDesc:"Extremely fast, low HP. One Arrow tower handles them — watch for wall gaps." },
  brute:  { label:"Brute",  icon:"🪨", hp:260, spd:1.2, dmg:20, gold:16, color:"#8e44ad",
            waveTag:"tank",
            fullDesc:"Slow but immensely tough. A Lv2 Ballista is the most gold-efficient counter." },
  siege:  { label:"Siege",  icon:"🏗️", hp:130, spd:1.1, dmg:40, gold:18, color:"#c0392b",
            waveTag:"tank",  targetWalls:true,
            fullDesc:"Targets walls and deals massive structure damage. Shoot it before it reaches the walls." },
  swarm:  { label:"Swarm",  icon:"🐝", hp:10,  spd:4.0, dmg:2,  gold:2,  color:"#f39c12",
            waveTag:"swarm",
            fullDesc:"Individually harmless, lethal in groups. One Cannon clears entire clusters instantly." },
  boss:   { label:"BOSS",   icon:"👹", hp:850, spd:0.9, dmg:50, gold:100,color:"#ff00ff",
            waveTag:"boss", isBoss:true,
            fullDesc:"Arrives every 90 seconds. Requires sustained DPS — have a Ballista placed before 90s." },
};

// ─── WAVE SYSTEM ─── Named wave types for clear identity
// waveDesc: short text shown when this wave activates (event log)
const WAVE_DEFS = [
  { id:"vanguard",  label:"Vanguard",    icon:"⚔️", waveDesc:"Raiders incoming!",       pool:["raider","raider","raider"],               extraSwarmChance:0,    extraCount:0, minSec:0   },
  { id:"scouts",    label:"Scout Rush",  icon:"💨", waveDesc:"Fast scouts spotted!",     pool:["runner","runner","raider"],                extraSwarmChance:0.10, extraCount:2, minSec:25  },
  { id:"mixed1",    label:"Mixed Host",  icon:"🛡️", waveDesc:"Mixed warband approaching!",pool:["raider","runner","raider","swarm"],        extraSwarmChance:0.18, extraCount:3, minSec:40  },
  { id:"swarm1",    label:"Swarm Wave",  icon:"🐝", waveDesc:"🐝 SWARM — build Cannon!", pool:["swarm","swarm","swarm","raider"],          extraSwarmChance:0.40, extraCount:4, minSec:60  },
  { id:"tanks1",    label:"Iron March",  icon:"🪨", waveDesc:"🪨 Brutes incoming!",      pool:["brute","raider","brute"],                  extraSwarmChance:0.08, extraCount:1, minSec:75  },
  { id:"mixed2",    label:"War Band",    icon:"⚔️", waveDesc:"War band pushing!",        pool:["raider","runner","swarm","raider"],        extraSwarmChance:0.22, extraCount:3, minSec:90  },
  { id:"siege1",    label:"Siege Line",  icon:"🏗️", waveDesc:"🏗️ Siege engines! Guard walls!", pool:["siege","siege","raider"],                  extraSwarmChance:0.10, extraCount:2, minSec:120 },
  { id:"fast1",     label:"Blitz",       icon:"⚡", waveDesc:"⚡ Speed rush incoming!",  pool:["runner","runner","runner","runner"],        extraSwarmChance:0.12, extraCount:2, minSec:140 },
  { id:"swarm2",    label:"Plague Wave", icon:"🐝", waveDesc:"🐝🐝 Plague swarm!",        pool:["swarm","swarm","swarm","swarm","runner"],  extraSwarmChance:0.50, extraCount:5, minSec:160 },
  { id:"tanks2",    label:"Heavy Guard", icon:"🪨", waveDesc:"🪨 Heavy assault!",        pool:["brute","siege","brute","raider"],          extraSwarmChance:0.08, extraCount:2, minSec:200 },
  { id:"horde",     label:"Great Horde", icon:"👾", waveDesc:"The Great Horde arrives!", pool:["raider","runner","swarm","siege","brute"], extraSwarmChance:0.30, extraCount:4, minSec:240 },
  { id:"siege2",    label:"Grand Siege", icon:"🏗️", waveDesc:"🏗️🏗️ Grand Siege!",         pool:["siege","siege","siege","brute"],           extraSwarmChance:0.15, extraCount:3, minSec:300 },
  { id:"blitz2",    label:"Death Rush",  icon:"💀", waveDesc:"💀 Death Rush!",            pool:["runner","runner","swarm","swarm","raider"],extraSwarmChance:0.45, extraCount:5, minSec:360 },
];

// Returns the best matching wave definition for the current elapsed time
function getWaveDef(ms) {
  const sec = ms / 1000;
  let best = WAVE_DEFS[0];
  for (const w of WAVE_DEFS) { if (sec >= w.minSec) best = w; }
  return best;
}

// Wave state tracking: every N seconds rotate to the next wave type within eligible pool
const WAVE_ROTATION_INTERVAL = 18000; // ms between wave type rotations
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
// RESEARCH SYSTEM — categorised, expandable
// ═══════════════════════════════════════════════════════════════

// Castle upgrades (XP spent between runs — broad fortress improvements)
const CASTLE_UPGRADES = [
  { id:"start_gold",   label:"War Chest",      icon:"💰", desc:"+40 starting gold per level",        maxLevel:5, baseCost:40,  effect:l=>({startGoldBonus:l*40}) },
  { id:"wall_hp",      label:"Thick Walls",    icon:"🧱", desc:"+15% wall max HP per level",         maxLevel:5, baseCost:50,  effect:l=>({permWallHpMult:1+l*0.15}) },
  { id:"tower_dmg",    label:"Siege Mastery",  icon:"⚔️", desc:"+8% tower damage per level",        maxLevel:5, baseCost:60,  effect:l=>({permDmgMult:1+l*0.08}) },
  { id:"atk_spd",      label:"Rapid Fire",     icon:"⚡", desc:"+8% attack speed per level",        maxLevel:5, baseCost:60,  effect:l=>({permSpdMult:Math.max(0.4,1-l*0.08)}) },
  { id:"heart_hp",     label:"Fortified Keep", icon:"❤️", desc:"+80 heart HP per level",            maxLevel:5, baseCost:70,  effect:l=>({permHeartHp:300+l*80}) },
  { id:"passive_gold", label:"Treasury",       icon:"🏦", desc:"+1 passive gold/sec per level",     maxLevel:5, baseCost:80,  effect:l=>({permPassiveGold:l}) },
  { id:"repair_eff",   label:"Mason Guild",    icon:"🔩", desc:"Wall repair -15% cost per level",   maxLevel:3, baseCost:70,  effect:l=>({permRepairDisc:l*0.15}) },
  { id:"heart_atk",    label:"Warden's Eye",   icon:"🎯", desc:"+15% heart atk+speed per level",   maxLevel:3, baseCost:90,  effect:l=>({permHeartAtkMult:1+l*0.15}) },
];

// Research categories — each is a tab in the Research screen
const RESEARCH_CATEGORIES = [
  {
    id:"economy", label:"Economy", icon:"💰", color:"#FFD700",
    desc:"Improve gold flow, income, and economic scaling.",
    upgrades:[
      { id:"kill_gold",    label:"Bounty Board",    icon:"💀", desc:"+20% gold from kills per level (all enemies)", maxLevel:5, baseCost:80,  effect:l=>({researchGoldMult:1+l*0.2}) },
      { id:"boss_gold",    label:"Trophy Hall",     icon:"👹", desc:"Boss kills grant +75% bonus gold",             maxLevel:1, baseCost:120, effect:()=>({researchBossGold:true}) },
      { id:"start_gold2",  label:"Advanced Treasury",icon:"🏦",desc:"+25 additional starting gold per level",       maxLevel:5, baseCost:60,  effect:l=>({researchStartGold:l*25}) },
      { id:"passive_rate", label:"Merchant Guild",  icon:"💹", desc:"+0.5 passive gold/sec per level",              maxLevel:4, baseCost:100, effect:l=>({researchPassiveGold:l*0.5}) },
      { id:"upgrade_disc", label:"Bulk Purchase",   icon:"📦", desc:"Run upgrade shop costs -8% per level",         maxLevel:3, baseCost:90,  effect:l=>({researchUpgradeDisc:l*0.08}) },
    ],
  },
  {
    id:"defence", label:"Defence", icon:"🧱", color:"#C68642",
    desc:"Strengthen walls, regeneration, and repair efficiency.",
    upgrades:[
      { id:"wall_ring",    label:"Iron Formation",  icon:"🛡️", desc:"Blueprint walls start reinforced (Lv2) — +60% HP",  maxLevel:1, baseCost:150, effect:()=>({researchWallRing:true}) },
      { id:"wall_regen",   label:"Living Stone",    icon:"🌿", desc:"Walls regen HP (up to 30% of max) per level", maxLevel:3, baseCost:110, effect:l=>({researchWallRegen:l*WALL_REGEN_PER_LEVEL}) },
      { id:"regen_cap",    label:"Vital Mortar",    icon:"💚", desc:"Increase wall regen cap by +10% per level",   maxLevel:3, baseCost:130, effect:l=>({researchRegenCap:l*0.10}) },
      { id:"wall_armor",   label:"Hardened Stone",  icon:"🪨", desc:"Walls take -10% damage per level",            maxLevel:3, baseCost:140, effect:l=>({researchWallArmor:l*0.10}) },
      { id:"repair_cost",  label:"Stonemason",      icon:"🔨", desc:"All wall repair costs -15% per level",        maxLevel:3, baseCost:80,  effect:l=>({researchRepairDisc:l*0.15}) },
    ],
  },
  {
    id:"weapons", label:"Weapons", icon:"⚔️", color:"#FF6347",
    desc:"Permanently upgrade individual tower types. Each Support sub-upgrade improves the Support tower itself — its aura power or reach. For a global bonus to all towers' received buff, see Utility › Command Aura.",
    upgrades:[
      // Arrow research — affects ALL Arrow towers permanently
      { id:"arrow_dmg",   label:"Arrow: Damage",     icon:"🏹", desc:"+12% Arrow tower base damage per level (ALL arrows)", maxLevel:5, baseCost:80,  weaponType:"arrow",  stat:"dmg",    effect:l=>({weapArrowDmg:1+l*0.12}) },
      { id:"arrow_spd",   label:"Arrow: Speed",      icon:"🏹", desc:"+10% Arrow attack speed per level (ALL arrows)",      maxLevel:5, baseCost:80,  weaponType:"arrow",  stat:"speed",  effect:l=>({weapArrowSpd:1-l*0.09}) },
      { id:"arrow_range", label:"Arrow: Range",      icon:"🏹", desc:"+0.5 tile Arrow range per level (ALL arrows)",        maxLevel:4, baseCost:90,  weaponType:"arrow",  stat:"range",  effect:l=>({weapArrowRange:l*0.5}) },
      // Cannon research — affects ALL Cannon towers permanently
      { id:"cannon_dmg",   label:"Cannon: Damage",   icon:"💣", desc:"+12% Cannon base damage per level (ALL cannons)",    maxLevel:5, baseCost:90,  weaponType:"cannon", stat:"dmg",    effect:l=>({weapCannonDmg:1+l*0.12}) },
      { id:"cannon_splash",label:"Cannon: Splash",   icon:"💣", desc:"+20% Cannon splash radius per level (ALL cannons)",  maxLevel:4, baseCost:100, weaponType:"cannon", stat:"splash", effect:l=>({weapCannonSplash:1+l*0.20}) },
      { id:"cannon_range", label:"Cannon: Range",    icon:"💣", desc:"+0.8 tile Cannon range per level (ALL cannons)",     maxLevel:3, baseCost:110, weaponType:"cannon", stat:"range",  effect:l=>({weapCannonRange:l*0.8}) },
      { id:"cannon_reload",label:"Cannon: Reload",   icon:"💣", desc:"+8% Cannon fire rate per level (ALL cannons)",       maxLevel:4, baseCost:95,  weaponType:"cannon", stat:"speed",  effect:l=>({weapCannonSpd:1-l*0.08}) },
      // Ballista research — affects ALL Ballista towers permanently
      { id:"balli_dmg",    label:"Ballista: Damage", icon:"⚡", desc:"+15% Ballista base damage per level (ALL ballistae)", maxLevel:5, baseCost:100, weaponType:"ballista",stat:"dmg",   effect:l=>({weapBallistaDmg:1+l*0.15}) },
      { id:"balli_range",  label:"Ballista: Range",  icon:"⚡", desc:"+1 tile Ballista range per level (ALL ballistae)",    maxLevel:4, baseCost:110, weaponType:"ballista",stat:"range",  effect:l=>({weapBallistaRange:l*1.0}) },
      { id:"balli_boss",   label:"Ballista: Boss",   icon:"⚡", desc:"+20% bonus dmg vs bosses per level (ALL ballistae)", maxLevel:3, baseCost:130, weaponType:"ballista",stat:"boss",   effect:l=>({weapBallistaBoss:1+l*0.20}) },
      // Support research — upgrades the Support tower type permanently (weapon research)
      { id:"supp_buff",    label:"Support: Buff Strength", icon:"✨", desc:"+10% aura buff per level — affects all Support towers' individual aura power", maxLevel:4, baseCost:90,  weaponType:"support", stat:"buff",   effect:l=>({weapSupportBuff:l*0.10}) },
      { id:"supp_range",   label:"Support: Aura Radius",   icon:"✨", desc:"+0.5 tile aura radius per level — affects all Support towers' individual reach", maxLevel:3, baseCost:100, weaponType:"support", stat:"range",  effect:l=>({weapSupportRange:l*0.5}) },
    ],
  },
  {
    id:"heart", label:"Heart", icon:"❤️", color:"#ff4466",
    desc:"Permanently improve the Fortress Heart's attack and durability.",
    upgrades:[
      { id:"heart_dmg",    label:"Heart: Damage",     icon:"❤️", desc:"+15% heart attack damage per level",         maxLevel:5, baseCost:80,  effect:l=>({researchHeartDmg:1+l*0.15}) },
      { id:"heart_range",  label:"Heart: Range",      icon:"❤️", desc:"+0.8 tile heart attack range per level",     maxLevel:4, baseCost:90,  effect:l=>({researchHeartRange:l*0.8}) },
      { id:"heart_speed",  label:"Heart: Fire Rate",  icon:"❤️", desc:"+10% heart attack speed per level",          maxLevel:4, baseCost:85,  effect:l=>({researchHeartSpd:1-l*0.10}) },
      { id:"heart_crit",   label:"Heart: Critical",   icon:"❤️", desc:"+8% heart crit chance per level",            maxLevel:3, baseCost:110, effect:l=>({researchHeartCrit:l*0.08}) },
    ],
  },
  {
    id:"perks", label:"Perks", icon:"🃏", color:"#c380ff",
    desc:"Improve the quality and variety of perk choices between waves.",
    upgrades:[
      { id:"card_quality", label:"Arcane Library",    icon:"📚", desc:"Rare perks appear more often in offers",     maxLevel:1, baseCost:120, effect:()=>({researchCardBonus:true}) },
      { id:"card_choices", label:"Three Paths",       icon:"🎲", desc:"Unlock a 4th perk choice option",            maxLevel:1, baseCost:180, effect:()=>({researchExtraCard:true}) },
      { id:"chain_unlock", label:"Lightning Rune",    icon:"🌩️", desc:"Unlocks Chain Lightning in perk pool",      maxLevel:1, baseCost:200, effect:()=>({researchChainUnlock:true}) },
      { id:"perk_freq",    label:"Ancient Texts",     icon:"📖", desc:"Perk offers every 90s instead of 120s",        maxLevel:1, baseCost:160, effect:()=>({researchPerkFreq:true}) },
      { id:"perk_reroll",  label:"Arcane Reroll",     icon:"🔄", desc:"Unlock one free perk reroll per run",        maxLevel:1, baseCost:220, effect:()=>({researchReroll:true}) },
    ],
  },
  {
    id:"ascension", label:"Ascension", icon:"✨", color:"#8B6FE8",
    desc:"Reduce ascension costs and amplify ascension tier bonuses.",
    upgrades:[
      { id:"asc_cost",     label:"Ritual Mastery",   icon:"💎", desc:"-15% ascension gold cost per level",          maxLevel:3, baseCost:130, effect:l=>({researchAscCostDisc:l*0.15}) },
      { id:"asc_bonus",    label:"Mythic Rites",     icon:"🌟", desc:"+10% ascension passive buff per level",        maxLevel:3, baseCost:150, effect:l=>({researchAscBonus:l*0.10}) },
      { id:"asc_carry",    label:"Lingering Power",  icon:"✨", desc:"Ascension bonus lingers 15s after tier lost",  maxLevel:1, baseCost:200, effect:()=>({researchAscLinger:true}) },
    ],
  },
  {
    id:"difficulty", label:"Rewards", icon:"🏆", color:"#4ecf8a",
    desc:"Increase XP and gold rewards, especially on harder difficulties.",
    upgrades:[
      { id:"xp_boost",     label:"Scholar's Mark",   icon:"⭐", desc:"+25% XP earned per run per level",            maxLevel:5, baseCost:120, effect:l=>({researchXpMult:1+l*0.25}) },
      { id:"boss_xp",      label:"Boss Chronicle",   icon:"👹", desc:"+50% XP bonus per boss killed per level",     maxLevel:3, baseCost:140, effect:l=>({researchBossXpMult:1+l*0.5}) },
      { id:"hard_bonus",   label:"Veteran's Pride",  icon:"⚔️", desc:"+15% extra gold on Hard/Nightmare per level", maxLevel:3, baseCost:110, effect:l=>({researchHardBonus:l*0.15}) },
      { id:"lvl_bonus",    label:"Mastery Reward",   icon:"🎖️", desc:"+5 XP per run level reached per level",      maxLevel:3, baseCost:100, effect:l=>({researchLvlBonus:l*5}) },
    ],
  },
  {
    id:"utility", label:"Utility", icon:"🔧", color:"#7a7a8a",
    desc:"Quality-of-life and systemic improvements. Note: Support upgrades here are global battlefield effects, separate from per-tower weapon research in the Weapons tab.",
    upgrades:[
      // NOTE: this raises the global base supportBuff received by ALL towers from ANY support tower.
      // Different from Weapons > Support which upgrades individual support towers' own stats.
      { id:"support_buff", label:"Command Aura",    icon:"📡", desc:"+15% global buff bonus received from any Support tower per level (stacks with Weapons > Support)", maxLevel:2, baseCost:110, effect:l=>({researchSupportBuff:l*0.15}) },
      { id:"cannon_chain", label:"Chain Reaction",  icon:"💥", desc:"Cannon explosions can trigger secondary chain hits",    maxLevel:1, baseCost:200, effect:()=>({researchCannonChain:true}) },
    ],
  },
];

// All research upgrades flat for save/lookup
const ALL_RESEARCH_UPGRADES = RESEARCH_CATEGORIES.flatMap(c=>c.upgrades);

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
    bestLevelByDiff:{ normal:0, hard:0, nightmare:0 },
    castleUpgrades:{},
    researchUpgrades:{},   // all research categories share this flat dict (keyed by upgrade.id)
    settings:{ preferredSpeed:1 },
  };
}
function loadSave(){
  try{
    const raw=localStorage.getItem(SAVE_KEY);
    if(!raw) return makeBlankSave();
    const p=JSON.parse(raw);
    const merged={ ...makeBlankSave(), ...p, version:SAVE_VERSION };
    if(!merged.bestLevelByDiff) merged.bestLevelByDiff={ normal:0, hard:0, nightmare:0 };
    if(!merged.researchUpgrades) merged.researchUpgrades={};
    return merged;
  }catch{ return makeBlankSave(); }
}
function saveGame(d){ try{localStorage.setItem(SAVE_KEY,JSON.stringify({...d,version:SAVE_VERSION}));}catch{} }
function resetSave(){ try{localStorage.removeItem(SAVE_KEY);}catch{} return makeBlankSave(); }
function isDifficultyUnlocked(tierId,save){
  const dt=DIFFICULTY_TIERS.find(d=>d.id===tierId);
  if(!dt||!dt.unlockCondition) return true;
  const{difficulty,minLevel}=dt.unlockCondition;
  return (save.bestLevelByDiff?.[difficulty]||0)>=minLevel;
}

// Compute all permanent perks from save — castle upgrades + all research categories
function computePerks(save){
  const p={
    // Castle upgrade outputs
    startGoldBonus:0, permWallHpMult:1, permDmgMult:1, permSpdMult:1, permHeartHp:300,
    permPassiveGold:0, permRepairDisc:0, permHeartAtkMult:1,
    // Research: economy
    researchGoldMult:1, researchBossGold:false, researchStartGold:0, researchPassiveGold:0, researchUpgradeDisc:0,
    // Research: defence
    researchWallRing:false, researchWallRegen:0, researchRegenCap:0, researchWallArmor:0, researchRepairDisc:0,
    // Research: weapons (affect ALL towers of that type)
    weapArrowDmg:1, weapArrowSpd:1, weapArrowRange:0,
    weapCannonDmg:1, weapCannonSplash:1, weapCannonRange:0, weapCannonSpd:1,
    weapBallistaDmg:1, weapBallistaRange:0, weapBallistaBoss:1,
    weapSupportBuff:0, weapSupportRange:0,
    // Research: heart
    researchHeartDmg:1, researchHeartRange:0, researchHeartSpd:1, researchHeartCrit:0,
    // Research: perks
    researchCardBonus:false, researchExtraCard:false, researchChainUnlock:false, researchPerkFreq:false, researchReroll:false,
    // Research: ascension
    researchAscCostDisc:0, researchAscBonus:0, researchAscLinger:false,
    // Research: difficulty rewards
    researchXpMult:1, researchBossXpMult:1, researchHardBonus:0, researchLvlBonus:0,
    // Research: utility
    researchSupportBuff:0, researchCannonChain:false,
  };
  for(const u of CASTLE_UPGRADES){const l=save.castleUpgrades?.[u.id]||0;if(l>0)Object.assign(p,u.effect(l));}
  for(const u of ALL_RESEARCH_UPGRADES){const l=save.researchUpgrades?.[u.id]||0;if(l>0)Object.assign(p,u.effect(l));}
  return p;
}

// Compute effective weapon stats for a tower type, incorporating weapon research
function getEffectiveTowerStats(type, perks){
  const base=TOWER_TYPES[type];
  if(!base) return null;
  switch(type){
    case "arrow":   return {...base,dmg:base.dmg*(perks.weapArrowDmg||1),speed:base.speed*(perks.weapArrowSpd||1),range:base.range+(perks.weapArrowRange||0)};
    case "cannon":  return {...base,dmg:base.dmg*(perks.weapCannonDmg||1),splash:(base.splash||3.5)*(perks.weapCannonSplash||1),range:base.range+(perks.weapCannonRange||0),speed:base.speed*(perks.weapCannonSpd||1)};
    case "ballista":return {...base,dmg:base.dmg*(perks.weapBallistaDmg||1),range:base.range+(perks.weapBallistaRange||0)};
    case "support": return {...base,buff:(base.buff||0.30)+(perks.weapSupportBuff||0),range:base.range+(perks.weapSupportRange||0)};
    default: return base;
  }
}

function calcXp(gs,tierIdx,perks,diffTier){
  const sec=gs.elapsed/1000;
  const runLevel=calcRunLevel(gs.elapsed);
  const base=Math.round(
    sec*XP_PER_SEC +
    gs.kills*XP_PER_KILL +
    gs.bossKills*(XP_PER_BOSS*(perks.researchBossXpMult||1)) +
    tierIdx*XP_PER_TIER +
    runLevel*(perks.researchLvlBonus||0)
  );
  const hardBonus = (diffTier.id!=="normal") ? 1+(perks.researchHardBonus||0) : 1;
  return Math.round(Math.max(XP_MIN_RUN,base)*(perks.researchXpMult||1)*(diffTier.xpMult||1)*hardBonus);
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
const getUnlockedTierIdx = ms=>getTierIdx(ms);

function getDifficulty(ms,dt){const c=diffCurve(ms);return{hpMult:c.hpScale*dt.enemyHpMult,dmgMult:c.dmgScale*dt.enemyDmgMult};}
function getSpawnInterval(ms,slow){if(slow>0)return 5000;return Math.max(SPAWN_RATE_MIN,SPAWN_RATE_MAX-(ms/1000)*SPAWN_RATE_DECAY);}
function isBossTime(e,p){return Math.floor(e/90000)>Math.floor(p/90000)&&e>0;}

// Fix 2: Compute the maximum attack range currently active across ALL towers and the heart.
// Accounts for: base tower range, tower level range bonus, weapon research range bonus,
// run range upgrades (rangeBonus), and heart research range bonus.
// Returns: the maximum Chebyshev attack range of any single attacker currently placed.
function getMaxActiveAttackRange(state) {
  const wp = state._weaponPerks || {};
  const hp2 = state._heartPerks || {};
  const globalRangeBonus = state.rangeBonus || 0;

  // Heart range
  const heartRange = HEART_TOWER.range + (hp2.range || 0) + globalRangeBonus;
  let maxRange = heartRange;

  // All placed towers
  for (const cell of Object.values(state.cells || {})) {
    if (cell.type !== "tower") continue;
    const ttype = cell.towerType;
    const tdef = TOWER_TYPES[ttype];
    if (!tdef) continue;
    const lvStats = getTowerLevelStats(ttype, cell.towerLevel || 1);
    const researchRangeBns = (wp[ttype]?.range) || 0;
    const towerRange = tdef.range + researchRangeBns + globalRangeBonus + lvStats.rangeBns;
    if (towerRange > maxRange) maxRange = towerRange;
  }

  return maxRange;
}

// Fix 3: Compute the view radius the camera must show to always cover full attack range.
// viewRadius >= fortressOuterRadius + maxAttackRange + 2 (so player sees full fire coverage).
function computeRequiredViewRadius(state) {
  const bp = getKeepBlueprint(state.castleLevel || 1);
  const fortressOuter = Math.max(...bp.wallRings, bp.buildRadius);
  const maxRange = getMaxActiveAttackRange(state);
  return fortressOuter + maxRange + 2;
}

// MAX_EFFECTIVE_RANGE and SPAWN_PADDING are now defined in the RADIUS SYSTEMS block above.

function spawnEnemy(type,diff,speedMult=1,fortressOuter=6){
  const base=ENEMY_TYPES[type];if(!base)return null;
  // Fix 3: spawn outside fortressOuter + MAX_EFFECTIVE_RANGE + SPAWN_PADDING.
  // fortressOuter = outermost wall ring radius (accounts for tower placement position).
  // This is independent of camera — enemies may be off-screen initially, which is fine.
  // They travel into view well before reaching the walls.
  const minDist=Math.min(fortressOuter+MAX_EFFECTIVE_RANGE+SPAWN_PADDING,Math.floor(GRID_SIZE/2)-1);
  const edge=rnd(0,3);let x,y;
  if(edge===0){x=rnd(0,GRID_SIZE-1);y=rnd(0,Math.max(0,HC-minDist));}
  else if(edge===1){x=rnd(0,Math.max(0,HC-minDist));y=rnd(0,GRID_SIZE-1);}
  else if(edge===2){x=rnd(Math.min(GRID_SIZE-1,HC+minDist),GRID_SIZE-1);y=rnd(0,GRID_SIZE-1);}
  else{x=rnd(0,GRID_SIZE-1);y=rnd(Math.min(GRID_SIZE-1,HR+minDist),GRID_SIZE-1);}
  return{id:mkId(),type,x:x+0.5,y:y+0.5,maxHp:Math.round(base.hp*diff.hpMult),hp:Math.round(base.hp*diff.hpMult),spd:base.spd*speedMult,dmg:Math.round(base.dmg*diff.dmgMult),gold:base.gold,targetWalls:base.targetWalls||false,isBoss:base.isBoss||false,attackCd:0};
}

function repairAllWalls(state){
  const cells={};for(const[k,c]of Object.entries(state.cells))cells[k]=c.type==="wall"?{...c,hp:c.maxHp}:c;
  return{...state,cells};
}
function applyWallHpBuff(state,mult){
  const cells={};
  for(const[k,c]of Object.entries(state.cells)){
    if(c.type==="wall"){const nm=Math.round(c.maxHp*mult);const r=c.maxHp>0?c.hp/c.maxHp:1;cells[k]={...c,maxHp:nm,hp:Math.round(nm*r)};}
    else cells[k]=c;
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
  const newLevel=lvl+1;
  const hk=`${HC},${HR}`;const heart=state.cells[hk];
  const prevBp=getKeepBlueprint(lvl);
  const newBp=getKeepBlueprint(newLevel);

  // Expand fortress physically using blueprint.
  // Pass the Iron Formation reinforcement flag so newly-placed blueprint cells are also reinforced.
  const reinforced = !!(state.blueprintReinforced);
  let newCells=applyFortressExpansion(state.cells,newLevel,state.wallHpMult||1,1,reinforced);

  // Fix 1: only add the DELTA in heartHpBonus between levels, not the full cumulative value.
  // e.g. Lv1→Lv2: delta = 60-0 = 60. Lv2→Lv3: delta = 120-60 = 60. Etc.
  if(heart){
    const hpDelta=newBp.heartHpBonus-prevBp.heartHpBonus;
    if(hpDelta>0){
      const newMax=heart.maxHp+hpDelta;
      newCells[hk]={...newCells[hk],maxHp:newMax,hp:Math.min(heart.hp+hpDelta,newMax)};
    }else{
      newCells[hk]={...newCells[hk]};
    }
  }

  // Compute newly unlocked tile keys for highlight
  const prevBuildable=getBuildableKeys(lvl);
  const newBuildable=getBuildableKeys(newLevel);
  const newlyUnlocked=new Set();
  for(const k of newBuildable)if(!prevBuildable.has(k))newlyUnlocked.add(k);

  // Build specific event messages for the log
  const expandEvents=[];
  if(newBp.wallRings.length>prevBp.wallRings.length) expandEvents.push("🧱 Outer wall ring raised!");
  else if(newLevel===2) expandEvents.push("🧱 Inner ring reinforced!");
  const newSockets=newBp.sockets.length-prevBp.sockets.length;
  if(newSockets>0) expandEvents.push(`🗼 ${newSockets} tower socket${newSockets>1?"s":""} unlocked!`);
  if(newBp.buildRadius>prevBp.buildRadius) expandEvents.push(`📐 Territory +${newBp.buildRadius-prevBp.buildRadius} tile radius`);

  // P3: Auto-tower placement for Lv6+ upgrades
  // Auto-towers are placed on the first available socket from preferSockets that is empty.
  // Never overwrites player towers, walls, or the heart.
  if(newBp.autoTowers&&newBp.autoTowers.length>0){
    const usedSockets=new Set();
    for(const at of newBp.autoTowers){
      if(!at.preferSockets||!TOWER_TYPES[at.towerType])continue;
      // Find first available preferred socket that hasn't been used by this upgrade pass
      const chosen=at.preferSockets.find(([c,r])=>{
        const k=`${c},${r}`;
        return !usedSockets.has(k)&&(!newCells[k]||newCells[k].type==="socket");
      });
      if(chosen){
        const [ac,ar]=chosen;const ak=`${ac},${ar}`;
        newCells[ak]={type:"tower",towerType:at.towerType,towerLevel:1,hp:60,maxHp:60,socketBonus:true,autoPlaced:true};
        usedSockets.add(ak);
        expandEvents.push(`🏰 Auto-placed ${TOWER_TYPES[at.towerType].label} tower!`);
      }
    }
  }

  // Fix 1: view radius expands only on keep upgrade, never from tower placement
  const newViewRadius = Math.max(
    state.unlockedViewRadius || VIEW_RADIUS_BY_LEVEL[0],
    VIEW_RADIUS_BY_LEVEL[Math.min(newLevel-1, VIEW_RADIUS_BY_LEVEL.length-1)]
  );

  return{...state,gold:free?state.gold:state.gold-cost,castleLevel:newLevel,cells:newCells,
    unlockedViewRadius: newViewRadius,
    newlyUnlockedTiles:newlyUnlocked,newlyUnlockedTimer:3500,
    _keepExpandEvents:expandEvents};
}
function lightenHex(hex,amount){
  const h=hex.replace("#","");const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return`#${[r,g,b].map(v=>Math.min(255,Math.round(v+(255-v)*amount)).toString(16).padStart(2,"0")).join("")}`;
}

function getInitialGrid(perks){
  const cells={};
  const hp=perks.permHeartHp||300;
  cells[`${HC},${HR}`]={type:"heart",hp,maxHp:hp};
  // Apply Keep Level 1 blueprint with Iron Formation reinforcement if researched.
  // The reinforced flag is passed into applyFortressExpansion so ALL blueprint walls
  // (including those created by future keep upgrades) start at level 2 when active.
  const wallHpMult = perks.permWallHpMult||1;
  const reinforced = !!(perks.researchWallRing);
  return applyFortressExpansion(cells, 1, 1, wallHpMult, reinforced);
}

function pickPerks(researchUpgrades,count=3){
  const hasChain=(researchUpgrades?.chain_unlock||0)>=1;
  const cardBonus=(researchUpgrades?.card_quality||0)>=1;
  const extraCard=(researchUpgrades?.card_choices||0)>=1;
  const n=extraCard?count+1:count;
  const pool=PERK_POOL.filter(p=>!(p.id==="chain_lightning"&&!hasChain));
  const weighted=[];
  for(const p of pool){const w=p.rarity==="rare"?(cardBonus?3:1):p.rarity==="uncommon"?3:5;for(let i=0;i<w;i++)weighted.push(p);}
  const chosen=[],seen=new Set();
  for(const p of[...weighted].sort(()=>Math.random()-0.5)){if(!seen.has(p.id)&&chosen.length<n){chosen.push(p);seen.add(p.id);}}
  return chosen;
}

// Compute the camera's target zoom radius.
// Uses whichever is larger: the keep-level unlocked view floor OR the furthest structure.
// This means destroying walls/towers can NEVER shrink the view radius.
// Fix 1+2: Camera target radius — driven by Keep level (unlockedViewRadius), not tower range.
// Placing/upgrading towers does NOT zoom out the map.
// Hard cap at ZOOM_MAX_RADIUS to preserve mobile playability.
// View NEVER shrinks: unlockedViewRadius is a one-way ratchet.
function computeTargetRadius(cells, unlockedViewRadius) {
  const floor = Math.max(ZOOM_MIN_RADIUS, unlockedViewRadius || ZOOM_MIN_RADIUS);
  // Walls at the very frontier can push the camera slightly, but only beyond the keep floor.
  // Sockets and towers inside the fortress do NOT push the camera.
  let maxR = floor;
  for (const [key, cell] of Object.entries(cells)) {
    if (cell.type === "socket" || cell.type === "tower") continue;  // only walls/heart push zoom
    const [c, r] = key.split(",").map(Number);
    const d = Math.max(Math.abs(c - HEART_COL), Math.abs(r - HEART_ROW));
    if (d > maxR) maxR = d;
  }
  return Math.min(maxR, ZOOM_MAX_RADIUS);
}

function computeFurthestRadius(cells) { return computeTargetRadius(cells, ZOOM_MIN_RADIUS); }

// ═══════════════════════════════════════════════════════════════
// INITIAL STATE
// ═══════════════════════════════════════════════════════════════
function makeInitialState(perks,save,diffTier){
  const perkInterval = perks.researchPerkFreq ? 90000 : PERK_INTERVAL;
  return{
    phase:"playing",
    xpAwarded:false,
    showUpgradeModal:false,showShop:false,showSettings:false,settingsTab:"credits",
    showTowerPanel:false,selectedTowerKey:null,
    showTowerList:false,showAscensionModal:false,
    elapsed:0,prevElapsed:0,
    diffTier,
    gold:GOLD_START+(perks.startGoldBonus||0)+(perks.researchStartGold||0),
    passiveGoldRate:(perks.permPassiveGold||0)+(perks.researchPassiveGold||0),
    passiveGoldAcc:0,
    kills:0,bossKills:0,totalGoldEarned:0,
    cells:getInitialGrid(perks),
    enemies:[],projectiles:[],towerCds:{},heartCd:0,
    castleLevel:1,wallRegenAcc:0,runUpgradeCounts:{},
    unlockedViewRadius: VIEW_RADIUS_BY_LEVEL[0],  // Fix 3: never decreases during a run
    selected:null,perks:[],rewardCards:[],
    upgradeTimer:perkInterval, perkInterval,
    spawnTimer:3000,spawnSlowTimer:0,
    waveTimer:WAVE_ROTATION_INTERVAL, currentWaveDef:WAVE_DEFS[0],
    hitFlashes:[],  // P2.4: [{x,y,dmg,color,ttl}] — floating damage numbers
    log:[],speedMult:1,enemySpeedMult:1,
    newlyUnlockedTiles: new Set(),  // highlights recently expanded territory
    atkSpdMult: perks.permSpdMult||1,
    wallHpMult: perks.permWallHpMult||1,
    goldMult:   (perks.researchGoldMult||1)*(diffTier.goldMult||1)*GOLD_KILL_MULT*(1+(perks.researchHardBonus&&diffTier.id!=="normal"?perks.researchHardBonus:0)),
    critChance:0, rangeBonus:0,
    dmgMult:    perks.permDmgMult||1,
    splashMult: 1,  // Bug2 fix: splashMult is only for perk/run multipliers, NOT weapon research splash (which lives in _weaponPerks.cannon.splash)
    supportBuff:0.30+(perks.researchSupportBuff||0)+(perks.weapSupportBuff||0),
    repairDisc: Math.min(0.8,(perks.permRepairDisc||0)+(perks.researchRepairDisc||0)),
    heartAtkMult:perks.permHeartAtkMult||1,
    bossGoldBonus:perks.researchBossGold||false,
    chainLightning:false,explosiveWalls:false,wallSpikes:false,
    wallRegenRate:perks.researchWallRegen||0,
    wallRegenCapExtra:perks.researchRegenCap||0,
    wallArmor:perks.researchWallArmor||0,
    blueprintReinforced: !!(perks.researchWallRing),  // Fix 2: Iron Formation applies to ALL future blueprint walls
    runUpgradeDisc: perks.researchUpgradeDisc||0,  // Bug1 fix: store on state for use in applyRunUpgrade
    // Weapon research — passed into tick for tower stat scaling
    _weaponPerks:{
      arrow:  {dmg:perks.weapArrowDmg||1,    spd:perks.weapArrowSpd||1,   range:perks.weapArrowRange||0},
      cannon: {dmg:perks.weapCannonDmg||1,   spd:perks.weapCannonSpd||1,  range:perks.weapCannonRange||0, splash:perks.weapCannonSplash||1},
      ballista:{dmg:perks.weapBallistaDmg||1, range:perks.weapBallistaRange||0, boss:perks.weapBallistaBoss||1},
      support:{buff:perks.weapSupportBuff||0, range:perks.weapSupportRange||0},
    },
    // Heart research
    _heartPerks:{dmg:perks.researchHeartDmg||1,range:perks.researchHeartRange||0,spd:perks.researchHeartSpd||1,crit:perks.researchHeartCrit||0},
    currentAscensionIdx:0,unlockedAscensionIdx:0,
    statWindow:[],totalWallDmg:0,totalHeartDmg:0,firstWallBroken:null,worstEnemy:{},
    _researchUpgrades:save.researchUpgrades||{},
    hasReroll:perks.researchReroll||false,
    cannonChain:perks.researchCannonChain||false,
    ascCostDisc:perks.researchAscCostDisc||0,
    ascBonusExtra:perks.researchAscBonus||0,
  };
}

// ═══════════════════════════════════════════════════════════════
// GAME TICK
// ═══════════════════════════════════════════════════════════════
function gameTick(state){
  if(state.phase!=="playing")return state;
  const prevElapsed=state.elapsed;
  const newlyUnlockedTimer=Math.max(0,(state.newlyUnlockedTimer||0)-BASE_TICK);
  let s={...state,elapsed:state.elapsed+BASE_TICK,prevElapsed,enemies:[...state.enemies],projectiles:[...state.projectiles],spawnSlowTimer:Math.max(0,state.spawnSlowTimer-BASE_TICK),newlyUnlockedTimer};

  // Fix 9: defensive guard — if phase transitions to gameover, close all modals and clear selection
  if(s.phase==="gameover"){
    return{...s,showUpgradeModal:false,showShop:false,showSettings:false,showTowerPanel:false,selectedTowerKey:null,showTowerList:false};
  }

  const diff=getDifficulty(s.elapsed,s.diffTier);
  const tier=getTier(s.currentAscensionIdx);
  const passiveB=tier.passiveBuff*(1+(s.ascBonusExtra||0));
  const unlockedAscensionIdx=Math.max(s.unlockedAscensionIdx,getUnlockedTierIdx(s.elapsed));

  const castleLvl=s.castleLevel||1;
  // Fix 3: use deterministic blueprint damage bonus, not the old linear formula
  const castleDmgBonus=1+getKeepBlueprint(castleLvl).castleDmgBonus;
  const castleGoldRate=(castleLvl-1)*CASTLE_LVL_GOLD_BONUS;

  let gold=s.gold;
  let pAcc=s.passiveGoldAcc+((s.passiveGoldRate+castleGoldRate)/1000)*BASE_TICK;
  if(pAcc>=1){gold+=Math.floor(pAcc);pAcc-=Math.floor(pAcc);}

  let upgradeTimer=s.upgradeTimer-BASE_TICK;
  let showUpgradeModal=s.showUpgradeModal,rewardCards=s.rewardCards;
  if(upgradeTimer<=0&&!showUpgradeModal){
    upgradeTimer=s.perkInterval||PERK_INTERVAL;showUpgradeModal=true;
    rewardCards=pickPerks(s._researchUpgrades);
  }

  let spawnTimer=s.spawnTimer-BASE_TICK;
  const enemies=[...s.enemies];

  // Fix 2+3: compute max attack range (capped) for combat; fortress outer for spawn distance.
  const maxAttackRange = Math.min(getMaxActiveAttackRange(s), MAX_EFFECTIVE_RANGE);
  const diffSpeedMult = (s.diffTier?.enemySpeedMult||1) * (s.enemySpeedMult||1);
  const bp_current = getKeepBlueprint(s.castleLevel || 1);
  const fortressOuter = Math.max(...bp_current.wallRings, bp_current.buildRadius);

  // All mutable tick state declared BEFORE any code that calls log.push()
  let kills=s.kills,bossKills=s.bossKills,totalGoldEarned=s.totalGoldEarned;
  let totalWallDmg=s.totalWallDmg,totalHeartDmg=s.totalHeartDmg,firstWallBroken=s.firstWallBroken;
  const worstEnemy={...s.worstEnemy};const log=[...s.log];const livingEnemies=[];
  const wallArmor=s.wallArmor||0;

  if(isBossTime(s.elapsed,prevElapsed)){
    const b=spawnEnemy("boss",diff,diffSpeedMult,fortressOuter);
    if(b){enemies.push(b);log.push("👹 BOSS INCOMING!");}
  }

  // Wave rotation — change wave type every WAVE_ROTATION_INTERVAL ms
  let waveTimer=(s.waveTimer||0)-BASE_TICK;
  let currentWaveDef=s.currentWaveDef||getWaveDef(s.elapsed);
  if(waveTimer<=0){
    waveTimer=WAVE_ROTATION_INTERVAL;
    // Pick from eligible wave defs at this time, rotate away from last one
    const eligible=WAVE_DEFS.filter(w=>s.elapsed/1000>=w.minSec);
    const choices=eligible.filter(w=>w.id!==currentWaveDef?.id);
    const next=choices.length>0?choices[Math.floor(Math.random()*choices.length)]:currentWaveDef;
    if(next.id!==currentWaveDef.id){
      currentWaveDef=next;
      log.push(next.waveDesc||`${next.icon} ${next.label}!`);
    }
  }

  if(spawnTimer<=0){
    const wd=currentWaveDef||getWaveDef(s.elapsed);
    const en=spawnEnemy(rndItem(wd.pool),diff,diffSpeedMult,fortressOuter);if(en)enemies.push(en);
    if(Math.random()<wd.extraSwarmChance){
      for(let i=0;i<rnd(1,Math.max(1,wd.extraCount));i++){
        const sw=spawnEnemy("swarm",diff,diffSpeedMult,fortressOuter);if(sw)enemies.push(sw);
      }
    }
    spawnTimer=getSpawnInterval(s.elapsed,s.spawnSlowTimer);
  }

  const cells={...s.cells};
  let wallRegenAcc=s.wallRegenAcc;
  if(s.wallRegenRate>0){
    wallRegenAcc+=(s.wallRegenRate/1000)*BASE_TICK;
    if(wallRegenAcc>=1){
      const pts=Math.floor(wallRegenAcc);wallRegenAcc-=pts;
      const cap=WALL_REGEN_MAX_PCT+(s.wallRegenCapExtra||0);
      for(const[k,c]of Object.entries(cells)){
        if(c.type==="wall"&&c.hp<c.maxHp){const capHp=Math.round(c.maxHp*cap);if(c.hp<capHp)cells[k]={...c,hp:Math.min(capHp,c.hp+pts)};}
      }
    }
  }

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
        const tc={...cells[tk]};
        // Wall armor research: reduce damage taken by walls
        const isWallLike = tc.type==="wall";
        const actualDmg=isWallLike?Math.round(en.dmg*(1-wallArmor)):en.dmg;
        const dmgDealt=Math.min(Math.max(0,tc.hp),actualDmg);
        tc.hp-=actualDmg;
        worstEnemy[en.type]=(worstEnemy[en.type]||0)+dmgDealt;
        if(isWallLike){totalWallDmg+=dmgDealt;tc.damageTaken=(tc.damageTaken||0)+dmgDealt;}
        if(tc.type==="heart")totalHeartDmg+=dmgDealt;
        if(s.wallSpikes&&isWallLike)en.hp=Math.max(0,en.hp-8);
        if(tc.hp<=0){
          if(tc.type==="heart")return{...s,cells:{...cells,[tk]:{...tc,hp:0}},phase:"gameover",totalWallDmg,totalHeartDmg,worstEnemy,kills,bossKills,totalGoldEarned,gold};
          if(isWallLike&&s.explosiveWalls){for(const xe of livingEnemies)if(dist({x:cx+0.5,y:cy+0.5},{x:xe.x,y:xe.y})<2.5)xe.hp=Math.max(0,xe.hp-50);log.push("💥 Wall exploded!");}
          if(isWallLike&&!firstWallBroken)firstWallBroken={time:s.elapsed,key:tk};
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

  let{selectedTowerKey,showTowerPanel}=s;
  // Fix 9: If selected structure was destroyed, clear panel gracefully
  if(selectedTowerKey&&selectedTowerKey!=="heart"&&!cells[selectedTowerKey]){selectedTowerKey=null;showTowerPanel=false;}
  if(selectedTowerKey==="heart"&&!cells[`${HC},${HR}`]){selectedTowerKey=null;showTowerPanel=false;}

  const towerCds={...s.towerCds};
  for(const k of Object.keys(towerCds))if(!cells[k])delete towerCds[k];
  const projs=[];const supBuff=s.supportBuff||0.30;let heartCd=s.heartCd-1;
  const wp=s._weaponPerks||{};
  const hp2=s._heartPerks||{dmg:1,range:0,spd:1,crit:0};
  const hitFlashes=[];

  for(const[key,cell]of Object.entries(cells)){
    if(cell.type==="heart"){
      if(heartCd<=0){
        const hm=(s.heartAtkMult||1)*(hp2.dmg||1);
        const hRange=HEART_TOWER.range+(hp2.range||0);
        let nearest=null,nearestD=Infinity;
        for(const en of livingEnemies){if(en.hp<=0)continue;const d=dist({x:HEART_COL+0.5,y:HEART_ROW+0.5},en);if(d<=hRange&&d<nearestD){nearest=en;nearestD=d;}}
        if(nearest){
          let dmg=Math.round(HEART_TOWER.dmg*hm*(s.dmgMult||1)*castleDmgBonus*(1+passiveB));
          if(Math.random()<((s.critChance||0)+(hp2.crit||0)))dmg*=2;
          nearest.hp=Math.max(0,nearest.hp-dmg);
          heartCd=Math.max(2,Math.round(HEART_TOWER.speed*(hp2.spd||1)/(s.heartAtkMult||1)));
          projs.push({id:mkId(),tx:nearest.x,ty:nearest.y,life:5,color:HEART_TOWER.color});
        }else heartCd=0;
      }
      continue;
    }
    if(cell.type!=="tower")continue;
    const ttype=cell.towerType;
    const tdef=TOWER_TYPES[ttype];
    if(!tdef||tdef.dmg===0)continue;

    towerCds[key]=(towerCds[key]||0)-1;if(towerCds[key]>0)continue;

    const[tc,tr]=key.split(",").map(Number);
    const lvStats=getTowerLevelStats(ttype,cell.towerLevel||1);

    // Weapon research multipliers applied to base stats for ALL towers of this type
    const wRes=wp[ttype]||{};
    const researchDmgMult  = wRes.dmg||1;
    const researchSpdMult  = wRes.spd||1;
    const researchRangeBns = wRes.range||0;
    const researchSplash   = wRes.splash||1;

    const range=Math.min(tdef.range+researchRangeBns+(s.rangeBonus||0)+lvStats.rangeBns, MAX_EFFECTIVE_RANGE);

    let buffMult=1+passiveB;
    for(const[k2,c2]of Object.entries(cells)){
      if(c2.type==="tower"&&c2.towerType==="support"){
        const[sx,sy]=k2.split(",").map(Number);const sv=getTowerLevelStats("support",c2.towerLevel||1);
        // Bug3 fix: use support tower's OWN range (TOWER_TYPES.support.range + research + level bonus), not the attacking tower's range
        const sBaseRange=TOWER_TYPES.support.range;
        const sRange=sBaseRange+(wp.support?.range||0)+sv.rangeBuff;
        if(dist({x:tc,y:tr},{x:sx,y:sy})<=sRange)buffMult+=supBuff+sv.buffBns;
      }
    }

    let nearest=null,nearestD=Infinity;
    for(const en of livingEnemies){
      if(en.hp<=0)continue;const d=dist({x:tc+0.5,y:tr+0.5},en);
      if(d<=range&&d<nearestD){nearest=en;nearestD=d;}
    }
    if(nearest){
      // Boss damage bonus for Ballista
      const isBossTarget=nearest.isBoss;
      const bossMult=(ttype==="ballista"&&isBossTarget)?(wp.ballista?.boss||1):1;
      // Fix 5: socket-built towers deal +10% damage
      const socketMult=cell.socketBonus?1.10:1;

      let dmg=Math.round(tdef.dmg*researchDmgMult*(s.dmgMult||1)*castleDmgBonus*lvStats.dmgMult*buffMult*bossMult*socketMult);
      if(Math.random()<(s.critChance||0))dmg*=2;
      towerCds[key]=Math.max(2,Math.round(tdef.speed*researchSpdMult*(s.atkSpdMult||1)*lvStats.spdMult));

      if(tdef.splash){
        // Bug2 fix: researchSplash is from weapon research (_weaponPerks.cannon.splash).
        // state.splashMult is ONLY for perks (e.g. Blast Radius perk). Never both applied together before.
        const splashR=tdef.splash*researchSplash*(s.splashMult||1);
        for(const en of livingEnemies)if(dist(nearest,en)<=splashR)en.hp=Math.max(0,en.hp-dmg);
        // Cannon chain research: secondary splash at half damage
        if(s.cannonChain){
          const sec2=livingEnemies.filter(e=>e!==nearest&&e.hp>0&&dist(nearest,e)<=splashR*1.5);
          for(const e of sec2.slice(0,3))e.hp=Math.max(0,e.hp-Math.round(dmg*0.3));
        }
      }else{
        nearest.hp=Math.max(0,nearest.hp-dmg);
        if(s.chainLightning&&ttype==="arrow"){
          const chained=livingEnemies.filter(e=>e!==nearest&&e.hp>0&&dist(nearest,e)<4.0).slice(0,2);
          for(const ce of chained){ce.hp=Math.max(0,ce.hp-Math.round(dmg*0.5));projs.push({id:mkId(),tx:ce.x,ty:ce.y,life:3,color:"#aaff00"});}
        }
      }
      projs.push({id:mkId(),tx:nearest.x,ty:nearest.y,life:3,color:tdef.color});
      // P2.4: emit hit flash for visual feedback
      hitFlashes.push({x:nearest.x,y:nearest.y,dmg,color:tdef.color,ttl:12,isCrit:Math.random()<(s.critChance||0)});
    }
  }

  // Tick down existing hit flashes from previous tick and merge with new ones
  const prevFlashes=(s.hitFlashes||[]).map(f=>({...f,ttl:f.ttl-1})).filter(f=>f.ttl>0);
  const allHitFlashes=[...prevFlashes,...hitFlashes];

  const snap={t:s.elapsed,gold,kills};
  const statWindow=[...s.statWindow.filter(w=>s.elapsed-w.t<5000),snap];
  const aliveProjs=[...s.projectiles,...projs].map(p=>({...p,life:p.life-1})).filter(p=>p.life>0);

  return{...s,gold,passiveGoldAcc:pAcc,kills,bossKills,totalGoldEarned,totalWallDmg,totalHeartDmg,firstWallBroken,worstEnemy,cells,enemies:livingEnemies,projectiles:aliveProjs,towerCds,heartCd,spawnTimer,upgradeTimer,showUpgradeModal,rewardCards,statWindow,wallRegenAcc,selectedTowerKey,showTowerPanel,unlockedAscensionIdx,log:log.slice(-4),
    hitFlashes:allHitFlashes,
    // Fix 1: unlockedViewRadius driven by keep level only — never shrinks, never expands from towers
    unlockedViewRadius:Math.max(
      s.unlockedViewRadius||VIEW_RADIUS_BY_LEVEL[0],
      VIEW_RADIUS_BY_LEVEL[Math.min((s.castleLevel||1)-1, VIEW_RADIUS_BY_LEVEL.length-1)]
    ),
    newlyUnlockedTiles:newlyUnlockedTimer>0?(s.newlyUnlockedTiles||new Set()):new Set(),
    newlyUnlockedTimer,waveTimer,currentWaveDef};
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
  const gs_selectedKey=state.selectedTowerKey;  // Fix 3: needed for click-to-deselect
  const addLog=msg=>({...state,log:[...state.log.slice(-3),msg]});

  // Enforce buildable radius (allow all tools EXCEPT placing new things outside territory)
  const buildable=getBuildableKeys(state.castleLevel||1);
  const isPlacementTool=tool==="wall"||!!TOWER_TYPES[tool];
  if(isPlacementTool&&!buildable.has(key)){
    return addLog(`❌ Upgrade Keep to build here`);
  }

  if(!tool){
    if(cell?.type==="tower"){
      // Fix 3: if already selected, deselect; otherwise select
      if(gs_selectedKey===key)return{...state,showTowerPanel:false,selectedTowerKey:null};
      return{...state,showTowerPanel:true,selectedTowerKey:key,showShop:false,showTowerList:false};
    }
    if(cell?.type==="heart"){
      // Fix 3+4+5: clicking the Fortress Core always clears build tool and opens keep panel;
      // if already selected, deselect
      if(gs_selectedKey==="heart")return{...state,selected:null,showTowerPanel:false,selectedTowerKey:null};
      return{...state,selected:null,showTowerPanel:true,selectedTowerKey:"heart",showShop:false,showTowerList:false};
    }
    if(cell?.type==="socket")return{...state,log:[...state.log.slice(-3),"🗼 Fortress socket — build here for +10% dmg bonus!"]};
    return{...state,showTowerPanel:false,selectedTowerKey:null};
  }
  if(tool==="sell"&&cell&&cell.type!=="heart"&&cell.type!=="socket"){
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
    const lvl=state.castleLevel||1;if(lvl>=CASTLE_RUN_MAX_LEVEL)return addLog("✅ Keep at max level");
    const cost=CASTLE_RUN_COSTS[lvl];if(state.gold<cost)return addLog(`❌ Need 💰${cost}`);
    const next=applyCastleLevelUp(state);const bp=getKeepBlueprint(next.castleLevel);
    // Collect expand event messages and push them to the log
    const evts=next._keepExpandEvents||[];
    const baseMsg=`🏰 Keep Lv${next.castleLevel}: ${bp.label}!`;
    const allMsgs=[baseMsg,...evts];
    const newLog=[...state.log,...allMsgs].slice(-4);
    return{...next,log:newLog,_keepExpandEvents:undefined};
  }
  if(tool==="upgrade"&&cell?.type==="wall"){
    const cost=25;if(state.gold<cost)return addLog("❌ Need 💰25");
    const newHp=Math.round(cell.maxHp*1.6);
    return{...state,gold:state.gold-cost,cells:{...state.cells,[key]:{...cell,maxHp:newHp,hp:newHp,level:(cell.level||1)+1}}};
  }
  if(tool==="repair"&&cell?.type==="wall"){
    if(cell.hp>=cell.maxHp)return addLog("✅ Wall already full");
    const cost=Math.max(5,Math.round(REPAIR_COST*(1-(state.repairDisc||0))));
    if(state.gold<cost)return addLog(`❌ Need 💰${cost}`);
    return{...state,gold:state.gold-cost,cells:{...state.cells,[key]:{...cell,hp:cell.maxHp}}};
  }
  if(tool==="wall"&&(!cell||cell.type==="socket")){
    if(state.gold<WALL_COST)return addLog(`❌ Need 💰${WALL_COST}`);
    const hp=Math.round(WALL_HP_BASE*(state.wallHpMult||1));
    const newCells={...state.cells,[key]:{type:"wall",hp,maxHp:hp,level:1,damageTaken:0}};
    return{...state,gold:state.gold-WALL_COST,cells:newCells};
  }
  if(TOWER_TYPES[tool]&&(!cell||cell.type==="socket")){
    const tdef=TOWER_TYPES[tool];if(state.gold<tdef.cost)return addLog(`❌ Need 💰${tdef.cost}`);
    const onSocket=cell?.type==="socket";
    const newCells={...state.cells,[key]:{type:"tower",towerType:tool,towerLevel:1,hp:60,maxHp:60,socketBonus:onSocket}};
    const msg=onSocket?`✅ Socket tower! +10% dmg bonus`:``;
    return{...state,gold:state.gold-tdef.cost,cells:newCells,...(msg?{log:[...state.log.slice(-3),msg]}:{})};
  }
  return state;
}

function applyRunUpgrade(state,item){
  const count=state.runUpgradeCounts?.[item.id]||0;
  const disc=state.runUpgradeDisc||0;  // Bug1 fix: use properly stored research discount
  const rawCost=getRunUpgradeCost(item,count);
  const cost=item.action==="repairWalls"?rawCost:Math.round(rawCost*(1-disc));
  if(state.gold<cost)return{...state,log:[...state.log.slice(-3),`❌ Need 💰${cost}`]};
  let s={...state,gold:state.gold-cost,runUpgradeCounts:{...state.runUpgradeCounts,[item.id]:count+1}};
  if(item.action==="repairWalls")s=repairAllWalls(s);
  if(item.action==="boostDmg")  s={...s,dmgMult:(s.dmgMult||1)*1.1};
  if(item.action==="boostSpd")  s={...s,atkSpdMult:(s.atkSpdMult||1)*0.9};
  if(item.action==="goldIncome")s={...s,passiveGoldRate:s.passiveGoldRate+3};
  if(item.action==="boostRange")s={...s,rangeBonus:(s.rangeBonus||0)+1.0};
  if(item.action==="repairDisc")s={...s,repairDisc:Math.min(0.8,(s.repairDisc||0)+0.2)};
  if(item.action==="heartBoost")s={...s,heartAtkMult:(s.heartAtkMult||1)*1.25};
  if(item.action==="wallHp")    s=applyWallHpBuff(s,1.2);
  return{...s,log:[...s.log.slice(-3),`✅ ${item.label}!`]};
}

function buildFailureAnalysis(gs){
  const sorted=Object.entries(gs.worstEnemy||{}).sort((a,b)=>b[1]-a[1]);const wt=sorted[0];
  const towers=Object.values(gs.cells).filter(c=>c.type==="tower").length;
  const walls=Object.values(gs.cells).filter(c=>c.type==="wall").length;
  const runLevel=calcRunLevel(gs.elapsed);const suggestions=[];
  if(wt?.[0]==="swarm")suggestions.push("Swarms caused the most damage — build a Cannon before 60 seconds.");
  if(wt?.[0]==="runner")suggestions.push("Runners slipped through — close wall gaps and use Arrow towers.");
  if(wt?.[0]==="boss")suggestions.push("Boss damage was decisive — invest in a Ballista before 90 seconds.");
  if(wt?.[0]==="siege")suggestions.push("Siege units destroyed your walls — prioritise them with Arrow towers.");
  if(wt?.[0]==="brute")suggestions.push("Brutes absorbed too much — upgraded Ballistae deal massive single-target DPS.");
  if(gs.totalHeartDmg>gs.totalWallDmg*0.4)suggestions.push("Enemies bypassed your walls — add more layers and close gaps.");
  if(towers<3)suggestions.push("You had fewer than 3 towers — aim for 3–4 before 60 seconds.");
  if(walls<5) suggestions.push("Sparse walls let enemies through — a full outer ring dramatically helps.");
  if(runLevel<=3)suggestions.push(`You reached Level ${runLevel} — place walls and an Arrow tower in the first 30 seconds.`);
  if(suggestions.length===0)suggestions.push("Solid run! Try upgrading towers to Level 2–3 for a major DPS boost.");
  if((gs.castleLevel||1)<3&&gs.elapsed>90000)suggestions.push("Your Keep was low level — upgrading it expands your fortress and adds wall rings automatically.");
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
  const [showDev,setShowDev] = useState(false);
  const xpAwardedRef = useRef(false);

  // Dynamic cell size — fills screen width
  const [cellSize,setCellSize] = useState(()=>Math.floor(Math.min(window.innerWidth,520)/GRID_SIZE));
  useEffect(()=>{
    const update=()=>setCellSize(Math.floor(Math.min(window.innerWidth,520)/GRID_SIZE));
    update();window.addEventListener("resize",update);return()=>window.removeEventListener("resize",update);
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

  useEffect(()=>{
    if(gs?.phase!=="gameover")return;
    if(xpAwardedRef.current)return;
    xpAwardedRef.current=true;
    const tierIdx=getTierIdx(gs.elapsed);
    const perks=computePerks(save);
    const dt=gs.diffTier||DIFFICULTY_TIERS[0];
    const xpEarned=calcXp(gs,tierIdx,perks,dt);
    const runLevel=calcRunLevel(gs.elapsed);
    const diffId=dt.id;
    const newSave={...save,totalXp:save.totalXp+xpEarned,lifetimeKills:save.lifetimeKills+gs.kills,lifetimeBosses:save.lifetimeBosses+gs.bossKills,bestTime:Math.max(save.bestTime,gs.elapsed),bestTierIdx:Math.max(save.bestTierIdx,tierIdx),bestLevel:Math.max(save.bestLevel||0,runLevel),bestLevelByDiff:{...(save.bestLevelByDiff||{normal:0,hard:0,nightmare:0}),[diffId]:Math.max((save.bestLevelByDiff?.[diffId]||0),runLevel)}};
    setSave(newSave);saveGame(newSave);
    setRunResult({xpEarned,gs,tierIdx,runLevel,analysis:buildFailureAnalysis(gs)});
  },[gs?.phase]);

  const handleCellTap=useCallback((c,r)=>setGs(p=>(!p||p.phase!=="playing")?p:applyBuild(p,c,r)),[]);
  const handleSelectTool=useCallback(tool=>setGs(p=>p?{...p,selected:tool?{tool}:null,showTowerPanel:false,selectedTowerKey:null,showTowerList:false}:p),[]);
  const handleClearTool=useCallback(()=>setGs(p=>p?{...p,selected:null}:p),[]);
  const handlePerkSelect=useCallback(perk=>{setGs(prev=>{if(!prev)return prev;const u=perk.apply(prev);return{...u,showUpgradeModal:false,perks:[...prev.perks,perk.id],rewardCards:[],upgradeTimer:prev.perkInterval||PERK_INTERVAL};});},[]);
  const handleRunUpgrade=useCallback(item=>setGs(prev=>prev?applyRunUpgrade(prev,item):prev),[]);
  const handleTowerUpgrade=useCallback(key=>{setGs(prev=>{if(!prev)return prev;if(key==="castle")return applyBuild({...prev,selected:{tool:"castle_up"}},HEART_COL,HEART_ROW);const cell=prev.cells[key];if(!cell||cell.type!=="tower")return prev;return applyBuild({...prev,selected:{tool:"upgrade_tower"}},+key.split(",")[0],+key.split(",")[1]);});},[]);
  const handleSpeedChange=useCallback(m=>setGs(p=>p?{...p,speedMult:m}:p),[]);
  const handleToggleShop=useCallback(()=>setGs(p=>p?{...p,showShop:!p.showShop,showSettings:false,showTowerPanel:false,showTowerList:false}:p),[]);
  const handleToggleSettings=useCallback(()=>setGs(p=>p?{...p,showSettings:!p.showSettings,showShop:false}:p),[]);
  const handleSetSettingsTab=useCallback(t=>setGs(p=>p?{...p,settingsTab:t}:p),[]);
  const handleCloseTowerPanel=useCallback(()=>setGs(p=>p?{...p,showTowerPanel:false,selectedTowerKey:null,selected:null}:p),[]);
  const handleToggleTowerList=useCallback(()=>setGs(p=>p?{...p,showTowerList:!p.showTowerList,showShop:false,showTowerPanel:false,showSettings:false}:p),[]);
  const handleAscend=useCallback(()=>{setGs(prev=>{if(!prev)return prev;const nextIdx=prev.currentAscensionIdx+1;if(nextIdx>prev.unlockedAscensionIdx)return{...prev,log:[...prev.log.slice(-3),"⏳ Survive longer to unlock"]};const baseCost=ASCENSION_COSTS[prev.currentAscensionIdx]||0;const cost=Math.round(baseCost*(1-(prev.ascCostDisc||0)));if(prev.gold<cost)return{...prev,log:[...prev.log.slice(-3),`❌ Need 💰${cost} to ascend`]};const nextTier=getTier(nextIdx);return{...prev,gold:prev.gold-cost,currentAscensionIdx:nextIdx,showAscensionModal:false,log:[...prev.log.slice(-3),`✨ Ascended to ${nextTier.name}!`]};});},[]);
  const handlePerkReroll=useCallback(()=>{setGs(prev=>{if(!prev||!prev.hasReroll||prev.rerollUsed)return prev;return{...prev,rewardCards:pickPerks(prev._researchUpgrades),rerollUsed:true};});},[]);

  const handleMetaUpgrade=useCallback((categoryId,id,mult)=>{
    setSave(prev=>{
      // Castle upgrades
      if(categoryId==="castle"){
        const upg=CASTLE_UPGRADES.find(u=>u.id===id);if(!upg)return prev;
        const cur=prev.castleUpgrades?.[id]||0;
        const times=mult==="max"?upg.maxLevel-cur:Math.min(Number(mult),upg.maxLevel-cur);
        if(times<=0)return prev;
        let xp=prev.totalXp,lvl=cur,updated={...(prev.castleUpgrades||{})};
        for(let i=0;i<times;i++){const c=getUpgradeCost(upg,lvl);if(xp<c)break;xp-=c;lvl++;updated[id]=lvl;}
        const next={...prev,totalXp:xp,castleUpgrades:updated};saveGame(next);return next;
      }
      // Research categories
      const upg=ALL_RESEARCH_UPGRADES.find(u=>u.id===id);if(!upg)return prev;
      const cur=prev.researchUpgrades?.[id]||0;
      const times=mult==="max"?upg.maxLevel-cur:Math.min(Number(mult),upg.maxLevel-cur);
      if(times<=0)return prev;
      let xp=prev.totalXp,lvl=cur,updated={...(prev.researchUpgrades||{})};
      for(let i=0;i<times;i++){const c=getUpgradeCost(upg,lvl);if(xp<c)break;xp-=c;lvl++;updated[id]=lvl;}
      const next={...prev,totalXp:xp,researchUpgrades:updated};saveGame(next);return next;
    });
  },[]);

  const handleEndRun=useCallback(()=>{
    setGs(prev=>{
      if(!prev||prev.phase!=="playing")return prev;
      return{...prev,phase:"gameover",voluntaryEnd:true,showSettings:false};
    });
  },[]);
  const handleResetSave=useCallback(()=>{if(window.confirm("Reset all progress?")){const blank=resetSave();setSave(blank);setScreen("menu");setGs(null);}},[]);

  const currentTier=gs?getTier(gs.currentAscensionIdx):ASCENSION_TIERS[0];

  return(
    <div style={{minHeight:"100vh",background:gs?.phase==="playing"?currentTier.bg:"#0a0a0f",display:"flex",flexDirection:"column",alignItems:"center",fontFamily:"'Segoe UI',system-ui,sans-serif",color:"#fff",transition:"background 2s ease",userSelect:"none",position:"relative",WebkitTapHighlightColor:"transparent"}}>
      {screen==="menu"&&<MenuScreen onStart={startRun} onMeta={goMeta} save={save} diffTierId={diffTierId} onSetDiff={setDiffTierId}/>}
      {screen==="game"&&gs&&(
        <GameScreen gs={gs} tier={currentTier} cellSize={cellSize}
          onCellTap={handleCellTap} onSelectTool={handleSelectTool} onClearTool={handleClearTool}
          onPerkSelect={handlePerkSelect} onPerkReroll={handlePerkReroll}
          onRunUpgrade={handleRunUpgrade}
          onTowerUpgrade={handleTowerUpgrade} onCloseTowerPanel={handleCloseTowerPanel}
          onToggleTowerList={handleToggleTowerList}
          onSpeedChange={handleSpeedChange}
          onToggleShop={handleToggleShop} onToggleSettings={handleToggleSettings}
          onSetSettingsTab={handleSetSettingsTab}
          onAscend={handleAscend}
          onToggleAscensionModal={()=>setGs(p=>p?{...p,showAscensionModal:!p.showAscensionModal}:p)}
          onRestart={()=>{setScreen("menu");setGs(null);}}
          onEndRun={handleEndRun}
          onGoMeta={goMeta} runResult={runResult}/>
      )}
      {screen==="meta"&&<MetaScreen save={save} onUpgrade={handleMetaUpgrade} onStart={startRun} onMenu={goMenu} runResult={runResult} buyMult={buyMult} onSetBuyMult={setBuyMult} onReset={handleResetSave}/>}
      {/* Dev panel toggle — bottom-right corner, only in DEV_MODE */}
      {DEV_MODE&&<button onClick={()=>setShowDev(v=>!v)} style={{position:"fixed",bottom:8,right:8,background:"rgba(231,76,60,0.15)",border:"1px solid #e74c3c44",borderRadius:6,color:"#e74c3c",fontSize:10,padding:"4px 8px",cursor:"pointer",zIndex:9998}}>🛠</button>}
      {DEV_MODE&&showDev&&<DevPanel gs={gs} save={save} onGs={setGs} onSave={setSave} onClose={()=>setShowDev(false)}/>}
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
      <div style={{textAlign:"center"}}><div style={{fontSize:52,marginBottom:4}}>🏰</div>
        <h1 style={{fontSize:28,fontWeight:900,margin:0,letterSpacing:3,textTransform:"uppercase",background:"linear-gradient(135deg,#FFD700,#FF6B35,#C41E3A)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Mythic Fortress</h1>
        <div style={{color:"#8a7fc0",fontSize:10,letterSpacing:2,marginTop:3}}>IDLE SIEGE · ROGUELITE</div>
      </div>
      <div style={{width:"100%",maxWidth:340}}>
        <div style={{fontSize:9,color:"#555",textAlign:"center",letterSpacing:1,marginBottom:6,textTransform:"uppercase"}}>Select Difficulty</div>
        <div style={{display:"flex",gap:6}}>
          {DIFFICULTY_TIERS.map(d=>{const unlocked=isDifficultyUnlocked(d.id,save);const sel=diffTierId===d.id;const uc=d.unlockCondition;const hint=uc?`${uc.difficulty.charAt(0).toUpperCase()+uc.difficulty.slice(1)} Lv${uc.minLevel}`:null;
            return(<button key={d.id} onClick={()=>unlocked&&onSetDiff(d.id)} style={{flex:1,padding:"10px 4px",borderRadius:10,cursor:unlocked?"pointer":"default",background:sel?"rgba(255,215,0,0.12)":"rgba(255,255,255,0.04)",border:`1px solid ${sel?"#FFD70066":unlocked?"#2a2a2a":"#161616"}`,color:sel?"#FFD700":unlocked?"#aaa":"#333",fontSize:11,fontWeight:sel?700:400}}>
              <div style={{fontSize:18}}>{d.icon}</div><div style={{marginTop:2}}>{d.label}</div>
              {!unlocked&&hint&&<div style={{fontSize:8,color:"#444",marginTop:3}}>Reach {hint}</div>}
              {unlocked&&d.id!=="normal"&&<div style={{fontSize:8,color:"#888",marginTop:2}}>✓ Unlocked</div>}
            </button>);
          })}
        </div>
        <div style={{fontSize:10,color:"#666",textAlign:"center",marginTop:6,lineHeight:1.4}}>{dt.desc}</div>
        {diffTierId!=="normal"&&<div style={{fontSize:10,color:"#888",textAlign:"center",marginTop:2}}>Gold ×{dt.goldMult} · XP ×{dt.xpMult}{dt.enemySpeedMult>1?` · Speed ×${dt.enemySpeedMult}`:""}</div>}
      </div>
      {save.totalXp>0&&<div style={{fontSize:11,color:"#555"}}>⭐{save.totalXp} XP · Best {formatTime(save.bestTime)}{save.bestLevel>0?` · Lv${save.bestLevel}`:""}</div>}
      <div style={{display:"flex",gap:10}}>
        <button onClick={onStart} style={{background:"linear-gradient(135deg,#FFD700,#FF8C00)",border:"none",borderRadius:14,padding:"16px 36px",fontSize:17,fontWeight:800,color:"#1a0a00",cursor:"pointer",boxShadow:"0 0 22px rgba(255,200,0,0.4)",minHeight:52}}>⚔️ SIEGE</button>
        <button onClick={onMeta} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.18)",borderRadius:14,padding:"16px 20px",fontSize:16,fontWeight:700,color:"#ddd",cursor:"pointer",minHeight:52}}>⭐ Research</button>
      </div>
    </div>
  );
}

function GameScreen({gs,tier,cellSize,onCellTap,onSelectTool,onClearTool,onPerkSelect,onPerkReroll,onRunUpgrade,onTowerUpgrade,onCloseTowerPanel,onToggleTowerList,onSpeedChange,onToggleShop,onToggleSettings,onSetSettingsTab,onAscend,onToggleAscensionModal,onRestart,onGoMeta,runResult,onEndRun}){
  if (gs.phase === "gameover") {
    return (
      <GameOverScreen gs={gs} tier={tier} runResult={runResult} onGoMeta={onGoMeta} onRestart={onRestart}/>
    );
  }
  const stats=computeStats(gs);const level=calcRunLevel(gs.elapsed);
  return(
    <div style={{display:"flex",flexDirection:"column",width:"100%",maxWidth:520,padding:"0",minHeight:"100vh",position:"relative"}}>
      <div style={{padding:"6px 8px 0"}}>
        <TopHUD gs={gs} tier={tier} level={level} onToggleSettings={()=>{onSetSettingsTab("credits");onToggleSettings();}} onToggleAscensionModal={onToggleAscensionModal} onOpenFortress={()=>{onCellTap(HEART_COL,HEART_ROW);}}/>
        <TierBadge gs={gs} tier={tier}/>
      </div>
      <ZoomGrid gs={gs} tier={tier} cellSize={cellSize} onCellTap={onCellTap}/>
      <div style={{padding:"0 8px"}}>
        <LiveStats gs={gs} stats={stats} level={level}/>
        <NextActionAdvisor gs={gs}/>
        <SpeedBar speedMult={gs.speedMult} onChange={onSpeedChange}/>
        <Toolbar gs={gs} tier={tier} onSelectTool={onSelectTool} onClearTool={onClearTool} onToggleShop={onToggleShop} onToggleTowerList={onToggleTowerList} onOpenFortress={()=>onCellTap(HEART_COL,HEART_ROW)}/>
        <LogBar entries={gs.log}/>
      </div>
      {gs.showShop&&<ShopOverlay gs={gs} tier={tier} onBuy={onRunUpgrade} onClose={onToggleShop}/>}
      {gs.showTowerList&&!gs.showShop&&<TowerListPanel gs={gs} tier={tier} onUpgrade={onTowerUpgrade} onClose={onToggleTowerList}/>}
      {gs.showTowerPanel&&!gs.showShop&&!gs.showTowerList&&<TowerPanel gs={gs} tier={tier} onUpgrade={onTowerUpgrade} onClose={onCloseTowerPanel} onAscend={onAscend}/>}
      {gs.showUpgradeModal&&gs.phase==="playing"&&<PerkModal gs={gs} tier={tier} onSelect={onPerkSelect} onReroll={onPerkReroll}/>}
      {gs.showSettings&&<SettingsOverlay gs={gs} tier={tier} onClose={onToggleSettings} onSetTab={onSetSettingsTab} onEndRun={onEndRun}/>}
    </div>
  );
}

function TopHUD({gs,tier,level,onToggleSettings,onToggleAscensionModal,onOpenFortress}){
  const heart=gs.cells[`${HEART_COL},${HEART_ROW}`];const hpPct=heart?heart.hp/heart.maxHp:0;
  const nextSec=Math.ceil(gs.upgradeTimer/1000);const urgent=nextSec<=12;
  const castLvl=gs.castleLevel||1;const canAscend=gs.unlockedAscensionIdx>gs.currentAscensionIdx;
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
        <div onClick={()=>{onToggleSettings&&onOpenFortress&&onOpenFortress();}} style={{fontSize:10,color:"#FFD700",padding:"2px 6px",borderRadius:4,background:"rgba(255,215,0,0.08)",border:"1px solid #FFD70033",cursor:"pointer",display:"flex",alignItems:"center",gap:3}} title="Open Fortress panel">
          <span>🏰</span>
          <span style={{fontWeight:700}}>{castLvl}/{CASTLE_RUN_MAX_LEVEL}</span>
          {castLvl<CASTLE_RUN_MAX_LEVEL&&<span style={{fontSize:8,color:"#888"}}>💰{CASTLE_RUN_COSTS[castLvl]}</span>}
        </div>
        {canAscend&&<button onClick={()=>onOpenFortress&&onOpenFortress()} style={{background:"rgba(138,63,170,0.2)",border:"1px solid #8B6FE8",borderRadius:5,color:"#8B6FE8",fontSize:10,padding:"2px 6px",cursor:"pointer",fontWeight:700}} title="Open Fortress panel to ascend">✨</button>}
        <button onClick={onToggleSettings} style={{background:"none",border:"1px solid #222",borderRadius:5,color:"#444",fontSize:10,padding:"3px 7px",cursor:"pointer",minHeight:28}}>⚙️</button>
      </div>
    </div>
  );
}

function TierBadge({gs,tier}){
  const sec=gs.elapsed/1000;const currentIdx=gs.currentAscensionIdx;
  const nextTier=ASCENSION_TIERS[currentIdx+1];const unlockSec=nextTier?.minSec||0;
  const pct=nextTier?Math.min(1,sec/unlockSec):1;
  return(
    <div style={{textAlign:"center",marginBottom:2}}>
      <div style={{fontSize:10,color:tier.wallColor,letterSpacing:2,fontWeight:700,textTransform:"uppercase"}}>{tier.name}</div>
      {nextTier&&(<div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,marginTop:1}}>
        <div style={{width:65,height:3,background:"#1a1a1a",borderRadius:2,overflow:"hidden"}}><div style={{width:`${pct*100}%`,height:"100%",background:tier.wallColor,transition:"width 1s"}}/></div>
        <span style={{fontSize:9,color:"#444"}}>→{nextTier.name} ({nextTier.minSec}s)</span>
      </div>)}
    </div>
  );
}

// ─── ZOOM GRID ─── Dynamic zoom based on furthest structure from heart
function ZoomGrid({gs,tier,cellSize,onCellTap}){
  const ref       = useRef(null);
  const zoomRef   = useRef(ZOOM_MIN_RADIUS); // current zoom radius (smoothly interpolated)

  const S = cellSize || 20;
  const W = GRID_SIZE * S;

  useEffect(()=>{
    const cv=ref.current;if(!cv)return;
    const ctx=cv.getContext("2d");

    // Fix 1: Camera driven by Keep level (unlockedViewRadius), NOT tower range.
    const targetRadius = computeTargetRadius(gs.cells, gs.unlockedViewRadius || VIEW_RADIUS_BY_LEVEL[0]);

    // Smooth zoom interpolation
    zoomRef.current = zoomRef.current + (targetRadius - zoomRef.current) * ZOOM_SPEED;
    const zRadius = zoomRef.current;

    // Convert radius to a visible tile count (diameter + margin)
    const visibleTiles = Math.max(7, Math.round(zRadius * 2 + 4));
    const clampedVisible = Math.min(visibleTiles, GRID_SIZE);

    // Scale: how many canvas pixels per grid tile at this zoom
    const scale = W / clampedVisible;

    // Camera center offset — keep heart centered
    const camOffX = (HEART_COL + 0.5) * scale - W / 2;
    const camOffY = (HEART_ROW + 0.5) * scale - W / 2;

    ctx.clearRect(0,0,W,W);
    ctx.save();
    ctx.translate(-camOffX, -camOffY);

    // Background
    for(let r=0;r<GRID_SIZE;r++) for(let c=0;c<GRID_SIZE;c++){
      ctx.fillStyle=(r+c)%2===0?"rgba(255,255,255,0.018)":"rgba(0,0,0,0.08)";
      ctx.fillRect(c*scale,r*scale,scale,scale);
    }

    // Buildable zone tint — show player where they can build
    const castleLvlForBuild=gs.castleLevel||1;
    const buildableSet=getBuildableKeys(castleLvlForBuild);
    const nextBuildable=castleLvlForBuild<CASTLE_RUN_MAX_LEVEL?getBuildableKeys(castleLvlForBuild+1):null;

    for(let r2=0;r2<GRID_SIZE;r2++) for(let c2=0;c2<GRID_SIZE;c2++){
      const k=`${c2},${r2}`;
      if(gs.cells[k])continue; // occupied
      const x2=c2*scale,y2=r2*scale;
      if(gs.newlyUnlockedTiles?.has&&gs.newlyUnlockedTiles.has(k)&&(gs.newlyUnlockedTimer||0)>0){
        // Flash newly unlocked tiles gold
        const pulse=0.1+0.12*Math.sin(Date.now()/200);
        ctx.fillStyle=`rgba(255,215,0,${pulse})`;ctx.fillRect(x2,y2,scale,scale);
      } else if(buildableSet.has(k)){
        ctx.fillStyle="rgba(255,255,180,0.035)";ctx.fillRect(x2,y2,scale,scale);
      } else if(nextBuildable?.has(k)){
        // Preview of next keep level territory — very faint
        ctx.fillStyle="rgba(100,180,255,0.018)";ctx.fillRect(x2,y2,scale,scale);
      }
    }

    // Structures
    for(const[key,cell]of Object.entries(gs.cells)){
      const[c,r]=key.split(",").map(Number);const x=c*scale,y=r*scale;
      if(cell.type==="heart"){
        ctx.fillStyle="#120600";ctx.fillRect(x,y,scale,scale);
        const hpPct=cell.hp/cell.maxHp;
        ctx.shadowColor=tier.heartColor;ctx.shadowBlur=5+hpPct*8;
        ctx.font=`${scale*0.72}px serif`;ctx.textAlign="center";ctx.fillText("🏰",x+scale/2,y+scale*0.8);
        ctx.shadowBlur=0;hpBar(ctx,x,y+scale-4,scale,4,hpPct);
        if(gs.heartCd<=3){ctx.strokeStyle="rgba(255,70,100,0.7)";ctx.lineWidth=2;ctx.strokeRect(x+1,y+1,scale-2,scale-2);}
      }else if(cell.type==="wall"){
        const lvl=cell.level||1;
        const col=lvl>=3?lightenHex(tier.wallColor,0.35):lvl===2?tier.wallColor+"cc":tier.wallColor+"88";
        ctx.fillStyle=col;ctx.fillRect(x,y,scale,scale);
        ctx.fillStyle="rgba(255,255,255,0.14)";ctx.fillRect(x,y,scale,3);
        const dp=1-cell.hp/cell.maxHp;
        if(dp>0.3){ctx.strokeStyle="rgba(0,0,0,0.45)";ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(x+2,y+3);ctx.lineTo(x+scale-2,y+scale-2);ctx.stroke();}
        if(lvl>=2&&scale>=12){ctx.font=`${scale*0.38}px sans-serif`;ctx.fillStyle="#fff";ctx.textAlign="center";ctx.fillText(`${lvl}`,x+scale/2,y+scale*0.52);}
        hpBar(ctx,x,y+scale-4,scale,4,cell.hp/cell.maxHp);
      }else if(cell.type==="socket"){
        // Fortress socket — faint dashed gold outline, placement hint
        ctx.fillStyle="rgba(255,215,0,0.07)";ctx.fillRect(x,y,scale,scale);
        ctx.strokeStyle="rgba(255,215,0,0.30)";ctx.lineWidth=1;ctx.setLineDash([2,3]);
        ctx.strokeRect(x+1,y+1,scale-2,scale-2);ctx.setLineDash([]);
        if(scale>=14){ctx.font=`${scale*0.42}px sans-serif`;ctx.fillStyle="rgba(255,215,0,0.55)";ctx.textAlign="center";ctx.fillText("🗼",x+scale/2,y+scale*0.68);}
      }else if(cell.type==="tower"){
        const tdef=TOWER_TYPES[cell.towerType]||{};const tLvl=cell.towerLevel||1;
        ctx.fillStyle=tdef.color+"14";ctx.fillRect(x,y,scale,scale);
        const ba=Math.min(0.95,0.35+tLvl*0.14);
        ctx.strokeStyle=tdef.color+Math.round(ba*255).toString(16).padStart(2,"0");
        ctx.lineWidth=1.2+tLvl*0.2;ctx.strokeRect(x+0.5,y+0.5,scale-1,scale-1);
        ctx.font=`${scale*0.6}px serif`;ctx.textAlign="center";ctx.fillText(tdef.icon||"🗼",x+scale/2,y+scale*0.74);
        if(tLvl>=2&&scale>=12){ctx.font=`${scale*0.32}px sans-serif`;ctx.fillStyle=tdef.color;ctx.textAlign="center";ctx.fillText(`L${tLvl}`,x+scale/2,y+scale-4);}
        hpBar(ctx,x,y+scale-4,scale,4,cell.hp/cell.maxHp);
        if(gs.selectedTowerKey===key){ctx.strokeStyle="#FFD700";ctx.lineWidth=2;ctx.strokeRect(x+1,y+1,scale-2,scale-2);}
        if(tLvl<TOWER_MAX_LEVEL){ctx.fillStyle="#FFD700";ctx.beginPath();ctx.arc(x+scale-3,y+3,2.5,0,Math.PI*2);ctx.fill();}
        // Socket-built towers show a small gold star in bottom-left corner
        if(cell.socketBonus&&scale>=12){ctx.fillStyle="#FFD700";ctx.font=`${scale*0.28}px sans-serif`;ctx.textAlign="left";ctx.fillText("★",x+2,y+scale-2);}
      }
    }

    // Enemies
    for(const en of (gs.enemies||[])){
      if(!en||en.hp<=0)continue;
      const edef=ENEMY_TYPES[en.type];const px=en.x*scale,py=en.y*scale;
      ctx.fillStyle="rgba(0,0,0,0.18)";ctx.beginPath();ctx.ellipse(px,py+3,scale*0.3,scale*0.13,0,0,Math.PI*2);ctx.fill();
      ctx.font=`${en.isBoss?scale*1.1:scale*0.68}px serif`;ctx.textAlign="center";ctx.fillText(edef.icon,px,py+(en.isBoss?scale*0.52:scale*0.3));
      const bw=en.isBoss?scale*1.7:scale*0.9;
      hpBar(ctx,px-bw/2,py-scale*0.55,bw,en.isBoss?5:3,en.hp/en.maxHp,en.isBoss?"#ff00ff":edef.color);
    }

    // Projectiles
    for(const p of (gs.projectiles||[])){if(!p)continue;ctx.fillStyle=(p.color||"#fff")+"cc";ctx.beginPath();ctx.arc(p.tx*scale,p.ty*scale,2.5,0,Math.PI*2);ctx.fill();}

    // Hit flashes — floating damage numbers (P2.4)
    for(const f of gs.hitFlashes||[]){
      const alpha=f.ttl/12;
      const rise=(12-f.ttl)*0.3;  // float upward
      const px=f.x*scale, py=f.y*scale-rise*scale;
      ctx.globalAlpha=alpha;
      ctx.font=`bold ${f.isCrit?scale*0.55:scale*0.38}px sans-serif`;
      ctx.fillStyle=f.isCrit?"#FFD700":f.color;
      ctx.textAlign="center";
      ctx.fillText(f.isCrit?`💥${f.dmg}`:f.dmg,px,py);
      ctx.globalAlpha=1;
    }

    ctx.restore();
  },[gs,tier,S,W]);

  return(
    <canvas ref={ref} width={W} height={W}
      style={{display:"block",width:"100%",height:"auto",cursor:"pointer",touchAction:"none"}}
      onClick={e=>{
        const cv=e.currentTarget;const rect=cv.getBoundingClientRect();
        // Bug5 fix: use the same smoothed zoom value as rendering (zoomRef.current), not raw target
        const zRadius=zoomRef.current;
        const visibleTiles=Math.max(7,Math.round(zRadius*2+4));
        const clampedVisible=Math.min(visibleTiles,GRID_SIZE);
        const scale=(W/clampedVisible);
        const camOffX=(HEART_COL+0.5)*scale-W/2;
        const camOffY=(HEART_ROW+0.5)*scale-W/2;
        const cssScale=W/rect.width;
        const canvasX=(e.clientX-rect.left)*cssScale;
        const canvasY=(e.clientY-rect.top)*cssScale;
        const col=Math.floor((canvasX+camOffX)/scale);
        const row=Math.floor((canvasY+camOffY)/scale);
        if(col>=0&&col<GRID_SIZE&&row>=0&&row<GRID_SIZE)onCellTap(col,row);
      }}/>
  );
}

const hpBar=(ctx,x,y,w,h,pct,col)=>{ctx.fillStyle="rgba(0,0,0,0.5)";ctx.fillRect(x,y,w,h);ctx.fillStyle=col||`hsl(${clamp(pct,0,1)*120},75%,50%)`;ctx.fillRect(x,y,w*clamp(pct,0,1),h);};

function LiveStats({gs,stats,level}){
  const n=gs.enemies.length;const hasBoss=gs.enemies.some(e=>e.isBoss);
  const towers=Object.values(gs.cells).filter(c=>c.type==="tower").length;
  const walls=Object.values(gs.cells).filter(c=>c.type==="wall").length;
  const nxtT=LEVEL_TIME_THRESHOLDS[level]||null;const secL=nxtT?Math.max(0,Math.round(nxtT-gs.elapsed/1000)):null;
  const wd=gs.currentWaveDef;
  return(
    <div style={{display:"flex",justifyContent:"center",gap:8,fontSize:10,color:"#555",margin:"3px 0",flexWrap:"wrap"}}>
      <span style={{color:"#888"}}>👾{n}</span>
      {hasBoss&&<span style={{color:"#ff00ff",fontWeight:700,animation:"pulse 0.5s infinite"}}>👹BOSS!</span>}
      <span>🗼{towers}</span><span>🧱{walls}</span>
      <span style={{color:"#7CFC00"}}>⚡{stats.dps}/s</span>
      <span style={{color:"#FFD700"}}>💰{stats.gps}/s</span>
      <span style={{color:"#aaa",fontWeight:700}}>Lv{level}</span>
      {secL!==null&&<span style={{color:"#444"}}>→Lv{level+1} {secL}s</span>}
      {gs.wallRegenRate>0&&<span style={{color:"#4ecf8a"}}>🌿regen</span>}
      {wd&&<span style={{color:"#888",fontSize:9}}>{wd.icon} {wd.label}</span>}
    </div>
  );
}

function SpeedBar({speedMult,onChange}){
  return(<div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:6,margin:"4px 0"}}>
    <span style={{fontSize:10,color:"#444"}}>Speed:</span>
    {[1,2,5].map(x=>(<button key={x} onClick={()=>onChange(x)} style={{background:speedMult===x?"rgba(255,215,0,0.14)":"rgba(255,255,255,0.05)",border:`1px solid ${speedMult===x?"#FFD700":"rgba(255,255,255,0.1)"}`,borderRadius:7,padding:"5px 16px",cursor:"pointer",color:speedMult===x?"#FFD700":"#666",fontSize:12,fontWeight:speedMult===x?800:400,minHeight:34}}>{x}×</button>))}
  </div>);
}

function Toolbar({gs,tier,onSelectTool,onClearTool,onToggleShop,onToggleTowerList,onOpenFortress}){
  const sel=gs.selected?.tool;
  const tools=[
    {id:"wall",    label:"Wall",    icon:"🧱", cost:WALL_COST},
    {id:"arrow",   label:"Arrow",   icon:"🏹", cost:25},
    {id:"cannon",  label:"Cannon",  icon:"💣", cost:50},
    {id:"ballista",label:"Ballista",icon:"⚡", cost:70},
    {id:"support", label:"Support", icon:"✨", cost:40},
    {id:"upgrade", label:"Wall+",   icon:"⬆️", cost:25},
    {id:"repair",  label:"Repair",  icon:"🔧", cost:REPAIR_COST},
    {id:"sell",    label:"Sell",    icon:"💸", cost:null},
  ];
  return(<div style={{marginTop:4}}>
    <div style={{display:"flex",gap:3,flexWrap:"wrap",justifyContent:"center",marginBottom:3}}>
      {/* Fix 7: Fortress Core shortcut button */}
      <button onClick={onOpenFortress} style={{background:gs.selectedTowerKey==="heart"?tier.color:"rgba(255,215,0,0.08)",border:`1px solid ${gs.selectedTowerKey==="heart"?tier.wallColor:"#FFD70033"}`,borderRadius:7,padding:"5px 5px",cursor:"pointer",color:"#FFD700",display:"flex",flexDirection:"column",alignItems:"center",gap:1,minWidth:40,fontSize:9,minHeight:52}}>
        <span style={{fontSize:16}}>🏰</span><span>Core</span>
      </button>
      {tools.map(t=>{const can=t.cost===null||gs.gold>=t.cost;const isSelected=sel===t.id;return(
        <button key={t.id}
          onClick={()=>isSelected?onClearTool():onSelectTool(t.id)}  // Fix 6: toggle deselect
          style={{background:isSelected?tier.color:can?"rgba(255,255,255,0.07)":"rgba(255,255,255,0.02)",border:`1px solid ${isSelected?tier.wallColor:can?"rgba(255,255,255,0.12)":"rgba(255,255,255,0.03)"}`,borderRadius:7,padding:"5px 5px",cursor:"pointer",color:can?"#fff":"#3a3a3a",display:"flex",flexDirection:"column",alignItems:"center",gap:1,minWidth:40,fontSize:9,minHeight:52}}>
          <span style={{fontSize:16}}>{t.icon}</span><span>{t.label}</span>
          {t.cost!==null&&<span style={{color:can?"#FFD700":"#3a2200",fontSize:8}}>💰{t.cost}</span>}
        </button>);})}
      <button onClick={onToggleTowerList} style={{background:gs.showTowerList?"rgba(0,191,255,0.18)":"rgba(255,255,255,0.05)",border:`1px solid ${gs.showTowerList?"#00BFFF":"rgba(255,255,255,0.1)"}`,borderRadius:7,padding:"5px 5px",cursor:"pointer",color:gs.showTowerList?"#00BFFF":"#fff",display:"flex",flexDirection:"column",alignItems:"center",gap:1,minWidth:40,fontSize:9,minHeight:52}}>
        <span style={{fontSize:16}}>⬆️</span><span>Upgrade</span><span style={{fontSize:8,color:gs.showTowerList?"#00BFFF":"#888"}}>Towers</span>
      </button>
      <button onClick={onToggleShop} style={{background:gs.showShop?"#102010":"rgba(255,255,255,0.05)",border:`1px solid ${gs.showShop?"#3a8a3a":"rgba(255,255,255,0.1)"}`,borderRadius:7,padding:"5px 5px",cursor:"pointer",color:"#fff",display:"flex",flexDirection:"column",alignItems:"center",gap:1,minWidth:40,fontSize:9,minHeight:52}}>
        <span style={{fontSize:16}}>🏪</span><span>Invest</span>
      </button>
    </div>
    <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:6,marginBottom:2}}>
      <div style={{fontSize:9,color:"#555",flex:1,textAlign:"center"}}>
        {!sel?"Tap 🏰Core or tower to manage · Select tool then tap grid":sel==="sell"?"Tap structure to sell":sel==="repair"?"Tap damaged wall to repair":sel==="upgrade"?"Tap wall to upgrade HP (+60%, 💰25)":sel==="wall"?`Tap empty tile — wall 💰${WALL_COST}`:TOWER_TYPES[sel]?`Tap empty tile · ${TOWER_TYPES[sel].shortDesc}`:""}
      </div>
      {sel&&<button onClick={onClearTool} style={{background:"rgba(255,255,255,0.07)",border:"1px solid #333",borderRadius:5,padding:"3px 9px",color:"#aaa",fontSize:9,cursor:"pointer",minHeight:28}}>✕ Cancel</button>}
    </div>
  </div>);
}

function LogBar({entries}){return(<div style={{minHeight:22,marginBottom:3}}>{entries.slice().reverse().map((e,i)=>(<div key={i} style={{fontSize:9,color:`rgba(180,180,180,${1-i*0.28})`,textAlign:"center",lineHeight:1.4}}>{e}</div>))}</div>);}

function ShopOverlay({gs,tier,onBuy,onClose}){
  const disc=gs.runUpgradeDisc||0;
  return(<div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(6,4,14,0.98)",border:`1px solid ${tier.color}44`,borderRadius:"14px 14px 0 0",padding:"12px 12px",zIndex:10,maxHeight:"55vh",overflowY:"auto"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
      <span style={{fontWeight:800,fontSize:13,color:tier.wallColor}}>🏪 Run Investments{disc>0?<span style={{fontSize:9,color:"#4ecf8a",marginLeft:5}}>-{Math.round(disc*100)}% off</span>:null}</span>
      <span style={{fontSize:12,color:"#FFD700"}}>💰{gs.gold}</span>
      <button onClick={onClose} style={{background:"none",border:"none",color:"#555",fontSize:16,cursor:"pointer",minWidth:32,minHeight:32}}>✕</button>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
      {RUN_UPGRADES.map(item=>{const count=gs.runUpgradeCounts?.[item.id]||0;
        const rawCost=getRunUpgradeCost(item,count);
        const cost=item.action==="repairWalls"?rawCost:Math.round(rawCost*(1-disc));
        const can=gs.gold>=cost;
        return(<button key={item.id} onClick={()=>can&&onBuy(item)} style={{background:can?"rgba(255,255,255,0.06)":"rgba(255,255,255,0.02)",border:`1px solid ${can?tier.color+"55":"#181818"}`,borderRadius:8,padding:"9px 10px",cursor:can?"pointer":"default",color:can?"#fff":"#2a2a2a",textAlign:"left",minHeight:72}}>
          <div style={{fontSize:16,marginBottom:2}}>{item.icon}</div>
          <div style={{fontWeight:700,fontSize:10}}>{item.label}</div>
          <div style={{fontSize:9,color:can?"#888":"#333",marginTop:1}}>{item.desc}</div>
          <div style={{fontSize:10,color:can?"#FFD700":"#442200",marginTop:3}}>💰{cost}{count>0?` (×${count+1})`:""}</div>
        </button>);})}
    </div>
  </div>);
}

function TowerListPanel({gs,tier,onUpgrade,onClose}){
  const towers=Object.entries(gs.cells).filter(([,c])=>c.type==="tower");
  return(<div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(5,3,12,0.98)",border:`1px solid #00BFFF44`,borderRadius:"14px 14px 0 0",padding:"12px 12px",zIndex:16,maxHeight:"55vh",overflowY:"auto"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
      <span style={{fontWeight:800,fontSize:13,color:"#00BFFF"}}>⬆️ Upgrade Towers</span>
      <button onClick={onClose} style={{background:"none",border:"none",color:"#444",fontSize:16,cursor:"pointer",minWidth:32,minHeight:32}}>✕</button>
    </div>
    {towers.length===0&&<div style={{textAlign:"center",color:"#555",fontSize:11,padding:"12px 0"}}>No towers placed yet.</div>}
    <div style={{display:"flex",flexDirection:"column",gap:6}}>
      {towers.map(([key,cell])=>{
        const tdef=TOWER_TYPES[cell.towerType];if(!tdef)return null;
        const tLvl=cell.towerLevel||1;const maxed=tLvl>=TOWER_MAX_LEVEL;
        const cost=getTowerUpgradeCost(cell.towerType,tLvl);const canAfford=!maxed&&gs.gold>=cost;
        const[col,row]=key.split(",").map(Number);
        return(<div key={key} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,0.04)",borderRadius:9,padding:"8px 10px",border:`1px solid ${tdef.color}22`}}>
          <span style={{fontSize:22}}>{tdef.icon}</span>
          <div style={{flex:1}}>
            <div style={{display:"flex",alignItems:"center",gap:5}}>
              <span style={{fontWeight:700,fontSize:12,color:tdef.color}}>{tdef.label}</span>
              <span style={{color:"#666",fontSize:10}}>({col},{row})</span>
              {cell.socketBonus&&<span style={{fontSize:8,color:"#FFD700",background:"rgba(255,215,0,0.1)",border:"1px solid #FFD70033",borderRadius:3,padding:"0 4px"}}>🗼+10%</span>}
            </div>
            <div style={{display:"flex",gap:3,marginTop:3}}>{Array.from({length:TOWER_MAX_LEVEL},(_,i)=>(<div key={i} style={{width:10,height:5,borderRadius:2,background:i<tLvl?tdef.color:"#1a1a1a"}}/>))}<span style={{fontSize:9,color:"#555",marginLeft:4}}>Lv{tLvl}/{TOWER_MAX_LEVEL}</span></div>
            {!maxed&&<div style={{fontSize:9,color:"#888",marginTop:2}}>+{Math.round(TOWER_LVL_DMG_MULT*100)}% dmg · +{Math.round(TOWER_LVL_SPD_MULT*100)}% spd</div>}
          </div>
          {!maxed?(<button onClick={()=>canAfford&&onUpgrade(key)} style={{background:canAfford?`${tdef.color}22`:"rgba(255,255,255,0.02)",border:`1px solid ${canAfford?tdef.color+"66":"#222"}`,borderRadius:8,padding:"6px 10px",cursor:canAfford?"pointer":"default",color:canAfford?tdef.color:"#444",fontSize:10,fontWeight:700,minWidth:70,textAlign:"center",minHeight:38}}>
            {canAfford?`💰${cost}`:`Need 💰${cost}`}
          </button>):(<div style={{fontSize:10,color:tdef.color,minWidth:50,textAlign:"center",fontWeight:700}}>MAX ✓</div>)}
        </div>);
      })}
    </div>
  </div>);
}

function TowerPanel({gs,tier,onUpgrade,onClose,onAscend}){
  const key=gs.selectedTowerKey;if(!key)return null;
  const isHeart=key==="heart";const castLvl=gs.castleLevel||1;
  if(isHeart){
    const cost=castLvl<CASTLE_RUN_MAX_LEVEL?CASTLE_RUN_COSTS[castLvl]:null;
    const canAfford=cost!==null&&gs.gold>=cost;
    const heart=gs.cells[`${HC},${HR}`];
    const bp=getKeepBlueprint(castLvl);
    const nextBp=castLvl<CASTLE_RUN_MAX_LEVEL?getKeepBlueprint(castLvl+1):null;
    const goldBonus=+((castLvl-1)*CASTLE_LVL_GOLD_BONUS).toFixed(1);
    const dmgPct=Math.round(bp.castleDmgBonus*100);

    // Ascension data
    const curAscIdx=gs.currentAscensionIdx||0;
    const curAscTier=ASCENSION_TIERS[curAscIdx];
    const nextAscIdx=curAscIdx+1;
    const nextAscTier=ASCENSION_TIERS[nextAscIdx]||null;
    const ascUnlocked=nextAscIdx<=gs.unlockedAscensionIdx;
    const ascBaseCost=ASCENSION_COSTS[curAscIdx]||0;
    const ascCost=Math.round(ascBaseCost*(1-(gs.ascCostDisc||0)));
    const canAscendAfford=gs.gold>=ascCost;

    return(
      <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(6,4,14,0.97)",border:`1px solid ${tier.heartColor}55`,borderRadius:"14px 14px 0 0",zIndex:15,maxHeight:"65vh",display:"flex",flexDirection:"column"}}>
        {/* Fixed header */}
        <div style={{padding:"10px 14px 0",flexShrink:0}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <div>
              <span style={{fontWeight:900,fontSize:13,color:tier.heartColor}}>🏰 Fortress Core</span>
              <span style={{fontSize:10,color:"#555",marginLeft:8}}>{bp.label} · Lv{castLvl}/{CASTLE_RUN_MAX_LEVEL}</span>
            </div>
            <button onClick={onClose} style={{background:"none",border:"none",color:"#444",fontSize:16,cursor:"pointer",minWidth:32,minHeight:32}}>✕</button>
          </div>
          {/* Progress bar */}
          <div style={{display:"flex",gap:3,marginBottom:8}}>
            {Array.from({length:CASTLE_RUN_MAX_LEVEL},(_,i)=>(
              <div key={i} style={{flex:1,height:5,borderRadius:3,background:i<castLvl?tier.heartColor:"#222"}}/>
            ))}
          </div>
        </div>
        {/* Scrollable body */}
        <div style={{overflowY:"auto",padding:"0 14px 14px",flex:1}}>
          {/* Current stats */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:4,marginBottom:8}}>
            {[
              ["❤️ HP",   heart?.hp||0],
              ["🛡 Max",  heart?.maxHp||0],
              ["⚔️ Dmg",  dmgPct>0?`+${dmgPct}%`:"base"],
              ["💰 /s",   goldBonus>0?`+${goldBonus}`:"—"],
            ].map(([l,v])=>(
              <div key={l} style={{background:"rgba(255,255,255,0.05)",borderRadius:6,padding:"4px 5px",textAlign:"center"}}>
                <div style={{fontSize:8,color:"#555"}}>{l}</div>
                <div style={{fontSize:11,color:"#ddd",fontWeight:700}}>{v}</div>
              </div>
            ))}
          </div>
          {/* Next keep level preview */}
          {nextBp&&(
            <div style={{background:"rgba(255,215,0,0.05)",border:"1px solid #FFD70022",borderRadius:8,padding:"7px 10px",marginBottom:8,fontSize:9,color:"#888"}}>
              <div style={{color:"#FFD70099",fontWeight:700,marginBottom:3}}>⬆️ Next: {nextBp.label}</div>
              <div style={{lineHeight:1.6,marginBottom:3}}>{nextBp.unlockDesc}</div>
              <div style={{color:"#666",fontSize:8}}>
                +{nextBp.heartHpBonus-bp.heartHpBonus} HP · +{Math.round((nextBp.castleDmgBonus-bp.castleDmgBonus)*100)}% dmg bonus
              </div>
            </div>
          )}
          {/* Keep upgrade button */}
          {cost!==null?(
            <button onClick={()=>onUpgrade("castle")} style={{width:"100%",background:canAfford?"linear-gradient(135deg,#FFD700,#FF8C00)":"rgba(255,255,255,0.04)",border:"none",borderRadius:10,padding:"11px",color:canAfford?"#1a0a00":"#444",fontWeight:800,fontSize:14,cursor:canAfford?"pointer":"default",minHeight:44,marginBottom:10}}>
              {canAfford?`⬆️ Expand Fortress — 💰${cost}`:`💰${cost} needed to expand`}
            </button>
          ):(
            <div style={{textAlign:"center",fontSize:12,color:"#FFD700",padding:"6px 0 10px",fontWeight:700}}>🏰 Fortress at maximum power!</div>
          )}

          {/* ── Ascension Section ── */}
          <div style={{borderTop:"1px solid #1a1a1a",paddingTop:10}}>
            <div style={{fontSize:9,color:"#555",letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>✨ Ascension</div>
            {/* Current tier */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div>
                <div style={{fontSize:11,color:curAscTier.wallColor,fontWeight:700}}>{curAscTier.name}</div>
                <div style={{fontSize:9,color:"#555"}}>{curAscTier.passiveBuff>0?`+${Math.round(curAscTier.passiveBuff*(1+(gs.ascBonusExtra||0))*100)}% passive dmg aura`:"No passive bonus yet"}</div>
              </div>
              <div style={{fontSize:20}}>{curAscIdx===0?"🪵":curAscIdx===1?"🪨":curAscIdx===2?"🔮":"⭐"}</div>
            </div>
            {/* Next tier or maxed */}
            {nextAscTier?(
              <div style={{background:`${nextAscTier.color}12`,border:`1px solid ${nextAscTier.color}33`,borderRadius:8,padding:"8px 10px",marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <div style={{fontSize:10,color:nextAscTier.wallColor,fontWeight:700}}>→ {nextAscTier.name}</div>
                  <div style={{fontSize:9,color:"#555"}}>{ascUnlocked?"✓ Unlocked":`🔒 Survive ${nextAscTier.minSec}s`}</div>
                </div>
                <div style={{fontSize:9,color:"#888",marginBottom:6}}>
                  +{Math.round(nextAscTier.passiveBuff*(1+(gs.ascBonusExtra||0))*100)}% passive dmg aura · Cost: 💰{ascCost}
                </div>
                <button onClick={onAscend} disabled={!ascUnlocked||!canAscendAfford}
                  style={{width:"100%",background:ascUnlocked&&canAscendAfford?`linear-gradient(135deg,${nextAscTier.color},${nextAscTier.wallColor})`:"rgba(255,255,255,0.04)",border:"none",borderRadius:8,padding:"9px",color:ascUnlocked&&canAscendAfford?"#fff":"#444",fontWeight:700,fontSize:12,cursor:ascUnlocked&&canAscendAfford?"pointer":"default",minHeight:38}}>
                  {!ascUnlocked?`🔒 Survive ${nextAscTier.minSec}s first`:!canAscendAfford?`💰${ascCost} needed`:`✨ Ascend — 💰${ascCost}`}
                </button>
              </div>
            ):(
              <div style={{textAlign:"center",fontSize:11,color:"#FFD700",padding:6,fontWeight:700}}>✨ Maximum ascension reached!</div>
            )}
          </div>
        </div>
      </div>
    );
  }
  const cell=gs.cells[key];if(!cell||cell.type!=="tower")return null;
  const tdef=TOWER_TYPES[cell.towerType];if(!tdef)return null;
  const tLvl=cell.towerLevel||1;const maxed=tLvl>=TOWER_MAX_LEVEL;
  const cost=getTowerUpgradeCost(cell.towerType,tLvl);const canAfford=!maxed&&gs.gold>=cost;
  const curr=getTowerLevelStats(cell.towerType,tLvl);const next=maxed?curr:getTowerLevelStats(cell.towerType,tLvl+1);
  return(<div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(6,4,14,0.97)",border:`1px solid ${tdef.color}44`,borderRadius:"14px 14px 0 0",padding:"12px 14px",zIndex:15}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        <span style={{fontWeight:800,fontSize:13,color:tdef.color}}>{tdef.icon} {tdef.label} — Lv{tLvl}</span>
        {cell.socketBonus&&<span style={{fontSize:9,color:"#FFD700",background:"rgba(255,215,0,0.12)",border:"1px solid #FFD70044",borderRadius:4,padding:"1px 5px"}}>🗼 +10% dmg</span>}
      </div>
      <button onClick={onClose} style={{background:"none",border:"none",color:"#444",fontSize:16,cursor:"pointer",minWidth:32,minHeight:32}}>✕</button>
    </div>
    <div style={{display:"flex",gap:4,marginBottom:8}}>{Array.from({length:TOWER_MAX_LEVEL},(_,i)=>(<div key={i} style={{flex:1,height:4,borderRadius:2,background:i<tLvl?tdef.color:"#222"}}/>))}</div>
    <div style={{fontSize:9,color:"#888",marginBottom:6,fontStyle:"italic"}}>In-run upgrade: affects this tower only. Research in Citadel to improve ALL towers of this type.</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:5,marginBottom:8}}>
      {[["⚔️ DMG",`×${curr.dmgMult.toFixed(2)}`,maxed?null:`×${next.dmgMult.toFixed(2)}`],["⚡ SPD",`×${(1/curr.spdMult).toFixed(2)}`,maxed?null:`×${(1/next.spdMult).toFixed(2)}`],["📏 RNG",`+${curr.rangeBns.toFixed(1)}`,maxed?null:`+${next.rangeBns.toFixed(1)}`]].map(([l,cur,nxt])=>(<div key={l} style={{background:"rgba(255,255,255,0.05)",borderRadius:6,padding:"5px 6px",textAlign:"center"}}><div style={{fontSize:9,color:"#666"}}>{l}</div><div style={{fontSize:11,color:"#ccc",fontWeight:700}}>{cur}</div>{nxt&&<div style={{fontSize:9,color:tdef.color}}>→{nxt}</div>}</div>))}
    </div>
    {!maxed?(<button onClick={()=>onUpgrade(key)} style={{width:"100%",background:canAfford?`linear-gradient(135deg,${tdef.color}88,${tdef.color}44)`:"rgba(255,255,255,0.03)",border:`1px solid ${canAfford?tdef.color+"66":"#222"}`,borderRadius:10,padding:"12px",color:canAfford?"#fff":"#444",fontWeight:800,fontSize:13,cursor:canAfford?"pointer":"default",minHeight:46}}>
      {canAfford?`⬆️ Lv${tLvl+1} — 💰${cost}`:`💰${cost} required`}
    </button>):(<div style={{textAlign:"center",fontSize:12,color:tdef.color,padding:8,fontWeight:700}}>⭐ Max level!</div>)}
  </div>);
}

function PerkModal({gs,tier,onSelect,onReroll}){
  return(<div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.84)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:20,padding:16}}>
    <div style={{background:tier.bg,border:`2px solid ${tier.wallColor}`,borderRadius:16,padding:16,maxWidth:320,width:"100%",boxShadow:`0 0 30px ${tier.color}44`}}>
      <div style={{textAlign:"center",marginBottom:12}}><div style={{fontSize:26}}>🃏</div>
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
      {gs.hasReroll&&!gs.rerollUsed&&(
        <button onClick={onReroll} style={{width:"100%",marginTop:8,background:"rgba(255,255,255,0.05)",border:"1px solid #444",borderRadius:8,padding:"8px",color:"#aaa",cursor:"pointer",fontSize:10}}>🔄 Reroll choices (1× per run)</button>
      )}
      <div style={{textAlign:"center",fontSize:9,color:"#444",marginTop:8}}>{gs.perks.length} perks active</div>
    </div>
  </div>);
}

function AscensionModal({gs,tier,onAscend,onClose}){
  const nextIdx=gs.currentAscensionIdx+1;const nextTier=ASCENSION_TIERS[nextIdx];if(!nextTier)return null;
  const baseCost=ASCENSION_COSTS[gs.currentAscensionIdx]||0;
  const cost=Math.round(baseCost*(1-(gs.ascCostDisc||0)));
  const canAfford=gs.gold>=cost;const canAscend=nextIdx<=gs.unlockedAscensionIdx;
  return(<div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.85)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",zIndex:22,padding:20}}>
    <div style={{background:"#0a0510",border:`2px solid ${nextTier.wallColor}`,borderRadius:16,padding:20,maxWidth:320,width:"100%",boxShadow:`0 0 40px ${nextTier.color}55`}}>
      <div style={{textAlign:"center",marginBottom:14}}><div style={{fontSize:32}}>✨</div>
        <div style={{fontWeight:900,fontSize:16,color:nextTier.wallColor}}>Ascend to {nextTier.name}</div>
        <div style={{fontSize:10,color:"#777",marginTop:3}}>Unlocked by surviving {nextTier.minSec}s — pay gold to activate</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        {[["🎨 Visual",nextTier.name],[`⚔️ Passive`,`+${Math.round(nextTier.passiveBuff*(1+(gs.ascBonusExtra||0))*100)}% dmg`],["💰 Cost",`${cost} gold`],["🔒 Require",`${nextTier.minSec}s survived`]].map(([l,v])=>(<div key={l} style={{background:"rgba(255,255,255,0.05)",borderRadius:7,padding:"7px 9px"}}><div style={{fontSize:9,color:"#666"}}>{l}</div><div style={{fontSize:11,color:"#ccc",fontWeight:700,marginTop:2}}>{v}</div></div>))}
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={onClose} style={{flex:1,background:"rgba(255,255,255,0.05)",border:"1px solid #333",borderRadius:10,padding:"12px",color:"#777",cursor:"pointer",fontSize:12}}>Not yet</button>
        <button onClick={onAscend} disabled={!canAscend||!canAfford} style={{flex:2,background:canAscend&&canAfford?`linear-gradient(135deg,${nextTier.color},${nextTier.wallColor})`:"rgba(255,255,255,0.03)",border:"none",borderRadius:10,padding:"12px",color:canAscend&&canAfford?"#fff":"#444",fontWeight:800,fontSize:14,cursor:canAscend&&canAfford?"pointer":"default"}}>
          {!canAscend?"Locked":!canAfford?`Need 💰${cost}`:`✨ Ascend — 💰${cost}`}
        </button>
      </div>
    </div>
  </div>);
}

function SettingsOverlay({gs,tier,onClose,onSetTab,onEndRun}){
  const tab=gs.settingsTab||"credits";
  const handleEndRun=()=>{
    if(window.confirm("End this run and claim rewards?\n\nYour XP and progress so far will be saved.")){
      onEndRun&&onEndRun();
    }
  };
  return(<div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.95)",display:"flex",flexDirection:"column",zIndex:30,overflowY:"auto"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",borderBottom:"1px solid #181818"}}>
      <div style={{display:"flex",gap:5}}>
        {[["credits","📜 Credits"],["encyclopedia","📖 Guide"]].map(([id,lbl])=>(<button key={id} onClick={()=>onSetTab(id)} style={{background:tab===id?tier.color+"33":"none",border:`1px solid ${tab===id?tier.wallColor:"#222"}`,borderRadius:7,padding:"7px 12px",cursor:"pointer",color:tab===id?tier.wallColor:"#555",fontSize:11,minHeight:36}}>{lbl}</button>))}
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        {/* P4: End Run button */}
        {gs.phase==="playing"&&<button onClick={handleEndRun} style={{background:"rgba(231,76,60,0.12)",border:"1px solid #e74c3c44",borderRadius:7,padding:"7px 12px",cursor:"pointer",color:"#e74c3c",fontSize:11,fontWeight:700,minHeight:36}}>⚑ End Run</button>}
        <button onClick={onClose} style={{background:"none",border:"1px solid #2a2a2a",borderRadius:6,color:"#666",padding:"6px 12px",cursor:"pointer",fontSize:11,minHeight:36}}>Close</button>
      </div>
    </div>
    <div style={{padding:"12px 14px",flex:1,overflowY:"auto"}}>
      {tab==="credits"&&<CreditsPanel/>}
      {tab==="encyclopedia"&&<EncyclopediaPanel/>}
    </div>
  </div>);
}

const CREDITS_DATA=[
  {cat:"Game Code",items:[{name:"Mythic Fortress: Idle Siege v19",author:"Original",license:"N/A",url:null}]},
  {cat:"Active Visual Assets",items:[{name:"All in-game icons (emoji)",author:"Unicode / OS platform font",license:"Platform terms — not standalone assets",url:null},{name:"STATUS: Development placeholders",author:"Replace with OGA sprites before production",license:"N/A",url:null}]},
  {cat:"Planned Assets (OGA verified, not yet integrated)",items:[
    {name:"Castle Tiles for RPGs",author:"Hyptosis",license:"CC-BY 3.0",url:"https://opengameart.org/content/castle-tiles-for-rpgs"},
    {name:"Fantasy Tower Defense Pack",author:"bevouliin",license:"CC0",url:"https://opengameart.org/content/fantasy-tower-defense"},
    {name:"Tower Defense Graphics",author:"Clint Bellanger",license:"CC-BY 3.0",url:"https://opengameart.org/content/tower-defense-graphics"},
    {name:"Tiny 16: Basic (enemies)",author:"Lanea Zimmermann (Sharm)",license:"CC-BY 3.0",url:"https://opengameart.org/content/tiny-16-basic"},
    {name:"RPG Enemies — 11 Creatures",author:"Skorpio",license:"CC-BY-SA 3.0",url:"https://opengameart.org/content/rpg-enemies-11-creatures"},
    {name:"Gold Coin sprite",author:"qubodup",license:"CC0",url:"https://opengameart.org/content/gold-coin-0"},
    {name:"Battle Theme A",author:"cynicmusic",license:"CC0",url:"https://opengameart.org/content/battle-theme-a"},
  ]},
];
function CreditsPanel(){return(<div>{CREDITS_DATA.map(s=>(<div key={s.cat} style={{marginBottom:14}}><div style={{fontSize:9,color:"#444",letterSpacing:1,textTransform:"uppercase",marginBottom:5,borderBottom:"1px solid #141414",paddingBottom:3}}>{s.cat}</div>{s.items.map(item=>(<div key={item.name} style={{background:"rgba(255,255,255,0.025)",borderRadius:6,padding:"6px 10px",marginBottom:4}}><div style={{fontSize:11,color:"#ccc",fontWeight:600}}>{item.name}</div><div style={{fontSize:9,color:"#555",marginTop:1}}>By {item.author} · {item.license}</div>{item.url&&<a href={item.url} target="_blank" rel="noopener noreferrer" style={{fontSize:9,color:"#4a7aaa",display:"block",marginTop:2}}>🔗 {item.url.slice(8,55)}…</a>}</div>))}</div>))}</div>);}

const ENC_DATA=[
  {section:"⚔️ Towers",entries:[...Object.entries(TOWER_TYPES).map(([,t])=>({name:`${t.icon} ${t.label}`,stats:`Cost:💰${t.cost} · DMG:${t.dmg||"—"} · Range:${t.range} · CD:${t.speed||"—"}`,body:t.fullDesc})),{name:"🏰 Fortress Heart",stats:`DMG:${HEART_TOWER.dmg} · Range:${HEART_TOWER.range} · CD:${HEART_TOWER.speed}`,body:"Auto-attacks nearby enemies. Tap the heart to level it up. Scales with castle level and heart research."},{name:"⬆️ Tower Upgrades",stats:"In-run vs Research",body:"In-run upgrades (tap tower or use ⬆️ panel) affect that single tower only and reset each run. Research upgrades in the Citadel permanently improve ALL towers of that type across every run."}]},
  {section:"🔬 Research Categories",entries:RESEARCH_CATEGORIES.map(c=>({name:`${c.icon} ${c.label}`,stats:`${c.upgrades.length} upgrades`,body:c.desc}))},
  {section:"🔍 Dynamic Zoom",entries:[{name:"Camera Zoom",stats:"Automatic",body:"The camera zooms in around your keep at the start and gradually zooms out as you place structures further away. This keeps early gameplay readable and scales naturally as your fortress grows."}]},
  {section:"🏰 Fortress Expansion",entries:[
    {name:"Keep Levels",stats:"Lv1–5",body:"Upgrading the Keep (tap 🏰, then 'Expand Keep') physically grows your fortress each level: walls are placed automatically, build radius expands, and socket markers appear (dashed 🗼 outlines). Towers built on sockets deal +10% bonus damage — they're the optimal positions. Manual building is allowed anywhere inside the current build radius. Sockets are invisible to enemies."},
    {name:"Iron Formation",stats:"Defence Research",body:"Reinforces all starting blueprint walls to Level 2 (+60% HP) at run start. It no longer spawns an outer ring — that blocked socket positions at Keep Level 2. The reinforcement applies to the inner ring at Level 1 and any blueprint walls already placed."},
  ]},
  {section:"👾 Enemies",entries:Object.entries(ENEMY_TYPES).map(([,e])=>({name:`${e.icon} ${e.label}`,stats:`HP:${e.hp} · Speed:${e.spd}c/s · DMG:${e.dmg} · Gold:${e.gold}`,body:e.fullDesc}))},
  {section:"💰 Gold & ⭐ XP",entries:[{name:"💰 Gold",stats:"Run currency",body:`Start: ${GOLD_START}+perks. Earned from kills, passive income, and castle bonuses.`},{name:"⭐ XP",stats:"Permanent",body:`Earned at game over. Spent in Citadel Research on permanent upgrades.`}]},
  {section:"🏰 Castle Upgrades",entries:CASTLE_UPGRADES.map(u=>({name:`${u.icon} ${u.label}`,stats:`Max Lv${u.maxLevel} · ⭐${u.baseCost}`,body:u.desc}))},
];
function EncyclopediaPanel(){
  const[os,setOs]=useState(null);const[oe,setOe]=useState(null);
  return(<div>{ENC_DATA.map(sec=>(<div key={sec.section} style={{marginBottom:6}}>
    <button onClick={()=>setOs(os===sec.section?null:sec.section)} style={{width:"100%",background:"rgba(255,255,255,0.04)",border:"1px solid #1e1e1e",borderRadius:8,padding:"10px 12px",cursor:"pointer",color:"#bbb",display:"flex",justifyContent:"space-between",fontSize:12,fontWeight:700,minHeight:42}}>
      <span>{sec.section}</span><span style={{color:"#333"}}>{os===sec.section?"▲":"▼"}</span>
    </button>
    {os===sec.section&&(<div style={{paddingLeft:8,marginTop:3}}>{sec.entries.map(e=>(<div key={e.name} style={{marginBottom:3}}>
      <button onClick={()=>setOe(oe===e.name?null:e.name)} style={{width:"100%",background:"rgba(255,255,255,0.02)",border:"1px solid #141414",borderRadius:6,padding:"8px 10px",cursor:"pointer",color:"#999",textAlign:"left",fontSize:11,minHeight:36}}>{e.name}</button>
      {oe===e.name&&(<div style={{background:"rgba(255,255,255,0.015)",borderRadius:"0 0 6px 6px",padding:"8px 10px",border:"1px solid #101010",borderTop:"none"}}><div style={{fontSize:9,color:"#666",fontFamily:"monospace",marginBottom:4}}>{e.stats}</div><div style={{fontSize:11,color:"#bbb",lineHeight:1.6}}>{e.body}</div></div>)}
    </div>))}</div>)}
  </div>))}</div>);
}

// ─── NEXT ACTION ADVISOR ───
// Analyses game state and surfaces a single highest-priority recommendation.
function getNextAction(gs) {
  if (!gs) return null;
  const heart = gs.cells[`${HEART_COL},${HEART_ROW}`];
  const hpPct = heart ? heart.hp / heart.maxHp : 1;
  const walls = Object.values(gs.cells).filter(c => c.type === "wall");
  const towers = Object.values(gs.cells).filter(c => c.type === "tower");
  const castLvl = gs.castleLevel || 1;
  const keepCost = castLvl < CASTLE_RUN_MAX_LEVEL ? CASTLE_RUN_COSTS[castLvl] : Infinity;
  const mostDamagedWall = walls.filter(w => w.hp < w.maxHp * 0.5);
  const repairCost = Math.max(5, Math.round(REPAIR_COST * (1 - (gs.repairDisc || 0))));
  const canRepair = mostDamagedWall.length > 0 && gs.gold >= repairCost;
  const canKeep = gs.gold >= keepCost;
  const towerCount = towers.length;
  const sockets = Object.values(gs.cells).filter(c => c.type === "socket");
  const elapsed = gs.elapsed / 1000;
  const hasCannon = towers.some(t => t.towerType === "cannon");
  const hasBallista = towers.some(t => t.towerType === "ballista");

  // Urgency: heart below 40% — repair / defend first
  if (hpPct < 0.4) {
    if (canRepair) return { icon:"🔧", label:"Repair walls", color:"#e74c3c", reason:"Enemies are getting through!" };
    if (gs.gold >= 25) return { icon:"🧱", label:"Build more walls", color:"#e74c3c", reason:"Heart under heavy attack" };
  }

  // Critical: no towers at all
  if (towerCount === 0 && gs.gold >= 25) return { icon:"🏹", label:"Place Arrow tower first", color:"#7CFC00", reason:"No towers — heart undefended!" };

  // Early: cannon before swarms (45s)
  if (!hasCannon && elapsed > 40 && gs.gold >= 50) return { icon:"💣", label:"Build Cannon now", color:"#FF6347", reason:"Swarm waves start at 60s" };

  // Pre-boss: ballista by 80s
  if (!hasBallista && elapsed > 70 && gs.gold >= 70) return { icon:"⚡", label:"Build Ballista", color:"#00BFFF", reason:"First boss arrives at 90s!" };

  // Keep upgrade available and affordable — strong signal
  if (canKeep && castLvl < CASTLE_RUN_MAX_LEVEL) {
    const nextBp = getKeepBlueprint(castLvl + 1);
    return { icon:"🏰", label:`Upgrade Keep → ${nextBp.label}`, color:"#FFD700", reason:`+${nextBp.heartHpBonus - getKeepBlueprint(castLvl).heartHpBonus}HP · expands fortress` };
  }

  // Repair damaged walls
  if (canRepair && hpPct < 0.7) return { icon:"🔧", label:"Repair walls", color:"#C68642", reason:"Walls taking damage" };

  // Socket available — nudge player to fill it
  if (sockets.length > 0 && gs.gold >= 28) return { icon:"🗼", label:"Fill tower socket", color:"#FFD700", reason:"+10% bonus dmg on socket" };

  // Upgrade cheapest tower
  const cheapestUpgrade = towers
    .filter(t => (t.towerLevel||1) < TOWER_MAX_LEVEL)
    .map(t => ({ t, cost: getTowerUpgradeCost(t.towerType, t.towerLevel||1) }))
    .filter(({cost}) => gs.gold >= cost)
    .sort((a,b) => a.cost - b.cost)[0];
  if (cheapestUpgrade) {
    const tdef = TOWER_TYPES[cheapestUpgrade.t.towerType];
    return { icon:tdef?.icon||"⬆️", label:`Upgrade ${tdef?.label||"tower"}`, color:tdef?.color||"#aaa", reason:`+${Math.round(TOWER_LVL_DMG_MULT*100)}% dmg per level` };
  }

  // Save for keep if close
  if (castLvl < CASTLE_RUN_MAX_LEVEL) {
    const pct = gs.gold / keepCost;
    if (pct >= 0.6) return { icon:"🏰", label:`Save for Keep Lv${castLvl+1}`, color:"#FFD700aa", reason:`${gs.gold}/${keepCost} 💰` };
  }

  return null;
}

function NextActionAdvisor({ gs }) {
  const action = getNextAction(gs);
  if (!action) return null;
  return (
    <div style={{display:"flex",alignItems:"center",gap:6,background:"rgba(255,255,255,0.04)",border:`1px solid ${action.color}33`,borderRadius:8,padding:"4px 10px",margin:"2px 0",fontSize:9}}>
      <span style={{fontSize:13}}>{action.icon}</span>
      <div style={{flex:1}}>
        <span style={{color:action.color,fontWeight:700}}>{action.label}</span>
        <span style={{color:"#555",marginLeft:5}}>{action.reason}</span>
      </div>
      <span style={{fontSize:8,color:"#444"}}>▶ suggested</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DEV / DEBUG PANEL — toggle DEV_MODE false before shipping
// ═══════════════════════════════════════════════════════════════
const DEV_MODE = true; // Set to false before release

function DevPanel({gs,save,onGs,onSave,onClose}){
  const [goldAmt,setGoldAmt]=useState(500);
  const [xpAmt,setXpAmt]=useState(100);
  const [keepTarget,setKeepTarget]=useState(gs?.castleLevel||1);
  const [enemyType,setEnemyType]=useState("raider");
  const [waveIdx,setWaveIdx]=useState(0);
  const patch=fn=>onGs(prev=>prev?fn(prev):prev);
  const patchSave=fn=>{onSave(prev=>{const n=fn({...prev});saveGame(n);return n;});};
  return(<div style={{position:"fixed",top:0,right:0,width:220,bottom:0,background:"rgba(5,5,14,0.98)",border:"1px solid #2a2a3a",zIndex:9999,overflowY:"auto",padding:10,fontSize:11,boxShadow:"-4px 0 20px rgba(0,0,0,0.8)"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
      <span style={{color:"#e74c3c",fontWeight:900,fontSize:11,letterSpacing:1}}>🛠 DEV</span>
      <button onClick={onClose} style={{background:"none",border:"1px solid #333",color:"#555",borderRadius:4,padding:"2px 7px",cursor:"pointer",fontSize:10}}>✕</button>
    </div>
    <div style={{fontSize:9,color:"#333",marginBottom:8,lineHeight:1.7}}>
      <div>💰 {gs?.gold} · ⭐ {save?.totalXp}</div>
      <div>🏰 Keep {gs?.castleLevel} · ⏱ {formatTime(gs?.elapsed||0)}</div>
      <div>👾 {gs?.enemies?.length} · {gs?.currentWaveDef?.icon} {gs?.currentWaveDef?.label}</div>
    </div>
    <hr style={{border:"none",borderTop:"1px solid #1a1a1a",margin:"6px 0"}}/>
    <div style={{color:"#555",fontSize:9,marginBottom:3}}>ADD GOLD</div>
    <div style={{display:"flex",gap:3,marginBottom:8}}>
      <input type="number" value={goldAmt} onChange={e=>setGoldAmt(+e.target.value)} style={{flex:1,background:"#0a0a12",border:"1px solid #222",color:"#ccc",borderRadius:3,padding:"2px 5px",fontSize:10,width:0}}/>
      <button onClick={()=>patch(s=>({...s,gold:s.gold+goldAmt}))} style={{background:"rgba(255,215,0,0.1)",border:"1px solid #FFD70033",borderRadius:3,color:"#FFD700",cursor:"pointer",padding:"2px 6px",fontSize:9}}>+💰</button>
    </div>
    <div style={{color:"#555",fontSize:9,marginBottom:3}}>ADD XP</div>
    <div style={{display:"flex",gap:3,marginBottom:8}}>
      <input type="number" value={xpAmt} onChange={e=>setXpAmt(+e.target.value)} style={{flex:1,background:"#0a0a12",border:"1px solid #222",color:"#ccc",borderRadius:3,padding:"2px 5px",fontSize:10,width:0}}/>
      <button onClick={()=>patchSave(s=>({...s,totalXp:(s.totalXp||0)+xpAmt}))} style={{background:"rgba(255,215,0,0.1)",border:"1px solid #FFD70033",borderRadius:3,color:"#FFD700",cursor:"pointer",padding:"2px 6px",fontSize:9}}>+⭐</button>
    </div>
    <div style={{color:"#555",fontSize:9,marginBottom:3}}>FORCE KEEP LV</div>
    <div style={{display:"flex",gap:2,marginBottom:8}}>
      {[1,2,3,4,5].map(l=>(
        <button key={l} onClick={()=>{
          setKeepTarget(l);
          patch(s=>{
            let ns={...s,castleLevel:1,cells:getInitialGrid({permHeartHp:s.cells[`${HC},${HR}`]?.maxHp||300,permWallHpMult:s.wallHpMult||1})};
            for(let i=1;i<l;i++)ns={...applyCastleLevelUp({...ns,gold:999999},true),gold:s.gold};
            return{...ns,gold:s.gold};
          });
        }} style={{flex:1,background:keepTarget===l?"rgba(255,215,0,0.15)":"rgba(255,255,255,0.04)",border:`1px solid ${keepTarget===l?"#FFD70044":"#1a1a1a"}`,borderRadius:3,color:keepTarget===l?"#FFD700":"#555",cursor:"pointer",padding:"3px 0",fontSize:9}}>{l}</button>
      ))}
    </div>
    <div style={{color:"#555",fontSize:9,marginBottom:3}}>SPAWN ENEMY</div>
    <div style={{display:"flex",gap:3,marginBottom:8}}>
      <select value={enemyType} onChange={e=>setEnemyType(e.target.value)} style={{flex:1,background:"#0a0a12",border:"1px solid #222",color:"#ccc",borderRadius:3,padding:"2px",fontSize:9,width:0}}>
        {Object.keys(ENEMY_TYPES).map(t=><option key={t} value={t}>{ENEMY_TYPES[t].icon} {t}</option>)}
      </select>
      <button onClick={()=>patch(s=>{const d=getDifficulty(s.elapsed,s.diffTier||DIFFICULTY_TIERS[0]);const bpNow=getKeepBlueprint(s.castleLevel||1);const fo=Math.max(...bpNow.wallRings,bpNow.buildRadius);const en=spawnEnemy(enemyType,d,1,fo);return en?{...s,enemies:[...s.enemies,...Array.from({length:3},()=>spawnEnemy(enemyType,d,1,fo)).filter(Boolean)]}:s;})}
        style={{background:"rgba(231,76,60,0.1)",border:"1px solid #e74c3c33",borderRadius:3,color:"#e74c3c",cursor:"pointer",padding:"2px 6px",fontSize:9}}>×3</button>
    </div>
    <div style={{color:"#555",fontSize:9,marginBottom:3}}>SET WAVE</div>
    <div style={{display:"flex",gap:2,flexWrap:"wrap",marginBottom:8}}>
      {WAVE_DEFS.map((w,i)=>(
        <button key={w.id} onClick={()=>{setWaveIdx(i);patch(s=>({...s,currentWaveDef:w}));}}
          title={w.label} style={{background:waveIdx===i?"rgba(255,255,255,0.1)":"rgba(255,255,255,0.03)",border:`1px solid ${waveIdx===i?"#555":"#1a1a1a"}`,borderRadius:3,color:waveIdx===i?"#ccc":"#444",cursor:"pointer",padding:"2px 4px",fontSize:10}}>{w.icon}</button>
      ))}
    </div>
    <div style={{color:"#555",fontSize:9,marginBottom:3}}>SKIP TIME</div>
    <div style={{display:"flex",gap:2,marginBottom:10}}>
      {[30,60,120,300].map(sec=>(
        <button key={sec} onClick={()=>patch(s=>({...s,elapsed:s.elapsed+sec*1000}))}
          style={{flex:1,background:"rgba(255,255,255,0.04)",border:"1px solid #1a1a1a",borderRadius:3,color:"#555",cursor:"pointer",padding:"2px 0",fontSize:9}}>+{sec}s</button>
      ))}
    </div>
    <hr style={{border:"none",borderTop:"1px solid #1a1a1a",margin:"6px 0"}}/>
    <button onClick={()=>{if(window.confirm("Reset save data?")){const b=resetSave();onSave(()=>b);}}}
      style={{width:"100%",background:"rgba(231,76,60,0.08)",border:"1px solid #e74c3c22",borderRadius:5,color:"#e74c3c",cursor:"pointer",padding:"5px",fontSize:9}}>⚠️ Reset Save</button>
  </div>);
}

function MetaScreen({save,onUpgrade,onStart,onMenu,runResult,buyMult,onSetBuyMult,onReset}){
  const [tab,setTab]=useState("castle");
  const allTabs=[{id:"castle",label:"🏰 Castle",color:"#FFD700"},...RESEARCH_CATEGORIES.map(c=>({id:c.id,label:`${c.icon} ${c.label}`,color:c.color}))];
  const activeCategory=RESEARCH_CATEGORIES.find(c=>c.id===tab);

  return(<div style={{display:"flex",flexDirection:"column",width:"100%",maxWidth:480,minHeight:"100vh",background:"radial-gradient(ellipse at 50% 10%, #0d0820 0%, #050508 70%)",padding:"10px 10px 20px"}}>
    <div style={{textAlign:"center",marginBottom:6}}>
      <div style={{fontSize:22}}>⭐</div>
      <div style={{fontWeight:900,fontSize:17,color:"#FFD700"}}>Citadel Research</div>
      <div style={{fontSize:11,color:"#777",marginTop:1}}>Permanent upgrades across all runs</div>
      <div style={{fontSize:14,color:"#FFD700",marginTop:4,fontWeight:700}}>⭐ {save.totalXp} XP</div>
    </div>

    {runResult&&(<div style={{background:"rgba(255,215,0,0.05)",border:"1px solid #FFD70020",borderRadius:9,padding:"6px 11px",marginBottom:6,textAlign:"center"}}>
      <div style={{fontSize:11,color:"#FFD700",fontWeight:700}}>Last run: +{runResult.xpEarned} XP · Lv{runResult.runLevel}</div>
      <div style={{fontSize:9,color:"#666",marginTop:2}}>{formatTime(runResult.gs.elapsed)} · {runResult.gs.kills} kills · {runResult.gs.bossKills} bosses</div>
    </div>)}

    {/* Buy multiplier */}
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,marginBottom:6}}>
      <span style={{fontSize:9,color:"#555"}}>Buy:</span>
      {[1,5,10,"max"].map(m=>(<button key={m} onClick={()=>onSetBuyMult(m)} style={{background:buyMult===m?"rgba(255,215,0,0.1)":"rgba(255,255,255,0.04)",border:`1px solid ${buyMult===m?"#FFD70044":"#1a1a1a"}`,borderRadius:6,padding:"4px 9px",cursor:"pointer",color:buyMult===m?"#FFD700":"#666",fontSize:10,fontWeight:buyMult===m?700:400,minHeight:30}}>{m==="max"?"MAX":m===1?"×1":`×${m}`}</button>))}
    </div>

    {/* Category tabs — scrollable row */}
    <div style={{overflowX:"auto",marginBottom:6,paddingBottom:2}}>
      <div style={{display:"flex",gap:4,minWidth:"max-content"}}>
        {allTabs.map(t=>{
          const sel=tab===t.id;
          return(<button key={t.id} onClick={()=>setTab(t.id)} style={{background:sel?`${t.color}18`:"rgba(255,255,255,0.03)",border:`1px solid ${sel?t.color+"66":"#161616"}`,borderRadius:8,padding:"6px 10px",cursor:"pointer",color:sel?t.color:"#666",fontSize:10,fontWeight:sel?700:400,whiteSpace:"nowrap",minHeight:34}}>{t.label}</button>);
        })}
      </div>
    </div>

    {/* Category description */}
    {activeCategory&&<div style={{fontSize:10,color:"#666",textAlign:"center",marginBottom:8,lineHeight:1.4}}>{activeCategory.desc}</div>}

    {/* Weapon research note */}
    {tab==="weapons"&&<div style={{background:"rgba(255,100,55,0.08)",border:"1px solid #FF634733",borderRadius:8,padding:"6px 10px",marginBottom:8,fontSize:9,color:"#FF6347",textAlign:"center"}}>⚔️ Weapon upgrades permanently improve that tower type for all runs. Support upgrades here improve each Support tower's own stats (aura power, aura radius).</div>}
    {/* Utility tab note — distinguish Command Aura from weapon-research Support */}
    {tab==="utility"&&<div style={{background:"rgba(122,122,138,0.08)",border:"1px solid #7a7a8a33",borderRadius:8,padding:"6px 10px",marginBottom:8,fontSize:9,color:"#9a9aaa",textAlign:"center"}}>📡 Command Aura raises the buff bonus that towers <em>receive</em> from any Support tower. Weapons › Support upgrades raise what each Support tower <em>outputs</em>. Both stack.</div>}

    {/* Upgrade list */}
    <div style={{flex:1,overflowY:"auto"}}>
      {(tab==="castle"?CASTLE_UPGRADES:(activeCategory?.upgrades||[])).map(upg=>{
        const saveKey=tab==="castle"?"castleUpgrades":"researchUpgrades";
        const cur=save[saveKey]?.[upg.id]||0;const maxed=cur>=upg.maxLevel;
        let pl=0,pc=0;
        if(!maxed){
          const times=buyMult==="max"?upg.maxLevel-cur:Math.min(Number(buyMult),upg.maxLevel-cur);
          let xp=save.totalXp,lvl=cur;
          for(let i=0;i<times;i++){const c=getUpgradeCost(upg,lvl);if(xp<c)break;xp-=c;lvl++;pl++;pc+=c;}
        }
        const ca=!maxed&&pl>0;
        const weapType=upg.weaponType;
        return(<div key={upg.id} style={{background:"rgba(255,255,255,0.03)",border:`1px solid ${maxed?"#FFD70022":"#111"}`,borderRadius:10,padding:"9px 11px",marginBottom:5,display:"flex",gap:7,alignItems:"center"}}>
          <div style={{fontSize:18,minWidth:24,textAlign:"center"}}>{upg.icon}</div>
          <div style={{flex:1}}>
            <div style={{fontSize:11,fontWeight:700,color:maxed?"#FFD700":"#ccc"}}>{upg.label}</div>
            <div style={{fontSize:9,color:"#555",marginTop:1,lineHeight:1.3}}>{upg.desc}</div>
            {weapType&&<div style={{fontSize:8,color:TOWER_TYPES[weapType]?.color||"#888",marginTop:2}}>All {TOWER_TYPES[weapType]?.label} towers</div>}
            <div style={{display:"flex",gap:3,marginTop:3}}>{Array.from({length:upg.maxLevel},(_,i)=>(<div key={i} style={{width:9,height:9,borderRadius:2,background:i<cur?"#FFD700":"#181818",border:"1px solid #222"}}/>))}<span style={{fontSize:8,color:"#444",marginLeft:3}}>Lv{cur}/{upg.maxLevel}</span></div>
          </div>
          {!maxed?(<button onClick={()=>ca&&onUpgrade(tab,upg.id,buyMult)} style={{background:ca?"rgba(255,215,0,0.1)":"rgba(255,255,255,0.02)",border:`1px solid ${ca?"#FFD70033":"#1a1a1a"}`,borderRadius:8,padding:"5px 8px",cursor:ca?"pointer":"default",color:ca?"#FFD700":"#333",fontSize:9,fontWeight:700,minWidth:52,textAlign:"center",minHeight:42}}>
            {ca?<><div>⭐{pc}</div>{pl>1&&<div style={{fontSize:7,color:"#aaa"}}>×{pl}</div>}</>:<div style={{fontSize:9}}>⭐{getUpgradeCost(upg,cur)}</div>}
          </button>):(<div style={{fontSize:9,color:"#FFD700",minWidth:40,textAlign:"center"}}>MAX✓</div>)}
        </div>);
      })}
    </div>

    {/* Stats row */}
    <div style={{display:"flex",gap:4,marginTop:8,marginBottom:8,justifyContent:"center",flexWrap:"wrap"}}>
      {[["Best","⏱",formatTime(save.bestTime)],["Kills","☠️",save.lifetimeKills],["Bosses","👹",save.lifetimeBosses],["Lv","🏆",save.bestLevel||1]].map(([l,i,v])=>(<div key={l} style={{background:"rgba(255,255,255,0.03)",borderRadius:7,padding:"4px 8px",textAlign:"center",minWidth:56}}><div style={{fontSize:8,color:"#444"}}>{i} {l}</div><div style={{fontSize:10,color:"#ccc",fontWeight:700}}>{v}</div></div>))}
    </div>

    <div style={{display:"flex",gap:8}}>
      <button onClick={onMenu} style={{flex:1,background:"rgba(255,255,255,0.04)",border:"1px solid #1a1a1a",borderRadius:10,padding:"11px",color:"#666",cursor:"pointer",fontSize:12,minHeight:44}}>← Menu</button>
      <button onClick={onStart} style={{flex:2,background:"linear-gradient(135deg,#FFD700,#FF8C00)",border:"none",borderRadius:10,padding:"11px",color:"#1a0a00",fontSize:13,fontWeight:800,cursor:"pointer",minHeight:44}}>⚔️ New Run</button>
    </div>
    <button onClick={onReset} style={{marginTop:8,background:"none",border:"1px solid #2a0a0a",borderRadius:8,padding:"7px",color:"#554444",cursor:"pointer",fontSize:10,width:"100%"}}>⚠️ Reset Save Data</button>
  </div>);
}

function GameOverScreen({gs,tier,runResult,onGoMeta,onRestart}){
  const[tab,setTab]=useState("summary");
  const xp=runResult?.xpEarned||0;const level=runResult?.runLevel||calcRunLevel(gs.elapsed);
  const analysis=runResult?.analysis||buildFailureAnalysis(gs);
  const voluntary=gs.voluntaryEnd||false;
  return(<div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",padding:"20px 16px",background:voluntary?"radial-gradient(ellipse at 50% 20%, #051a05 0%, #060606 70%)":"radial-gradient(ellipse at 50% 20%, #2a0505 0%, #060606 70%)"}}>
    <div style={{fontSize:48,marginBottom:4}}>{voluntary?"🏳️":"💀"}</div>
    <h1 style={{margin:0,fontSize:24,color:voluntary?"#4ecf8a":"#e74c3c",fontWeight:900,letterSpacing:2}}>{voluntary?"RUN ENDED":"FORTRESS FALLEN"}</h1>
    <div style={{color:"#555",fontSize:11,marginBottom:12}}>{tier.name} · Level {level} · {formatTime(gs.elapsed)}</div>
    <div style={{display:"flex",gap:5,marginBottom:10,width:"100%",maxWidth:320}}>
      {[["summary","📊 Summary"],["analysis","🔍 Analysis"]].map(([id,lbl])=>(<button key={id} onClick={()=>setTab(id)} style={{flex:1,background:tab===id?"rgba(231,76,60,0.12)":"rgba(255,255,255,0.04)",border:`1px solid ${tab===id?"#e74c3c55":"#1a1a1a"}`,borderRadius:8,padding:"8px",cursor:"pointer",color:tab===id?"#e74c3c":"#666",fontSize:11,fontWeight:tab===id?700:400,minHeight:38}}>{lbl}</button>))}
    </div>
    {tab==="summary"&&(<div style={{background:"rgba(255,255,255,0.03)",borderRadius:12,padding:"14px 20px",border:"1px solid rgba(255,255,255,0.06)",width:"100%",maxWidth:300,marginBottom:12}}>
      {[["⏱ Time",formatTime(gs.elapsed)],["🏆 Level",`${level}/10`],["☠️ Kills",gs.kills],["👹 Bosses",gs.bossKills],["🌟 Tier",tier.name],["🏰 Keep",`Lv${gs.castleLevel||1} ${getKeepBlueprint(gs.castleLevel||1).label}`],["🃏 Perks",gs.perks.length],["💰 Earned",gs.totalGoldEarned],["⭐ XP",`+${xp}`]].map(([l,v])=>(<div key={l} style={{display:"flex",justifyContent:"space-between",gap:16,marginBottom:6,fontSize:12}}><span style={{color:"#555"}}>{l}</span><span style={{color:String(l).includes("XP")?"#FFD700":"#ccc",fontWeight:700}}>{v}</span></div>))}
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
