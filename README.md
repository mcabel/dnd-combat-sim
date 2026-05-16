# D&D 5e Combat AI Simulator

A TypeScript simulation engine for D&D 5e (PHB 2014, pre-2024) combat encounters. Models the full PHB ruleset at level 1 with three AI profiles, class resources, summon-type creatures, mount rules, and multi-encounter adventuring days.

## Quick Start

```bash
npm install

# List available encounter presets
npx ts-node src/index.ts

# Run a simulation (200 iterations)
npx ts-node src/index.ts fighter-vs-larva --runs 200
npx ts-node src/index.ts party4-vs-3larva --runs 500
npx ts-node src/index.ts all12-vs-larva --runs 100 --verbose

# Run all tests
for f in src/test/*.test.ts; do
  echo -n "$(basename $f): "
  npx ts-node $f 2>&1 | grep "Results:"
done
```

## Project Structure

```
src/
├── types/core.ts          # Core type system (Combatant, Action, Battlefield, etc.)
├── parser/
│   ├── fivetools.ts       # 5etools bestiary JSON → Combatant
│   └── pc.ts              # pc_stat_blocks_lv1.json → Combatant
├── engine/
│   ├── movement.ts        # Chebyshev 3D movement, OA triggers
│   ├── utils.ts           # Dice, damage, conditions, rests, mechanics
│   └── combat.ts          # Main combat loop
├── ai/
│   ├── targeting.ts       # attackNearest / attackWeakest / smart profiles
│   ├── actions.ts         # Action selection, AoE clustering, grapple/shove
│   ├── planner.ts         # Turn state machine
│   └── resources.ts       # Class resource AI (rage, smite, BI, etc.)
├── data/loader.ts         # Loads all bestiary JSON files from bestiaryData/
├── scenarios/
│   ├── encounter.ts       # Encounter builder
│   ├── simulate.ts        # N-run simulation + statistics
│   ├── report.ts          # Terminal output
│   ├── presets.ts         # Named encounter presets
│   └── multiencounter.ts  # Adventuring day with rests
├── summons/
│   ├── registry.ts        # Summon-type creature catalogue
│   ├── spawner.ts         # spawnSummon() with HP scaling
│   └── mount.ts           # Mount rules (PHB p.198)
├── test/                  # 12 test files, 822+ assertions
└── index.ts               # CLI entry point
bestiaryData/              # Drop 5etools bestiary JSON files here
```

## Adding Monsters

1. Download any 5etools-format bestiary JSON (e.g. from 5e.tools)
2. Drop it in `bestiaryData/`
3. The loader picks it up automatically on next run

Creatures with no numeric CR (summon-types, magic item mounts, companions) are excluded from the main bestiary and handled via `src/summons/registry.ts`.

## Rules Coverage (PHB 2014)

| Feature | Status |
|---------|--------|
| Chebyshev 3D movement | ✅ |
| Action economy (action/bonus/reaction/free) | ✅ |
| Opportunity attacks (SAC v2.7) | ✅ |
| Multiattack (never usable for OA) | ✅ |
| Concentration saves on damage | ✅ |
| Death saving throws (PCs) | ✅ |
| Sneak Attack | ✅ |
| Pack Tactics | ✅ |
| Temporary HP | ✅ |
| Divine Smite | ✅ |
| Rage, Bardic Inspiration, Second Wind, Lay on Hands | ✅ |
| Hex + Dark One's Blessing | ✅ |
| Spell slot / pact slot tracking | ✅ |
| Short rest / long rest recovery | ✅ |
| Ammo tracking | ✅ |
| Commanded creatures (verbal, no action cost) | ✅ |
| Prone modifiers (melee adv / ranged disadv) | ✅ |
| Grapple / Shove | ✅ |
| Auto AI profile from creature type | ✅ |
| Mount rules (PHB p.198) | ✅ |
| Multi-encounter adventuring day | ✅ |

## AI Profiles

- `attackNearest` — closes gap, attacks closest enemy, always takes OA
- `attackWeakest` — focuses bloodied/low-AC targets
- `smart` — threat-weighted scoring (healer +80, AoE caster +70, bloodied +60), self-preserves at 25% HP, uses control/AoE tactically
- `defend` — only retaliates if directly adjacent, never pursues (for magic-item mounts like Giant Fly)

## Data Files

- `bestiaryData/bestiary-dmg.json` — DMG monsters (Larva usable; Giant Fly + Avatar of Death are summon-type, handled separately)
- `pc_stat_blocks_lv1.json` — All 12 PHB classes at level 1 with verified features

## Development

```bash
# Type-check only
npx tsc --noEmit

# Run specific test suite
npx ts-node src/test/mechanics.test.ts
npx ts-node src/test/resources.test.ts
npx ts-node src/test/summons.test.ts
```

See `task.md` for the full phase/task tracker and `summaries/` for session logs.
