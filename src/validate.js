import { badRequest } from './errors.js';

// Picks the allowed fields out of a request body, enforcing required ones and simple types.
// spec: { field: { type: 'string'|'int'|'number'|'bool', required?: true, oneOf?: [...] } }
export function pick(body, spec, { partial = false } = {}) {
  if (body == null || typeof body !== 'object') throw badRequest('Request body must be a JSON object');
  const out = {};
  for (const [field, rule] of Object.entries(spec)) {
    const value = body[field];
    if (value === undefined || value === '') {
      if (rule.required && !partial) throw badRequest(`${field} is required`);
      continue;
    }
    if (value === null) {
      if (rule.required) throw badRequest(`${field} cannot be null`);
      out[field] = null;
      continue;
    }
    out[field] = coerce(field, value, rule);
  }
  return out;
}

function coerce(field, value, rule) {
  let v = value;
  switch (rule.type) {
    case 'string':
      if (typeof v !== 'string') throw badRequest(`${field} must be a string`);
      v = v.trim();
      break;
    case 'int':
      v = Number(v);
      if (!Number.isInteger(v)) throw badRequest(`${field} must be a whole number`);
      if (rule.min !== undefined && v < rule.min) throw badRequest(`${field} must be at least ${rule.min}`);
      break;
    case 'number':
      v = Number(v);
      if (!Number.isFinite(v)) throw badRequest(`${field} must be a number`);
      if (rule.min !== undefined && v < rule.min) throw badRequest(`${field} must be at least ${rule.min}`);
      break;
    case 'bool':
      if (typeof v !== 'boolean') throw badRequest(`${field} must be true or false`);
      v = v ? 1 : 0;
      break;
  }
  if (rule.oneOf && !rule.oneOf.includes(v)) throw badRequest(`${field} must be one of: ${rule.oneOf.join(', ')}`);
  return v;
}

export function id(param) {
  const n = Number(param);
  if (!Number.isInteger(n) || n < 1) throw badRequest('Invalid id');
  return n;
}

// Builds "UPDATE table SET a = ?, b = ? WHERE id = ?" from a picked object.
export function updateRow(db, table, rowId, fields, extraSet = '') {
  const keys = Object.keys(fields);
  if (keys.length === 0 && !extraSet) throw badRequest('Nothing to update');
  const sets = keys.map((k) => `${k} = ?`);
  if (extraSet) sets.push(extraSet);
  return db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...Object.values(fields), rowId);
}
