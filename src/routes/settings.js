import { Router } from 'express';
import { pick, updateRow } from '../validate.js';

const SPEC = {
  shop_name: { type: 'string' },
  phone: { type: 'string' },
  address: { type: 'string' },
  labor_rate_cents: { type: 'int', min: 0 },
  tax_rate: { type: 'number', min: 0 },
  tax_labor: { type: 'bool' },
};

export function getSettings(db) {
  const s = db.prepare('SELECT * FROM settings WHERE id = 1').get();
  return { ...s, tax_labor: Boolean(s.tax_labor) };
}

export default function settingsRouter(db) {
  const r = Router();
  r.get('/', (req, res) => res.json(getSettings(db)));
  r.patch('/', (req, res) => {
    const fields = pick(req.body, SPEC, { partial: true });
    if (fields.tax_rate > 1) fields.tax_rate /= 100; // accept 8.25 as well as 0.0825
    updateRow(db, 'settings', 1, fields);
    res.json(getSettings(db));
  });
  return r;
}
