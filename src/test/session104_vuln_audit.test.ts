// ============================================================
// Test: Session 104 — damage_vulnerability broader-adoption audit
//       (S103 next-action #6)
//
// Audits `src/spells/*` and `src/engine/*` for direct mutations of
// `Combatant.damageVulnerabilities` (the damage-type vulnerability array
// that `applyDamageWithTempHP` checks to double incoming damage per PHB
// p.197). The S103 `damage_vulnerability` ActiveEffect (with
// `sourceTurnExpires` + `addedVulnerability` guard) is the canonical
// pattern for granting damage vulnerability — it auto-expires via
// `reevaluateEffects` and protects innate vuln (Skeleton bludgeoning)
// from being wrongly spliced on effect expiry.
//
// This test is a REGRESSION GUARD: it verifies that no spell module or
// engine handler bypasses the ActiveEffect pattern by pushing directly
// to `target.damageVulnerabilities`. If a future spell author adds a
// direct push, this test fails and points them to the ActiveEffect
// pattern (applySpellEffect with effectType:'damage_vulnerability').
//
// Allowlist (the ONLY production-code sites permitted to mutate
// damageVulnerabilities):
//   - src/engine/spell_effects.ts — applySpellEffect/undoEffect handlers
//     for the 'damage_vulnerability' effectType (the ActiveEffect pattern
//     itself — this IS the canonical mutation site).
//   - src/engine/combat.ts — handleLairDebuffEnemy creates the
//     damage_vulnerability ActiveEffect (S103); it reads
//     `enemy.damageVulnerabilities?.includes(dt)` to set addedVulnerability
//     but does NOT push directly (the push happens via applySpellEffect).
//   - src/parser/fivetools.ts — parseDamageDefenseList reads innate vuln
//     from bestiary JSON at parse time (initial data load, not a runtime
//     mutation).
//
// Run: npx ts-node --transpile-only src/test/session104_vuln_audit.test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

// ---- Test harness -------------------------------------------

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else       { console.error(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
}
function eq<T>(label: string, a: T, e: T): void {
  assert(label, a === e, `got ${JSON.stringify(a)}, want ${JSON.stringify(e)}`);
}

// ---- Audit: scan src/spells/* for damageVulnerabilities mutations ----

console.log('\n--- 1. Audit: no spell module directly mutates damageVulnerabilities ---');

const SPELLS_DIR = path.join(__dirname, '..', 'spells');
const spellFiles = fs.readdirSync(SPELLS_DIR)
  .filter(f => f.endsWith('.ts') && f !== '_generic_registry.ts')
  .sort();

console.log(`    Scanning ${spellFiles.length} spell modules in src/spells/...`);

// Patterns that indicate a DIRECT mutation of damageVulnerabilities
// (bypassing the ActiveEffect pattern). These are the "bad" patterns:
//   - target.damageVulnerabilities.push(...)
//   - target.damageVulnerabilities = [...]
//   - target.damageVulnerabilities[i] = ...
//   - target.damageVulnerabilities.splice(...)
//   - target.damageVulnerabilities.pop()
//   - target.damageVulnerabilities.shift()
//   - target.damageVulnerabilities.unshift(...)
//   - target.damageVulnerabilities.length = ...
//
// The ALLOWED pattern is: applySpellEffect(target, { effectType: 'damage_vulnerability', ... })
// which internally pushes to damageVulnerabilities via the spell_effects.ts handler.
const DIRECT_MUTATION_PATTERNS = [
  /\.damageVulnerabilities\s*\.\s*push\s*\(/,      // .push(
  /\.damageVulnerabilities\s*\.\s*splice\s*\(/,    // .splice(
  /\.damageVulnerabilities\s*\.\s*pop\s*\(/,       // .pop(
  /\.damageVulnerabilities\s*\.\s*shift\s*\(/,     // .shift(
  /\.damageVulnerabilities\s*\.\s*unshift\s*\(/,   // .unshift(
  /\.damageVulnerabilities\s*\.\s*length\s*=/,      // .length =
  /\.damageVulnerabilities\s*\[\s*\w+\s*\]\s*=/,   // [i] =
];
// Direct assignment `target.damageVulnerabilities = [...]` — allowed in TEST
// files (test fixtures) but NOT in spell modules. We check this separately
// because it's a common test-setup pattern that we don't want to flag in
// production code but DO want to flag in spell modules.
const DIRECT_ASSIGN_PATTERN = /\.damageVulnerabilities\s*=\s*\[/;

const spellViolations: Array<{ file: string; line: number; text: string; pattern: string }> = [];

for (const f of spellFiles) {
  const filePath = path.join(SPELLS_DIR, f);
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  lines.forEach((line, idx) => {
    // Skip comment lines
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    for (const pat of DIRECT_MUTATION_PATTERNS) {
      if (pat.test(line)) {
        spellViolations.push({ file: f, line: idx + 1, text: line.trim(), pattern: pat.source });
      }
    }
    if (DIRECT_ASSIGN_PATTERN.test(line)) {
      spellViolations.push({ file: f, line: idx + 1, text: line.trim(), pattern: DIRECT_ASSIGN_PATTERN.source });
    }
  });
}

eq('spell modules scanned', spellFiles.length > 0, true);
eq('spell modules with direct damageVulnerabilities mutation', spellViolations.length, 0);
if (spellViolations.length > 0) {
  for (const v of spellViolations) {
    console.error(`    ❌ ${v.file}:${v.line} — /${v.pattern}/ — ${v.text}`);
  }
  console.error('\n    → Use applySpellEffect(target, { effectType: "damage_vulnerability", payload: { damageType, addedVulnerability }, sourceTurnExpires }) instead.');
  console.error('      See src/engine/spell_effects.ts "damage_vulnerability" case + src/engine/combat.ts handleLairDebuffEnemy.');
}

// ---- Audit: verify allowlisted production-code mutation sites ----

console.log('\n--- 2. Audit: allowlisted production-code mutation sites ---');

const ALLOWED_PROD_FILES = [
  // The ActiveEffect pattern itself — apply/undo handlers.
  { file: 'src/engine/spell_effects.ts', reason: 'damage_vulnerability effectType apply/undo handlers (the ActiveEffect pattern)' },
  // The lair-action handler that CREATES the damage_vulnerability ActiveEffect.
  // It reads `enemy.damageVulnerabilities?.includes(dt)` (no push) and calls
  // applySpellEffect to do the actual mutation.
  { file: 'src/engine/combat.ts', reason: 'handleLairDebuffEnemy creates damage_vulnerability ActiveEffect (reads .includes, no direct push)' },
  // The parser reads innate vuln from bestiary JSON at parse time.
  { file: 'src/parser/fivetools.ts', reason: 'parseDamageDefenseList reads innate vuln from bestiary JSON (initial data load)' },
];

// Verify spell_effects.ts has the apply + undo handlers (the canonical pattern).
const spellEffectsPath = path.join(__dirname, '..', 'engine', 'spell_effects.ts');
const spellEffectsSrc = fs.readFileSync(spellEffectsPath, 'utf-8');
assert('spell_effects.ts has damage_vulnerability apply case',
  /case\s+['"]damage_vulnerability['"]\s*:/.test(spellEffectsSrc),
  'expected applySpellEffect to have a damage_vulnerability case');
assert('spell_effects.ts has damage_vulnerability undo case',
  spellEffectsSrc.match(/case\s+['"]damage_vulnerability['"]\s*:/g)?.length === 2,
  'expected undoEffect to also have a damage_vulnerability case (2 total)');

// Verify combat.ts handleLairDebuffEnemy uses applySpellEffect (not direct push).
const combatPath = path.join(__dirname, '..', 'engine', 'combat.ts');
const combatSrc = fs.readFileSync(combatPath, 'utf-8');
assert('combat.ts handleLairDebuffEnemy uses effectType: damage_vulnerability',
  /handleLairDebuffEnemy[\s\S]*?effectType:\s*['"]damage_vulnerability['"]/.test(combatSrc),
  'expected handleLairDebuffEnemy to create a damage_vulnerability ActiveEffect');

// Verify the lair handler does NOT directly push (it should call applySpellEffect).
// Extract the handleLairDebuffEnemy function body and check for direct pushes
// in the vulnerability branch.
const lairHandlerMatch = combatSrc.match(
  /function handleLairDebuffEnemy[\s\S]*?(?=\nfunction |\nexport function )/
);
if (lairHandlerMatch) {
  const handlerBody = lairHandlerMatch[0];
  // The handler should NOT contain `.damageVulnerabilities.push(` — the push
  // happens inside applySpellEffect, not in the handler itself.
  const hasDirectPush = /\.damageVulnerabilities\s*\.\s*push\s*\(/.test(handlerBody);
  assert('handleLairDebuffEnemy does NOT directly push damageVulnerabilities',
    !hasDirectPush,
    'handler should call applySpellEffect, not push directly');
  // It MAY read .includes() to set addedVulnerability (that's the S103 guard).
  assert('handleLairDebuffEnemy reads .includes for addedVulnerability guard',
    /\.damageVulnerabilities\?\.includes\(dt\)/.test(handlerBody),
    'expected the addedVulnerability guard check');
}

// ---- Audit: document the allowlist for future reference ----

console.log('\n--- 3. Audit: allowlist documentation ---');
console.log('    Production-code sites PERMITTED to touch damageVulnerabilities:');
for (const a of ALLOWED_PROD_FILES) {
  console.log(`      • ${a.file} — ${a.reason}`);
}
console.log('    All other production code MUST use applySpellEffect({effectType:"damage_vulnerability"}).');
eq('allowlist has 3 production files', ALLOWED_PROD_FILES.length, 3);

// ---- Audit: verify no OTHER engine files mutate damageVulnerabilities ----

console.log('\n--- 4. Audit: no non-allowlisted engine file mutates damageVulnerabilities ---');

const ENGINE_DIR = path.join(__dirname, '..', 'engine');
const engineFiles = fs.readdirSync(ENGINE_DIR).filter(f => f.endsWith('.ts')).sort();
const ALLOWED_ENGINE_FILES = new Set(['spell_effects.ts', 'combat.ts', 'utils.ts']);
// utils.ts is allowlisted because applyDamageWithTempHP READS
// damageVulnerabilities (target.damageVulnerabilities?.includes(damageType))
// to double damage — it does NOT mutate (no push/assign/splice).

const engineViolations: Array<{ file: string; line: number; text: string }> = [];

for (const f of engineFiles) {
  if (f === 'spell_effects.ts') continue; // allowlisted (ActiveEffect handlers)
  if (f === 'combat.ts') continue;        // allowlisted (lair handler reads only)
  const filePath = path.join(ENGINE_DIR, f);
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    // Flag any MUTATION (push/splice/assign) in non-allowlisted engine files.
    // READS (.includes, ?.length, ?.includes) are fine — only mutations are blocked.
    for (const pat of DIRECT_MUTATION_PATTERNS) {
      if (pat.test(line)) {
        engineViolations.push({ file: f, line: idx + 1, text: line.trim() });
      }
    }
    if (DIRECT_ASSIGN_PATTERN.test(line)) {
      engineViolations.push({ file: f, line: idx + 1, text: line.trim() });
    }
  });
}

eq('non-allowlisted engine files with damageVulnerabilities mutation', engineViolations.length, 0);
if (engineViolations.length > 0) {
  for (const v of engineViolations) {
    console.error(`    ❌ src/engine/${v.file}:${v.line} — ${v.text}`);
  }
}

// Verify utils.ts only READS (the damage-doubling check) — no mutation.
const utilsPath = path.join(ENGINE_DIR, 'utils.ts');
const utilsSrc = fs.readFileSync(utilsPath, 'utf-8');
const utilsPushCount = (utilsSrc.match(/\.damageVulnerabilities\s*\.\s*push\s*\(/g) || []).length;
const utilsAssignCount = (utilsSrc.match(/\.damageVulnerabilities\s*=\s*\[/g) || []).length;
eq('utils.ts has 0 damageVulnerabilities.push() calls', utilsPushCount, 0);
eq('utils.ts has 0 damageVulnerabilities = [...] assignments', utilsAssignCount, 0);
// utils.ts SHOULD read .includes (the damage-doubling check in applyDamageWithTempHP).
assert('utils.ts reads damageVulnerabilities?.includes (damage-doubling check)',
  /damageVulnerabilities\?\.includes\(/.test(utilsSrc),
  'expected applyDamageWithTempHP to read damageVulnerabilities for damage doubling');

// ---- Summary: the S103 ActiveEffect is the single source of truth ----

console.log('\n--- 5. Summary: damage_vulnerability ActiveEffect is the single source of truth ---');
console.log('    Audit result: NO spell modules and NO non-allowlisted engine files');
console.log('    directly mutate damageVulnerabilities. The S103 damage_vulnerability');
console.log('    ActiveEffect (src/engine/spell_effects.ts) is the ONLY runtime mechanism');
console.log('    that grants damage vulnerability. Future spell authors MUST use:');
console.log('      applySpellEffect(target, {');
console.log('        effectType: "damage_vulnerability",');
console.log('        payload: { damageType: <DamageType>, addedVulnerability: <boolean> },');
console.log('        sourceTurnExpires: <round>,  // auto-expiry via reevaluateEffects');
console.log('        ...');
console.log('      });');
console.log('    This ensures per-source expiry + innate-vuln protection (Skeleton');
console.log('    bludgeoning is not wrongly spliced on effect expiry).');
assert('audit complete — no violations', spellViolations.length === 0 && engineViolations.length === 0);

// ---- Results ------------------------------------------------
console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
