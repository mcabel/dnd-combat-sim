// ============================================================
// Test: Phase 4 Completion — 4.10–4.14 + Q7
// Rests, ammo, creature type profiles, prone modifiers,
// grapple/shove mechanics, commanded creatures
// Run: ts-node src/test/phase4.test.ts
// ============================================================

import { shortRest, longRest, hasAmmo, spendAmmo, rollGrappleContest, shouldGrapple, resolveAttackAdvantage } from '../engine/utils';
import { defaultProfileForType }                       from '../parser/fivetools';
import { loadPCStatBlocks, spawnPC, RawPCEntry }        from '../parser/pc';
import { runCombat, makeFlatBattlefield }               from '../engine/combat';
import { Combatant, Battlefield }                       from '../types/core';
import * as fs   from 'fs';
import * as path from 'path';

// ---- Harness ------------------------------------------------

let passed = 0, failed = 0;
function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- PC data ------------------------------------------------

const pcPath = [
  path.join(__dirname, '../../pc_stat_blocks_lv1.json'),
  '/mnt/project/pc_stat_blocks_lv1.json',
].find(p => fs.existsSync(p))!;
const pcData: RawPCEntry[] = JSON.parse(fs.readFileSync(pcPath, 'utf-8'));
const pcMap = loadPCStatBlocks(pcData);
const pc = (cls: string) => spawnPC(pcMap, cls, {x:0,y:0,z:0})!;

// ---- Factory ------------------------------------------------

let _id = 0;
function makeC(o: Partial<Combatant> = {}): Combatant {
  const speed = o.speed ?? 30;
  return {
    id: `c${++_id}`, name: `c${_id}`, isPlayer: false, faction: 'enemy',
    maxHP: 20, currentHP: 20, ac: 14, speed,
    flySpeed: null, swimSpeed: null, burrowSpeed: null,
    str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10,
    cr: 1, pos: {x:0,y:0,z:0},
    actions: [], traits: [],
    legendaryActions: [], legendaryActionPool: 0, legendaryActionPoolMax: 0,
    budget: { movementFt: speed, actionUsed: false, bonusActionUsed: false, reactionUsed: false, freeObjectUsed: false },
    conditions: new Set(),
    concentration: null, deathSaves: null, tempHP: 0,
    resources: null, usedSneakAttackThisTurn: false,
    helpedThisTurn: false,
    isDefender: false,
    cannotAttack: false,
    hasHands: false,
    aiProfile: 'smart',
    perception: { targets: new Map() },
    mountedOn: null,
    carriedBy: null,
    independentMount: false,
    role: 'regular',
    bonded: null,
    isDead: false, isUnconscious: false,
    advantages: [], vulnerabilities: [], resistances: [],
    ...o,
  };
}

// ============================================================
// 1. Short Rest (4.10)
// ============================================================
console.log('\n=== 1. Short Rest ===\n');

{
  // Warlock recovers pact slot on short rest
  const warlock = pc('Warlock');
  warlock.resources!.pactSlots!.remaining = 0;
  assert('Warlock: 0 pact slots before short rest', warlock.resources!.pactSlots!.remaining === 0);
  shortRest(warlock);
  eq('Warlock: pact slot restored after short rest', warlock.resources!.pactSlots!.remaining, 1);

  // Fighter recovers second wind on short rest
  const fighter = pc('Fighter');
  fighter.resources!.secondWind!.remaining = 0;
  shortRest(fighter);
  eq('Fighter: second wind restored after short rest', fighter.resources!.secondWind!.remaining, 1);

  // Wizard spell slots do NOT recover on short rest (long rest only)
  const wizard = pc('Wizard');
  wizard.resources!.spellSlots![1]!.remaining = 0;
  shortRest(wizard);
  eq('Wizard: spell slots NOT restored on short rest', wizard.resources!.spellSlots![1]!.remaining, 0);
}

// ============================================================
// 2. Long Rest (4.10)
// ============================================================
console.log('\n=== 2. Long Rest ===\n');

{
  const barb = pc('Barbarian');
  barb.currentHP = 3;
  barb.resources!.rage!.remaining = 0;
  longRest(barb);
  eq('Barbarian: HP restored to max', barb.currentHP, barb.maxHP);
  eq('Barbarian: rage restored', barb.resources!.rage!.remaining, barb.resources!.rage!.max);

  const bard = pc('Bard');
  bard.resources!.bardicInspiration!.remaining = 0;
  longRest(bard);
  eq('Bard: bardic inspiration restored', bard.resources!.bardicInspiration!.remaining, bard.resources!.bardicInspiration!.max);

  const paladin = pc('Paladin');
  paladin.resources!.layOnHands!.remaining = 0;
  paladin.resources!.spellSlots![1]!.remaining = 0;
  longRest(paladin);
  eq('Paladin: LoH pool restored', paladin.resources!.layOnHands!.remaining, 5);
  eq('Paladin: spell slots restored', paladin.resources!.spellSlots![1]!.remaining, 2);
}

// ============================================================
// 3. Ammo Tracking (4.11)
// ============================================================
console.log('\n=== 3. Ammo Tracking ===\n');

{
  const ranger = pc('Ranger');
  assert('Ranger has longbow ammo', ranger.resources?.ammo?.['longbow'] !== undefined);
  eq('Ranger: 20 arrows', ranger.resources!.ammo!['longbow'].max, 20);
  eq('Ranger: 20 remaining', ranger.resources!.ammo!['longbow'].remaining, 20);

  assert('hasAmmo: true initially', hasAmmo(ranger, 'Longbow'));
  assert('spendAmmo: success', spendAmmo(ranger, 'Longbow'));
  eq('19 arrows remaining', ranger.resources!.ammo!['longbow'].remaining, 19);

  // Exhaust all arrows
  for (let i = 0; i < 19; i++) spendAmmo(ranger, 'Longbow');
  eq('0 arrows remaining', ranger.resources!.ammo!['longbow'].remaining, 0);
  assert('hasAmmo: false when empty', !hasAmmo(ranger, 'Longbow'));
  assert('spendAmmo: fails when empty', !spendAmmo(ranger, 'Longbow'));

  // Creature with no ammo tracking — always returns true
  const fighter = pc('Fighter');
  assert('Fighter: hasAmmo always true (no tracking)', hasAmmo(fighter, 'Greatsword'));
  assert('Fighter: spendAmmo always true (no tracking)', spendAmmo(fighter, 'Greatsword'));
}

// ============================================================
// 4. Default AI Profile per Creature Type (Q7)
// ============================================================
console.log('\n=== 4. Creature Type → AI Profile ===\n');

const typeTests: [string, string][] = [
  ['beast',       'attackNearest'],
  ['undead',      'attackNearest'],
  ['construct',   'attackNearest'],
  ['plant',       'attackNearest'],
  ['ooze',        'attackNearest'],
  ['elemental',   'attackNearest'],
  ['giant',       'attackWeakest'],
  ['humanoid',    'smart'],
  ['monstrosity', 'smart'],
  ['fiend',       'smart'],
  ['celestial',   'smart'],
  ['fey',         'smart'],
  ['dragon',      'smart'],
  ['aberration',  'smart'],
  [undefined as any, 'smart'],  // unknown → safe default
];

for (const [type, expected] of typeTests) {
  const result = defaultProfileForType(type);
  eq(`Type "${type}" → ${expected}`, result, expected as any);
}

// Object form (5etools sometimes uses { type: string })
eq('Object type form works', defaultProfileForType({ type: 'humanoid' }), 'smart');
eq('Object beast works',     defaultProfileForType({ type: 'beast' }),    'attackNearest');

// ============================================================
// 5. Prone Attack Modifiers (4.13)
// ============================================================
console.log('\n=== 5. Prone Attack Modifiers ===\n');

{
  const attacker = makeC({ str: 16, dex: 14 });
  const proneTarget = makeC();
  proneTarget.conditions.add('prone');

  // Melee → advantage
  const meleeAdv = resolveAttackAdvantage(attacker, proneTarget, 'melee');
  assert('Prone target: melee → advantage', meleeAdv.advantage);
  assert('Prone target: melee → no disadvantage', !meleeAdv.disadvantage);

  // Ranged → disadvantage
  const rangedAdv = resolveAttackAdvantage(attacker, proneTarget, 'ranged');
  assert('Prone target: ranged → disadvantage', rangedAdv.disadvantage);
  assert('Prone target: ranged → no advantage', !rangedAdv.advantage);

  // Spell (melee spell) → advantage
  const spellAdv = resolveAttackAdvantage(attacker, proneTarget, 'spell');
  assert('Prone target: spell → advantage', spellAdv.advantage);

  // No prone → no modifier
  const normalTarget = makeC();
  const normalAdv = resolveAttackAdvantage(attacker, normalTarget, 'melee');
  assert('Non-prone: no advantage', !normalAdv.advantage);
  assert('Non-prone: no disadvantage', !normalAdv.disadvantage);

  // Blinded attacker stacks with prone target
  const blindedAttacker = makeC();
  blindedAttacker.conditions.add('blinded');
  const stackedAdv = resolveAttackAdvantage(blindedAttacker, proneTarget, 'melee');
  assert('Blinded+prone: both flags set', stackedAdv.advantage && stackedAdv.disadvantage);
  // (advantage and disadvantage cancel — PHB p.173; engine handles this in rollAttack)
}

// ============================================================
// 6. Grapple Mechanics (4.14)
// ============================================================
console.log('\n=== 6. Grapple Mechanics ===\n');

{
  const strongGrappler = makeC({ str: 20 }); // +5 STR
  const weakTarget     = makeC({ str: 8, dex: 8 }); // -1 both

  // Strong grappler should win majority of contests
  let wins = 0;
  for (let i = 0; i < 100; i++) {
    if (rollGrappleContest(strongGrappler, weakTarget)) wins++;
  }
  assert('Strong grappler wins majority (≥60%)', wins >= 60,
    `wins=${wins}/100`);

  // shouldGrapple: only smart AI with STR ≥ 2 vs flying/fast target
  const smartStrong = makeC({ str: 16, aiProfile: 'smart' });
  const flyingTarget = makeC({ flySpeed: 30 });
  assert('Should grapple flying target', shouldGrapple(smartStrong, flyingTarget, 0));

  const fastTarget = makeC({ speed: 40 });
  assert('Should grapple fast target', shouldGrapple(smartStrong, fastTarget, 0));

  const normalTarget = makeC({ speed: 30 });
  assert('Should NOT grapple normal target', !shouldGrapple(smartStrong, normalTarget, 0));

  const weakAttacker = makeC({ str: 8, aiProfile: 'smart' }); // STR mod -1
  assert('Weak STR: should not grapple', !shouldGrapple(weakAttacker, flyingTarget, 0));

  const nearestAI = makeC({ str: 18, aiProfile: 'attackNearest' });
  assert('attackNearest: should not grapple', !shouldGrapple(nearestAI, flyingTarget, 0));
}

// ============================================================
// 7. Commanded Creatures (4.12)
// ============================================================
console.log('\n=== 7. Commanded Creatures ===\n');

{
  // Spawn a defend-profile creature and a distant enemy
  const defender = makeC({ id: 'fly', faction: 'enemy', aiProfile: 'defend', pos: {x:0,y:0,z:0} });
  const aggressor = makeC({ id: 'hero', faction: 'party', pos: {x:6,y:0,z:0},
    actions: [{ name:'Punch', isMultiattack:false, attackType:'melee', reach:5, range:null,
      hitBonus:5, damage:{count:1,sides:6,bonus:3,average:6}, damageType:'bludgeoning',
      saveDC:null, saveAbility:null, isAoE:false, isControl:false, requiresConcentration:false,
      costType:'action', legendaryCost:0, description:'' }]
  });
  const bf = makeFlatBattlefield(15, 15, [defender, aggressor]);

  // Pre-wire a command: on round 1, override fly's profile to attackNearest
  bf.pendingCommands = new Map();
  bf.pendingCommands.set('fly', 'attackNearest');

  // Run for 3 rounds only — check that fly moved (command activated)
  const log = runCombat(bf, ['fly', 'hero'], { maxRounds: 3 });

  // With 'defend' profile and no command, fly would NOT move
  // With command overriding to 'attackNearest', fly SHOULD have dashed toward hero
  const flyMoves = log.events.filter(e => e.type === 'move' && e.actorId === 'fly');
  assert('Commanded creature moved toward enemy', flyMoves.length > 0,
    `fly move events: ${flyMoves.length}`);

  // Verify command was consumed (profile is now attackNearest, not defend)
  eq('Profile overridden to attackNearest', defender.aiProfile, 'attackNearest');
  assert('pendingCommands cleared after use', !bf.pendingCommands.has('fly'));
}

// ============================================================
// Summary
// ============================================================
console.log('\n' + '─'.repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('\nFailed tests above ↑'); process.exit(1); }
else console.log('\nAll tests passed ✅');
