import { Router } from 'express';
import { pick, id, updateRow } from '../validate.js';
import { notFound, badRequest } from '../errors.js';
import { decodeVin, getRecalls, normalizeVin } from '../services/nhtsa.js';

const SPEC = {
  customer_id: { type: 'int', required: true },
  vin: { type: 'string' },
  year: { type: 'int', min: 1900 },
  make: { type: 'string' },
  model: { type: 'string' },
  trim: { type: 'string' },
  engine: { type: 'string' },
  license_plate: { type: 'string' },
  color: { type: 'string' },
  mileage: { type: 'int', min: 0 },
  notes: { type: 'string' },
};
const COLUMNS = Object.keys(SPEC);

export default function vehiclesRouter(db) {
  const r = Router();
  const find = (vehicleId) => {
    const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId);
    if (!v) throw notFound('Vehicle');
    return v;
  };

  r.get('/', (req, res) => {
    const { vin, customer_id } = req.query;
    if (vin) return res.json(db.prepare('SELECT * FROM vehicles WHERE vin = ?').all(normalizeVin(vin)));
    if (customer_id) return res.json(db.prepare('SELECT * FROM vehicles WHERE customer_id = ?').all(id(customer_id)));
    res.json(db.prepare('SELECT * FROM vehicles ORDER BY id DESC LIMIT 100').all());
  });

  // With a VIN and no year/make/model, the vehicle details are filled in from NHTSA automatically.
  // Anything sent in the request wins over the decoded value.
  r.post('/', async (req, res) => {
    const f = pick(req.body, SPEC);
    if (!db.prepare('SELECT 1 FROM customers WHERE id = ?').get(f.customer_id)) throw badRequest('customer_id does not exist');

    let decoded = null;
    if (f.vin) {
      f.vin = normalizeVin(f.vin);
      if (req.body.decode !== false && !(f.year && f.make && f.model)) {
        decoded = await decodeVin(f.vin);
        for (const key of ['year', 'make', 'model', 'trim', 'engine']) f[key] ??= decoded[key];
      }
    }

    const { lastInsertRowid } = db
      .prepare(`INSERT INTO vehicles (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`)
      .run(...COLUMNS.map((c) => f[c] ?? null));
    const vehicle = find(lastInsertRowid);
    res.status(201).json(decoded?.warning ? { ...vehicle, vin_warning: decoded.warning } : vehicle);
  });

  r.get('/:id', (req, res) => {
    const vehicle = find(id(req.params.id));
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(vehicle.customer_id);
    const work_orders = db
      .prepare('SELECT id, status, complaint, mileage_in, created_at FROM work_orders WHERE vehicle_id = ? ORDER BY id DESC')
      .all(vehicle.id);
    res.json({ ...vehicle, customer, work_orders });
  });

  r.patch('/:id', (req, res) => {
    const vehicleId = id(req.params.id);
    find(vehicleId);
    const f = pick(req.body, SPEC, { partial: true });
    if (f.vin) f.vin = normalizeVin(f.vin);
    if (f.customer_id && !db.prepare('SELECT 1 FROM customers WHERE id = ?').get(f.customer_id)) {
      throw badRequest('customer_id does not exist');
    }
    updateRow(db, 'vehicles', vehicleId, f);
    res.json(find(vehicleId));
  });

  r.delete('/:id', (req, res) => {
    const vehicleId = id(req.params.id);
    find(vehicleId);
    db.prepare('DELETE FROM vehicles WHERE id = ?').run(vehicleId);
    res.status(204).end();
  });

  r.get('/:id/recalls', async (req, res) => {
    const v = find(id(req.params.id));
    if (!v.make || !v.model || !v.year) throw badRequest('Vehicle needs a year, make and model to check recalls');
    const recalls = await getRecalls(v);
    res.json({ vehicle_id: v.id, count: recalls.length, recalls });
  });

  return r;
}
