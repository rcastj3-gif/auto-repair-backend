import { Router } from 'express';
import { pick, id, updateRow } from '../validate.js';
import { notFound } from '../errors.js';

const SPEC = {
  first_name: { type: 'string', required: true },
  last_name: { type: 'string', required: true },
  phone: { type: 'string' },
  email: { type: 'string' },
  address: { type: 'string' },
  notes: { type: 'string' },
};

export default function customersRouter(db) {
  const r = Router();
  const find = (customerId) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    if (!c) throw notFound('Customer');
    return c;
  };

  // ?q= searches name, phone and email.
  r.get('/', (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const rows = q
      ? db.prepare(
          `SELECT * FROM customers
           WHERE first_name || ' ' || last_name LIKE ?1 OR phone LIKE ?1 OR email LIKE ?1
           ORDER BY last_name, first_name LIMIT 100`
        ).all(`%${q}%`)
      : db.prepare('SELECT * FROM customers ORDER BY last_name, first_name LIMIT 100').all();
    res.json(rows);
  });

  r.post('/', (req, res) => {
    const f = pick(req.body, SPEC);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO customers (first_name, last_name, phone, email, address, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(f.first_name, f.last_name, f.phone ?? null, f.email ?? null, f.address ?? null, f.notes ?? null);
    res.status(201).json(find(lastInsertRowid));
  });

  r.get('/:id', (req, res) => {
    const customer = find(id(req.params.id));
    const vehicles = db.prepare('SELECT * FROM vehicles WHERE customer_id = ? ORDER BY year DESC').all(customer.id);
    res.json({ ...customer, vehicles });
  });

  r.patch('/:id', (req, res) => {
    const customerId = id(req.params.id);
    find(customerId);
    updateRow(db, 'customers', customerId, pick(req.body, SPEC, { partial: true }));
    res.json(find(customerId));
  });

  r.delete('/:id', (req, res) => {
    const customerId = id(req.params.id);
    find(customerId);
    db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
    res.status(204).end();
  });

  return r;
}
