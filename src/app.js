import express from 'express';
import { HttpError } from './errors.js';
import settingsRouter from './routes/settings.js';
import customersRouter from './routes/customers.js';
import vehiclesRouter from './routes/vehicles.js';
import workOrdersRouter from './routes/workOrders.js';
import invoicesRouter from './routes/invoices.js';
import lookupRouter from './routes/lookup.js';

export function createApp(db) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api/settings', settingsRouter(db));
  app.use('/api/customers', customersRouter(db));
  app.use('/api/vehicles', vehiclesRouter(db));
  app.use('/api/work-orders', workOrdersRouter(db));
  app.use('/api/invoices', invoicesRouter(db));
  app.use('/api', lookupRouter(db));

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));

  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}
