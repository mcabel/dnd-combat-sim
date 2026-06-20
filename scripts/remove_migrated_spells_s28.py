#!/usr/bin/env python3
"""
remove_migrated_spells_s28.py — Remove Session 27 Batch 4 migrated spells from
_generic_registry.ts. 22 persistent-zone + healing + temp-HP spells migrated
to bespoke case branches.

Mirrors scripts/remove_migrated_spells_s27.py. Idempotent per-spell.
"""
import re
from pathlib import Path

SPELLS = [
    # PERSISTENT_DAMAGE_ZONE (11)
    ('Death Armor', 'death_armor', 'DeathArmor'),
    ('Dust Devil', 'dust_devil', 'DustDevil'),
    ('Healing Spirit', 'healing_spirit', 'HealingSpirit'),
    ('Cacophonic Shield', 'cacophonic_shield', 'CacophonicShield'),
    ('Call Lightning', 'call_lightning', 'CallLightning'),
    ('Hunger of Hadar', 'hunger_of_hadar', 'HungerOfHadar'),
    ('Spirit Guardians', 'spirit_guardians', 'SpiritGuardians'),
    ('Guardian of Faith', 'guardian_of_faith', 'GuardianOfFaith'),
    ('Dawn', 'dawn', 'Dawn'),
    ('Insect Plague', 'insect_plague', 'InsectPlague'),
    ('Storm of Vengeance', 'storm_of_vengeance', 'StormOfVengeance'),
    # HEALING (9)
    ('Goodberry', 'goodberry', 'Goodberry'),
    ('Wither and Bloom', 'wither_and_bloom', 'WitherAndBloom'),
    ('Aura of Vitality', 'aura_of_vitality', 'AuraOfVitality'),
    ('Mass Healing Word', 'mass_healing_word', 'MassHealingWord'),
    ('Mass Cure Wounds', 'mass_cure_wounds', 'MassCureWounds'),
    ('Heal', 'heal', 'Heal'),
    ('Regenerate', 'regenerate', 'Regenerate'),
    ('Mass Heal', 'mass_heal', 'MassHeal'),
    ('Power Word Heal', 'power_word_heal', 'PowerWordHeal'),
    # TEMP_HP (2)
    ('Armor of Agathys', 'armor_of_agathys', 'ArmorOfAgathys'),
    ('False Life', 'false_life', 'FalseLife'),
]

PATH = Path('src/spells/_generic_registry.ts')

def main():
    text = PATH.read_text()
    for canonical, snake, alias in SPELLS:
        import_pat = re.compile(
            r"import \{\s*\n"
            r"\s*shouldCast as shouldCast" + re.escape(alias) + r",\s*\n"
            r"\s*execute as execute" + re.escape(alias) + r",\s*\n"
            r"\s*metadata as metadata" + re.escape(alias) + r",\s*\n"
            r"\} from '\./" + re.escape(snake) + r"';\s*\n\n",
            re.MULTILINE,
        )
        text, n1 = import_pat.subn('', text)
        map_pat = re.compile(
            r"  '" + re.escape(canonical) + r"': \{\s*\n"
            r"    name: '" + re.escape(canonical) + r"',\s*\n"
            r"    level: metadata" + re.escape(alias) + r"\.level,\s*\n"
            r"    shouldCast: shouldCast" + re.escape(alias) + r",\s*\n"
            r"    execute: execute" + re.escape(alias) + r",\s*\n"
            r"  \},\s*\n",
            re.MULTILINE,
        )
        text, n2 = map_pat.subn('', text)
        status = 'removed' if (n1 or n2) else 'missing'
        print(f"  {canonical:25s} import={n1} map={n2} [{status}]")
    PATH.write_text(text)
    print(f"\nDone. {len(SPELLS)} spells processed.")

if __name__ == '__main__':
    main()
