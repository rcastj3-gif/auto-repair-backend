// Free US government vehicle data from NHTSA. No API key or account required.
//   VIN decoding:  https://vpic.nhtsa.dot.gov/api/
//   Recalls:       https://www.nhtsa.gov/nhtsa-datasets-and-apis
import { HttpError, badRequest } from '../errors.js';

const VPIC_BASE = process.env.NHTSA_VPIC_URL || 'https://vpic.nhtsa.dot.gov/api';
const RECALLS_BASE = process.env.NHTSA_API_URL || 'https://api.nhtsa.gov';
const TIMEOUT_MS = 10_000;

// 17 characters; I, O and Q are never used in VINs.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

export function normalizeVin(vin) {
  const v = String(vin ?? '').trim().toUpperCase();
  if (!VIN_RE.test(v)) throw badRequest('VIN must be 17 characters (letters I, O and Q are not allowed)');
  return v;
}

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new HttpError(502, 'Could not reach NHTSA. Check your internet connection and try again.');
  }
  if (!res.ok) throw new HttpError(502, `NHTSA returned an error (${res.status})`);
  return res.json();
}

const clean = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

export async function decodeVin(rawVin) {
  const vin = normalizeVin(rawVin);
  const data = await getJson(`${VPIC_BASE}/vehicles/DecodeVinValues/${vin}?format=json`);
  const r = data?.Results?.[0];
  if (!r) throw new HttpError(502, 'Unexpected response from NHTSA');

  const make = clean(r.Make);
  if (!make) throw new HttpError(422, 'NHTSA could not decode this VIN. Double-check it for typos.');

  const displacement = clean(r.DisplacementL);
  const cylinders = clean(r.EngineCylinders);
  const engineParts = [
    displacement && `${Number(displacement).toFixed(1)}L`,
    cylinders && `${cylinders}-cyl`,
    clean(r.FuelTypePrimary),
  ].filter(Boolean);

  return {
    vin,
    year: clean(r.ModelYear) ? Number(r.ModelYear) : null,
    make: titleCase(make),
    model: clean(r.Model),
    trim: clean(r.Trim),
    engine: engineParts.length ? engineParts.join(' ') : null,
    body_class: clean(r.BodyClass),
    drive_type: clean(r.DriveType),
    transmission: clean(r.TransmissionStyle),
    plant_country: clean(r.PlantCountry),
    // NHTSA flags partial decodes (e.g. a bad check digit) here; surface it rather than hide it.
    warning: clean(r.ErrorCode) && r.ErrorCode !== '0' ? clean(r.ErrorText) : null,
  };
}

export async function getRecalls({ make, model, year }) {
  if (!make || !model || !year) throw badRequest('make, model and year are required');
  const qs = new URLSearchParams({ make, model, modelYear: String(year) });
  const data = await getJson(`${RECALLS_BASE}/recalls/recallsByVehicle?${qs}`);
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map((r) => ({
    campaign_number: r.NHTSACampaignNumber,
    report_date: r.ReportReceivedDate,
    component: r.Component,
    summary: r.Summary,
    consequence: r.Consequence,
    remedy: r.Remedy,
    park_it: Boolean(r.parkIt),
    park_outside: Boolean(r.parkOutSide),
  }));
}

function titleCase(s) {
  // NHTSA returns makes in caps ("HONDA"); keep short all-caps brands like BMW and GMC as-is.
  if (s.length <= 3) return s;
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}
