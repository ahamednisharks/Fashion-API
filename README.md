# Fashion — Backend API

REST API for Fashion (dress shop management software): master data — categories, brands, sizes,
colours, suppliers, customers, and products with variants — sign-in and users, and counter
billing (GST bills with barcode lookup).

Node.js · Express 5 · TypeScript · PostgreSQL (raw SQL with `pg`) · Zod · Swagger UI

## Quick start

Requirements: Node.js ≥ 20.19 (tested on 24.2) and PostgreSQL ≥ 13 (tested on 17).

```bash
npm install
# 1. Edit .env — at least DB_PASSWORD (copy .env.example if .env is missing)
# 2. Create the database, apply migrations and load demo data:
npm run db:setup
# 3. Start the API with auto-reload:
npm run dev
```

- API: http://localhost:3000/api/v1
- Swagger UI: http://localhost:3000/api/docs (raw spec: `/api/docs/openapi.json`)
- Health: http://localhost:3000/api/v1/health

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Start with auto-reload (tsx watch) |
| `npm run build` / `npm start` | Compile to `dist/` / run the compiled server |
| `npm run db:create` | Create the database named in `DB_NAME` if it does not exist |
| `npm run db:migrate` | Apply pending SQL migrations (`npm run db:migrate:prod` after a build). On a database with no users it also creates the default login **admin / admin@123** (change it at first sign-in; override with `ADMIN_INITIAL_PASSWORD`) |
| `npm run db:seed` | Load demo data (idempotent — safe to re-run) |
| `npm run db:setup` | `db:create` + `db:migrate` + `db:seed` |
| `npm test` | Integration + unit tests against `<DB_NAME>_test` (created automatically) |
| `npm run typecheck` | TypeScript check of src, database and tests |
| `npm run format` | Prettier |

## Configuration (`.env`)

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | |
| `CORS_ORIGINS` | `http://localhost:4200` | Comma-separated; `*` allows any origin |
| `LOG_REQUESTS` | `true` | One log line per request |
| `DB_HOST` / `DB_PORT` | `localhost` / `5432` | |
| `DB_USER` / `DB_PASSWORD` | `postgres` / — | |
| `DB_NAME` | `fashion` | Letters, digits and underscores only |
| `TEST_DB_NAME` | `<DB_NAME>_test` | Database used by `npm test` (wiped on every run) |
| `DB_POOL_MAX` | `10` | |
| `DB_SSL` | `false` | |

Environment variables override `.env`. The configuration is validated at start-up.

## Architecture

```
src/
  config/        env (validated), database (pg Pool + withTransaction), swagger (OpenAPI builder)
  common/
    crud/        Generic master repository / service / controller / standard routes
    errors/      AppError, PostgreSQL error translation, constraint → message map
    http/        Route definitions: routing + validation + docs from one declaration
    middlewares/ validateRequest, errorHandler, notFoundHandler, requestLogger
    utils/       Pagination, sorting allowlist, SQL parameter builder, responses, logger
    validators/  Zod fields (mobile, GSTIN, pincode, HSN, HEX, money…), list/exists queries
  modules/<name>/  <name>.routes → .controller → .service → .repository (+ .schema)
  modules/products/variants/   Variant sub-resource
  app.ts, routes.ts, server.ts
database/
  migrations/    NNN_name.sql + migrate.ts (tracked in schema_migrations, checksummed)
  seeds/         seed-data.ts + seed.ts (idempotent)
tests/           node:test suites (api + unit) and the test harness
```

- **Routes → Controllers → Services → Repositories.** Repositories contain all SQL; services hold
  business rules; controllers map validated HTTP input to services.
- **Raw, parameterised SQL** only (`$1, $2…`). Sort fields are allowlisted, `LIKE` wildcards in
  search terms are escaped, and identifiers in SQL text are developer constants.
- **Integrity is enforced in PostgreSQL** (case-insensitive unique indexes, foreign keys with
  `ON DELETE RESTRICT`, CHECK constraints) and pre-checked in services for clear messages.
  Constraint names map to user-facing messages in `common/errors/constraint-messages.ts`.
- **One definition per endpoint**: `defineRoute({ method, path, schemas, handle, … })` registers the
  Express route, validates params/query/body with Zod, and generates the Swagger docs.

## API conventions

**Envelope**

```jsonc
// success
{ "success": true, "data": { … } }
// list
{ "success": true, "data": { "items": [ … ], "total": 42, "page": 1, "pageSize": 10, "totalPages": 5 } }
// error
{ "success": false, "error": { "code": "DUPLICATE", "message": "…", "field": "variants.2.sku", "details": [ … ] } }
```

`DELETE` returns `204 No Content`.

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `VALIDATION` | Invalid params/query/body; `details` lists every problem with its field path |
| 400 | `BAD_REQUEST` | Malformed JSON |
| 404 | `NOT_FOUND` | Record or route not found |
| 409 | `DUPLICATE` | Unique value already used (name, mobile, GSTIN, product code, SKU, barcode…) |
| 409 | `IN_USE` | Delete blocked because other records reference it — deactivate instead |
| 503 | `SERVICE_UNAVAILABLE` | Database unreachable |

**List query:** `?search=&status=active|inactive&page=1&pageSize=10&sortBy=name&sortOrder=asc`
plus resource filters (sizes: `type`; suppliers: `state`; products: `categoryId`, `brandId`,
`productType`). Search matches every word. Empty values (e.g. `status=`) are ignored.

## Endpoints (`/api/v1`)

Masters — `categories`, `brands`, `sizes`, `colors`, `suppliers`, `customers` — share one shape:

| Method | Path | |
| --- | --- | --- |
| GET | `/{resource}` | Paginated list |
| GET | `/{resource}/lookup?status=` | All records (dropdowns) |
| GET | `/{resource}/exists?field=&value=&excludeId=` | Live duplicate check |
| GET | `/{resource}/{id}` | Details |
| POST | `/{resource}` | Create |
| PUT | `/{resource}/{id}` | Update (full replacement) |
| PATCH | `/{resource}/{id}/status` | `{ "status": "active" \| "inactive" }` |
| DELETE | `/{resource}/{id}` | Delete (409 `IN_USE` if referenced) |

Products:

| Method | Path | |
| --- | --- | --- |
| GET | `/products` | Paginated summaries (category/brand names, `variantCount`; no variants) |
| GET | `/products/lookup`, `/products/exists?field=code\|sku\|barcode` | |
| GET | `/products/{id}` | Product **with variants** (size/colour names and HEX included) |
| POST | `/products` | Create product + variants in one transaction |
| PUT | `/products/{id}` | Update product and **sync variants** (with `id` → update, without → add, missing → delete) |
| PATCH / DELETE | `/products/{id}/status`, `/products/{id}` | Delete also removes its variants |
| GET / POST | `/products/{productId}/variants` | List / add one variant |
| GET / PUT / DELETE | `/products/{productId}/variants/{variantId}` | One variant |

Business rules: product code, SKUs and barcodes are unique across the whole catalogue (product and
variant barcodes share one namespace); selling price ≤ MRP after variant overrides; one variant per
design + size + colour within a product; new records cannot use inactive categories / brands /
sizes / colours (existing references are kept). Concurrent product saves are serialised with a
PostgreSQL advisory lock so codes can't be claimed twice.

Shop profile and billing:

| Method | Path | |
| --- | --- | --- |
| GET / PUT | `/settings/shop` | Shop profile printed on bills (PUT is admin-only) |
| GET | `/sales/items/lookup?code=` | Scanner: exact variant barcode / SKU, product barcode / code (a product code returns all its variants; inactive items are flagged) |
| GET | `/sales/items?search=&limit=` | Typed search over active items (name, code, SKU, barcode, design, brand, size, colour) |
| POST | `/sales/invoices` | Save a bill `{ customerId?, items: [{ productId, variantId, quantity, discountPercent, unitPrice }], payments: [{ mode, amount, reference }] }` |
| GET | `/sales/invoices?date=&from=&to=&search=` | Bills, newest first (`from` / `to` = YYYY-MM-DD, both included) |
| GET | `/sales/invoices/{id}` | One bill with lines and payments (for printing) |

Billing rules: prices are GST-inclusive; the server recomputes every line (discount → taxable value
→ CGST + SGST, or IGST for a registered customer from another state) and rounds the bill to the
rupee (`src/modules/sales/bill-calculator.ts`, mirrored in the frontend). A bill is refused when an
item is inactive, its price changed since it was added (`items.N.unitPrice`), a non-fabric quantity
has decimals, or the payments don't cover it (only cash may exceed the bill — the rest is change).
Bills are numbered `INV/<financial year>/<n>` (e.g. `INV/26-27/00001`) without gaps: the counter
row is locked by the saving transaction. Bills keep a snapshot of the seller, customer and items,
and are never deleted, so billed products, variants, customers and users are protected by RESTRICT
foreign keys (409 `IN_USE` — deactivate them instead).

Reports (administrators only):

| Method | Path | |
| --- | --- | --- |
| GET | `/reports/sales?from=&to=` | Sales of a period: `totals` plus one row per day that had sales (`days`, oldest first) — bills, quantity, gross, discount, taxable value, CGST / SGST / IGST, round-off, net sales, average bill, and the cash / UPI / card split |

Report rules: periods use the shop-local bill date, include both ends and may be at most 366 days.
Only `completed` bills count (cancelled bills drop out automatically once cancellation exists).
Cash is net of change returned, so cash + UPI + card = net sales. Sums are done in SQL `NUMERIC`
(exact to the paisa); one `GROUP BY ROLLUP` query returns the days and the total
(`src/modules/reports/reports.repository.ts`).

## Connecting the Angular frontend

The frontend uses this API by default (`Frontend/src/app/core/data-access/http`). In development
the Angular dev server proxies `/api` to `http://localhost:3000` (`Frontend/proxy.conf.mjs`), so
start this backend first, then `npm start` in `Frontend`. The client maps:

- list query `sort` → `sortBy` / `sortOrder`; `status: ''` → omitted;
- `getAll()` → `GET /{resource}/lookup`; `isTaken()` → `GET /{resource}/exists`;
- `setStatus()` → `PATCH /{resource}/{id}/status`;
- products: `brandId: null` (unbranded) ↔ the frontend's `''`; list rows have `variantCount` but
  no `variants`.

## Not in this phase

Purchase, inventory/stock (billing does not check or reduce stock yet — bill lines keep the
variant so stock can be derived later), sales returns / exchanges, bill cancellation, credit sales
and wholesale orders. Once purchase exists, suppliers with purchases must be blocked from deletion.
