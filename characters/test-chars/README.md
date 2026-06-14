# Test Characters

Pre-built characters for engine testing and feature verification.
These files are NOT loaded by `listCharacters()` (which only reads `characters/*.json`).

## Usage
- Copy a file to `characters/` when needed for HTTP-level server tests.
- Reference inline in unit tests via JSON.parse / factory functions.
- Level up / modify as needed; keep originals here as templates.

## Index

| File | ID | Name | Class | Level | Purpose |
|------|----|------|-------|-------|---------|
| `rogue-lv5.json` | `test0000-0000-rogue-0000-000000000001` | Kira Shadowstep | Halfling Rogue 5 | 5 | Sneak Attack, Cunning Action, Uncanny Dodge |
| `barbarian-lv5.json` | `test0000-0000-barb0-0000-000000000002` | Grog Ironfist | Half-Orc Barbarian 5 | 5 | Rage, Reckless Attack, Extra Attack |
| `cleric-lv5.json` | `test0000-0000-clrc0-0000-000000000003` | Mirela Dawnborne | Human Cleric 5 | 5 | Spells, Channel Divinity, spell slots |
| `ranger-lv5.json` | `test0000-0000-rang0-0000-000000000004` | Sylvara Windfoot | Wood Elf Ranger 5 | 5 | Extra Attack, Favored Enemy, Hunter's Mark |
| `wizard-lv3.json` | `test0000-0000-wiz00-0000-000000000005` | Aldric Voss | Human Wizard 3 | 3 | Spell slots, Arcane Recovery |

## Conventions
- All test IDs use `test0000-...` prefix to avoid collision with real UUIDs.
- AC and HP are representative for class/level but not optimized.
- Resources and spell slots are initialized at full (long-rested state).
