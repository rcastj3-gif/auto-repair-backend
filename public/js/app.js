import { html } from './ui.js';
import { api } from './api.js';
import { jobsView, workOrderView } from './views/jobs.js';
import { customersView, customerView, vehicleView } from './views/customers.js';
import { invoicesView, invoiceView } from './views/invoices.js';
import { codesView, settingsView } from './views/misc.js';

const ROUTES = [
  [/^\/$/, jobsView, '/'],
  [/^\/customers$/, customersView, '/customers'],
  [/^\/customers\/(\d+)$/, customerView, '/customers'],
  [/^\/vehicles\/(\d+)$/, vehicleView, '/customers'],
  [/^\/work-orders\/(\d+)$/, workOrderView, '/'],
  [/^\/invoices$/, invoicesView, '/invoices'],
  [/^\/invoices\/(\d+)$/, invoiceView, '/invoices'],
  [/^\/codes$/, codesView, '/codes'],
  [/^\/settings$/, settingsView, '/settings'],
];

const root = document.getElementById('app');
let renderToken = 0;

export const go = (path) => { location.hash = `#${path}`; };

export async function refresh() {
  const token = ++renderToken;
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const query = new URLSearchParams(qs);
  const match = ROUTES.map(([re, view, nav]) => [path.match(re), view, nav]).find(([m]) => m);

  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === match?.[2]));
  if (!match) {
    root.innerHTML = String(html`<div class="card empty-state"><h1>Page not found</h1><a class="btn" href="#/">Back to jobs</a></div>`);
    return;
  }

  const [m, view] = match;
  if (!root.hasChildNodes()) root.innerHTML = '<p class="loading">Loading…</p>';
  try {
    const result = await view(m.slice(1), query);
    if (token !== renderToken) return; // the user navigated away while this was loading
    root.innerHTML = String(result.html);
    result.bind?.(root);
    const h1 = root.querySelector('h1');
    document.title = h1 ? `${h1.textContent.trim().split('\n')[0]} · Shop Desk` : 'Shop Desk';
  } catch (err) {
    if (token !== renderToken) return;
    root.innerHTML = String(html`<div class="card empty-state"><h1>Something went wrong</h1><p>${err.message}</p><a class="btn" href="#/">Back to jobs</a></div>`);
  }
}

let lastPath = null;
window.addEventListener('hashchange', () => {
  const path = location.hash.split('?')[0];
  if (path !== lastPath) window.scrollTo(0, 0);
  lastPath = path;
  refresh();
});

api.get('/settings').then((s) => { document.getElementById('shop-name').textContent = s.shop_name; }).catch(() => {});
refresh();
