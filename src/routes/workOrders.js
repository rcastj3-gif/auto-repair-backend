import { Router } from 'express';
import { pick, id, updateRow } from '../validate.js';
import { notFound, badRequest, HttpError } from '../errors.js';
import { computeTotals, lineTotal } from '../totals.js';
import { getSettings } from './settings.js';
import { lookupCode, normalizeCode } from './lookup.js';
import { transaction } from '../db.js';
import { getInvoice } from './invoices.js';

export const STATUSES = ['estimate', 'approved', 'in_progress', 'completed', 'invoiced', 'cancelled'];
// "invoiced" is only reached by creating an invoice, never by editing the status directly.
const EDITABLE_STATUSES = STATUSES.filter((s) => s !== 'invoiced');

const SPEC = {
  vehicle_id: { type: 'int', required: true },
  status: { type: 'string', oneOf: EDITABLE_STATUSES },
  complaint: { type: 'string' },
  diagnosis: { type: 'string' },
  technician: { type: 'string' },
  mileage_in: { type: 'int', min: 0 },
};
const { vehicle_id: _vehicleId, ...PATCH_SPEC } = SPEC;

const ITEM_SPEC = {
  kind: { type: 'string', required: true, oneOf: ['labor', 'part', 'fee'] },
  description: { type: 'string', required: true },
  part_number: { type: 'string' },
  quantity: { type: 'number', min: 0 },
  unit_price_cents: { type: 'int', min: 0 },
};

export default function workOrdersRouter(db) {
  const r = Router();

  const find = (woId) => {
    const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(woId);
    if (!wo) throw notFound('Work order');
    return wo;
  };
  const findEditable = (woId) => {
    const wo = find(woId);
    if (wo.status === 'invoiced') throw new HttpError(409, 'This work order has been invoiced and can no longer be changed');
    return wo;
  };
  const touch = (woId) => db.prepare("UPDATE work_orders SET updated_at = datetime('now') WHERE id = ?").run(woId);

  const full = (woId) => {
    const wo = find(woId);
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(wo.vehicle_id);
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(vehicle.customer_id);
    const items = db.prepare('SELECT * FROM work_order_items WHERE work_order_id = ? ORDER BY id').all(wo.id)
      .map((i) => ({ ...i, line_total_cents: lineTotal(i) }));
    const codes = db.prepare('SELECT code, notes FROM work_order_codes WHERE work_order_id = ? ORDER BY code').all(wo.id)
      .map((c) => ({ ...lookupCode(db, c.code), notes: c.notes }));
    const invoice = db.prepare('SELECT id FROM invoices WHERE work_order_id = ?').get(wo.id);
    return {
      ...wo,
      vehicle,
      customer,
      items,
      codes,
      totals: computeTotals(items, getSettings(db)),
      invoice_id: invoice?.id ?? null,
    };
  };

  r.get('/', (req, res) => {
    const where = [];
    const args = [];
    if (req.query.status) {
      const statuses = String(req.query.status).split(',');
      for (const s of statuses) if (!STATUSES.includes(s)) throw badRequest(`Unknown status: ${s}`);
      where.push(`wo.status IN (${statuses.map(() => '?').join(', ')})`);
      args.push(...statuses);
    }
    if (req.query.vehicle_id) {
      where.push('wo.vehicle_id = ?');
      args.push(id(req.query.vehicle_id));
    }
    const rows = db.prepare(
      `SELECT wo.*, v.year, v.make, v.model, c.first_name, c.last_name, c.phone
       FROM work_orders wo
       JOIN vehicles v ON v.id = wo.vehicle_id
       JOIN customers c ON c.id = v.customer_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY wo.id DESC LIMIT 200`
    ).all(...args);
    res.json(rows);
  });

  r.post('/', (req, res) => {
    const f = pick(req.body, SPEC);
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(f.vehicle_id);
    if (!vehicle) throw badRequest('vehicle_id does not exist');

    const woId = transaction(db, () => {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO work_orders (vehicle_id, status, complaint, diagnosis, technician, mileage_in) VALUES (?, ?, ?, ?, ?, ?)')
        .run(f.vehicle_id, f.status ?? 'estimate', f.complaint ?? null, f.diagnosis ?? null, f.technician ?? null, f.mileage_in ?? null);
      // Keep the vehicle's odometer current.
      if (f.mileage_in && (vehicle.mileage == null || f.mileage_in > vehicle.mileage)) {
        db.prepare('UPDATE vehicles SET mileage = ? WHERE id = ?').run(f.mileage_in, vehicle.id);
      }
      return lastInsertRowid;
    });
    res.status(201).json(full(woId));
  });

  r.get('/:id', (req, res) => res.json(full(id(req.params.id))));

  r.patch('/:id', (req, res) => {
    const woId = id(req.params.id);
    findEditable(woId);
    updateRow(db, 'work_orders', woId, pick(req.body, PATCH_SPEC, { partial: true }), "updated_at = datetime('now')");
    res.json(full(woId));
  });

  r.delete('/:id', (req, res) => {
    const woId = id(req.params.id);
    findEditable(woId);
    db.prepare('DELETE FROM work_orders WHERE id = ?').run(woId);
    res.status(204).end();
  });

  // Line items. A labor line with no price uses the shop's labor rate per hour.
  r.post('/:id/items', (req, res) => {
    const woId = id(req.params.id);
    findEditable(woId);
    const f = pick(req.body, ITEM_SPEC);
    if (f.unit_price_cents === undefined) {
      if (f.kind !== 'labor') throw badRequest('unit_price_cents is required for parts and fees');
      f.unit_price_cents = getSettings(db).labor_rate_cents;
    }
    db.prepare('INSERT INTO work_order_items (work_order_id, kind, description, part_number, quantity, unit_price_cents) VALUES (?, ?, ?, ?, ?, ?)')
      .run(woId, f.kind, f.description, f.part_number ?? null, f.quantity ?? 1, f.unit_price_cents);
    touch(woId);
    res.status(201).json(full(woId));
  });

  r.patch('/:id/items/:itemId', (req, res) => {
    const woId = id(req.params.id);
    findEditable(woId);
    const itemId = id(req.params.itemId);
    if (!db.prepare('SELECT 1 FROM work_order_items WHERE id = ? AND work_order_id = ?').get(itemId, woId)) throw notFound('Item');
    updateRow(db, 'work_order_items', itemId, pick(req.body, ITEM_SPEC, { partial: true }));
    touch(woId);
    res.json(full(woId));
  });

  r.delete('/:id/items/:itemId', (req, res) => {
    const woId = id(req.params.id);
    findEditable(woId);
    const { changes } = db.prepare('DELETE FROM work_order_items WHERE id = ? AND work_order_id = ?').run(id(req.params.itemId), woId);
    if (!changes) throw notFound('Item');
    touch(woId);
    res.json(full(woId));
  });

  // Trouble codes pulled from the vehicle. Accepts { code } or { codes: [...] }.
  r.post('/:id/codes', (req, res) => {
    const woId = id(req.params.id);
    findEditable(woId);
    const body = req.body ?? {};
    const raw = Array.isArray(body.codes) ? body.codes : [body.code];
    if (raw.length === 0 || raw[0] == null) throw badRequest('code or codes is required');
    const codes = raw.map(normalizeCode);
    const notes = typeof body.notes === 'string' ? body.notes : null;
    const insert = db.prepare('INSERT INTO work_order_codes (work_order_id, code, notes) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET notes = COALESCE(excluded.notes, notes)');
    transaction(db, () => codes.forEach((c) => insert.run(woId, c, notes)));
    touch(woId);
    res.status(201).json(full(woId));
  });

  r.delete('/:id/codes/:code', (req, res) => {
    const woId = id(req.params.id);
    findEditable(woId);
    const { changes } = db.prepare('DELETE FROM work_order_codes WHERE work_order_id = ? AND code = ?').run(woId, normalizeCode(req.params.code));
    if (!changes) throw notFound('Code on this work order');
    res.json(full(woId));
  });

  // Turns a finished job into an invoice. Prices and tax are frozen at this moment.
  r.post('/:id/invoice', (req, res) => {
    const woId = id(req.params.id);
    const wo = findEditable(woId);
    if (wo.status === 'cancelled') throw new HttpError(409, 'A cancelled work order cannot be invoiced');
    const items = db.prepare('SELECT * FROM work_order_items WHERE work_order_id = ? ORDER BY id').all(woId);
    if (items.length === 0) throw badRequest('Add at least one line item before invoicing');
    const t = computeTotals(items, getSettings(db));

    const invoiceId = transaction(db, () => {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO invoices (work_order_id, labor_cents, parts_cents, fees_cents, tax_cents, total_cents) VALUES (?, ?, ?, ?, ?, ?)')
        .run(woId, t.labor_cents, t.parts_cents, t.fees_cents, t.tax_cents, t.total_cents);
      const copy = db.prepare('INSERT INTO invoice_items (invoice_id, kind, description, part_number, quantity, unit_price_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const i of items) copy.run(lastInsertRowid, i.kind, i.description, i.part_number, i.quantity, i.unit_price_cents, lineTotal(i));
      db.prepare("UPDATE work_orders SET status = 'invoiced', updated_at = datetime('now') WHERE id = ?").run(woId);
      return lastInsertRowid;
    });
    res.status(201).json(getInvoice(db, invoiceId));
  });

  return r;
}
