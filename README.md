# Auto Repair Backend

Shop management backend for independent auto repair shops: customers, vehicles, work orders,
estimates, invoices and payments, plus free vehicle data.

**Costs nothing to run.** No paid database and no accounts needed:

- **Storage:** SQLite, built into Node.js. The whole database is one file (`data/shop.db`).
  Back it up by copying that file.
- **VIN decoding and recalls:** NHTSA's free government APIs. No API key needed.
- **Trouble codes:** a built-in table of 125 common generic OBD-II codes (P0xxx, U0xxx) with
  typical causes. Manufacturer-specific codes (like P1xxx) are recognized and labeled, but their
  meaning varies by make.

Repair procedures, wiring diagrams and labor times are **not** included. That data is licensed
(ALLDATA, Mitchell 1, MOTOR), and most shops already subscribe to one of them.

## Run it

Requires Node.js 22.13 or newer.

```bash
npm install
npm start        # http://localhost:3000
npm run dev      # restarts automatically when you edit code
npm test
```

Environment variables (all optional): `PORT` (default 3000), `DB_PATH` (default `data/shop.db`).

## How a job flows

1. Add a **customer**.
2. Add their **vehicle**. Send just the VIN and the year, make, model, trim and engine fill in automatically.
3. Open a **work order** with the customer's complaint. It starts as an `estimate`.
4. Attach the **trouble codes** from the scan tool. Each one comes back with its meaning and common causes.
5. Add **line items**: labor (hours, priced at the shop rate by default), parts and fees. Totals and tax are calculated for you.
6. Move the status along: `estimate` → `approved` → `in_progress` → `completed`.
7. Create the **invoice**. Prices are frozen and the work order is locked.
8. Record **payments**. Partial payments are supported, and the invoice shows the balance due.

All money is in **cents** (`15000` = $150.00).

## API

| Method | Path | What it does |
|---|---|---|
| GET / PATCH | `/api/settings` | Shop name, labor rate, tax rate (`8.25` or `0.0825`), whether labor is taxed |
| GET / POST | `/api/customers` | List (`?q=` searches name, phone, email) / create |
| GET / PATCH / DELETE | `/api/customers/:id` | GET includes the customer's vehicles |
| GET / POST | `/api/vehicles` | List (`?vin=`, `?customer_id=`) / create (auto-decodes the VIN) |
| GET / PATCH / DELETE | `/api/vehicles/:id` | GET includes owner and work order history |
| GET | `/api/vehicles/:id/recalls` | Open NHTSA safety recalls for this vehicle |
| GET / POST | `/api/work-orders` | List (`?status=approved,in_progress`, `?vehicle_id=`) / create |
| GET / PATCH / DELETE | `/api/work-orders/:id` | GET includes vehicle, customer, items, codes and totals |
| POST | `/api/work-orders/:id/items` | Add a labor, part or fee line |
| PATCH / DELETE | `/api/work-orders/:id/items/:itemId` | Edit or remove a line |
| POST | `/api/work-orders/:id/codes` | Attach trouble codes: `{ "codes": ["P0171", "P0300"] }` |
| DELETE | `/api/work-orders/:id/codes/:code` | Remove a code |
| POST | `/api/work-orders/:id/invoice` | Create the invoice |
| GET | `/api/invoices` | List (`?unpaid=true` for balances due) |
| GET | `/api/invoices/:id` | Full invoice with shop info, items, payments and balance |
| POST | `/api/invoices/:id/payments` | `{ "amount_cents": 10000, "method": "cash" }` |
| GET | `/api/vin/:vin` | Decode any VIN |
| GET | `/api/recalls?make=&model=&year=` | Recalls for any vehicle |
| GET | `/api/codes?q=` | Search trouble codes by code or keyword (`?q=lean`, `?q=P04`) |
| GET | `/api/codes/:code` | Look up one trouble code |

### Example

```bash
curl -X POST localhost:3000/api/customers -H 'content-type: application/json' \
  -d '{"first_name":"Maria","last_name":"Lopez","phone":"555-0100"}'

curl -X POST localhost:3000/api/vehicles -H 'content-type: application/json' \
  -d '{"customer_id":1,"vin":"1HGCM82633A004352"}'

curl localhost:3000/api/codes/P0420
```

## Not built yet

- **Logins / multiple shops.** Right now one running copy serves one shop, with no login.
  Add authentication before putting this on the public internet.
- A front end (web or mobile app).
- Texting or emailing customers, appointments, inventory.
