#!/usr/bin/env python3
"""
remove_migrated_spells_s24.py — Remove Session 24 migrated L1 spells from
_generic_registry.ts.

For each spell, removes:
  1. The 5-line import block:
       import {
         shouldCast as shouldCast<Alias>,
         execute as execute<Alias>,
         metadata as metadata<Alias>,
       } from './<snake>';
  2. The 6-line map entry:
       'Canonical': {
         name: 'Canonical',
         level: metadata<Alias>.level,
         shouldCast: shouldCast<Alias>,
         execute: execute<Alias>,
       },

Mirrors scripts/remove_migrated_spells_s23.py. Run once for the L1 batch.
"""
import re
import sys
from pathlib import Path

# (canonical, snake, alias) tuples for the Session 24 migrated spells.
# Edit this list per increment and re-run (idempotent per-spell: reports
# "missing" for already-removed spells without touching them).
SPELLS = [
    # L1 (8) — increment 1
    ('Chaos Bolt',      'chaos_bolt',       'ChaosBolt'),
    ('Earth Tremor',    'earth_tremor',     'EarthTremor'),
    ('Frost Fingers',   'frost_fingers',    'FrostFingers'),
    ('Magnify Gravity', 'magnify_gravity',  'MagnifyGravity'),
    ('Ray of Sickness', 'ray_of_sickness',  'RayOfSickness'),
    ('Spellfire Flare', 'spellfire_flare',  'SpellfireFlare'),
    ('Wardaway',        'wardaway',         'Wardaway'),
    ('Witch Bolt',      'witch_bolt',       'WitchBolt'),
    # L2 (2) — increment 2
    ('Mind Spike',      'mind_spike',       'MindSpike'),
    ('Spray of Cards',  'spray_of_cards',   'SprayOfCards'),
    # L3 (5) — increment 3
    ('Erupting Earth',  'erupting_earth',   'EruptingEarth'),
    ('Life Transference', 'life_transference', 'LifeTransference'),
    ('Pulse Wave',      'pulse_wave',       'PulseWave'),
    ('Tidal Wave',      'tidal_wave',       'TidalWave'),
    ('Vampiric Touch',  'vampiric_touch',   'VampiricTouch'),
    # L4 (7) — increment 4
    ('Elemental Bane',  'elemental_bane',   'ElementalBane'),
    ('Gravity Sinkhole', 'gravity_sinkhole', 'GravitySinkhole'),
    ('Ice Storm',       'ice_storm',        'IceStorm'),
    ('Sickening Radiance', 'sickening_radiance', 'SickeningRadiance'),
    ('Spellfire Storm', 'spellfire_storm',  'SpellfireStorm'),
    ('Storm Sphere',    'storm_sphere',     'StormSphere'),
    ('Vitriolic Sphere', 'vitriolic_sphere', 'VitriolicSphere'),
    # L5 (8) — increment 5
    ('Destructive Wave', 'destructive_wave', 'DestructiveWave'),
    ('Enervation',      'enervation',       'Enervation'),
    ('Flame Strike',    'flame_strike',     'FlameStrike'),
    ('Immolation',      'immolation',       'Immolation'),
    ('Maelstrom',       'maelstrom',        'Maelstrom'),
    ('Negative Energy Flood', 'negative_energy_flood', 'NegativeEnergyFlood'),
    ('Steel Wind Strike', 'steel_wind_strike', 'SteelWindStrike'),
    ('Synaptic Static', 'synaptic_static',  'SynapticStatic'),
    # L6 (5) — increment 6
    ('Chain Lightning', 'chain_lightning',  'ChainLightning'),
    ('Circle of Death', 'circle_of_death',  'CircleOfDeath'),
    ('Gravity Fissure', 'gravity_fissure',  'GravityFissure'),
    ('Mental Prison',   'mental_prison',    'MentalPrison'),
    ('Sunbeam',         'sunbeam',          'Sunbeam'),
    # L7 (2) — increment 6
    ('Crown of Stars',  'crown_of_stars',   'CrownOfStars'),
    ('Fire Storm',      'fire_storm',       'FireStorm'),
    # L8 (5) — increment 6
    ('Dark Star',       'dark_star',        'DarkStar'),
    ('Earthquake',      'earthquake',       'Earthquake'),
    ('Feeblemind',      'feeblemind',       'Feeblemind'),
    ('Incendiary Cloud', 'incendiary_cloud', 'IncendiaryCloud'),
    ('Maddening Darkness', 'maddening_darkness', 'MaddeningDarkness'),
    # L9 (2) — increment 6
    ('Psychic Scream',  'psychic_scream',   'PsychicScream'),
    ('Ravenous Void',   'ravenous_void',    'RavenousVoid'),
    # ── Session 25 / Batch 2 (save-or-condition spells) — idempotent ──
    # Appended per-commit as spells are migrated to bespoke. Re-running is
    # safe: already-removed spells report "missing" without touching them.
    # L9 (1)
    ('Weird',           'weird',            'Weird'),
    # L8 (2)
    ('Power Word Stun', 'power_word_stun',  'PowerWordStun'),
    ('Dominate Monster','dominate_monster', 'DominateMonster'),
    # L7 (3)
    ('Power Word Pain', 'power_word_pain',  'PowerWordPain'),
    ('Whirlwind',       'whirlwind',         'Whirlwind'),
    ('Reverse Gravity', 'reverse_gravity',   'ReverseGravity'),
    # L6 (3)
    ('Eyebite',         'eyebite',           'Eyebite'),
    ('Flesh to Stone',  'flesh_to_stone',    'FleshToStone'),
    ('Mass Suggestion', 'mass_suggestion',   'MassSuggestion'),
]

REGISTRY = Path('src/spells/_generic_registry.ts')

def main():
    src = REGISTRY.read_text()
    orig_len = len(src.splitlines())

    removed_imports = 0
    removed_entries = 0
    missing = []

    for canonical, snake, alias in SPELLS:
        # 1. Import block (with trailing blank line so removal is clean).
        import_block = (
            "import {\n"
            f"  shouldCast as shouldCast{alias},\n"
            f"  execute as execute{alias},\n"
            f"  metadata as metadata{alias},\n"
            f"}} from './{snake}';\n"
            "\n"
        )
        if import_block in src:
            src = src.replace(import_block, '', 1)
            removed_imports += 1
        else:
            missing.append(f"import block for {canonical} ({snake})")

        # 2. Map entry (6 lines). NOTE: the registry may use varying
        #    indentation, so match flexibly with a regex anchored on the
        #    canonical name + alias references.
        entry_re = re.compile(
            r"^  '" + re.escape(canonical) + r"': \{\n"
            r"    name: '" + re.escape(canonical) + r"',\n"
            r"    level: metadata" + alias + r"\.level,\n"
            r"    shouldCast: shouldCast" + alias + r",\n"
            r"    execute: execute" + alias + r",\n"
            r"  \},\n",
            re.MULTILINE,
        )
        m = entry_re.search(src)
        if m:
            src = src[:m.start()] + src[m.end():]
            removed_entries += 1
        else:
            missing.append(f"map entry for {canonical} ({snake})")

    REGISTRY.write_text(src)
    new_len = len(src.splitlines())

    print(f"Removed {removed_imports}/{len(SPELLS)} import blocks")
    print(f"Removed {removed_entries}/{len(SPELLS)} map entries")
    print(f"Line count: {orig_len} -> {new_len} (delta {orig_len - new_len})")
    if missing:
        # Idempotent: "missing" means already removed in a prior run. Report
        # as a warning, not an error, so the script can be re-run per
        # increment with a growing SPELLS list.
        print("Already removed (skipped — idempotent re-run):")
        for m in missing:
            print(f"  - {m}")
    print(f"Done. {removed_imports} new removal(s) this run.")

if __name__ == '__main__':
    main()
