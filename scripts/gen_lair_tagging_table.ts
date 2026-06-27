// One-shot generator: docs/LAIR-ACTIONS-TAGGING-TABLE.md
// Run: npx ts-node --transpile-only scripts/gen_lair_tagging_table.ts
import * as fs from 'fs';
import * as path from 'path';
import { extractLairAction } from '../src/parser/fivetools';

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../bestiaryData/legendarygroups.json'), 'utf8'));
const groups: any[] = data.legendaryGroup || [];
function flat(e: any): string {
  if (typeof e === 'string') return e;
  if (Array.isArray(e)) return e.map(flat).join(' ');
  if (e.items) return e.items.map(flat).join(' ');
  if (e.entries) return e.entries.map(flat).join(' ');
  if (e.entry) return e.entry;
  return '';
}

interface Row {
  id: string; sourceCreature: string; isMagical: boolean; isSpell: boolean;
  spellName: string; castLevel: number | string; category: string;
  outOfScopeId: string; deferred: string; deferredId: string;
  saveDC: number | string; saveAbility: string; damage: string; conditions: string;
}
const rows: Row[] = [];
for (const g of groups) {
  if (!g.lairActions) continue;
  let idx = 0;
  for (const entry of g.lairActions) {
    if (typeof entry === 'string') continue;
    const push = (t: string) => {
      const text = t.trim();
      if (!text) return;
      const a = extractLairAction(text, g.name, idx++);
      rows.push({
        id: a.id, sourceCreature: a.sourceCreature, isMagical: a.isMagical, isSpell: a.isSpell,
        spellName: a.spellName ?? '—', castLevel: a.castLevel ?? '—', category: a.category,
        outOfScopeId: a.outOfScopeId ?? '—', deferred: a.deferred ?? '—', deferredId: a.deferredId ?? '—',
        saveDC: a.saveDC ?? '—', saveAbility: a.saveAbility ?? '—',
        damage: a.damage ? `${a.damage.count}d${a.damage.sides} ${a.damage.type}` : '—',
        conditions: a.conditions?.join(',') ?? '—',
      });
    };
    if (entry.items && Array.isArray(entry.items)) { for (const item of entry.items) push(flat(item)); }
    else if (entry.entries) { push(flat(entry)); }
  }
}

// Summary
const catCount: Record<string, number> = {};
let isSpellN = 0, oosN = 0, defN = 0;
for (const r of rows) {
  catCount[r.category] = (catCount[r.category] || 0) + 1;
  if (r.isSpell) isSpellN++;
  if (r.outOfScopeId !== '—') oosN++;
  if (r.deferred !== '—') defN++;
}

let out = `# Lair Actions — Per-Action Tagging Table (Phase 1 Deliverable)

**Generated:** Session 91 (RFC-LAIRACTIONS Phase 1)
**Source:** \`bestiaryData/legendarygroups.json\` — 115 legendary groups, ${rows.length} lair-action options.
**Generator:** \`scripts/gen_lair_tagging_table.ts\` (re-run after parser changes to refresh).

This is the per-action tagging table required by RFC-LAIRACTIONS §5.3 / §8 Phase 1.
Every flattened lair-action option is read individually and tagged per [DD-4]:
- \`isSpell: true\` ONLY when the action casts a named spell (detected via \`@spell\`
  tag in a casting context). Remedy-references (e.g., Sphinx "A greater restoration
  spell can restore…") are EXCLUDED — \`isSpell: false\`.
- \`isMagical: true\` for ALL actions (MM: lair actions are "magical effects").
- \`category\` routes the Phase 2+ dispatcher. \`deferred\` / \`flavor\` are logged
  not executed; \`cast_spell\` drives GoI/Counterspell interactions.

Review this table before Phase 2 dispatch begins. Flag any \`isSpell\` mis-tag or
\`category\` mis-assignment as \`[VERIFY]\` for the next pass.

## Summary

| Metric | Value |
|---|---|
| Total actions | ${rows.length} |
| \`isSpell: true\` (cast a named spell) | ${isSpellN} |
| \`isMagical: true\` (all) | ${rows.length} |
| Out-of-scope (\`lair_oos_*\`) | ${oosN} |
| Deferred (\`lair_def_*\` / heuristic) | ${defN} |
| In-scope (executable in Phase 2+) | ${rows.length - oosN - defN} |

### Category distribution

| Category | Count |
|---|---|
${Object.entries(catCount).sort((a, b) => b[1] - a[1]).map(([c, n]) => `| \`${c}\` | ${n} |`).join('\n')}

## Full table

Grouped by \`sourceCreature\` (alphabetical). Columns: \`id\`, \`isMagical\`, \`isSpell\`,
\`spellName\`/\`castLevel\`, \`category\`, \`saveDC\`/\`saveAbility\`, \`damage\`,
\`conditions\`, \`outOfScopeId\`/\`deferred\`/\`deferredId\`.

`;

// Group by sourceCreature
const byCreature: Record<string, Row[]> = {};
for (const r of rows) (byCreature[r.sourceCreature] ??= []).push(r);
const creatures = Object.keys(byCreature).sort();
for (const c of creatures) {
  out += `### ${c}\n\n`;
  out += `| id | isMagical | isSpell | spellName | castLevel | category | saveDC | saveAbility | damage | conditions | outOfScopeId | deferred | deferredId |\n`;
  out += `|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of byCreature[c]) {
    out += `| \`${r.id}\` | ${r.isMagical ? '✓' : ''} | ${r.isSpell ? '✓' : ''} | ${r.spellName} | ${r.castLevel} | \`${r.category}\` | ${r.saveDC} | ${r.saveAbility} | ${r.damage} | ${r.conditions} | ${r.outOfScopeId} | ${r.deferred} | ${r.deferredId} |\n`;
  }
  out += '\n';
}

fs.writeFileSync(path.join(__dirname, '../docs/LAIR-ACTIONS-TAGGING-TABLE.md'), out);
console.log(`Wrote docs/LAIR-ACTIONS-TAGGING-TABLE.md — ${rows.length} rows across ${creatures.length} creatures.`);
console.log(`isSpell=${isSpellN} outOfScope=${oosN} deferred=${defN}`);
