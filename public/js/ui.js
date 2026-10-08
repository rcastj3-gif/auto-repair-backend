// Small rendering helpers. html`` escapes every interpolated value unless it was built with html`` or raw().

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
export const raw = (s) => new Raw(s);

const renderValue = (v) =>
  v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(renderValue).join('') : esc(v);

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += renderValue(values[i]) + strings[i + 1];
  return raw(out);
}

// ---- Formatting ----

export const money = (cents) => ((cents ?? 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const dollarsToCents = (v) => (v === undefined || v === '' ? undefined : Math.round(parseFloat(v) * 100));
export const centsToDollars = (c) => (c == null ? '' : (c / 100).toFixed(2));

// The server stores UTC timestamps as "YYYY-MM-DD HH:MM:SS".
const parseDate = (s) => new Date(`${s.replace(' ', 'T')}Z`);
export const date = (s) => (s ? parseDate(s).toLocaleDateString() : '');
export const dateTime = (s) => (s ? parseDate(s).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

export const vehicleName = (v) => [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
export const personName = (c) => `${c.first_name} ${c.last_name}`;
export const miles = (n) => (n == null ? '' : `${Number(n).toLocaleString()} mi`);

export const STATUS_LABELS = {
  estimate: 'Estimate',
  approved: 'Approved',
  in_progress: 'In progress',
  completed: 'Completed',
  invoiced: 'Invoiced',
  cancelled: 'Cancelled',
};
export const statusBadge = (s) => html`<span class="badge status-${s}">${STATUS_LABELS[s] ?? s}</span>`;
export const PAY_LABELS = { paid: 'Paid', partial: 'Partly paid', unpaid: 'Unpaid' };
export const payBadge = (s) => html`<span class="badge pay-${s}">${PAY_LABELS[s]}</span>`;

// ---- Form fields ----

export function field(label, name, { type = 'text', value, required, placeholder, step, min, hint, attrs = '', wide } = {}) {
  const id = `f-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const control = type === 'textarea'
    ? html`<textarea id="${id}" name="${name}" rows="3" placeholder="${placeholder ?? ''}" ${required ? raw('required') : ''} ${raw(attrs)}>${value ?? ''}</textarea>`
    : html`<input id="${id}" name="${name}" type="${type}" value="${value ?? ''}" placeholder="${placeholder ?? ''}"
        ${step ? raw(`step="${esc(step)}"`) : ''} ${min !== undefined ? raw(`min="${esc(min)}"`) : ''}
        ${required ? raw('required') : ''} ${raw(attrs)}>`;
  return html`<label class="field ${wide ? 'wide' : ''}" for="${id}"><span>${label}${required ? raw(' <b class="req">*</b>') : ''}</span>${control}${hint ? html`<small>${hint}</small>` : ''}</label>`;
}

export function selectField(label, name, options, selected, { attrs = '' } = {}) {
  return html`<label class="field"><span>${label}</span><select name="${name}" ${raw(attrs)}>${options.map(
    ([value, text]) => html`<option value="${value}" ${value === selected ? raw('selected') : ''}>${text}</option>`
  )}</select></label>`;
}

// Reads a form into an object, trimming text and dropping empty fields.
export function formValues(form) {
  const out = {};
  for (const [k, v] of new FormData(form)) {
    const t = typeof v === 'string' ? v.trim() : v;
    if (t !== '') out[k] = t;
  }
  return out;
}

// For edit forms: empty fields become null so clearing a field actually clears it.
export function formValuesWithNulls(form) {
  const out = {};
  for (const [k, v] of new FormData(form)) {
    const t = typeof v === 'string' ? v.trim() : v;
    out[k] = t === '' ? null : t;
  }
  return out;
}

// ---- Feedback ----

export function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  const box = document.getElementById('toasts');
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => el.classList.add('out'), 2800);
  setTimeout(() => el.remove(), 3200);
}

// Runs an async action from a button, disabling it meanwhile and showing errors as a toast.
export async function busy(button, fn) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

export function openForm({ title, body, submitLabel = 'Save', danger, onSubmit, onOpen }) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = String(html`
    <form class="modal" novalidate>
      <header><h2>${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></header>
      <div class="modal-body">${body}</div>
      <p class="form-error" role="alert" hidden></p>
      <footer>
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${submitLabel}</button>
      </footer>
    </form>`);
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const errorEl = dlg.querySelector('.form-error');
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('close', () => dlg.remove());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    errorEl.hidden = true;
    try {
      await onSubmit(form);
      dlg.close();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });

  dlg.showModal();
  onOpen?.(form);
  form.querySelector('.modal-body input, .modal-body select, .modal-body textarea')?.focus();
}

export const confirmAction = (title, message, label, action) =>
  openForm({ title, body: html`<p>${message}</p>`, submitLabel: label, danger: true, onSubmit: action });

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
