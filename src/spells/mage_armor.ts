// ============================================================
// Mage Armor — PHB p.256
// 1st-level abjuration. Action, touch, no concentration, 8 hrs.
//
// Effect: Willing creature not wearing armor has base AC = 13 + DEX mod.
// AI: cast on self as first action if unarmored and benefit > 0.
//
// Implementation:
//   - Apply 'ac_bonus' ActiveEffect: acBonus = (13 + dexMod) − current AC
//   - Only beneficial when 13 + dexMod > current AC
//   - Warlocks in leather (wearingArmor = true) are ineligible
// ============================================================

import { Combatant, Battlefield } from '../types/core';
import { EngineState } from '../engine/combat';
import { applySpellEffect } from '../engine/spell_effects';

function dexMod(c: Combatant): number {
  return Math.floor((c.dex - 10) / 2);
}

// ---- shouldCast ---------------------------------------------

/**
 * Returns true if `caster` should cast Mage Armor on themselves.
 * Conditions:
 *   1. Has a 1st-level spell slot remaining
 *   2. Not wearing armor (wearingArmor = false)
 *   3. Mage Armor AC (13 + DEX) > current AC  (net positive gain)
 *   4. Not already under Mage Armor effect
 */
export function shouldCast(caster: Combatant, _bf: Battlefield): boolean {
  const slots = caster.resources?.spellSlots?.[1];
  if (!slots || slots.remaining < 1) return false;
  if (caster.wearingArmor) return false;

  const mageArmorAC = 13 + dexMod(caster);
  if (mageArmorAC <= caster.ac) return false;          // no net gain (Sorcerer Draconic Res.)

  const alreadyActive = caster.activeEffects.some(e => e.spellName === 'Mage Armor');
  if (alreadyActive) return false;

  return true;
}

// ---- execute ------------------------------------------------

export function execute(caster: Combatant, state: EngineState): void {
  // Consume slot
  const slot = caster.resources!.spellSlots![1];
  slot.remaining = Math.max(0, slot.remaining - 1);

  const bonus = (13 + dexMod(caster)) - caster.ac;

  applySpellEffect(caster, {
    casterId: caster.id,
    spellName: 'Mage Armor',
    effectType: 'ac_bonus',
    payload: { acBonus: bonus },
    sourceIsConcentration: false,
    appliedTurn: state.battlefield.round,
    sourceTurnExpires: state.battlefield.round + 4800,   // PHB p.256: 8 hr = 4800 rounds
  });

  state.log.events.push({
    round: state.battlefield.round ?? 0,
    actorId: caster.id,
    type: 'action',
    description: `${caster.name} casts Mage Armor (AC ${caster.ac} → ${caster.ac + bonus})`,
    value: bonus,
  });
}
