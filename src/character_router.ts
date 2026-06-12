// ============================================================
// Character Sheet API Router
// D&D 5e Combat Sim
//
// Mounted at /api/characters and /api/parties in server.ts.
// Isolated here to avoid merge conflicts with the combat agent.
//
// Endpoints:
//   GET    /api/characters              list all character sheets
//   POST   /api/characters              create a new character sheet
//   GET    /api/characters/:id          get one character sheet
//   PUT    /api/characters/:id          update a character sheet
//   DELETE /api/characters/:id          delete a character sheet
//   POST   /api/characters/import       import from JSON string
//   GET    /api/characters/:id/export   export as JSON string
//
//   GET    /api/parties                 list all parties
//   POST   /api/parties                 create a new party
//   GET    /api/parties/:id             get one party (with member names)
//   PUT    /api/parties/:id             update a party
//   DELETE /api/parties/:id             delete a party
//   GET    /api/parties/:id/members     get full character sheets for party members
// ============================================================

import { Router, Request, Response } from 'express';
import {
  saveCharacter, loadCharacter, listCharacters,
  deleteCharacter, importCharacter, exportCharacter,
  saveParty, loadParty, listParties,
  deleteParty, loadPartyMembers,
} from './characters/storage';
import { ValidationError } from './characters/validator';

const router = Router();

// ---- Helpers ------------------------------------------------

function handleError(res: Response, err: unknown): void {
  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
  } else if (err instanceof Error) {
    res.status(500).json({ error: err.message });
  } else {
    res.status(500).json({ error: 'Unknown error' });
  }
}

// ---- Character Endpoints ------------------------------------

// GET /api/characters — list all characters (summary only)
router.get('/characters', (_req: Request, res: Response) => {
  try {
    const sheets = listCharacters();
    // Return summary (no equipment/features bulk) for list view
    const summary = sheets.map(s => ({
      id:          s.id,
      name:        s.name,
      race:        s.race,
      background:  s.background,
      firstClass:  s.firstClass,
      classLevels: s.classLevels,
      experiencePoints: s.experiencePoints,
      maxHP:       s.maxHP,
      armorClass:  s.armorClass,
      updatedAt:   s.updatedAt,
    }));
    res.json({ characters: summary, total: summary.length });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/characters — create a new character sheet
router.post('/characters', (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }
    // Strip id/timestamps — saveCharacter stamps these
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = body;
    const saved = saveCharacter(rest as any);
    return res.status(201).json({ character: saved });
  } catch (err) {
    return handleError(res, err);
  }
});

// GET /api/characters/:id — get one character sheet
router.get('/characters/:id', (req: Request, res: Response) => {
  try {
    const sheet = loadCharacter(String(req.params.id));
    if (!sheet) return res.status(404).json({ error: `Character "${String(req.params.id)}" not found` });
    return res.json({ character: sheet });
  } catch (err) {
    return handleError(res, err);
  }
});

// PUT /api/characters/:id — update a character sheet
router.put('/characters/:id', (req: Request, res: Response) => {
  try {
    const existing = loadCharacter(String(req.params.id));
    if (!existing) return res.status(404).json({ error: `Character "${String(req.params.id)}" not found` });

    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }

    // Merge: id and createdAt are immutable; everything else can change
    const updated = {
      ...existing,
      ...body,
      id:        existing.id,
      createdAt: existing.createdAt,
    };
    const saved = saveCharacter(updated);
    return res.json({ character: saved });
  } catch (err) {
    return handleError(res, err);
  }
});

// DELETE /api/characters/:id
router.delete('/characters/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteCharacter(String(req.params.id));
    if (!deleted) return res.status(404).json({ error: `Character "${String(req.params.id)}" not found` });
    return res.json({ deleted: true, id: String(req.params.id) });
  } catch (err) {
    return handleError(res, err);
  }
});

// POST /api/characters/import — import from JSON string in body
router.post('/characters/import', (req: Request, res: Response) => {
  try {
    const { json } = req.body as { json?: string };
    if (typeof json !== 'string') {
      return res.status(400).json({ error: 'Body must have a "json" string field' });
    }
    const imported = importCharacter(json);
    return res.status(201).json({ character: imported });
  } catch (err) {
    return handleError(res, err);
  }
});

// GET /api/characters/:id/export — export as JSON
router.get('/characters/:id/export', (req: Request, res: Response) => {
  try {
    const json = exportCharacter(String(req.params.id));
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="character-${String(req.params.id)}.json"`
    );
    return res.send(json);
  } catch (err) {
    return handleError(res, err);
  }
});

// ---- Party Endpoints ----------------------------------------

// GET /api/parties — list all parties
router.get('/parties', (_req: Request, res: Response) => {
  try {
    const parties = listParties();
    res.json({ parties, total: parties.length });
  } catch (err) {
    handleError(res, err);
  }
});

// POST /api/parties — create a new party
router.post('/parties', (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = body;
    const saved = saveParty(rest as any);
    return res.status(201).json({ party: saved });
  } catch (err) {
    return handleError(res, err);
  }
});

// GET /api/parties/:id — get one party
router.get('/parties/:id', (req: Request, res: Response) => {
  try {
    const party = loadParty(String(req.params.id));
    if (!party) return res.status(404).json({ error: `Party "${String(req.params.id)}" not found` });
    return res.json({ party });
  } catch (err) {
    return handleError(res, err);
  }
});

// PUT /api/parties/:id — update a party
router.put('/parties/:id', (req: Request, res: Response) => {
  try {
    const existing = loadParty(String(req.params.id));
    if (!existing) return res.status(404).json({ error: `Party "${String(req.params.id)}" not found` });

    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }

    const updated = {
      ...existing,
      ...body,
      id:        existing.id,
      createdAt: existing.createdAt,
    };
    const saved = saveParty(updated);
    return res.json({ party: saved });
  } catch (err) {
    return handleError(res, err);
  }
});

// DELETE /api/parties/:id
router.delete('/parties/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteParty(String(req.params.id));
    if (!deleted) return res.status(404).json({ error: `Party "${String(req.params.id)}" not found` });
    return res.json({ deleted: true, id: String(req.params.id) });
  } catch (err) {
    return handleError(res, err);
  }
});

// GET /api/parties/:id/members — get full character sheets for party members
router.get('/parties/:id/members', (req: Request, res: Response) => {
  try {
    const party = loadParty(String(req.params.id));
    if (!party) return res.status(404).json({ error: `Party "${String(req.params.id)}" not found` });
    const members = loadPartyMembers(String(req.params.id));
    return res.json({ party, members, total: members.length });
  } catch (err) {
    return handleError(res, err);
  }
});

export default router;
