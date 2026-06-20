#!/usr/bin/env python3
"""
remove_migrated_spells_s27.py — Remove Session 27 Batch 3 migrated spells from
_generic_registry.ts. 23 concentration-buff spells migrated to bespoke
case branches in combat.ts + planner.ts branches.

Mirrors scripts/remove_migrated_spells_s24.py. Idempotent per-spell.
"""
import re
from pathlib import Path

SPELLS = [
    # BUFF_BLESS_DIE (2)
    ('Bane', 'bane', 'Bane'),
    ('Motivational Speech', 'motivational_speech', 'MotivationalSpeech'),
    # BUFF_HEX_RIDER / smites (11)
    ('Ensnaring Strike', 'ensnaring_strike', 'EnsnaringStrike'),
    ('Hail of Thorns', 'hail_of_thorns', 'HailOfThorns'),
    ('Searing Smite', 'searing_smite', 'SearingSmite'),
    ('Thunderous Smite', 'thunderous_smite', 'ThunderousSmite'),
    ('Wrathful Smite', 'wrathful_smite', 'WrathfulSmite'),
    ('Zephyr Strike', 'zephyr_strike', 'ZephyrStrike'),
    ('Blinding Smite', 'blinding_smite', 'BlindingSmite'),
    ('Lightning Arrow', 'lightning_arrow', 'LightningArrow'),
    ('Spirit Shroud', 'spirit_shroud', 'SpiritShroud'),
    ('Staggering Smite', 'staggering_smite', 'StaggeringSmite'),
    ('Banishing Smite', 'banishing_smite', 'BanishingSmite'),
    # BUFF_WEAPON_ENCHANT (6)
    ('Divine Favor', 'divine_favor', 'DivineFavor'),
    ('Shadow Blade', 'shadow_blade', 'ShadowBlade'),
    ('Elemental Weapon', 'elemental_weapon', 'ElementalWeapon'),
    ('Flame Arrows', 'flame_arrows', 'FlameArrows'),
    ('Holy Weapon', 'holy_weapon', 'HolyWeapon'),
    ('Swift Quiver', 'swift_quiver', 'SwiftQuiver'),
    # BUFF_ADVANTAGE_VS (4)
    ('Beacon of Hope', 'beacon_of_hope', 'BeaconOfHope'),
    ('Intellect Fortress', 'intellect_fortress', 'IntellectFortress'),
    ('Holy Aura', 'holy_aura', 'HolyAura'),
    ('Foresight', 'foresight', 'Foresight'),
]

PATH = Path('src/spells/_generic_registry.ts')

def main():
    text = PATH.read_text()
    for canonical, snake, alias in SPELLS:
        before = text
        # 1. Remove import block (5 lines + trailing blank line)
        import_pat = re.compile(
            r"import \{\s*\n"
            r"\s*shouldCast as shouldCast" + re.escape(alias) + r",\s*\n"
            r"\s*execute as execute" + re.escape(alias) + r",\s*\n"
            r"\s*metadata as metadata" + re.escape(alias) + r",\s*\n"
            r"\} from '\./" + re.escape(snake) + r"';\s*\n\n",
            re.MULTILINE,
        )
        text, n1 = import_pat.subn('', text)
        # 2. Remove map entry (6 lines)
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
