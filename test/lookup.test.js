import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fakeNhtsa, HONDA_VIN } from './helpers.js';

test('trouble code lookup', async () => {
  const api = await startServer();
  try {
    const p0420 = await api.get('/api/codes/p0420');
    assert.equal(p0420.body.found, true);
    assert.equal(p0420.body.system, 'Powertrain');
    assert.equal(p0420.body.type, 'generic');
    assert.ok(p0420.body.common_causes.length > 0);

    const unknown = await api.get('/api/codes/B1234');
    assert.equal(unknown.body.found, false);
    assert.equal(unknown.body.system, 'Body');
    assert.equal(unknown.body.type, 'manufacturer');

    assert.equal((await api.get('/api/codes/hello')).status, 400);

    const lean = await api.get('/api/codes?q=lean');
    assert.ok(lean.body.some((c) => c.code === 'P0171'));
    const misfires = await api.get('/api/codes?q=P030');
    assert.equal(misfires.body.length, 9);
  } finally {
    await api.close();
  }
});

test('VIN decode and recall lookups', async () => {
  const api = await startServer({ nhtsa: fakeNhtsa });
  try {
    const vin = await api.get(`/api/vin/${HONDA_VIN}`);
    assert.equal(vin.status, 200);
    assert.equal(vin.body.make, 'Honda');
    assert.equal(vin.body.warning, null);

    assert.equal((await api.get('/api/recalls?make=honda&model=accord&year=2003')).body.length, 1);
    assert.equal((await api.get('/api/recalls?make=honda')).status, 400);
  } finally {
    await api.close();
  }
});

test('NHTSA outage gives a clear error, not a crash', async () => {
  const api = await startServer();
  try {
    const res = await api.get(`/api/vin/${HONDA_VIN}`);
    assert.equal(res.status, 502);
    assert.match(res.body.error, /Could not reach NHTSA/);
  } finally {
    await api.close();
  }
});

test('serves the web app and keeps API 404s as JSON', async () => {
  const api = await startServer();
  try {
    const res = await fetch(`${api.base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /<main id="app"/);
    const missing = await api.get('/api/nope');
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error, 'Not found');
  } finally {
    await api.close();
  }
});
