// ============================================================
// Character Sheet Storage
// D&D 5e Combat Sim — Character Persistence Layer
//
// Stores CharacterSheet and Party objects as JSON files:
//   characters/<id>.json
//   parties/<id>.json
//
// All public functions are synchronous for simplicity.
// I/O errors propagate as thrown exceptions to the caller.
// ============================================================

import * as fs   from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { CharacterSheet, Party } from './types';
import { validateCharacterSheet, validateParty, ValidationError } from './validator';

// ---- Directory resolution -----------------------------------
// Resolve relative to CWD (project root) so tests and server both work.

function getCharactersDir(): string {
  return path.join(process.cwd(), 'characters');
}

function getPartiesDir(): string {
  return path.join(process.cwd(), 'parties');
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function characterPath(id: string): string {
  // Sanitize id: only alphanumeric + hyphens allowed (UUID format)
  if (!/^[a-zA-Z0-9-]+$/.test(id)) {
    throw new Error(`Invalid character ID: "${id}"`);
  }
  return path.join(getCharactersDir(), `${id}.json`);
}

function partyPath(id: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) {
    throw new Error(`Invalid party ID: "${id}"`);
  }
  return path.join(getPartiesDir(), `${id}.json`);
}

// ---- Schema Version -----------------------------------------

const CURRENT_SCHEMA_VERSION = 1;

function stampSheet(sheet: CharacterSheet, isNew: boolean): CharacterSheet {
  const now = new Date().toISOString();
  return {
    ...sheet,
    id:        sheet.id        || randomUUID(),
    version:   CURRENT_SCHEMA_VERSION,
    createdAt: isNew ? now : (sheet.createdAt || now),
    updatedAt: now,
  };
}

function stampParty(party: Party, isNew: boolean): Party {
  const now = new Date().toISOString();
  return {
    ...party,
    id:        party.id        || randomUUID(),
    createdAt: isNew ? now : (party.createdAt || now),
    updatedAt: now,
  };
}

// ---- Character CRUD -----------------------------------------

/**
 * Save a CharacterSheet to disk. Assigns a UUID if id is absent.
 * Validates the sheet before writing.
 * Returns the saved (possibly id-stamped) sheet.
 */
export function saveCharacter(sheet: CharacterSheet): CharacterSheet {
  ensureDir(getCharactersDir());
  const isNew  = !sheet.id || !fs.existsSync(characterPath(sheet.id || '___'));
  const stamped = stampSheet(sheet, isNew);

  const errors = validateCharacterSheet(stamped);
  if (errors.length > 0) {
    throw new ValidationError(`Invalid character sheet: ${errors.join('; ')}`);
  }

  const filePath = characterPath(stamped.id);
  fs.writeFileSync(filePath, JSON.stringify(stamped, null, 2), 'utf-8');
  return stamped;
}

/**
 * Load a CharacterSheet by id. Returns null if not found.
 * Validates on load and throws if schema is broken.
 */
export function loadCharacter(id: string): CharacterSheet | null {
  const filePath = characterPath(id);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  let sheet: CharacterSheet;
  try {
    sheet = JSON.parse(raw) as CharacterSheet;
  } catch (e) {
    throw new Error(`Corrupt character file ${id}.json: ${(e as Error).message}`);
  }

  const errors = validateCharacterSheet(sheet);
  if (errors.length > 0) {
    throw new ValidationError(`Loaded character "${id}" has validation errors: ${errors.join('; ')}`);
  }

  return sheet;
}

/**
 * List all saved CharacterSheets (sorted by updatedAt, newest first).
 * Skips and warns on corrupt files.
 */
export function listCharacters(): CharacterSheet[] {
  ensureDir(getCharactersDir());
  const dir  = getCharactersDir();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

  const sheets: CharacterSheet[] = [];
  for (const file of files) {
    try {
      const raw   = fs.readFileSync(path.join(dir, file), 'utf-8');
      const sheet = JSON.parse(raw) as CharacterSheet;
      sheets.push(sheet);
    } catch (e) {
      console.warn(`[characters/storage] Skipping corrupt file ${file}: ${(e as Error).message}`);
    }
  }

  return sheets.sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * Delete a CharacterSheet by id. Returns true if deleted, false if not found.
 * Also removes the character from all parties.
 */
export function deleteCharacter(id: string): boolean {
  const filePath = characterPath(id);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);

  // Remove from all parties
  try {
    const parties = listParties();
    for (const party of parties) {
      if (party.characterIds.includes(id)) {
        const updated = {
          ...party,
          characterIds: party.characterIds.filter(cid => cid !== id),
        };
        saveParty(updated);
      }
    }
  } catch {
    // Best-effort — deletion already succeeded
  }

  return true;
}

/**
 * Check if a character with the given id exists.
 */
export function characterExists(id: string): boolean {
  try {
    return fs.existsSync(characterPath(id));
  } catch {
    return false;
  }
}

// ---- Party CRUD ---------------------------------------------

/**
 * Save a Party to disk. Assigns a UUID if id is absent.
 * Validates that all memberIds exist (warns if not — does not block save).
 */
export function saveParty(party: Party): Party {
  ensureDir(getPartiesDir());
  const isNew   = !party.id || !fs.existsSync(partyPath(party.id || '___'));
  const stamped = stampParty(party, isNew);

  const errors = validateParty(stamped);
  if (errors.length > 0) {
    throw new ValidationError(`Invalid party: ${errors.join('; ')}`);
  }

  // Warn (not error) on missing character IDs — characters may be on another machine
  for (const cid of stamped.characterIds) {
    if (!characterExists(cid)) {
      console.warn(`[characters/storage] Party "${stamped.name}": member "${cid}" not found locally`);
    }
  }

  const filePath = partyPath(stamped.id);
  fs.writeFileSync(filePath, JSON.stringify(stamped, null, 2), 'utf-8');
  return stamped;
}

/**
 * Load a Party by id. Returns null if not found.
 */
export function loadParty(id: string): Party | null {
  const filePath = partyPath(id);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  let party: Party;
  try {
    party = JSON.parse(raw) as Party;
  } catch (e) {
    throw new Error(`Corrupt party file ${id}.json: ${(e as Error).message}`);
  }

  const errors = validateParty(party);
  if (errors.length > 0) {
    throw new ValidationError(`Loaded party "${id}" has validation errors: ${errors.join('; ')}`);
  }

  return party;
}

/**
 * List all saved Parties (sorted by updatedAt, newest first).
 */
export function listParties(): Party[] {
  ensureDir(getPartiesDir());
  const dir   = getPartiesDir();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

  const parties: Party[] = [];
  for (const file of files) {
    try {
      const raw   = fs.readFileSync(path.join(dir, file), 'utf-8');
      const party = JSON.parse(raw) as Party;
      parties.push(party);
    } catch (e) {
      console.warn(`[characters/storage] Skipping corrupt party file ${file}: ${(e as Error).message}`);
    }
  }

  return parties.sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * Delete a Party by id. Returns true if deleted, false if not found.
 * Does NOT delete member characters.
 */
export function deleteParty(id: string): boolean {
  const filePath = partyPath(id);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

/**
 * Load full character sheets for all members of a party.
 * Missing characters (deleted or not local) are skipped with a warning.
 */
export function loadPartyMembers(partyId: string): CharacterSheet[] {
  const party = loadParty(partyId);
  if (!party) return [];

  const members: CharacterSheet[] = [];
  for (const cid of party.characterIds) {
    try {
      const sheet = loadCharacter(cid);
      if (sheet) members.push(sheet);
      else console.warn(`[characters/storage] Party member ${cid} not found`);
    } catch (e) {
      console.warn(`[characters/storage] Failed to load party member ${cid}: ${(e as Error).message}`);
    }
  }
  return members;
}

// ---- Import / Export ----------------------------------------

/**
 * Import a CharacterSheet from raw JSON string.
 * Validates and saves. Returns the saved sheet with a fresh id+timestamps.
 * NOTE: always assigns a new id to prevent collision with existing sheets.
 */
export function importCharacter(json: string): CharacterSheet {
  let raw: Partial<CharacterSheet>;
  try {
    raw = JSON.parse(json) as Partial<CharacterSheet>;
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }

  // Strip identity fields — import always creates a fresh copy
  const sheet: CharacterSheet = {
    ...(raw as CharacterSheet),
    id:        randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version:   CURRENT_SCHEMA_VERSION,
  };

  return saveCharacter(sheet);
}

/**
 * Export a CharacterSheet as a JSON string (pretty-printed).
 */
export function exportCharacter(id: string): string {
  const sheet = loadCharacter(id);
  if (!sheet) throw new Error(`Character "${id}" not found`);
  return JSON.stringify(sheet, null, 2);
}
