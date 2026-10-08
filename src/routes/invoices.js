import { Router } from 'express';
import { pick, id } from '../validate.js';
import { notFound, HttpError } from '../errors.js';
import { getSettings } from './settings.js';

const PAYMENT_SPEC = {
  amount_cents: { type: 'int', required: true, min: 1 },
  method: { type: 'string', oneOf: ['cash', 'card', 'check', 'other'] },
  note: { type: 'string' },
};

export function getInvoice(db, invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) throw notFound('Invoice');
  const wo = db.prepare('SELECT id, complaint, diagnosis, technician, mileage_in, vehicle_id FROM work_orders WHERE id = ?').get(inv.work_order_id);
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(wo.vehicle_id);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(vehicle.customer_id);
  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(inv.id);
  const payments = db.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY id').all(inv.id);
  const paid = payments.reduce((sum, p) => sum + p.amount_cents, 0);
  const { shop_name, phone, address } = getSettings(db);
  return {
    ...inv,
    shop: { name: shop_name, phone, address },
    work_order: wo,
    vehicle,
    customer,
    items,
    payments,
    paid_cents: paid,
    balance_cents: inv.total_cents - paid,
    status: paid >= inv.total_cents ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
  };
}

export default function invoicesRouter(db) {
  const r = Router();

  // ?unpaid=true lists invoices with a balance due.
  r.get('/', (req, res) => {
    const rows = db.prepare(
      `SELECT i.*, COALESCE(SUM(p.amount_cents), 0) AS paid_cents,
              c.first_name, c.last_name, v.year, v.make, v.model
       FROM invoices i
       JOIN work_orders wo ON wo.id = i.work_order_id
       JOIN vehicles v ON v.id = wo.vehicle_id
       JOIN customers c ON c.id = v.customer_id
       LEFT JOIN payments p ON p.invoice_id = i.id
       GROUP BY i.id
       ${req.query.unpaid === 'true' ? 'HAVING paid_cents < i.total_cents' : ''}
       ORDER BY i.id DESC LIMIT 200`
    ).all();
    res.json(rows.map((r) => ({ ...r, balance_cents: r.total_cents - r.paid_cents })));
  });

  r.get('/:id', (req, res) => res.json(getInvoice(db, id(req.params.id))));

  r.post('/:id/payments', (req, res) => {
    const inv = getInvoice(db, id(req.params.id));
    const f = pick(req.body, PAYMENT_SPEC);
    if (f.amount_cents > inv.balance_cents) {
      throw new HttpError(422, `Payment is more than the balance due (${inv.balance_cents} cents)`);
    }
    db.prepare('INSERT INTO payments (invoice_id, amount_cents, method, note) VALUES (?, ?, ?, ?)')
      .run(inv.id, f.amount_cents, f.method ?? 'card', f.note ?? null);
    res.status(201).json(getInvoice(db, inv.id));
  });

  return r;
}
