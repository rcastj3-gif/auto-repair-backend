import { Router } from 'express';
import { decodeVin, getRecalls } from '../services/nhtsa.js';
import { badRequest } from '../errors.js';
import { systemFor } from '../db.js';

// Standalone lookups that don't need a saved customer or vehicle.
export default function lookupRouter(db) {
  const r = Router();

  r.get('/vin/:vin', async (req, res) => res.json(await decodeVin(req.params.vin)));

  r.get('/recalls', async (req, res) => {
    const { make, model, year } = req.query;
    res.json(await getRecalls({ make, model, year }));
  });

  // ?q= matches code or words in the description, e.g. ?q=lean or ?q=P04
  r.get('/codes', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const rows = q
      ? db.prepare('SELECT * FROM dtc_codes WHERE code LIKE ?1 OR description LIKE ?2 ORDER BY code LIMIT 50')
          .all(`${q.toUpperCase()}%`, `%${q}%`)
      : db.prepare('SELECT * FROM dtc_codes ORDER BY code').all();
    res.json(rows.map(formatCode));
  });

  r.get('/codes/:code', (req, res) => res.json(lookupCode(db, req.params.code)));

  return r;
}

const CODE_RE = /^[PBCU][0-3][0-9A-F]{3}$/;

export function normalizeCode(raw) {
  const code = String(raw ?? '').trim().toUpperCase();
  if (!CODE_RE.test(code)) throw badRequest('Trouble codes look like P0420: a letter (P, B, C or U) and four characters');
  return code;
}

export function lookupCode(db, raw) {
  const code = normalizeCode(raw);
  const row = db.prepare('SELECT * FROM dtc_codes WHERE code = ?').get(code);
  if (row) return { ...formatCode(row), found: true };
  return {
    code,
    system: systemFor(code),
    type: codeType(code),
    description: null,
    common_causes: [],
    found: false,
    note: codeType(code) === 'manufacturer'
      ? 'This is a manufacturer-specific code. Its meaning depends on the make; check the factory service information.'
      : 'This code is not in the built-in table yet. Check your service information.',
  };
}

function formatCode(row) {
  return {
    code: row.code,
    system: row.system,
    type: codeType(row.code),
    description: row.description,
    common_causes: row.common_causes ? row.common_causes.split('; ') : [],
  };
}

// Second character: 0 = generic (SAE); 1 = manufacturer. For P codes, 2 is generic and 3 is mixed.
function codeType(code) {
  const d = code[1];
  if (d === '0') return 'generic';
  if (d === '1') return 'manufacturer';
  if (code[0] === 'P' && d === '2') return 'generic';
  if (code[0] === 'P' && d === '3') return code[2] >= '4' ? 'generic' : 'manufacturer';
  return 'manufacturer';
}
