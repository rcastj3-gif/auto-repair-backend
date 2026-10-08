// All money is integer cents to avoid floating-point rounding errors.

export function lineTotal(item) {
  return Math.round(item.quantity * item.unit_price_cents);
}

export function computeTotals(items, settings) {
  let labor = 0;
  let parts = 0;
  let fees = 0;
  for (const item of items) {
    const t = lineTotal(item);
    if (item.kind === 'labor') labor += t;
    else if (item.kind === 'part') parts += t;
    else fees += t;
  }
  const taxable = parts + fees + (settings.tax_labor ? labor : 0);
  const tax = Math.round(taxable * settings.tax_rate);
  return {
    labor_cents: labor,
    parts_cents: parts,
    fees_cents: fees,
    tax_cents: tax,
    total_cents: labor + parts + fees + tax,
  };
}
