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

# (canonical, snake, alias) tuples for the 8 Session 24 L1 spells.
SPELLS = [
    ('Chaos Bolt',      'chaos_bolt',       'ChaosBolt'),
    ('Earth Tremor',    'earth_tremor',     'EarthTremor'),
    ('Frost Fingers',   'frost_fingers',    'FrostFingers'),
    ('Magnify Gravity', 'magnify_gravity',  'MagnifyGravity'),
    ('Ray of Sickness', 'ray_of_sickness',  'RayOfSickness'),
    ('Spellfire Flare', 'spellfire_flare',  'SpellfireFlare'),
    ('Wardaway',        'wardaway',         'Wardaway'),
    ('Witch Bolt',      'witch_bolt',       'WitchBolt'),
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
        print("MISSING (not found — investigate):")
        for m in missing:
            print(f"  - {m}")
        sys.exit(1)
    print("All 8 spells removed cleanly.")

if __name__ == '__main__':
    main()
