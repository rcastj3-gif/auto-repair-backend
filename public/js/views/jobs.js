import { api } from '../api.js';
import {
  html, raw, field, selectField, openForm, formValues, formValuesWithNulls, toast, busy, confirmAction,
  money, dollarsToCents, centsToDollars, personName, vehicleName, miles, statusBadge, STATUS_LABELS, dateTime, date,
} from '../ui.js';
import { go, refresh } from '../app.js';
import { newCustomer } from './customers.js';

const BOARD = ['estimate', 'approved', 'in_progress', 'completed'];

// ---- Jobs board (home) ----

export async function jobsView() {
  const [orders, unpaid] = await Promise.all([
    api.get(`/work-orders?status=${BOARD.join(',')}`),
    api.get('/invoices?unpaid=true'),
  ]);
  const owed = unpaid.reduce((s, i) => s + i.balance_cents, 0);
  return {
    html: html`
      <div class="page-head">
        <h1>Jobs</h1>
        <div class="actions">
          <a class="btn" href="#/customers">Find customer</a>
          <button class="btn primary" data-new-customer>+ New customer</button>
        </div>
      </div>
      <div class="stats">
        ${BOARD.map((s) => html`<div class="stat"><span class="stat-num">${orders.filter((o) => o.status === s).length}</span><span class="label">${STATUS_LABELS[s]}</span></div>`)}
        <a class="stat" href="#/invoices?unpaid=true"><span class="stat-num">${money(owed)}</span><span class="label">${unpaid.length} unpaid invoice${unpaid.length === 1 ? '' : 's'}</span></a>
      </div>
      ${orders.length === 0 ? html`
        <div class="card empty-state">
          <h2>No open jobs</h2>
          <p>To start a job, find or add the customer, add their vehicle, then press <strong>New job</strong>.</p>
          <button class="btn primary" data-new-customer>+ New customer</button>
        </div>` : html`
        <div class="board">
          ${BOARD.map((s) => {
            const col = orders.filter((o) => o.status === s);
            return html`
              <section class="column">
                <h2 class="column-head">${STATUS_LABELS[s]} <span class="count">${col.length}</span></h2>
                ${col.map((o) => html`
                  <a class="job-card" href="#/work-orders/${o.id}">
                    <div class="job-top"><strong>${vehicleName(o)}</strong><span class="muted">#${o.id}</span></div>
                    <div>${o.first_name} ${o.last_name}</div>
                    ${o.complaint ? html`<p class="muted clamp">${o.complaint}</p>` : ''}
                    <div class="muted small">${o.technician ? `${o.technician} · ` : ''}Updated ${date(o.updated_at)}</div>
                  </a>`)}
                ${col.length === 0 ? html`<p class="empty small">None</p>` : ''}
              </section>`;
          })}
        </div>`}`,
    bind(root) {
      root.querySelectorAll('[data-new-customer]').forEach((b) => b.addEventListener('click', newCustomer));
    },
  };
}

// ---- Work order detail ----

const KIND_LABELS = { labor: 'Labor', part: 'Part', fee: 'Fee' };

function itemFields(item = {}, laborRate) {
  return html`
    <div class="grid-2">
      ${selectField('Type', 'kind', [['labor', 'Labor'], ['part', 'Part'], ['fee', 'Fee']], item.kind ?? 'labor')}
      ${field('Part number', 'part_number', { value: item.part_number })}
    </div>
    ${field('Description', 'description', { value: item.description, required: true })}
    <div class="grid-2">
      ${field('Quantity / hours', 'quantity', { type: 'number', step: '0.1', min: 0, value: item.quantity ?? 1 })}
      ${field('Price each ($)', 'price', {
        type: 'number', step: '0.01', min: 0, value: centsToDollars(item.unit_price_cents),
        hint: `Leave blank on labor to use the shop rate (${money(laborRate)}/hr)`,
      })}
    </div>`;
}

const itemBody = (form) => {
  const v = formValues(form);
  const body = { kind: v.kind, description: v.description, part_number: v.part_number ?? null, quantity: v.quantity ?? 1 };
  const cents = dollarsToCents(v.price);
  if (cents !== undefined) body.unit_price_cents = cents;
  return body;
};

export async function workOrderView([id]) {
  const [wo, settings] = await Promise.all([api.get(`/work-orders/${id}`), api.get('/settings')]);
  const locked = wo.status === 'invoiced';
  const t = wo.totals;
  const statusOptions = Object.entries(STATUS_LABELS).filter(([s]) => s !== 'invoiced');

  return {
    html: html`
      <p class="crumbs"><a href="#/">Jobs</a> / <a href="#/vehicles/${wo.vehicle.id}">${vehicleName(wo.vehicle)}</a> /</p>
      <div class="page-head">
        <h1>Work order #${wo.id} ${statusBadge(wo.status)}</h1>
        <div class="actions">
          ${locked
            ? html`<a class="btn primary" href="#/invoices/${wo.invoice_id}">View invoice</a>`
            : html`
              <label class="inline-select">Status
                <select data-status>${statusOptions.map(([s, label]) => html`<option value="${s}" ${s === wo.status ? raw('selected') : ''}>${label}</option>`)}</select>
              </label>
              <button class="btn primary" data-invoice ${wo.status === 'cancelled' ? raw('disabled') : ''}>Create invoice</button>`}
        </div>
      </div>

      <div class="card info-grid">
        <div><span class="label">Customer</span><a href="#/customers/${wo.customer.id}">${personName(wo.customer)}</a>
          ${wo.customer.phone ? html`<br><a href="tel:${wo.customer.phone}">${wo.customer.phone}</a>` : ''}</div>
        <div><span class="label">Vehicle</span><a href="#/vehicles/${wo.vehicle.id}">${vehicleName(wo.vehicle)}</a>
          ${wo.vehicle.engine ? html`<br><span class="muted">${wo.vehicle.engine}</span>` : ''}</div>
        <div><span class="label">VIN</span><span class="mono">${wo.vehicle.vin || '—'}</span></div>
        <div><span class="label">Mileage in</span>${miles(wo.mileage_in) || '—'}</div>
        <div><span class="label">Opened</span>${dateTime(wo.created_at)}</div>
      </div>

      <form class="card notes-form" data-notes>
        ${field("Customer's concern", 'complaint', { type: 'textarea', value: wo.complaint, attrs: locked ? 'readonly' : '' })}
        ${field('Diagnosis / work performed', 'diagnosis', { type: 'textarea', value: wo.diagnosis, attrs: locked ? 'readonly' : '' })}
        <div class="grid-2">
          ${field('Technician', 'technician', { value: wo.technician, attrs: locked ? 'readonly' : '' })}
          ${field('Mileage in', 'mileage_in', { type: 'number', min: 0, value: wo.mileage_in, attrs: locked ? 'readonly' : '' })}
        </div>
        ${locked ? '' : html`<div class="form-actions"><button class="btn" type="submit">Save notes</button></div>`}
      </form>

      <div class="section-head"><h2>Trouble codes</h2></div>
      <div class="card">
        ${locked ? '' : html`
          <form class="code-add" data-add-codes>
            <input name="codes" placeholder="Enter codes from the scan tool, e.g. P0171, P0300" aria-label="Trouble codes" autocapitalize="characters">
            <button class="btn" type="submit">Add codes</button>
          </form>`}
        ${wo.codes.length ? html`<ul class="codes">${wo.codes.map((c) => html`
          <li class="code">
            <div class="code-head">
              <span class="code-id mono">${c.code}</span>
              <strong class="grow">${c.description ?? 'Not in the built-in list'}</strong>
              <span class="badge">${c.system}${c.type === 'manufacturer' ? ' · make-specific' : ''}</span>
              ${locked ? '' : html`<button class="icon-btn" data-remove-code="${c.code}" aria-label="Remove ${c.code}">✕</button>`}
            </div>
            ${c.common_causes.length
              ? html`<p class="muted small"><strong>Common causes:</strong> ${c.common_causes.join(' · ')}</p>`
              : html`<p class="muted small">${c.note}</p>`}
          </li>`)}</ul>` : html`<p class="empty">No codes recorded.</p>`}
      </div>

      <div class="section-head">
        <h2>Labor, parts &amp; fees</h2>
        ${locked ? '' : html`<button class="btn primary" data-add-item>+ Add line</button>`}
      </div>
      <div class="card table-wrap">
        <table class="items">
          <thead><tr><th class="hide-sm">Type</th><th>Description</th><th class="num">Qty</th><th class="num hide-sm">Price</th><th class="num">Total</th>${locked ? '' : html`<th></th>`}</tr></thead>
          <tbody>
            ${wo.items.length ? wo.items.map((i) => html`
              <tr>
                <td class="hide-sm"><span class="kind kind-${i.kind}">${KIND_LABELS[i.kind]}</span></td>
                <td>${i.description}${i.part_number ? html`<div class="muted small mono">${i.part_number}</div>` : ''}</td>
                <td class="num">${i.quantity}${i.kind === 'labor' ? ' h' : ''}</td>
                <td class="num hide-sm">${money(i.unit_price_cents)}</td>
                <td class="num">${money(i.line_total_cents)}</td>
                ${locked ? '' : html`<td class="row-actions">
                  <button class="icon-btn" data-edit-item="${i.id}" aria-label="Edit">✎</button>
                  <button class="icon-btn" data-delete-item="${i.id}" aria-label="Delete">✕</button></td>`}
              </tr>`) : html`<tr><td colspan="6" class="empty">No lines yet. Add labor and parts to build the estimate.</td></tr>`}
          </tbody>
        </table>
        <dl class="totals">
          <div><dt>Labor</dt><dd>${money(t.labor_cents)}</dd></div>
          <div><dt>Parts</dt><dd>${money(t.parts_cents)}</dd></div>
          ${t.fees_cents ? html`<div><dt>Fees</dt><dd>${money(t.fees_cents)}</dd></div>` : ''}
          <div><dt>Tax</dt><dd>${money(t.tax_cents)}</dd></div>
          <div class="grand"><dt>Total</dt><dd>${money(t.total_cents)}</dd></div>
        </dl>
      </div>

      ${locked ? '' : html`<p class="danger-zone"><button class="btn ghost danger-text" data-delete>Delete work order</button></p>`}`,

    bind(root) {
      if (locked) return;

      root.querySelector('[data-status]').addEventListener('change', (e) => busy(e.target, async () => {
        await api.patch(`/work-orders/${wo.id}`, { status: e.target.value });
        toast(`Status: ${STATUS_LABELS[e.target.value]}`);
        refresh();
      }));

      root.querySelector('[data-notes]').addEventListener('submit', (e) => {
        e.preventDefault();
        busy(e.submitter, async () => {
          await api.patch(`/work-orders/${wo.id}`, formValuesWithNulls(e.target));
          toast('Notes saved');
        });
      });

      root.querySelector('[data-add-codes]').addEventListener('submit', (e) => {
        e.preventDefault();
        const codes = e.target.elements.codes.value.split(/[\s,;]+/).filter(Boolean);
        if (!codes.length) return;
        busy(e.submitter, async () => {
          await api.post(`/work-orders/${wo.id}/codes`, { codes });
          refresh();
        });
      });

      root.querySelectorAll('[data-remove-code]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
        await api.del(`/work-orders/${wo.id}/codes/${b.dataset.removeCode}`);
        refresh();
      })));

      root.querySelector('[data-add-item]').addEventListener('click', () => openForm({
        title: 'Add line',
        submitLabel: 'Add',
        body: itemFields({}, settings.labor_rate_cents),
        onSubmit: async (form) => {
          await api.post(`/work-orders/${wo.id}/items`, itemBody(form));
          refresh();
        },
      }));

      root.querySelectorAll('[data-edit-item]').forEach((b) => b.addEventListener('click', () => {
        const item = wo.items.find((i) => i.id === Number(b.dataset.editItem));
        openForm({
          title: 'Edit line',
          body: itemFields(item, settings.labor_rate_cents),
          onSubmit: async (form) => {
            const body = itemBody(form);
            // On edit, a blank price on labor means "use the shop rate" too.
            if (body.unit_price_cents === undefined) {
              if (body.kind !== 'labor') throw new Error('Enter a price for parts and fees');
              body.unit_price_cents = settings.labor_rate_cents;
            }
            await api.patch(`/work-orders/${wo.id}/items/${item.id}`, body);
            refresh();
          },
        });
      }));

      root.querySelectorAll('[data-delete-item]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
        await api.del(`/work-orders/${wo.id}/items/${b.dataset.deleteItem}`);
        refresh();
      })));

      root.querySelector('[data-invoice]').addEventListener('click', () => openForm({
        title: 'Create invoice?',
        submitLabel: `Create invoice for ${money(t.total_cents)}`,
        body: html`<p>The prices on this work order will be locked and it can no longer be edited.</p>`,
        onSubmit: async () => {
          const inv = await api.post(`/work-orders/${wo.id}/invoice`);
          toast(`Invoice #${inv.id} created`);
          go(`/invoices/${inv.id}`);
        },
      }));

      root.querySelector('[data-delete]').addEventListener('click', () => confirmAction(
        'Delete work order?', `Work order #${wo.id} and its lines will be permanently deleted.`, 'Delete',
        async () => {
          await api.del(`/work-orders/${wo.id}`);
          toast('Work order deleted');
          go(`/vehicles/${wo.vehicle.id}`);
        }
      ));
    },
  };
}
