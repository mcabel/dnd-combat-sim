// bestow_curse.test.ts — Bestow Curse v2 (4 canon options — PHB p.214)
// L3, Touch (5 ft), WIS save or cursed, concentration.
// Options: (1) disadv on attacks vs caster, (2) disadv on one ability's checks & saves,
//          (3) incapacitated each turn (re-save not modelled), (4) +1d8 necrotic rider.
import { shouldCast, execute, metadata, pickCurseOption, CurseOption } from '../spells/bestow_curse';
import { getActiveCurseAttackDisadv, hasAbilityDisadvantage, getActiveCurseRider, applySpellEffect, removeEffectsFromCaster } from '../engine/spell_effects';
import { startConcentration } from '../engine/utils';
import { Combatant, Action, PlayerResources, Condition } from '../types/core';

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.error(`  ❌ ${label}${detail ? ': ' + detail : ''}`); failed++; } }
function eq<T>(label: string, a: T, b: T): void { assert(label, a === b, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
function withSlots3(remaining = 1): PlayerResources { return { spellSlots: { 3: { max: 1, remaining } } }; }
const BC_ACTION: Action = { name: 'Bestow Curse', isMultiattack: false, attackType: 'save', reach: 5, range: { normal: 60, long: 60 }, hitBonus: null, damage: null, damageType: null, saveDC: 25, saveAbility: 'wis', isAoE: false, isControl: true, requiresConcentration: true, slotLevel: 3, costType: 'action', legendaryCost: 0, description: 'Bestow Curse' };
const BC_ACTION_LOW: Action = { ...BC_ACTION, saveDC: 5 };
function makeCombatant(id: string, overrides: Partial<Combatant> = {}): Combatant {
  return { id, name: id, isPlayer: false, faction: 'party', maxHP: 100, currentHP: 100, ac: 14, speed: 30, flySpeed: null, swimSpeed: null, burrowSpeed: null, str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10, cr: 1, actions: [], traits: [], legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0, budget: { movementFt: 30, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false }, conditions: new Set() as Set<Condition>, aiProfile: 'smart', perception: { targets: new Map() } as any, concentration: null, deathSaves: null, resources: null, tempHP: 0, exhaustionLevel: 0, mountedOn: null, carriedBy: null, independentMount: false, role: 'regular', bonded: null, usedSneakAttackThisTurn: false, helpedThisTurn: false, isDefender: false, cannotAttack: false, hasHands: true, wearingArmor: false, isDead: false, isUnconscious: false, advantages: [], vulnerabilities: [], resistances: [], bardicInspirationDie: null, wardingBond: null, activeEffects: [], ...overrides, pos: { x: 0, y: 0, z: 0, ...((overrides as any).pos || {}) } };
}
function makeBF(c: Combatant[]) { return { width: 60, height: 60, depth: 1, cells: new Map(), round: 1, combatants: new Map(c.map(x => [x.id, x])), initiativeOrder: c.map(x => x.id) } as any; }
function makeState(bf: any): any { return { battlefield: bf, log: { events: [], winner: null, rounds: 0 }, disengagedThisTurn: new Set(), damageThisRound: new Map(), rageDamagedSinceLastTurn: new Set() }; }
function makeCaster(pos: any = { x: 0, y: 0, z: 0 }, a: Action = BC_ACTION) { return makeCombatant('wiz', { name: 'Caster', pos, actions: [a], resources: withSlots3(1) }); }
const weak = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', wis: 1, pos, ...o });
const strong = (id: string, pos: any, o: Partial<Combatant> = {}) => makeCombatant(id, { name: id, faction: 'enemy', wis: 30, pos, ...o });

// ============================================================
console.log('\n=== 1. Metadata ===\n');
// ============================================================
eq('Name', metadata.name, 'Bestow Curse');
eq('Level 3', metadata.level, 3);
eq('Range 5 (canon Touch)', metadata.rangeFt, 5);
eq('Save wis', metadata.saveAbility, 'wis');
eq('Concentration', metadata.concentration, true);
assert('v2 options implemented flag', metadata.bestowCurseOptionsV2Implemented === true);
assert('canon Touch range flag', metadata.bestowCurseCanonTouchRangeV1 === true);

// ============================================================
console.log('\n=== 2. shouldCast gates ===\n');
// ============================================================
{ const c = makeCombatant('wiz', { actions: [], resources: withSlots3(1) }); eq('null: no action', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCombatant('wiz', { actions: [BC_ACTION], resources: withSlots3(0) }); eq('null: no slots', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); c.concentration = { active: true, spellName: 'Bless', startedAtRound: 1 } as any; eq('null: already concentrating', shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: out of Touch range (10ft)', shouldCast(c, makeBF([c, weak('e1', { x: 2, y: 0 })])), null); }
{ const c = makeCaster(); eq('null: way out of range (50ft)', shouldCast(c, makeBF([c, weak('e1', { x: 50, y: 0 })])), null); }
{ const c = makeCaster(); const r = shouldCast(c, makeBF([c, weak('e1', { x: 1, y: 0 })])); assert('non-null (adjacent, 5ft)', r !== null); if (r) eq('enemy id', (r as Combatant).id, 'e1'); }

// ============================================================
console.log('\n=== 3. shouldCast target selection (both adjacent) ===\n');
// ============================================================
{ const c = makeCaster(); const lo = weak('lo', { x: 1, y: 0 }, { maxHP: 30 }); const hi = weak('hi', { x: 0, y: 1 }, { maxHP: 300 }); const r = shouldCast(c, makeBF([c, lo, hi])); if (r) eq('picks highest-threat (both in Touch)', (r as Combatant).id, 'hi'); }
{ const c = makeCaster(); const inc = weak('inc', { x: 1, y: 0 }, { maxHP: 300 }); inc.conditions.add('incapacitated' as Condition); // already cursed by someone else isn't a skip anymore (only our own curse)
  // But we now skip if already cursed by THIS caster
  eq('still picks incapacitated (no skip for that)', (() => { const r = shouldCast(c, makeBF([c, inc])); return r?.id; })(), 'inc');
}

// ============================================================
console.log('\n=== 4. pickCurseOption AI selection ===\n');
// ============================================================
{
  const c = makeCaster();
  const lowHP = weak('low', { x: 1, y: 0 }, { maxHP: 20 });
  const hiHP = weak('hi', { x: 1, y: 0 }, { maxHP: 50 });
  eq('low HP → disadv_attacks_vs_caster', pickCurseOption(c, lowHP), 'disadv_attacks_vs_caster');
  eq('high HP → necrotic_rider', pickCurseOption(c, hiHP), 'necrotic_rider');
  eq('boundary 30 → disadv_attacks_vs_caster (not >30)', pickCurseOption(c, weak('b30', { x: 1, y: 0 }, { maxHP: 30 })), 'disadv_attacks_vs_caster');
  eq('boundary 31 → necrotic_rider (>30)', pickCurseOption(c, weak('b31', { x: 1, y: 0 }, { maxHP: 31 })), 'necrotic_rider');
}

// ============================================================
console.log('\n=== 5. Execute — Option 1: curse_attack_disadv (low HP target) ===\n');
// ============================================================
{
  const c = makeCaster();
  const e = weak('e1', { x: 1, y: 0 }, { maxHP: 20 });  // low HP → disadv_attacks_vs_caster
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  execute(c, e, st);

  eq('slot consumed', (c.resources as any).spellSlots[3].remaining, 0);
  assert('concentration started', c.concentration?.active === true);

  // Check the effect was applied correctly
  const curseEffect = e.activeEffects.find(ef => ef.spellName === 'Bestow Curse');
  assert('effect exists', !!curseEffect);
  eq('effectType', curseEffect!.effectType, 'curse_attack_disadv');
  eq('curseCasterId', curseEffect!.payload.curseCasterId, 'wiz');
  assert('sourceIsConcentration', curseEffect!.sourceIsConcentration === true);

  // Query function
  const ids = getActiveCurseAttackDisadv(e);
  eq('getActiveCurseAttackDisadv returns caster id', ids.length, 1);
  eq('caster id in list', ids[0], 'wiz');

  // NOT incapacitated
  assert('NOT incapacitated', !e.conditions.has('incapacitated'));

  // Log contains curse option description
  const curseLog = st.log.events.find((x: any) => x.description?.includes('Curse of Attack Disadvantage'));
  assert('log mentions curse option', !!curseLog);
}

// ============================================================
console.log('\n=== 6. Execute — Option 4: curse_rider (high HP target) ===\n');
// ============================================================
{
  const c = makeCaster();
  const e = weak('e1', { x: 1, y: 0 }, { maxHP: 50 });  // high HP → necrotic_rider
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  execute(c, e, st);

  // Check the effect was applied correctly
  const curseEffect = e.activeEffects.find(ef => ef.spellName === 'Bestow Curse');
  assert('effect exists', !!curseEffect);
  eq('effectType', curseEffect!.effectType, 'curse_rider');
  eq('riderDie', curseEffect!.payload.riderDie, 8);
  eq('riderDieCount', curseEffect!.payload.riderDieCount, 1);
  eq('riderDamageType', curseEffect!.payload.riderDamageType, 'necrotic');
  eq('riderCasterId', curseEffect!.payload.riderCasterId, 'wiz');
  assert('sourceIsConcentration', curseEffect!.sourceIsConcentration === true);

  // Query function — attacker is the cursed target, targetId is the caster
  const rider = getActiveCurseRider(e, 'wiz');
  assert('getActiveCurseRider returns rider info', rider !== null);
  eq('rider die', rider!.die, 8);
  eq('rider count', rider!.count, 1);
  eq('rider damageType', rider!.damageType, 'necrotic');

  // NOT rider when target is not the caster
  const noRider = getActiveCurseRider(e, 'other');
  eq('no rider vs non-caster', noRider, null);

  // NOT incapacitated
  assert('NOT incapacitated', !e.conditions.has('incapacitated'));

  // Log contains necrotic rider description
  const curseLog = st.log.events.find((x: any) => x.description?.includes('Necrotic Rider'));
  assert('log mentions necrotic rider', !!curseLog);
}

// ============================================================
console.log('\n=== 7. Execute — Option 2: ability_disadvantage ===\n');
// ============================================================
{
  const c = makeCaster();
  const e = weak('e1', { x: 1, y: 0 }, { maxHP: 20 });  // low HP, but force option 2
  const bf = makeBF([c, e]);
  const st = makeState(bf);

  // Manually apply option 2 (ability_disadvantage) to test it
  // (AI would pick disadv_attacks_vs_caster for low HP, so we apply directly)
  consumeSpellSlotForTest(c);
  if (c.concentration?.active) removeEffectsFromCaster(c.id, bf);
  startConcentration(c, 'Bestow Curse');

  // Apply ability_disadvantage effect directly
  applySpellEffect(e, {
    casterId: c.id, spellName: 'Bestow Curse',
    effectType: 'ability_disadvantage', payload: { ability: 'wis' },
    sourceIsConcentration: true,
  });

  // Check the effect
  const abilityEffect = e.activeEffects.find((ef: any) => ef.effectType === 'ability_disadvantage');
  assert('effect exists', !!abilityEffect);
  eq('ability', abilityEffect!.payload.ability, 'wis');

  // Query function
  assert('hasAbilityDisadvantage wis', hasAbilityDisadvantage(e, 'wis'));
  assert('NOT hasAbilityDisadvantage str', !hasAbilityDisadvantage(e, 'str'));
  assert('NOT hasAbilityDisadvantage dex', !hasAbilityDisadvantage(e, 'dex'));
}
function consumeSpellSlotForTest(c: Combatant) {
  if (c.resources?.spellSlots?.[3]) c.resources.spellSlots[3].remaining--;
}

// ============================================================
console.log('\n=== 8. Execute — Option 3: incapacitated_resave ===\n');
// ============================================================
{
  const c = makeCaster();
  const e = weak('e1', { x: 1, y: 0 }, { maxHP: 20 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);

  // Apply incapacitated_resave option directly (AI would pick disadv_attacks_vs_caster)
  consumeSpellSlotForTest(c);
  if (c.concentration?.active) removeEffectsFromCaster(c.id, bf);
  startConcentration(c, 'Bestow Curse');

  applySpellEffect(e, {
    casterId: c.id, spellName: 'Bestow Curse',
    effectType: 'condition_apply', payload: { condition: 'incapacitated' },
    sourceIsConcentration: true,
  });

  assert('incapacitated applied', e.conditions.has('incapacitated'));

  // Verify undo works — concentration break removes the condition
  removeEffectsFromCaster(c.id, bf);
  assert('incapacitated removed on conc break', !e.conditions.has('incapacitated'));
  eq('no active effects left', e.activeEffects.length, 0);
}

// ============================================================
console.log('\n=== 9. Execute — guaranteed save success (no curse) ===\n');
// ============================================================
{
  const c = makeCaster({ x: 0, y: 0, z: 0 }, BC_ACTION_LOW);
  const e = strong('e1', { x: 1, y: 0 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  execute(c, e, st);
  assert('NOT cursed', !e.conditions.has('incapacitated'));
  assert('no curse effects', e.activeEffects.length === 0);
  const ss = st.log.events.filter((x: any) => x.type === 'save_success');
  assert('save_success log', ss.length === 1);
}

// ============================================================
console.log('\n=== 10. Cleanup no-op ===\n');
// ============================================================
{ let ok = true; try { (require('../spells/bestow_curse') as any).cleanup(makeCaster()); } catch { ok = false; } assert('no throw', ok); }

// ============================================================
console.log('\n=== 11. Concentration break removes all curse effects ===\n');
// ============================================================
{
  const c = makeCaster();
  const e = weak('e1', { x: 1, y: 0 }, { maxHP: 50 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  execute(c, e, st);

  // Should have a curse_rider effect (high HP target)
  assert('has curse effect', e.activeEffects.length > 0);

  // Concentration break removes it
  removeEffectsFromCaster(c.id, bf);
  eq('effect removed', e.activeEffects.length, 0);

  // Query returns null/empty
  eq('getActiveCurseRider null after removal', getActiveCurseRider(e, 'wiz'), null);
  eq('getActiveCurseAttackDisadv empty after removal', getActiveCurseAttackDisadv(e).length, 0);
}

// ============================================================
console.log('\n=== 12. Already-cursed target skip ===\n');
// ============================================================
{
  const c = makeCaster();
  const e = weak('e1', { x: 1, y: 0 }, { maxHP: 50 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  execute(c, e, st);

  // Try to cast again — shouldCast should return null (already cursed by this caster)
  const result = shouldCast(c, bf);
  eq('null: already cursed by this caster', result, null);
}

// ============================================================
console.log('\n=== 13. Log messages contain CURSED ===\n');
// ============================================================
{
  const c = makeCaster();
  const e = weak('e1', { x: 1, y: 0 }, { maxHP: 50 });
  const bf = makeBF([c, e]);
  const st = makeState(bf);
  execute(c, e, st);
  const cursedLog = st.log.events.find((x: any) => x.description?.includes('CURSED'));
  assert('log contains CURSED', !!cursedLog);
}

// ============================================================
console.log('\n=== 14. Multiple curse effects query ===\n');
// ============================================================
{
  const e = weak('e1', { x: 1, y: 0 });
  // Apply two curse_attack_disadv from different casters
  applySpellEffect(e, {
    casterId: 'caster1', spellName: 'Bestow Curse',
    effectType: 'curse_attack_disadv', payload: { curseCasterId: 'caster1' },
    sourceIsConcentration: true,
  });
  applySpellEffect(e, {
    casterId: 'caster2', spellName: 'Bestow Curse',
    effectType: 'curse_attack_disadv', payload: { curseCasterId: 'caster2' },
    sourceIsConcentration: true,
  });

  const ids = getActiveCurseAttackDisadv(e);
  eq('two curse caster IDs', ids.length, 2);
  assert('caster1 in list', ids.includes('caster1'));
  assert('caster2 in list', ids.includes('caster2'));
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
