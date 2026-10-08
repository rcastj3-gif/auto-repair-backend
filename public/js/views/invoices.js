import { api } from '../api.js';
import {
  html, field, selectField, openForm, formValues, toast, money, dollarsToCents, centsToDollars,
  personName, vehicleName, miles, payBadge, date, dateTime,
} from '../ui.js';
import { go, refresh } from '../app.js';

export async function invoicesView(_params, query) {
  const unpaidOnly = query.get('unpaid') === 'true';
  const rows = await api.get(`/invoices${unpaidOnly ? '?unpaid=true' : ''}`);
  const status = (i) => (i.paid_cents >= i.total_cents ? 'paid' : i.paid_cents > 0 ? 'partial' : 'unpaid');
  return {
    html: html`
      <div class="page-head">
        <h1>Invoices</h1>
        <div class="tabs" role="tablist">
          <a role="tab" href="#/invoices" class="${unpaidOnly ? '' : 'active'}">All</a>
          <a role="tab" href="#/invoices?unpaid=true" class="${unpaidOnly ? 'active' : ''}">Balance due</a>
        </div>
      </div>
      <div class="card table-wrap">
        <table>
          <thead><tr><th>#</th><th>Date</th><th>Customer</th><th class="hide-sm">Vehicle</th><th class="num">Total</th><th class="num">Balance</th><th></th></tr></thead>
          <tbody>
            ${rows.length ? rows.map((i) => html`
              <tr class="click-row" data-href="/invoices/${i.id}">
                <td><a href="#/invoices/${i.id}">${i.id}</a></td>
                <td>${date(i.created_at)}</td>
                <td>${i.first_name} ${i.last_name}</td>
                <td class="hide-sm">${vehicleName(i)}</td>
                <td class="num">${money(i.total_cents)}</td>
                <td class="num">${money(i.balance_cents)}</td>
                <td>${payBadge(status(i))}</td>
              </tr>`) : html`<tr><td colspan="7" class="empty">${unpaidOnly ? 'Nothing owed. Every invoice is paid.' : 'No invoices yet.'}</td></tr>`}
          </tbody>
        </table>
      </div>`,
    bind(root) {
      root.querySelectorAll('.click-row').forEach((tr) => tr.addEventListener('click', () => go(tr.dataset.href)));
    },
  };
}

const METHODS = [['card', 'Card'], ['cash', 'Cash'], ['check', 'Check'], ['other', 'Other']];

export async function invoiceView([id]) {
  const inv = await api.get(`/invoices/${id}`);
  const { shop, customer: c, vehicle: v, work_order: wo } = inv;
  return {
    html: html`
      <div class="page-head no-print">
        <p class="crumbs"><a href="#/invoices">Invoices</a> / <a href="#/work-orders/${wo.id}">Work order #${wo.id}</a></p>
        <div class="actions">
          ${inv.balance_cents > 0 ? html`<button class="btn primary" data-pay>Record payment</button>` : ''}
          <button class="btn" data-print>Print</button>
        </div>
      </div>

      <article class="card invoice">
        <header class="inv-head">
          <div>
            <h1 class="inv-shop">${shop.name}</h1>
            ${shop.address ? html`<div>${shop.address}</div>` : ''}
            ${shop.phone ? html`<div>${shop.phone}</div>` : ''}
          </div>
          <div class="inv-meta">
            <div class="inv-title">Invoice #${inv.id}</div>
            <div>${date(inv.created_at)}</div>
            <div class="no-print">${payBadge(inv.status)}</div>
          </div>
        </header>

        <section class="inv-parties">
          <div><span class="label">Bill to</span>
            <strong>${personName(c)}</strong>
            ${c.address ? html`<div>${c.address}</div>` : ''}
            ${c.phone ? html`<div>${c.phone}</div>` : ''}
            ${c.email ? html`<div>${c.email}</div>` : ''}
          </div>
          <div><span class="label">Vehicle</span>
            <strong>${vehicleName(v)}</strong>${v.trim ? ` ${v.trim}` : ''}
            ${v.vin ? html`<div class="mono">VIN ${v.vin}</div>` : ''}
            ${v.license_plate ? html`<div>Plate ${v.license_plate}</div>` : ''}
            ${wo.mileage_in ? html`<div>Mileage in ${miles(wo.mileage_in)}</div>` : ''}
          </div>
        </section>

        ${wo.complaint || wo.diagnosis ? html`
          <section class="inv-notes">
            ${wo.complaint ? html`<div><span class="label">Concern</span><p class="pre">${wo.complaint}</p></div>` : ''}
            ${wo.diagnosis ? html`<div><span class="label">Work performed</span><p class="pre">${wo.diagnosis}</p></div>` : ''}
          </section>` : ''}

        <table class="items">
          <thead><tr><th>Description</th><th class="num">Qty</th><th class="num hide-sm">Price</th><th class="num">Amount</th></tr></thead>
          <tbody>${inv.items.map((i) => html`
            <tr>
              <td>${i.description}${i.part_number ? html` <span class="muted small mono">${i.part_number}</span>` : ''}</td>
              <td class="num">${i.quantity}${i.kind === 'labor' ? ' h' : ''}</td>
              <td class="num hide-sm">${money(i.unit_price_cents)}</td>
              <td class="num">${money(i.line_total_cents)}</td>
            </tr>`)}
          </tbody>
        </table>

        <dl class="totals">
          <div><dt>Labor</dt><dd>${money(inv.labor_cents)}</dd></div>
          <div><dt>Parts</dt><dd>${money(inv.parts_cents)}</dd></div>
          ${inv.fees_cents ? html`<div><dt>Fees</dt><dd>${money(inv.fees_cents)}</dd></div>` : ''}
          <div><dt>Tax</dt><dd>${money(inv.tax_cents)}</dd></div>
          <div class="grand"><dt>Total</dt><dd>${money(inv.total_cents)}</dd></div>
          ${inv.payments.map((p) => html`<div class="paid"><dt>Paid (${p.method}) ${date(p.paid_at)}</dt><dd>−${money(p.amount_cents)}</dd></div>`)}
          ${inv.payments.length ? html`<div class="grand"><dt>Balance due</dt><dd>${money(inv.balance_cents)}</dd></div>` : ''}
        </dl>

        <p class="inv-thanks">Thank you for your business.</p>
      </article>

      ${inv.payments.length ? html`
        <div class="section-head no-print"><h2>Payments</h2></div>
        <div class="card list no-print">${inv.payments.map((p) => html`
          <div class="row-link static"><strong>${money(p.amount_cents)}</strong><span class="muted">${p.method}</span>
            <span class="grow muted">${p.note ?? ''}</span><span class="muted">${dateTime(p.paid_at)}</span></div>`)}
        </div>` : ''}`,
    bind(root) {
      root.querySelector('[data-print]').addEventListener('click', () => window.print());
      root.querySelector('[data-pay]')?.addEventListener('click', () => openForm({
        title: 'Record payment',
        submitLabel: 'Record payment',
        body: html`
          <div class="grid-2">
            ${field('Amount ($)', 'amount', { type: 'number', step: '0.01', min: 0.01, value: centsToDollars(inv.balance_cents), required: true, hint: `Balance due: ${money(inv.balance_cents)}` })}
            ${selectField('Method', 'method', METHODS, 'card')}
          </div>
          ${field('Note', 'note', { placeholder: 'e.g. check number' })}`,
        onSubmit: async (form) => {
          const v = formValues(form);
          await api.post(`/invoices/${inv.id}/payments`, { amount_cents: dollarsToCents(v.amount), method: v.method, note: v.note });
          toast('Payment recorded');
          refresh();
        },
      }));
    },
  };
}
