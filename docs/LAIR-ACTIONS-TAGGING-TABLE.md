# Lair Actions — Per-Action Tagging Table (Phase 1 Deliverable)

**Generated:** Session 91 (RFC-LAIRACTIONS Phase 1)
**Source:** `bestiaryData/legendarygroups.json` — 115 legendary groups, 324 lair-action options.
**Generator:** `scripts/gen_lair_tagging_table.ts` (re-run after parser changes to refresh).

This is the per-action tagging table required by RFC-LAIRACTIONS §5.3 / §8 Phase 1.
Every flattened lair-action option is read individually and tagged per [DD-4]:
- `isSpell: true` ONLY when the action casts a named spell (detected via `@spell`
  tag in a casting context). Remedy-references (e.g., Sphinx "A greater restoration
  spell can restore…") are EXCLUDED — `isSpell: false`.
- `isMagical: true` for ALL actions (MM: lair actions are "magical effects").
- `category` routes the Phase 2+ dispatcher. `deferred` / `flavor` are logged
  not executed; `cast_spell` drives GoI/Counterspell interactions.

Review this table before Phase 2 dispatch begins. Flag any `isSpell` mis-tag or
`category` mis-assignment as `[VERIFY]` for the next pass.

## Summary

| Metric | Value |
|---|---|
| Total actions | 324 |
| `isSpell: true` (cast a named spell) | 42 |
| `isMagical: true` (all) | 324 |
| Out-of-scope (`lair_oos_*`) | 6 |
| Deferred (`lair_def_*` / heuristic) | 16 |
| In-scope (executable in Phase 2+) | 302 |

### Category distribution

| Category | Count |
|---|---|
| `bespoke` | 63 |
| `save_condition` | 55 |
| `save_damage` | 55 |
| `cast_spell` | 42 |
| `save_only` | 36 |
| `summon` | 23 |
| `deferred` | 16 |
| `buff_ally` | 7 |
| `debuff_enemy` | 7 |
| `movement` | 7 |
| `flavor` | 6 |
| `damage_no_save` | 5 |
| `spell_slot_regen` | 2 |

## Full table

Grouped by `sourceCreature` (alphabetical). Columns: `id`, `isMagical`, `isSpell`,
`spellName`/`castLevel`, `category`, `saveDC`/`saveAbility`, `damage`,
`conditions`, `outOfScopeId`/`deferred`/`deferredId`.

### Aboleth

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Aboleth::0` | ✓ | ✓ | phantasmal force | 2 | `cast_spell` | — | — | — | — | — | — | — |
| `Aboleth::1` | ✓ |  | — | — | `save_condition` | 14 | str | — | prone | — | — | — |
| `Aboleth::2` | ✓ |  | — | — | `save_damage` | 14 | wis | 2d6 psychic | — | — | — | — |

### Alyxian the Absolved

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Alyxian the Absolved::0` | ✓ |  | — | — | `save_condition` | 15 | dex | — | restrained | — | — | — |
| `Alyxian the Absolved::1` | ✓ |  | — | — | `save_condition` | 15 | wis | — | charmed | — | — | — |
| `Alyxian the Absolved::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Alyxian the Absolved::3` | ✓ |  | — | — | `save_damage` | 15 | — | 4d6 psychic | — | — | — | — |

### Alyxian the Callous

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Alyxian the Callous::0` | ✓ |  | — | — | `save_condition` | 15 | dex | — | restrained | — | — | — |
| `Alyxian the Callous::1` | ✓ |  | — | — | `save_condition` | 15 | wis | — | charmed | — | — | — |
| `Alyxian the Callous::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Alyxian the Callous::3` | ✓ |  | — | — | `save_damage` | 15 | — | 4d6 psychic | — | — | — | — |

### Alyxian the Dispossessed

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Alyxian the Dispossessed::0` | ✓ |  | — | — | `save_condition` | 15 | dex | — | restrained | — | — | — |
| `Alyxian the Dispossessed::1` | ✓ |  | — | — | `save_condition` | 15 | wis | — | charmed | — | — | — |
| `Alyxian the Dispossessed::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Alyxian the Dispossessed::3` | ✓ |  | — | — | `save_damage` | 15 | — | 4d6 psychic | — | — | — | — |

### Alyxian the Tormented

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Alyxian the Tormented::0` | ✓ |  | — | — | `save_condition` | 15 | dex | — | restrained | — | — | — |
| `Alyxian the Tormented::1` | ✓ |  | — | — | `save_condition` | 15 | wis | — | charmed | — | — | — |
| `Alyxian the Tormented::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Alyxian the Tormented::3` | ✓ |  | — | — | `save_damage` | 15 | — | 4d6 psychic | — | — | — | — |

### Amethyst Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Amethyst Dragon::0` | ✓ |  | — | — | `save_condition` | 15 | wis | — | charmed | — | — | — |
| `Amethyst Dragon::1` | ✓ | ✓ | forcecage | 7 | `cast_spell` | — | — | — | — | — | — | — |
| `Amethyst Dragon::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |

### Ancient Dragon Turtle

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Ancient Dragon Turtle::0` | ✓ |  | — | — | `save_only` | 15 | str | — | — | — | — | — |
| `Ancient Dragon Turtle::1` | ✓ |  | — | — | `save_condition` | 15 | str | — | restrained | — | — | — |
| `Ancient Dragon Turtle::2` | ✓ |  | — | — | `save_damage` | 15 | con | 6d6 fire | — | — | — | — |

### Arasta

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Arasta::0` | ✓ |  | — | — | `save_condition` | 21 | int | — | restrained | — | — | — |
| `Arasta::1` | ✓ | ✓ | giant insect | 4 | `cast_spell` | — | — | — | — | — | — | — |

### Archdevil

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Archdevil::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Archdevil::1` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Archdevil::2` | ✓ |  | — | — | `save_only` | 22 | wis | — | — | — | — | — |
| `Archdevil::3` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Archdevil::4` | ✓ | ✓ | Haste | 3 | `cast_spell` | — | — | — | — | — | — | — |
| `Archdevil::5` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Archdevil::6` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Archdevil::7` | ✓ | ✓ | Hold Monster | 5 | `cast_spell` | — | — | — | — | — | — | — |

### Aurnozci

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Aurnozci::0` | ✓ |  | — | — | `save_damage` | 23 | str | 2d8 bludgeoning | — | — | — | — |
| `Aurnozci::1` | ✓ |  | — | — | `deferred` | 20 | con | 3d10 poison | — | — | magical-darkness | lair_def_auto_Aurnozci_1 |

### Baalzebul

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Baalzebul::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Baalzebul::1` | ✓ |  | — | — | `save_condition` | 17 | — | — | grappled | — | — | — |
| `Baalzebul::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |

### Baernaloth

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Baernaloth::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Baernaloth::1` | ✓ |  | — | — | `damage_no_save` | — | — | 3d8 psychic | — | — | — | — |
| `Baernaloth::2` | ✓ |  | — | — | `save_damage` | 19 | con | 4d10 necrotic | — | — | — | — |

### Balhannoth

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Balhannoth::0` | ✓ |  | — | — | `save_only` | 16 | wis | — | — | — | — | — |
| `Balhannoth::1` | ✓ |  | — | — | `save_condition` | 16 | wis | — | invisible | — | — | — |
| `Balhannoth::2` | ✓ |  | — | — | `flavor` | — | — | — | — | lair_oos_001 | — | — |
| `Balhannoth::0` | ✓ |  | — | — | `flavor` | — | — | — | — | lair_oos_001 | — | — |
| `Balhannoth::1` | ✓ |  | — | — | `save_only` | 16 | wis | — | — | — | — | — |
| `Balhannoth::2` | ✓ |  | — | — | `save_condition` | 16 | wis | — | invisible | — | — | — |

### Baphomet

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Baphomet::0` | ✓ | ✓ | mirage arcane | 7 | `cast_spell` | — | — | — | — | — | — | — |
| `Baphomet::1` | ✓ |  | — | — | `deferred` | — | — | — | — | — | gravity | lair_def_007 |
| `Baphomet::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Baphomet::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Baphomet::1` | ✓ |  | — | — | `deferred` | — | — | — | — | — | gravity | lair_def_007 |
| `Baphomet::2` | ✓ | ✓ | mirage arcane | 7 | `cast_spell` | — | — | — | — | — | — | — |

### Beholder

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Beholder::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Beholder::1` | ✓ |  | — | — | `save_condition` | 15 | dex | — | grappled | — | — | — |
| `Beholder::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |

### Belashyrra

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Belashyrra::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Belashyrra::1` | ✓ |  | — | — | `save_condition` | 22 | wis | — | charmed | — | — | — |
| `Belashyrra::2` | ✓ |  | — | — | `save_only` | 22 | wis | — | — | — | — | — |

### Black Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Black Dragon::0` | ✓ |  | — | — | `save_condition` | 15 | str | — | prone | — | — | — |
| `Black Dragon::1` | ✓ |  | — | — | `save_damage` | 15 | con | 3d6 piercing | — | — | — | — |
| `Black Dragon::2` | ✓ |  | — | — | `deferred` | — | — | — | — | — | magical-darkness | lair_def_001 |
| `Black Dragon::3` | ✓ |  | — | — | `summon` | 15 | con | 3d6 poison | restrained,poisoned | — | — | — |

### Blue Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Blue Dragon::0` | ✓ |  | — | — | `save_damage` | 15 | dex | 3d6 bludgeoning | prone,restrained | — | — | — |
| `Blue Dragon::1` | ✓ |  | — | — | `save_condition` | 15 | con | — | blinded | — | — | — |
| `Blue Dragon::2` | ✓ |  | — | — | `save_damage` | 15 | dex | 3d6 lightning | — | — | — | — |
| `Blue Dragon::3` | ✓ |  | — | — | `summon` | 15 | dex | 2d6 bludgeoning | prone | — | — | — |

### Brass Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Brass Dragon::0` | ✓ |  | — | — | `save_condition` | 15 | str | — | prone | — | — | — |
| `Brass Dragon::1` | ✓ |  | — | — | `save_condition` | 15 | con | — | blinded | — | — | — |
| `Brass Dragon::2` | ✓ |  | — | — | `summon` | 15 | str | 3d6 bludgeoning | prone | — | — | — |

### Bronze Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Bronze Dragon::0` | ✓ | ✓ | fog cloud | 1 | `cast_spell` | — | — | — | — | — | — | — |
| `Bronze Dragon::1` | ✓ |  | — | — | `save_damage` | 15 | con | 1d10 thunder | deafened | — | — | — |
| `Bronze Dragon::2` | ✓ |  | — | — | `summon` | 15 | dex | 1d10 slashing | prone | — | — | — |

### Captain N'ghathrod

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Captain N'ghathrod::0` | ✓ |  | — | — | `summon` | 15 | — | — | — | — | — | — |
| `Captain N'ghathrod::1` | ✓ |  | — | — | `save_damage` | 15 | wis | 3d6 psychic | — | — | — | — |

### Copper Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Copper Dragon::0` | ✓ | ✓ | spike growth | 2 | `cast_spell` | — | — | — | — | — | — | — |
| `Copper Dragon::1` | ✓ |  | — | — | `save_condition` | 15 | dex | — | restrained | — | — | — |
| `Copper Dragon::2` | ✓ |  | — | — | `summon` | 15 | wis | — | incapacitated | — | — | — |

### Cryonax

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Cryonax::0` | ✓ |  | — | — | `save_damage` | 20 | wis | 3d8 cold | blinded | — | — | — |
| `Cryonax::1` | ✓ |  | — | — | `save_damage` | 22 | dex | 4d6 slashing | prone | — | — | — |
| `Cryonax::2` | ✓ |  | — | — | `save_damage` | 24 | dex | 2d8 bludgeoning | prone | — | — | — |

### Crystal Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Crystal Dragon::0` | ✓ |  | — | — | `save_condition` | 15 | wis | — | charmed | — | — | — |
| `Crystal Dragon::1` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Crystal Dragon::2` | ✓ |  | — | — | `save_damage` | 15 | dex | 2d12 radiant | invisible | — | — | — |

### Darkweaver

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Darkweaver::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Darkweaver::1` | ✓ |  | — | — | `save_only` | 15 | wis | — | — | — | — | — |
| `Darkweaver::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |

### Death Tyrant

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Death Tyrant::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Death Tyrant::1` | ✓ |  | — | — | `save_condition` | 17 | dex | — | grappled | — | — | — |
| `Death Tyrant::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |

### Deep Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Deep Dragon::0` | ✓ | ✓ | slow | 3 | `cast_spell` | 16 | — | — | — | — | — | — |
| `Deep Dragon::1` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Deep Dragon::2` | ✓ |  | — | — | `save_damage` | 15 | con | 4d6 poison | poisoned | — | — | — |

### Demilich

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Demilich::0` | ✓ |  | — | — | `save_condition` | 19 | dex | — | prone | — | — | — |
| `Demilich::1` | ✓ | ✓ | antimagic field | 8 | `cast_spell` | — | — | — | — | — | — | — |
| `Demilich::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |

### Demogorgon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Demogorgon::0` | ✓ | ✓ | darkness | 2 | `cast_spell` | — | — | — | — | — | — | — |
| `Demogorgon::1` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Demogorgon::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Demogorgon::1` | ✓ | ✓ | darkness | 2 | `cast_spell` | — | — | — | — | — | — | — |

### Drow Matron Mother

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Drow Matron Mother::0` | ✓ |  | — | — | `bespoke` | — | — | — | invisible | — | — | — |
| `Drow Matron Mother::1` | ✓ |  | — | — | `save_condition` | 19 | dex | — | restrained | — | — | — |
| `Drow Matron Mother::2` | ✓ |  | — | — | `save_damage` | 19 | str | 1d6 bludgeoning | — | — | — | — |

### Dyrrn

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Dyrrn::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Dyrrn::1` | ✓ |  | — | — | `save_condition` | 23 | str | — | restrained | — | — | — |
| `Dyrrn::2` | ✓ |  | — | — | `save_damage` | 23 | wis | 4d12 psychic | — | — | — | — |

### Elder Brain

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Elder Brain::0` | ✓ | ✓ | wall of force | 5 | `cast_spell` | — | — | — | — | — | — | — |
| `Elder Brain::1` | ✓ |  | — | — | `save_only` | 18 | cha | — | — | — | — | — |
| `Elder Brain::2` | ✓ |  | — | — | `buff_ally` | — | — | — | — | — | — | — |
| `Elder Brain::0` | ✓ | ✓ | wall of force | 5 | `cast_spell` | — | — | — | — | — | — | — |
| `Elder Brain::1` | ✓ |  | — | — | `buff_ally` | — | — | — | — | — | — | — |
| `Elder Brain::2` | ✓ |  | — | — | `save_only` | 18 | cha | — | — | — | — | — |

### Emerald Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Emerald Dragon::0` | ✓ |  | — | — | `save_condition` | 15 | wis | — | charmed | — | — | — |
| `Emerald Dragon::1` | ✓ |  | — | — | `save_damage` | 15 | int | 4d10 psychic | — | — | — | — |
| `Emerald Dragon::2` | ✓ |  | — | — | `bespoke` | — | — | — | invisible | — | — | — |

### Faerie Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Faerie Dragon::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Faerie Dragon::1` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |

### Fazrian

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Fazrian::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Fazrian::1` | ✓ |  | — | — | `debuff_enemy` | — | — | — | — | — | — | — |
| `Fazrian::2` | ✓ | ✓ | lesser restoration | 2 | `cast_spell` | 20 | con | — | blinded | — | — | — |

### Fraz-Urb'luu

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Fraz-Urb'luu::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Fraz-Urb'luu::1` | ✓ |  | — | — | `save_damage` | 23 | wis | 6d10 psychic | — | — | — | — |
| `Fraz-Urb'luu::2` | ✓ | ✓ | simulacrum | 7 | `cast_spell` | — | — | — | — | — | — | — |
| `Fraz-Urb'luu::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Fraz-Urb'luu::1` | ✓ | ✓ | simulacrum | 7 | `cast_spell` | — | — | — | — | — | — | — |
| `Fraz-Urb'luu::2` | ✓ |  | — | — | `save_damage` | 23 | wis | 6d10 psychic | — | — | — | — |

### Froghemoth Elder

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Froghemoth Elder::0` | ✓ |  | — | — | `save_only` | 18 | wis | — | — | — | — | — |
| `Froghemoth Elder::1` | ✓ |  | — | — | `save_only` | 15 | wis | — | — | — | — | — |

### Gar Shatterkeel

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Gar Shatterkeel::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Gar Shatterkeel::1` | ✓ |  | — | — | `save_condition` | 18 | str | — | restrained | — | — | — |
| `Gar Shatterkeel::2` | ✓ |  | — | — | `summon` | — | — | — | — | — | — | — |

### Geryon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Geryon::0` | ✓ | ✓ | banishment | 4 | `cast_spell` | — | — | — | — | — | — | — |
| `Geryon::1` | ✓ |  | — | — | `save_damage` | 21 | con | 8d6 cold | — | — | — | — |
| `Geryon::2` | ✓ |  | — | — | `save_condition` | 21 | wis | — | restrained | — | — | — |
| `Geryon::0` | ✓ |  | — | — | `save_damage` | 21 | con | 8d6 cold | — | — | — | — |
| `Geryon::1` | ✓ |  | — | — | `save_condition` | 21 | wis | — | restrained | — | — | — |
| `Geryon::2` | ✓ | ✓ | banishment | 4 | `cast_spell` | — | — | — | — | — | — | — |

### Githzerai Anarch

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Githzerai Anarch::0` | ✓ | ✓ | creation | 9 | `cast_spell` | — | — | — | — | — | — | — |
| `Githzerai Anarch::1` | ✓ |  | — | — | `save_only` | 5 | — | — | — | — | — | — |
| `Githzerai Anarch::2` | ✓ | ✓ | lightning bolt | 5 | `cast_spell` | — | — | — | — | — | — | — |
| `Githzerai Anarch::0` | ✓ | ✓ | lightning bolt | 5 | `cast_spell` | — | — | — | — | — | — | — |
| `Githzerai Anarch::1` | ✓ | ✓ | creation | 9 | `cast_spell` | — | — | — | — | — | — | — |
| `Githzerai Anarch::2` | ✓ |  | — | — | `save_only` | 5 | — | — | — | — | — | — |

### Gold Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Gold Dragon::0` | ✓ |  | — | — | `buff_ally` | — | — | — | — | — | — | — |
| `Gold Dragon::1` | ✓ |  | — | — | `save_only` | 15 | cha | — | — | — | — | — |
| `Gold Dragon::2` | ✓ |  | — | — | `summon` | 15 | wis | — | charmed | — | — | — |

### Graz'zt

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Graz'zt::0` | ✓ | ✓ | command | 1 | `cast_spell` | — | — | — | — | — | — | — |
| `Graz'zt::1` | ✓ |  | — | — | `debuff_enemy` | — | — | — | — | — | — | — |
| `Graz'zt::0` | ✓ | ✓ | command | 1 | `cast_spell` | — | — | — | — | — | — | — |
| `Graz'zt::1` | ✓ |  | — | — | `debuff_enemy` | — | — | — | — | — | — | — |

### Greater Tyrant Shadow

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Greater Tyrant Shadow::0` | ✓ |  | — | — | `save_only` | 22 | cha | — | — | — | — | — |
| `Greater Tyrant Shadow::1` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |

### Green Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Green Dragon::0` | ✓ |  | — | — | `save_condition` | 15 | str | — | restrained | — | — | — |
| `Green Dragon::1` | ✓ |  | — | — | `save_damage` | 15 | dex | 4d8 fire | — | — | — | — |
| `Green Dragon::2` | ✓ |  | — | — | `save_condition` | 15 | wis | — | charmed | — | — | — |
| `Green Dragon::3` | ✓ |  | — | — | `summon` | 15 | str | 3d6 bludgeoning | prone | — | — | — |

### Hag

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Hag::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Hag::1` | ✓ |  | — | — | `save_only` | 20 | — | — | — | — | — | — |

### Halaster Blackcloak

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Halaster Blackcloak::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Halaster Blackcloak::1` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Halaster Blackcloak::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |

### Hierophant Medusa

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Hierophant Medusa::0` | ✓ |  | — | — | `save_only` | 15 | con | — | — | — | — | — |
| `Hierophant Medusa::1` | ✓ |  | — | — | `save_only` | 15 | dex | — | — | — | — | — |
| `Hierophant Medusa::2` | ✓ |  | — | — | `movement` | — | — | — | — | — | — | — |

### Hythonia

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Hythonia::0` | ✓ |  | — | — | `save_damage` | 15 | — | 3d6 bludgeoning | petrified,grappled | — | — | — |
| `Hythonia::1` | ✓ | ✓ | confusion | 4 | `cast_spell` | 19 | con | 2d4 piercing | poisoned | — | — | — |

### Illithilich

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Illithilich::0` | ✓ |  | — | — | `spell_slot_regen` | — | — | — | — | — | — | — |
| `Illithilich::1` | ✓ |  | — | — | `save_only` | 18 | con | — | — | — | — | — |
| `Illithilich::2` | ✓ |  | — | — | `save_damage` | 18 | con | 15d6 necrotic | — | — | — | — |

### Imix

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Imix::0` | ✓ |  | — | — | `save_condition` | 20 | str | — | prone | — | — | — |
| `Imix::1` | ✓ |  | — | — | `deferred` | — | — | 3d6 fire | — | — | magical-darkness | lair_def_012 |
| `Imix::2` | ✓ |  | — | — | `save_damage` | 15 | con | 1d8 fire | exhaustion | — | — | — |

### Juiblex

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Juiblex::0` | ✓ |  | — | — | `deferred` | — | — | — | — | — | dmg-hazard | lair_def_009 |
| `Juiblex::1` | ✓ |  | — | — | `save_damage` | 21 | dex | 4d10 fire | prone | — | — | — |
| `Juiblex::2` | ✓ |  | — | — | `save_damage` | 21 | str | 4d10 fire | restrained | — | — | — |
| `Juiblex::0` | ✓ |  | — | — | `save_damage` | 21 | str | 4d10 fire | restrained | — | — | — |
| `Juiblex::1` | ✓ |  | — | — | `save_damage` | 21 | dex | 4d10 fire | prone | — | — | — |
| `Juiblex::2` | ✓ |  | — | — | `deferred` | — | — | — | — | — | dmg-hazard | lair_def_009 |

### Ki-rin

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Ki-rin::0` | ✓ |  | — | — | `flavor` | — | — | — | — | lair_oos_auto_Ki_rin_0 | — | — |
| `Ki-rin::1` | ✓ |  | — | — | `flavor` | — | — | — | — | lair_oos_003 | — | — |
| `Ki-rin::2` | ✓ |  | — | — | `flavor` | — | — | — | — | lair_oos_auto_Ki_rin_2 | — | — |

### Kraken

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Kraken::0` | ✓ |  | — | — | `save_only` | 23 | str | — | — | — | — | — |
| `Kraken::1` | ✓ |  | — | — | `debuff_enemy` | — | — | — | — | — | — | — |
| `Kraken::2` | ✓ |  | — | — | `save_damage` | 23 | con | 3d6 lightning | — | — | — | — |

### Kyrilla, Accursed Gorgon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Kyrilla, Accursed Gorgon::0` | ✓ | ✓ | moonbeam | 2 | `cast_spell` | — | — | — | — | — | — | — |
| `Kyrilla, Accursed Gorgon::1` | ✓ | ✓ | cloud of daggers | 2 | `cast_spell` | — | — | — | — | — | — | — |
| `Kyrilla, Accursed Gorgon::2` | ✓ |  | — | — | `save_only` | 14 | dex | — | — | — | — | — |

### Lich

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Lich::0` | ✓ |  | — | — | `spell_slot_regen` | — | — | — | — | — | — | — |
| `Lich::1` | ✓ |  | — | — | `save_only` | 18 | con | — | — | — | — | — |
| `Lich::2` | ✓ |  | — | — | `save_damage` | 18 | con | 15d6 necrotic | — | — | — | — |

### Lichen Lich

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Lichen Lich::0` | ✓ |  | — | — | `save_condition` | 19 | con | — | poisoned | — | — | — |
| `Lichen Lich::1` | ✓ |  | — | — | `summon` | — | — | — | — | — | — | — |
| `Lichen Lich::2` | ✓ |  | — | — | `save_condition` | 19 | str | — | restrained | — | — | — |

### Malaxxix

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Malaxxix::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Malaxxix::1` | ✓ |  | — | — | `save_damage` | 20 | str | 2d10 bludgeoning | — | — | — | — |
| `Malaxxix::2` | ✓ |  | — | — | `movement` | — | — | — | — | — | — | — |

### Mephistopheles

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Mephistopheles::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Mephistopheles::1` | ✓ |  | — | — | `damage_no_save` | — | — | 6d8 fire | — | — | — | — |

### Merrenoloth

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Merrenoloth::0` | ✓ |  | — | — | `save_condition` | 13 | str | — | prone | — | — | — |
| `Merrenoloth::1` | ✓ |  | — | — | `flavor` | — | — | — | — | lair_oos_004 | — | — |
| `Merrenoloth::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Merrenoloth::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Merrenoloth::1` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Merrenoloth::2` | ✓ |  | — | — | `save_condition` | 13 | str | — | prone | — | — | — |

### Moonstone Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Moonstone Dragon::0` | ✓ |  | — | — | `save_condition` | 15 | cha | — | stunned | — | — | — |
| `Moonstone Dragon::1` | ✓ |  | — | — | `save_condition` | 15 | int | — | incapacitated | — | — | — |
| `Moonstone Dragon::2` | ✓ |  | — | — | `save_only` | 20 | wis | — | — | — | — | — |

### Morkoth

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Morkoth::0` | ✓ | ✓ | darkness | 2 | `cast_spell` | — | — | — | — | — | — | — |
| `Morkoth::1` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Morkoth::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Morkoth::1` | ✓ | ✓ | darkness | 2 | `cast_spell` | — | — | — | — | — | — | — |

### Mummy Lord

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Mummy Lord::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Mummy Lord::1` | ✓ |  | — | — | `buff_ally` | — | — | — | — | — | — | — |
| `Mummy Lord::2` | ✓ |  | — | — | `save_damage` | 16 | con | 1d6 necrotic | — | — | — | — |

### Murgaxor

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Murgaxor::0` | ✓ |  | — | — | `summon` | — | — | — | — | — | — | — |
| `Murgaxor::1` | ✓ |  | — | — | `save_damage` | 15 | — | 3d8 bludgeoning | — | — | — | — |
| `Murgaxor::2` | ✓ |  | — | — | `save_damage` | 15 | dex | 1d10 necrotic | — | — | — | — |
| `Murgaxor::3` | ✓ |  | — | — | `summon` | — | — | — | — | — | — | — |

### Nafas

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Nafas::0` | ✓ |  | — | — | `save_only` | 21 | str | — | — | — | — | — |
| `Nafas::1` | ✓ |  | — | — | `save_damage` | 21 | dex | 3d10 lightning | — | — | — | — |
| `Nafas::2` | ✓ |  | — | — | `deferred` | — | — | — | — | — | visibility | lair_def_002 |

### Nintra Siotta

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Nintra Siotta::0` | ✓ |  | — | — | `save_damage` | 18 | dex | 3d8 piercing | — | — | — | — |
| `Nintra Siotta::1` | ✓ |  | — | — | `save_damage` | 20 | str | 2d10 necrotic | — | — | — | — |

### Ogrémoch

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Ogrémoch::0` | ✓ |  | — | — | `save_condition` | 15 | dex | — | restrained | — | — | — |
| `Ogrémoch::1` | ✓ |  | — | — | `damage_no_save` | — | — | 1d8 piercing | prone | — | — | — |
| `Ogrémoch::2` | ✓ |  | — | — | `save_condition` | 15 | dex | — | prone | — | — | — |

### Olhydra

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Olhydra::0` | ✓ |  | — | — | `save_condition` | 20 | str | — | prone | — | — | — |
| `Olhydra::1` | ✓ |  | — | — | `deferred` | — | — | — | — | — | visibility | lair_def_003 |
| `Olhydra::2` | ✓ |  | — | — | `deferred` | — | — | 3d6 cold | — | — | magical-darkness | lair_def_013 |

### Orcus

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Orcus::0` | ✓ | ✓ | power word kill | 9 | `cast_spell` | — | — | — | — | — | — | — |
| `Orcus::1` | ✓ |  | — | — | `save_condition` | 23 | str | — | restrained | — | — | — |
| `Orcus::2` | ✓ |  | — | — | `summon` | — | — | — | — | — | — | — |
| `Orcus::0` | ✓ | ✓ | power word kill | 9 | `cast_spell` | — | — | — | — | — | — | — |
| `Orcus::1` | ✓ |  | — | — | `summon` | — | — | — | — | — | — | — |
| `Orcus::2` | ✓ |  | — | — | `save_condition` | 23 | str | — | restrained | — | — | — |

### Pazrodine

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Pazrodine::0` | ✓ |  | — | — | `save_only` | 15 | cha | — | — | — | — | — |
| `Pazrodine::1` | ✓ |  | — | — | `save_only` | 15 | wis | — | — | — | — | — |
| `Pazrodine::2` | ✓ |  | — | — | `save_damage` | 15 | dex | 2d10 bludgeoning | — | — | — | — |

### Pazuzu

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Pazuzu::0` | ✓ |  | — | — | `summon` | — | — | — | — | — | — | — |
| `Pazuzu::1` | ✓ | ✓ | insect plague | 5 | `cast_spell` | — | — | 6d10 piercing | — | — | — | — |
| `Pazuzu::2` | ✓ | ✓ | wish | 9 | `cast_spell` | 21 | cha | — | — | — | — | — |

### Red Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Red Dragon::0` | ✓ |  | — | — | `save_damage` | 15 | dex | 6d6 fire | — | — | — | — |
| `Red Dragon::1` | ✓ |  | — | — | `save_condition` | 15 | dex | — | prone | — | — | — |
| `Red Dragon::2` | ✓ |  | — | — | `save_condition` | 13 | con | — | poisoned,incapacitated | — | — | — |
| `Red Dragon::3` | ✓ |  | — | — | `summon` | 15 | con | 3d6 fire | poisoned | — | — | — |

### Riverine

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Riverine::0` | ✓ |  | — | — | `save_damage` | 17 | wis | 1d10 psychic | frightened | — | — | — |
| `Riverine::1` | ✓ |  | — | — | `damage_no_save` | — | — | 2d6 cold | — | — | — | — |

### Sapphire Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Sapphire Dragon::0` | ✓ |  | — | — | `save_damage` | 15 | con | 3d8 thunder | stunned | — | — | — |
| `Sapphire Dragon::1` | ✓ |  | — | — | `save_condition` | 15 | wis | — | charmed | — | — | — |
| `Sapphire Dragon::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Sapphire Dragon::0` | ✓ |  | — | — | `save_condition` | 15 | wis | — | charmed | — | — | — |
| `Sapphire Dragon::1` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Sapphire Dragon::2` | ✓ |  | — | — | `debuff_enemy` | — | — | — | — | — | — | — |

### Sea Fury

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Sea Fury::0` | ✓ |  | — | — | `deferred` | — | — | — | — | — | magical-darkness | lair_def_011 |
| `Sea Fury::1` | ✓ |  | — | — | `save_condition` | 16 | str | — | prone | — | — | — |
| `Sea Fury::2` | ✓ |  | — | — | `summon` | — | — | — | — | — | — | — |

### Shadow Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Shadow Dragon::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |

### Silver Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Silver Dragon::0` | ✓ | ✓ | fog cloud | 1 | `cast_spell` | — | — | — | — | — | — | — |
| `Silver Dragon::1` | ✓ |  | — | — | `save_damage` | 15 | con | 1d10 cold | — | — | — | — |
| `Silver Dragon::2` | ✓ |  | — | — | `summon` | 15 | con | — | restrained | — | — | — |

### Sphinx

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Sphinx::0` | ✓ |  | — | — | `deferred` | — | — | — | — | — | meta-initiative | lair_def_006 |
| `Sphinx::1` | ✓ |  | — | — | `save_only` | 15 | con | — | — | — | — | — |
| `Sphinx::2` | ✓ |  | — | — | `deferred` | — | — | — | — | — | meta-time | lair_def_008 |
| `Sphinx::3` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |

### Ssendam, Lord of Madness

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Ssendam, Lord of Madness::0` | ✓ | ✓ | confusion | 4 | `cast_spell` | 20 | wis | — | — | — | — | — |
| `Ssendam, Lord of Madness::1` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |

### Storm Giant Quintessent

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Storm Giant Quintessent::0` | ✓ |  | — | — | `save_condition` | 18 | con | — | deafened | — | — | — |
| `Storm Giant Quintessent::1` | ✓ |  | — | — | `deferred` | — | — | — | — | — | visibility | lair_def_004 |
| `Storm Giant Quintessent::2` | ✓ |  | — | — | `save_only` | 18 | str | — | — | — | — | — |
| `Storm Giant Quintessent::0` | ✓ |  | — | — | `save_condition` | 18 | con | — | deafened | — | — | — |
| `Storm Giant Quintessent::1` | ✓ |  | — | — | `deferred` | — | — | — | — | — | visibility | lair_def_004 |
| `Storm Giant Quintessent::2` | ✓ |  | — | — | `save_only` | 18 | str | — | — | — | — | — |

### Strahd von Zarovich

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Strahd von Zarovich::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Strahd von Zarovich::1` | ✓ |  | — | — | `save_only` | 20 | — | — | — | — | — | — |
| `Strahd von Zarovich::2` | ✓ |  | — | — | `summon` | — | — | — | — | — | — | — |
| `Strahd von Zarovich::3` | ✓ |  | — | — | `summon` | 17 | cha | — | — | — | — | — |

### The Gardener

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `The Gardener::0` | ✓ |  | — | — | `movement` | — | — | — | — | — | — | — |
| `The Gardener::1` | ✓ |  | — | — | `save_only` | 15 | dex | — | — | — | — | — |

### Thessalkraken

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Thessalkraken::0` | ✓ |  | — | — | `save_only` | 18 | str | — | — | — | — | — |
| `Thessalkraken::1` | ✓ |  | — | — | `debuff_enemy` | — | — | — | — | — | — | — |
| `Thessalkraken::2` | ✓ |  | — | — | `save_only` | 18 | wis | — | — | — | — | — |

### Time Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Time Dragon::0` | ✓ |  | — | — | `save_damage` | 18 | wis | 4d12 psychic | — | — | — | — |
| `Time Dragon::1` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Time Dragon::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |

### Topaz Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Topaz Dragon::0` | ✓ |  | — | — | `save_condition` | 15 | wis | — | charmed | — | — | — |
| `Topaz Dragon::1` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Topaz Dragon::2` | ✓ |  | — | — | `save_damage` | 15 | con | 4d6 necrotic | — | — | — | — |

### Valin Sarnaster

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Valin Sarnaster::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Valin Sarnaster::1` | ✓ |  | — | — | `buff_ally` | — | — | — | — | — | — | — |
| `Valin Sarnaster::2` | ✓ |  | — | — | `save_damage` | 16 | con | 1d6 necrotic | — | — | — | — |

### Villain

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Villain::0` | ✓ |  | — | — | `save_only` | 15 | con | — | — | — | — | — |
| `Villain::1` | ✓ |  | — | — | `save_only` | 15 | str | — | — | — | — | — |
| `Villain::2` | ✓ |  | — | — | `save_only` | 15 | dex | — | — | — | — | — |

### White Dragon

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `White Dragon::0` | ✓ |  | — | — | `deferred` | 10 | con | 3d6 cold | — | — | magical-darkness | lair_def_010 |
| `White Dragon::1` | ✓ |  | — | — | `damage_no_save` | — | — | 3d6 piercing | — | — | — | — |
| `White Dragon::2` | ✓ |  | — | — | `debuff_enemy` | — | — | — | — | — | — | — |
| `White Dragon::3` | ✓ |  | — | — | `summon` | 15 | con | — | blinded | — | — | — |

### Yan-C-Bin

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Yan-C-Bin::0` | ✓ | ✓ | sleet storm | 3 | `cast_spell` | — | — | — | — | — | — | — |
| `Yan-C-Bin::1` | ✓ |  | — | — | `save_damage` | 24 | con | 1d6 bludgeoning | — | — | — | — |
| `Yan-C-Bin::2` | ✓ |  | — | — | `save_condition` | 24 | wis | — | blinded | — | — | — |

### Yeenoghu

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Yeenoghu::0` | ✓ |  | — | — | `buff_ally` | — | — | — | — | — | — | — |
| `Yeenoghu::1` | ✓ |  | — | — | `save_damage` | 24 | dex | 6d8 piercing | restrained | — | — | — |
| `Yeenoghu::2` | ✓ |  | — | — | `movement` | — | — | — | — | — | — | — |
| `Yeenoghu::0` | ✓ |  | — | — | `save_damage` | 24 | dex | 6d8 piercing | restrained | — | — | — |
| `Yeenoghu::1` | ✓ |  | — | — | `movement` | — | — | — | — | — | — | — |
| `Yeenoghu::2` | ✓ |  | — | — | `buff_ally` | — | — | — | — | — | — | — |

### Zargon the Returner

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Zargon the Returner::0` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Zargon the Returner::1` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Zargon the Returner::2` | ✓ |  | — | — | `save_only` | 15 | — | — | — | — | — | — |

### Zariel

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Zariel::0` | ✓ | ✓ | fireball | 3 | `cast_spell` | — | — | — | — | — | — | — |
| `Zariel::1` | ✓ | ✓ | major image | 3 | `cast_spell` | 26 | wis | — | frightened | — | — | — |
| `Zariel::0` | ✓ | ✓ | major image | 3 | `cast_spell` | 26 | wis | — | frightened | — | — | — |
| `Zariel::1` | ✓ | ✓ | fireball | 3 | `cast_spell` | — | — | — | — | — | — | — |

### Zikzokrishka

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Zikzokrishka::0` | ✓ |  | — | — | `save_damage` | 15 | dex | 6d6 bludgeoning | prone,restrained | — | — | — |
| `Zikzokrishka::1` | ✓ |  | — | — | `save_condition` | 15 | con | — | blinded | — | — | — |
| `Zikzokrishka::2` | ✓ |  | — | — | `save_damage` | 15 | dex | 3d6 lightning | — | — | — | — |

### Zuggtmoy

| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `Zuggtmoy::0` | ✓ |  | — | — | `movement` | — | — | — | — | — | — | — |
| `Zuggtmoy::1` | ✓ |  | — | — | `summon` | — | — | — | — | — | — | — |
| `Zuggtmoy::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |
| `Zuggtmoy::0` | ✓ |  | — | — | `summon` | — | — | — | — | — | — | — |
| `Zuggtmoy::1` | ✓ |  | — | — | `movement` | — | — | — | — | — | — | — |
| `Zuggtmoy::2` | ✓ |  | — | — | `bespoke` | — | — | — | — | — | — | — |

