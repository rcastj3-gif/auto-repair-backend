import { openDatabase } from '../src/db.js';
import { createApp } from '../src/app.js';

const realFetch = globalThis.fetch;

// Starts the app on a random port with a fresh in-memory database.
// nhtsa: optional (url) => responseBody, used to fake the NHTSA services.
export async function startServer({ nhtsa } = {}) {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('nhtsa')) {
      if (!nhtsa) throw new Error('network disabled in tests');
      const body = await nhtsa(u);
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, opts);
  };

  const db = openDatabase(':memory:');
  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, body) => {
    const res = await realFetch(base + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  return {
    base,
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    patch: (p, b) => call('PATCH', p, b),
    del: (p) => call('DELETE', p),
    close: () => {
      globalThis.fetch = realFetch;
      return new Promise((r) => server.close(r));
    },
  };
}

export const HONDA_VIN = '1HGCM82633A004352';

export const fakeNhtsa = (url) => {
  if (url.includes('DecodeVinValues')) {
    return {
      Results: [{
        ModelYear: '2003', Make: 'HONDA', Model: 'Accord', Trim: 'EX-V6', DisplacementL: '3.0',
        EngineCylinders: '6', FuelTypePrimary: 'Gasoline', BodyClass: 'Coupe', ErrorCode: '0', ErrorText: '',
      }],
    };
  }
  if (url.includes('recallsByVehicle')) {
    return {
      results: [{
        NHTSACampaignNumber: '04V176000', ReportReceivedDate: '13/04/2004', Component: 'POWER TRAIN',
        Summary: 'Transmission may fail.', Consequence: 'Crash risk.', Remedy: 'Dealer will repair.', parkIt: false,
      }],
    };
  }
  throw new Error(`unexpected NHTSA url ${url}`);
};
