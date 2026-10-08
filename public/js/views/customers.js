import { api } from '../api.js';
import {
  html, raw, field, openForm, formValues, formValuesWithNulls, toast, busy, confirmAction, debounce,
  personName, vehicleName, miles, statusBadge, date,
} from '../ui.js';
import { go, refresh } from '../app.js';

const customerFields = (c = {}) => html`
  <div class="grid-2">
    ${field('First name', 'first_name', { value: c.first_name, required: true })}
    ${field('Last name', 'last_name', { value: c.last_name, required: true })}
    ${field('Phone', 'phone', { type: 'tel', value: c.phone })}
    ${field('Email', 'email', { type: 'email', value: c.email })}
  </div>
  ${field('Address', 'address', { value: c.address })}
  ${field('Notes', 'notes', { type: 'textarea', value: c.notes })}`;

export function newCustomer() {
  openForm({
    title: 'New customer',
    body: customerFields(),
    submitLabel: 'Add customer',
    onSubmit: async (form) => {
      const c = await api.post('/customers', formValues(form));
      toast(`Added ${personName(c)}`);
      go(`/customers/${c.id}`);
    },
  });
}

// ---- Customer list ----

const customerRows = (rows) => rows.length
  ? html`${rows.map((c) => html`
      <a class="row-link" href="#/customers/${c.id}">
        <strong>${personName(c)}</strong>
        <span class="muted">${c.phone ?? ''}</span>
        <span class="muted hide-sm">${c.email ?? ''}</span>
      </a>`)}`
  : html`<p class="empty">No customers found.</p>`;

export async function customersView(_params, query) {
  const q = query.get('q') ?? '';
  const rows = await api.get(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  return {
    html: html`
      <div class="page-head">
        <h1>Customers</h1>
        <button class="btn primary" data-new>+ New customer</button>
      </div>
      <input class="search" type="search" placeholder="Search by name, phone or email" value="${q}" aria-label="Search customers" autofocus>
      <div class="card list" id="customer-rows">${customerRows(rows)}</div>`,
    bind(root) {
      root.querySelector('[data-new]').addEventListener('click', newCustomer);
      const list = root.querySelector('#customer-rows');
      root.querySelector('.search').addEventListener('input', debounce(async (e) => {
        const term = e.target.value.trim();
        history.replaceState(null, '', `#/customers${term ? `?q=${encodeURIComponent(term)}` : ''}`);
        const found = await api.get(`/customers${term ? `?q=${encodeURIComponent(term)}` : ''}`);
        list.innerHTML = String(customerRows(found));
      }));
    },
  };
}

// ---- Customer detail ----

export async function customerView([id]) {
  const c = await api.get(`/customers/${id}`);
  return {
    html: html`
      <p class="crumbs"><a href="#/customers">Customers</a> /</p>
      <div class="page-head">
        <h1>${personName(c)}</h1>
        <div class="actions">
          <button class="btn" data-edit>Edit</button>
          <button class="btn ghost danger-text" data-delete>Delete</button>
        </div>
      </div>
      <div class="card info-grid">
        <div><span class="label">Phone</span>${c.phone ? html`<a href="tel:${c.phone}">${c.phone}</a>` : '—'}</div>
        <div><span class="label">Email</span>${c.email ? html`<a href="mailto:${c.email}">${c.email}</a>` : '—'}</div>
        <div><span class="label">Address</span>${c.address || '—'}</div>
        <div><span class="label">Customer since</span>${date(c.created_at)}</div>
        ${c.notes ? html`<div class="wide"><span class="label">Notes</span><p class="pre">${c.notes}</p></div>` : ''}
      </div>
      <div class="section-head">
        <h2>Vehicles</h2>
        <button class="btn primary" data-add-vehicle>+ Add vehicle</button>
      </div>
      <div class="card list">
        ${c.vehicles.length ? c.vehicles.map((v) => html`
          <a class="row-link" href="#/vehicles/${v.id}">
            <strong>${vehicleName(v)}</strong>
            <span class="muted">${v.license_plate ?? ''}</span>
            <span class="muted hide-sm mono">${v.vin ?? ''}</span>
          </a>`) : html`<p class="empty">No vehicles yet. Add one to start a job.</p>`}
      </div>`,
    bind(root) {
      root.querySelector('[data-edit]').addEventListener('click', () => openForm({
        title: 'Edit customer',
        body: customerFields(c),
        onSubmit: async (form) => {
          await api.patch(`/customers/${c.id}`, formValuesWithNulls(form));
          toast('Saved');
          refresh();
        },
      }));
      root.querySelector('[data-delete]').addEventListener('click', () => confirmAction(
        'Delete customer?',
        `This permanently deletes ${personName(c)}, their vehicles and all of their work orders.`,
        'Delete',
        async () => {
          await api.del(`/customers/${c.id}`);
          toast('Customer deleted');
          go('/customers');
        }
      ));
      root.querySelector('[data-add-vehicle]').addEventListener('click', () => vehicleForm({ customer_id: c.id }));
    },
  };
}

// ---- Vehicle form (add / edit) with VIN lookup ----

function vehicleForm(v) {
  const editing = Boolean(v.id);
  openForm({
    title: editing ? 'Edit vehicle' : 'Add vehicle',
    submitLabel: editing ? 'Save' : 'Add vehicle',
    body: html`
      <div class="vin-row">
        ${field('VIN', 'vin', { value: v.vin, placeholder: '17 characters', attrs: 'maxlength="17" autocapitalize="characters" class="mono"' })}
        <button type="button" class="btn" data-decode>Look up VIN</button>
      </div>
      <p class="hint vin-msg" hidden></p>
      <div class="grid-3">
        ${field('Year', 'year', { type: 'number', value: v.year, min: 1900 })}
        ${field('Make', 'make', { value: v.make })}
        ${field('Model', 'model', { value: v.model })}
        ${field('Trim', 'trim', { value: v.trim })}
        ${field('Engine', 'engine', { value: v.engine })}
        ${field('Color', 'color', { value: v.color })}
        ${field('License plate', 'license_plate', { value: v.license_plate })}
        ${field('Mileage', 'mileage', { type: 'number', value: v.mileage, min: 0 })}
      </div>
      ${field('Notes', 'notes', { type: 'textarea', value: v.notes })}`,
    onOpen(form) {
      const msg = form.querySelector('.vin-msg');
      form.querySelector('[data-decode]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        msg.hidden = true;
        const vin = form.elements.vin.value.trim();
        if (!vin) throw new Error('Enter a VIN first');
        const d = await api.get(`/vin/${encodeURIComponent(vin)}`);
        for (const k of ['year', 'make', 'model', 'trim', 'engine']) if (d[k] != null) form.elements[k].value = d[k];
        form.elements.vin.value = d.vin;
        msg.textContent = d.warning ? `Decoded with a warning: ${d.warning}` : `Found: ${vehicleName(d)}${d.trim ? ` ${d.trim}` : ''}`;
        msg.className = `hint vin-msg ${d.warning ? 'warn' : 'ok'}`;
        msg.hidden = false;
      }));
    },
    onSubmit: async (form) => {
      if (editing) {
        await api.patch(`/vehicles/${v.id}`, formValuesWithNulls(form));
        toast('Saved');
        refresh();
      } else {
        const created = await api.post('/vehicles', { ...formValues(form), customer_id: v.customer_id });
        if (created.vin_warning) toast(`VIN warning: ${created.vin_warning}`, 'warn');
        toast(`Added ${vehicleName(created)}`);
        go(`/vehicles/${created.id}`);
      }
    },
  });
}

// ---- Vehicle detail ----

export async function vehicleView([id]) {
  const v = await api.get(`/vehicles/${id}`);
  return {
    html: html`
      <p class="crumbs"><a href="#/customers">Customers</a> / <a href="#/customers/${v.customer.id}">${personName(v.customer)}</a> /</p>
      <div class="page-head">
        <h1>${vehicleName(v)} ${v.trim ? html`<span class="muted">${v.trim}</span>` : ''}</h1>
        <div class="actions">
          <button class="btn primary" data-new-job>+ New job</button>
          <button class="btn" data-edit>Edit</button>
          <button class="btn ghost danger-text" data-delete>Delete</button>
        </div>
      </div>
      <div class="card info-grid">
        <div><span class="label">VIN</span><span class="mono">${v.vin || '—'}</span></div>
        <div><span class="label">Engine</span>${v.engine || '—'}</div>
        <div><span class="label">Plate</span>${v.license_plate || '—'}</div>
        <div><span class="label">Color</span>${v.color || '—'}</div>
        <div><span class="label">Mileage</span>${miles(v.mileage) || '—'}</div>
        <div><span class="label">Owner</span><a href="#/customers/${v.customer.id}">${personName(v.customer)}</a></div>
        ${v.notes ? html`<div class="wide"><span class="label">Notes</span><p class="pre">${v.notes}</p></div>` : ''}
      </div>

      <div class="section-head">
        <h2>Safety recalls</h2>
        <button class="btn" data-recalls ${v.make && v.model && v.year ? '' : raw('disabled title="Needs year, make and model"')}>Check NHTSA recalls</button>
      </div>
      <div id="recalls"><p class="hint">Checks the free NHTSA recall database for this year, make and model.</p></div>

      <div class="section-head"><h2>Service history</h2></div>
      <div class="card list">
        ${v.work_orders.length ? v.work_orders.map((w) => html`
          <a class="row-link" href="#/work-orders/${w.id}">
            <strong>#${w.id}</strong>
            <span class="grow">${w.complaint || 'No complaint recorded'}</span>
            <span class="muted hide-sm">${date(w.created_at)}</span>
            ${statusBadge(w.status)}
          </a>`) : html`<p class="empty">No work orders yet.</p>`}
      </div>`,
    bind(root) {
      root.querySelector('[data-edit]').addEventListener('click', () => vehicleForm(v));
      root.querySelector('[data-delete]').addEventListener('click', () => confirmAction(
        'Delete vehicle?', `This permanently deletes the ${vehicleName(v)} and its service history.`, 'Delete',
        async () => {
          await api.del(`/vehicles/${v.id}`);
          toast('Vehicle deleted');
          go(`/customers/${v.customer.id}`);
        }
      ));
      root.querySelector('[data-new-job]').addEventListener('click', () => newJob(v));
      root.querySelector('[data-recalls]').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const box = root.querySelector('#recalls');
        const { recalls } = await api.get(`/vehicles/${v.id}/recalls`);
        box.innerHTML = String(recalls.length
          ? html`<div class="callout warn"><strong>${recalls.length} recall${recalls.length > 1 ? 's' : ''} found.</strong> Recall repairs are free at a dealer, so let the customer know.</div>
            ${recalls.map((r) => html`
              <details class="card recall">
                <summary><strong>${r.component}</strong> <span class="muted">Campaign ${r.campaign_number} · ${r.report_date}</span>
                  ${r.park_it ? html`<span class="badge pay-unpaid">Do not drive</span>` : ''}</summary>
                <p>${r.summary}</p>
                ${r.consequence ? html`<p><strong>Risk:</strong> ${r.consequence}</p>` : ''}
                ${r.remedy ? html`<p><strong>Fix:</strong> ${r.remedy}</p>` : ''}
              </details>`)}`
          : html`<div class="callout ok">No recalls on file with NHTSA for this vehicle.</div>`);
      }));
    },
  };
}

export function newJob(v) {
  openForm({
    title: `New job: ${vehicleName(v)}`,
    submitLabel: 'Create work order',
    body: html`
      ${field("Customer's concern", 'complaint', { type: 'textarea', placeholder: 'e.g. Check engine light on, rough idle when cold', required: true })}
      <div class="grid-2">
        ${field('Mileage in', 'mileage_in', { type: 'number', min: 0, placeholder: v.mileage ? String(v.mileage) : '' })}
        ${field('Technician', 'technician')}
      </div>`,
    onSubmit: async (form) => {
      const wo = await api.post('/work-orders', { ...formValues(form), vehicle_id: v.id });
      toast(`Work order #${wo.id} created`);
      go(`/work-orders/${wo.id}`);
    },
  });
}
