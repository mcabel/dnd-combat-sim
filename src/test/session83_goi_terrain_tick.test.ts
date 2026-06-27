// ============================================================
// Test: Session 83 — GoI terrain_zone tick protection
//
// PHB p.245: "Any spell of 5th level or lower cast from outside the
// barrier can't affect creatures or objects within it... the spell
// has no effect on them." This applies to terrain zones too — a
// GoI-protected creature should NOT be affected by a terrain zone's
// save/condition on per-turn ticks.
//
// Prior state: the damage_zone tick loop (combat.ts) had a GoI check
// (Session 78 + Session 82 casterId fix), but the terrain_zone tick
// loop had NO GoI check. The spell modules (Evard's Black Tentacles,
// Maelstrom, Sickening Radiance) even documented in their comments
// that "combat.ts terrain_zone tick loop re-checks GoI on each
// per-turn tick using the zone's sourceSlotLevel" — but the code
// didn't implement it. Also, the TerrainZone interface was missing
// the sourceSlotLevel field (set on the effect but lost during
// getActiveTerrainZones extraction).
//
// Session 83 fix:
//   1. Added sourceSlotLevel to TerrainZone interface + getActiveTerrainZones
//   2. Added GoI check (with zone.casterId for caster-inside) to the
//      terrain_zone tick loop in combat.ts
//
// Run: npx ts-node --transpile-only src/test/session83_goi_terrain_tick.test.ts
// ============================================================

import { Combatant, Condition, ActiveEffect } from '../types/core';
import { isProtectedByGoI, getActiveTerrainZones, TerrainZone } from '../engine/spell_effects';

let passed = 0, failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, b: T): void {
  assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
}

// ---- Helpers ------------------------------------------------

function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return {
    id, name: id, isPlayer: false, faction: 'enemy',
    maxHP: 1000, currentHP: 1000, ac: 14, speed: 30,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 10, dex: 1, con: 10, int: 10, wis: 16, cha: 10,
    cr: 1,
    pos: { x: 0, y: 0, z: 0 },
    actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0,
    legendaryActionPoolMax: 0,
    budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set<Condition>(),
    aiProfile: 'smart',
    perception: { targets: new Map() } as any,
    concentration: null,
    deathSaves: null,
    resources: null,
    tempHP: 0,
    exhaustionLevel: 0,
    mountedOn: null, carriedBy: null, independentMount: false,
    role: 'regular', bonded: null,
    usedSneakAttackThisTurn: false, helpedThisTurn: false,
    isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    bardicInspirationDie: null,
    wardingBond: null,
    activeEffects: [],
    ...overrides,
  };
}

function makeBF(combatants: Combatant[]) {
  return {
    width: 60, height: 60, depth: 5,
    cells: new Map(),
    round: 1,
    combatants: new Map(combatants.map(c => [c.id, c])),
    initiativeOrder: combatants.map(c => c.id),
  } as any;
}

function makeGoIEffect(blockThreshold: number, ownerId: string, sourceSlotLevel: number = 6): ActiveEffect {
  return {
    id: `eff_goi_${ownerId}_${blockThreshold}`,
    casterId: ownerId,
    spellName: 'Globe of Invulnerability',
    effectType: 'spell_shield',
    sourceSlotLevel,
    sourceIsConcentration: true,
    payload: { blockThreshold },
  } as ActiveEffect;
}

/** Create a terrain_zone ActiveEffect (as set by spell modules like Evard's). */
function makeTerrainZoneEffect(
  spellName: string,
  casterId: string,
  slotLevel: number,
  center: { x: number; y: number; z: number },
  radiusFt: number,
  condition: Condition,
  saveAbility: 'str' | 'dex' | 'con' | 'wis',
): ActiveEffect {
  return {
    id: `eff_tz_${spellName}_${casterId}`,
    casterId,
    spellName,
    effectType: 'terrain_zone',
    sourceSlotLevel: slotLevel,
    sourceIsConcentration: true,
    payload: {
      terrainCondition: condition,
      terrainSaveAbility: saveAbility,
      terrainRadiusFt: radiusFt,
      terrainCenterX: center.x,
      terrainCenterY: center.y,
      terrainCenterZ: center.z,
    },
  } as ActiveEffect;
}

// ============================================================
// Phase 1 — getActiveTerrainZones returns sourceSlotLevel
// ============================================================

console.log('\n=== Phase 1 — getActiveTerrainZones returns sourceSlotExpires ===\n');

{
  const caster = makeCombatant('wiz', {
    activeEffects: [makeTerrainZoneEffect("Evard's Black Tentacles", 'wiz', 4, { x: 5, y: 5, z: 0 }, 20, 'restrained', 'dex')],
  });
  const bf = makeBF([caster]);

  const zones = getActiveTerrainZones(bf);
  eq('1a. One terrain zone extracted', zones.length, 1);

  const z = zones[0] as TerrainZone;
  eq('1b. sourceSlotLevel present on TerrainZone', z.sourceSlotLevel, 4);
  eq('1c. spellName', z.spellName, "Evard's Black Tentacles");
  eq('1d. condition', z.condition, 'restrained');
  eq('1e. saveAbility', z.saveAbility, 'dex');
}

{
  // Multiple terrain zones with different slot levels.
  const caster1 = makeCombatant('wiz1', {
    activeEffects: [makeTerrainZoneEffect('Sickening Radiance', 'wiz1', 4, { x: 0, y: 0, z: 0 }, 30, 'poisoned', 'con')],
  });
  const caster2 = makeCombatant('wiz2', {
    activeEffects: [makeTerrainZoneEffect('Maelstrom', 'wiz2', 5, { x: 10, y: 10, z: 0 }, 20, 'restrained', 'dex')],
  });
  const bf = makeBF([caster1, caster2]);

  const zones = getActiveTerrainZones(bf);
  eq('1f. Two terrain zones extracted', zones.length, 2);
  const sr = zones.find(z => z.spellName === 'Sickening Radiance');
  const ma = zones.find(z => z.spellName === 'Maelstrom');
  eq('1g. Sickening Radiance sourceSlotLevel = 4', sr?.sourceSlotLevel, 4);
  eq('1h. Maelstrom sourceSlotLevel = 5', ma?.sourceSlotLevel, 5);
}

// ============================================================
// Phase 2 — isProtectedByGoI: terrain zone caster-inside
// ============================================================

console.log('\n=== Phase 2 — isProtectedByGoI: terrain zone caster === GoI caster ===\n');

{
  // Caster has own GoI. An ally within the GoI radius would be protected
  // from an EXTERNAL caster's terrain zone, but NOT from the GoI caster's
  // own terrain zone (the zone is "cast from inside the barrier").
  const goiCaster = makeCombatant('wiz', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'wiz')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });  // 5 ft, inside GoI radius
  const bf = makeBF([goiCaster, ally]);

  // External caster → ally protected from L4 terrain zone.
  eq('2a. External caster: ally protected from L4', isProtectedByGoI(ally, 4, bf, 'enemyCaster'), true);
  // Zone caster = GoI caster → ally NOT protected (caster inside own barrier).
  eq('2b. Zone caster = GoI caster: ally NOT protected', isProtectedByGoI(ally, 4, bf, 'wiz'), false);
}

// ============================================================
// Phase 3 — Simulated terrain_zone tick GoI check logic
// ============================================================

console.log('\n=== Phase 3 — Simulated terrain_zone tick GoI check ===\n');

{
  // Mirrors the combat.ts terrain_zone tick loop GoI check:
  //   const terrainSlotLevel = zone.sourceSlotLevel ?? 0;
  //   if (terrainSlotLevel > 0 && actor.id !== zone.casterId &&
  //       isProtectedByGoI(actor, terrainSlotLevel, state.battlefield, zone.casterId)) {
  //     ... skip (GoI-protected) ...

  // 3a. GoI-protected target in terrain zone → blocked.
  const goiTarget = makeCombatant('prot', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'prot')],  // GoI on the target itself
  });
  const zoneCaster = makeCombatant('ext', { pos: { x: 0, y: 0, z: 0 } });
  const bf = makeBF([goiTarget, zoneCaster]);

  const terrainSlotLevel = 4;  // Evard's Black Tentacles L4
  const blocked = terrainSlotLevel > 0 && goiTarget.id !== zoneCaster.id &&
    isProtectedByGoI(goiTarget, terrainSlotLevel, bf, zoneCaster.id);
  assert('3a. GoI-protected target: terrain tick BLOCKED (L4 ≤ threshold 5)', blocked === true);

  // 3b. GoI-protected target, L6 spell → not blocked (penetrates).
  const blocked6 = 6 > 0 && goiTarget.id !== zoneCaster.id &&
    isProtectedByGoI(goiTarget, 6, bf, zoneCaster.id);
  assert('3b. GoI-protected target: L6 terrain NOT blocked (penetrates threshold 5)', blocked6 === false);

  // 3c. No GoI → not blocked.
  const noGoiTarget = makeCombatant('nogoi', { pos: { x: 5, y: 5, z: 0 } });
  const bf2 = makeBF([noGoiTarget, zoneCaster]);
  const blockedNone = 4 > 0 && noGoiTarget.id !== zoneCaster.id &&
    isProtectedByGoI(noGoiTarget, 4, bf2, zoneCaster.id);
  assert('3c. No GoI: terrain tick NOT blocked', blockedNone === false);

  // 3d. Zone caster === GoI caster → not blocked (caster inside own barrier).
  const goiCasterIsZoneCaster = makeCombatant('both', {
    pos: { x: 5, y: 5, z: 0 },
    activeEffects: [makeGoIEffect(5, 'both')],
  });
  const ally = makeCombatant('ally', { pos: { x: 5, y: 6, z: 0 } });
  const bf3 = makeBF([goiCasterIsZoneCaster, ally]);
  const blockedSelf = 4 > 0 && ally.id !== goiCasterIsZoneCaster.id &&
    isProtectedByGoI(ally, 4, bf3, goiCasterIsZoneCaster.id);
  assert('3d. Zone caster === GoI caster: ally NOT blocked (caster inside)', blockedSelf === false);
}

// ============================================================
// Phase 4 — Source-code presence checks
// ============================================================

console.log('\n=== Phase 4 — Source-code presence checks ===\n');

{
  const fs = require('fs');
  const path = require('path');

  // 4a. TerrainZone interface has sourceSlotLevel field.
  const spellEffectsSrc = fs.readFileSync(path.join(__dirname, '..', 'engine', 'spell_effects.ts'), 'utf8');
  assert('4a. TerrainZone interface includes sourceSlotLevel',
    /interface TerrainZone \{[\s\S]*?sourceSlotLevel\?:\s*number/.test(spellEffectsSrc));

  // 4b. getActiveTerrainZones copies sourceSlotLevel.
  assert('4b. getActiveTerrainZones copies sourceSlotLevel',
    spellEffectsSrc.includes('sourceSlotLevel: e.sourceSlotLevel'));

  // 4c. combat.ts terrain_zone tick loop has the GoI check.
  const combatSrc = fs.readFileSync(path.join(__dirname, '..', 'engine', 'combat.ts'), 'utf8');
  assert('4c. combat.ts terrain_zone tick has GoI check with zone.casterId',
    combatSrc.includes('isProtectedByGoI(actor, terrainSlotLevel, state.battlefield, zone.casterId)'));

  // 4d. combat.ts terrain_zone tick has the "terrain tick negated" log message.
  assert('4d. combat.ts terrain_zone tick has GoI negation log',
    combatSrc.includes('terrain tick negated'));
}

// ============================================================
// Phase 5 — Spell modules set sourceSlotLevel on terrain_zone
// ============================================================

console.log('\n=== Phase 5 — Spell modules set sourceSlotLevel on terrain_zone ===\n');

{
  const fs = require('fs');
  const path = require('path');

  const spells = [
    { file: 'evards_black_tentacles.ts', name: "Evard's Black Tentacles" },
    { file: 'sickening_radiance.ts', name: 'Sickening Radiance' },
    { file: 'maelstrom.ts', name: 'Maelstrom' },
  ];

  for (const s of spells) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'spells', s.file), 'utf8');
    // The terrain_zone effect must include sourceSlotLevel.
    // Find the terrain_zone block and check for sourceSlotLevel.
    const tzBlock = src.slice(src.indexOf("'terrain_zone'"), src.indexOf("'terrain_zone'") + 500);
    assert(`5. ${s.name} terrain_zone has sourceSlotLevel`,
      tzBlock.includes('sourceSlotLevel:'),
      `terrain_zone block missing sourceSlotLevel`);
  }
}

// ============================================================
// Results
// ============================================================

console.log(`\n${'─'.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('\n❌ SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('\nAll tests passed ✅');
}
