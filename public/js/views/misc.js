import { api } from '../api.js';
import { html, field, toast, debounce, money, dollarsToCents, centsToDollars, busy } from '../ui.js';
import { refresh } from '../app.js';

// ---- Trouble code lookup ----

const codeCards = (rows) => rows.length
  ? html`<ul class="codes">${rows.map((c) => html`
      <li class="card code">
        <div class="code-head">
          <span class="code-id mono">${c.code}</span>
          <strong class="grow">${c.description ?? 'Not in the built-in list'}</strong>
          <span class="badge">${c.system}${c.type === 'manufacturer' ? ' · make-specific' : ''}</span>
        </div>
        ${c.common_causes?.length
          ? html`<p class="muted small"><strong>Common causes:</strong> ${c.common_causes.join(' · ')}</p>`
          : c.note ? html`<p class="muted small">${c.note}</p>` : ''}
      </li>`)}</ul>`
  : html`<p class="empty">No matching codes.</p>`;

const CODE_RE = /^[PBCU][0-3][0-9A-F]{3}$/i;

async function searchCodes(q) {
  if (CODE_RE.test(q)) return [await api.get(`/codes/${q}`)]; // exact code: includes make-specific ones
  return api.get(`/codes${q ? `?q=${encodeURIComponent(q)}` : ''}`);
}

export async function codesView(_params, query) {
  const q = query.get('q') ?? '';
  const rows = await searchCodes(q);
  return {
    html: html`
      <div class="page-head"><h1>Trouble codes</h1></div>
      <input class="search" type="search" value="${q}" placeholder="Type a code (P0420) or a word (lean, misfire, EVAP)" aria-label="Search codes" autofocus>
      <p class="hint">Built-in list of common generic OBD-II codes. Make-specific codes (like P1xxx) vary by manufacturer, so check the factory service information for those. Causes are typical starting points, not a diagnosis.</p>
      <div id="code-results">${codeCards(rows)}</div>`,
    bind(root) {
      const out = root.querySelector('#code-results');
      root.querySelector('.search').addEventListener('input', debounce(async (e) => {
        const term = e.target.value.trim();
        history.replaceState(null, '', `#/codes${term ? `?q=${encodeURIComponent(term)}` : ''}`);
        try {
          out.innerHTML = String(codeCards(await searchCodes(term)));
        } catch (err) {
          out.innerHTML = String(html`<p class="empty">${err.message}</p>`);
        }
      }));
    },
  };
}

// ---- Settings ----

export async function settingsView() {
  const s = await api.get('/settings');
  return {
    html: html`
      <div class="page-head"><h1>Shop settings</h1></div>
      <form class="card settings" data-settings>
        <h2>Shop details</h2>
        <p class="hint">Printed at the top of every invoice.</p>
        ${field('Shop name', 'shop_name', { value: s.shop_name, required: true })}
        <div class="grid-2">
          ${field('Phone', 'phone', { type: 'tel', value: s.phone })}
          ${field('Address', 'address', { value: s.address })}
        </div>
        <h2>Pricing</h2>
        <div class="grid-2">
          ${field('Labor rate ($ per hour)', 'labor_rate', { type: 'number', step: '0.01', min: 0, value: centsToDollars(s.labor_rate_cents), required: true })}
          ${field('Sales tax (%)', 'tax_percent', { type: 'number', step: '0.001', min: 0, value: +(s.tax_rate * 100).toFixed(4) })}
        </div>
        <label class="check"><input type="checkbox" name="tax_labor" ${s.tax_labor ? 'checked' : ''}> Charge sales tax on labor too (parts and fees are always taxed)</label>
        <p class="hint">Changes apply to open work orders. Invoices already created keep their original prices.</p>
        <div class="form-actions"><button class="btn primary" type="submit">Save settings</button></div>
      </form>`,
    bind(root) {
      root.querySelector('[data-settings]').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = e.target;
        busy(e.submitter, async () => {
          await api.patch('/settings', {
            shop_name: f.elements.shop_name.value.trim(),
            phone: f.elements.phone.value.trim() || null,
            address: f.elements.address.value.trim() || null,
            labor_rate_cents: dollarsToCents(f.elements.labor_rate.value),
            tax_rate: (parseFloat(f.elements.tax_percent.value) || 0) / 100,
            tax_labor: f.elements.tax_labor.checked,
          });
          document.getElementById('shop-name').textContent = f.elements.shop_name.value.trim();
          toast(`Saved. Labor rate ${money(dollarsToCents(f.elements.labor_rate.value))}/hr`);
          refresh();
        });
      });
    },
  };
}
