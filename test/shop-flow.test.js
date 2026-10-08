import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fakeNhtsa, HONDA_VIN } from './helpers.js';

let api;
before(async () => { api = await startServer({ nhtsa: fakeNhtsa }); });
after(() => api.close());

test('full job: customer, VIN-decoded vehicle, work order, invoice, payments', async () => {
  await api.patch('/api/settings', { shop_name: 'Main St Auto', labor_rate_cents: 15000, tax_rate: 8.25 });

  const customer = await api.post('/api/customers', { first_name: 'Maria', last_name: 'Lopez', phone: '555-0100' });
  assert.equal(customer.status, 201);

  const vehicle = await api.post('/api/vehicles', { customer_id: customer.body.id, vin: HONDA_VIN.toLowerCase(), mileage: 150000 });
  assert.equal(vehicle.status, 201);
  assert.equal(vehicle.body.vin, HONDA_VIN);
  assert.equal(vehicle.body.year, 2003);
  assert.equal(vehicle.body.make, 'Honda');
  assert.equal(vehicle.body.model, 'Accord');
  assert.equal(vehicle.body.engine, '3.0L 6-cyl Gasoline');

  const recalls = await api.get(`/api/vehicles/${vehicle.body.id}/recalls`);
  assert.equal(recalls.body.count, 1);
  assert.equal(recalls.body.recalls[0].campaign_number, '04V176000');

  const wo = await api.post('/api/work-orders', { vehicle_id: vehicle.body.id, complaint: 'Check engine light, rough idle', mileage_in: 151200 });
  assert.equal(wo.status, 201);
  assert.equal(wo.body.status, 'estimate');
  assert.equal((await api.get(`/api/vehicles/${vehicle.body.id}`)).body.mileage, 151200);

  const withCodes = await api.post(`/api/work-orders/${wo.body.id}/codes`, { codes: ['p0171', 'P1456'] });
  assert.deepEqual(withCodes.body.codes.map((c) => c.code), ['P0171', 'P1456']);
  assert.equal(withCodes.body.codes[0].description, 'System Too Lean (Bank 1)');
  assert.equal(withCodes.body.codes[1].found, false);
  assert.equal(withCodes.body.codes[1].type, 'manufacturer');

  // Labor with no price uses the shop rate: 1.5 h x $150 = $225.
  await api.post(`/api/work-orders/${wo.body.id}/items`, { kind: 'labor', description: 'Diagnose and replace intake gasket', quantity: 1.5 });
  await api.post(`/api/work-orders/${wo.body.id}/items`, { kind: 'part', description: 'Intake manifold gasket', part_number: 'IG-123', quantity: 2, unit_price_cents: 2499 });
  const priced = await api.post(`/api/work-orders/${wo.body.id}/items`, { kind: 'fee', description: 'Shop supplies', unit_price_cents: 1000 });
  // Tax on parts + fees only (labor not taxed by default): (4998 + 1000) * 0.0825 = 494.835 -> 495
  assert.deepEqual(priced.body.totals, { labor_cents: 22500, parts_cents: 4998, fees_cents: 1000, tax_cents: 495, total_cents: 28993 });

  await api.patch(`/api/work-orders/${wo.body.id}`, { status: 'completed', diagnosis: 'Intake gasket vacuum leak' });
  const invoice = await api.post(`/api/work-orders/${wo.body.id}/invoice`);
  assert.equal(invoice.status, 201);
  assert.equal(invoice.body.total_cents, 28993);
  assert.equal(invoice.body.items.length, 3);
  assert.equal(invoice.body.status, 'unpaid');
  assert.equal(invoice.body.shop.name, 'Main St Auto');

  // Invoiced work orders are locked.
  const locked = await api.post(`/api/work-orders/${wo.body.id}/items`, { kind: 'fee', description: 'x', unit_price_cents: 1 });
  assert.equal(locked.status, 409);
  assert.equal((await api.post(`/api/work-orders/${wo.body.id}/invoice`)).status, 409);

  const partial = await api.post(`/api/invoices/${invoice.body.id}/payments`, { amount_cents: 10000, method: 'cash' });
  assert.equal(partial.body.status, 'partial');
  assert.equal(partial.body.balance_cents, 18993);
  assert.equal((await api.get('/api/invoices?unpaid=true')).body.length, 1);

  assert.equal((await api.post(`/api/invoices/${invoice.body.id}/payments`, { amount_cents: 99999 })).status, 422);
  const paid = await api.post(`/api/invoices/${invoice.body.id}/payments`, { amount_cents: 18993 });
  assert.equal(paid.body.status, 'paid');
  assert.equal((await api.get('/api/invoices?unpaid=true')).body.length, 0);
});

test('customer search and validation', async () => {
  await api.post('/api/customers', { first_name: 'Dave', last_name: 'Kim', email: 'dave@example.com' });
  assert.equal((await api.get('/api/customers?q=dave')).body.length, 1);
  assert.equal((await api.get('/api/customers?q=Dave Kim')).body.length, 1);

  const missing = await api.post('/api/customers', { first_name: 'NoLast' });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /last_name is required/);

  assert.equal((await api.get('/api/customers/9999')).status, 404);
  assert.equal((await api.get('/api/customers/abc')).status, 400);
});

test('vehicle validation', async () => {
  const c = await api.post('/api/customers', { first_name: 'A', last_name: 'B' });
  const badVin = await api.post('/api/vehicles', { customer_id: c.body.id, vin: '1HGCM82633A00435O' });
  assert.equal(badVin.status, 400);
  assert.equal((await api.post('/api/vehicles', { customer_id: 9999, year: 2020, make: 'Ford', model: 'F-150' })).status, 400);

  // Manual entry works without any VIN lookup.
  const manual = await api.post('/api/vehicles', { customer_id: c.body.id, year: 2018, make: 'Ford', model: 'F-150' });
  assert.equal(manual.status, 201);
});

test('work order status rules', async () => {
  const c = await api.post('/api/customers', { first_name: 'S', last_name: 'T' });
  const v = await api.post('/api/vehicles', { customer_id: c.body.id, year: 2015, make: 'Toyota', model: 'Camry' });
  const wo = await api.post('/api/work-orders', { vehicle_id: v.body.id });

  assert.equal((await api.patch(`/api/work-orders/${wo.body.id}`, { status: 'invoiced' })).status, 400);
  assert.equal((await api.post(`/api/work-orders/${wo.body.id}/invoice`)).status, 400, 'no items yet');

  await api.patch(`/api/work-orders/${wo.body.id}`, { status: 'cancelled' });
  assert.equal((await api.get('/api/work-orders?status=cancelled')).body.length, 1);
  assert.equal((await api.get('/api/work-orders?status=bogus')).status, 400);
});
