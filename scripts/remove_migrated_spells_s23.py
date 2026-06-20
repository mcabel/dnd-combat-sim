#!/usr/bin/env python3
"""
remove_migrated_spells_s23.py — Session 23 batch 2 migration helper.

Removes the 7 Session 23 migrated spells from _generic_registry.ts:
  - Blight (L4)
  - Cloudkill (L5)
  - Disintegrate (L6)
  - Harm (L6)
  - Finger of Death (L7)
  - Sunburst (L8)
  - Power Word Kill (L9)

For each spell, removes:
  1. The 5-line import block (import { ... } from './snake_name';)
  2. The 6-line map entry ('Spell Name': { ... },)

Mirrors the Session 22 remove_migrated_spells.py pattern.
NOT committed to the repo — throwaway script.
"""

import re
import sys
from pathlib import Path

REGISTRY = Path("/home/z/my-project/dnd-combat-sim/src/spells/_generic_registry.ts")

# (canonical_name, snake_name, import_alias_camel)
SPELLS = [
    ("Blight",           "blight",            "Blight"),
    ("Cloudkill",        "cloudkill",         "Cloudkill"),
    ("Disintegrate",     "disintegrate",      "Disintegrate"),
    ("Harm",             "harm",              "Harm"),
    ("Finger of Death",  "finger_of_death",   "FingerOfDeath"),
    ("Sunburst",         "sunburst",          "Sunburst"),
    ("Power Word Kill",  "power_word_kill",   "PowerWordKill"),
]

def main():
    text = REGISTRY.read_text()
    orig_len = len(text.splitlines())
    removed_imports = 0
    removed_entries = 0

    for canonical, snake, alias in SPELLS:
        # 1. Remove the import block. Pattern:
        #    \nimport {\n  shouldCast as shouldCast<Alias>,\n  execute as execute<Alias>,\n  metadata as metadata<Alias>,\n} from './<snake>';\n
        import_pattern = re.compile(
            r"\nimport \{\n"
            r"  shouldCast as shouldCast" + alias + r",\n"
            r"  execute as execute" + alias + r",\n"
            r"  metadata as metadata" + alias + r",\n"
            r"\} from '\./" + snake + r"';\n"
        )
        new_text, n = import_pattern.subn("\n", text)
        if n != 1:
            print(f"  X {canonical}: expected 1 import block match, got {n}", file=sys.stderr)
            sys.exit(1)
        text = new_text
        removed_imports += n

        # 2. Remove the map entry. Pattern:
        canon_escaped = re.escape(canonical)
        entry_pattern = re.compile(
            r"  '" + canon_escaped + r"': \{\n"
            r"    name: '" + canon_escaped + r"',\n"
            r"    level: metadata" + alias + r"\.level,\n"
            r"    shouldCast: shouldCast" + alias + r",\n"
            r"    execute: execute" + alias + r",\n"
            r"  \},\n"
        )
        new_text, n = entry_pattern.subn("", text)
        if n != 1:
            print(f"  X {canonical}: expected 1 map entry match, got {n}", file=sys.stderr)
            sys.exit(1)
        text = new_text
        removed_entries += n

        print(f"  OK {canonical}: removed import block + map entry")

    # Clean up: collapse any triple-newlines that resulted from removals
    # (only if there are 3+ consecutive newlines).
    text = re.sub(r"\n{3,}", "\n\n", text)

    REGISTRY.write_text(text)
    new_len = len(text.splitlines())
    print(f"\nDone. Removed {removed_imports} import blocks + {removed_entries} map entries.")
    print(f"Registry: {orig_len} -> {new_len} lines ({orig_len - new_len} lines removed).")

if __name__ == "__main__":
    main()
