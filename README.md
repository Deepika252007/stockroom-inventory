# Stockroom Inventory

Stockroom uses React, TypeScript, Vite, Express, and SQLite. All four role workspaces use the same persistent store data, with backend authorization on protected operations.

## Requirements

- Node.js 22.13 or newer (required for the built-in SQLite driver).
- npm.

## Install and run

```powershell
npm install
Copy-Item .env.example .env
npm run dev
```

The combined command starts the API on `http://127.0.0.1:3001` and Vite on `http://127.0.0.1:5173`. Open the Vite URL in your browser; Vite proxies `/api` requests to Express. You can also run the processes separately with `npm run dev:backend` and `npm run dev:frontend`.

## Set up the first Owner

Owner accounts cannot be created through the website or a public API. In a trusted terminal, run:

```powershell
npm run owner:create
```

The command asks for an Owner name and email, then prompts for a password without displaying it. Use a unique password with at least 12 characters. It refuses to create another Owner if one already exists. There are no default credentials.

If the project already has `data/store.json`, the first backend start imports its Owner, employees, inventory, and transaction history into SQLite. The JSON file is preserved as a backup. Existing scrypt passwords continue to work and are upgraded to bcrypt hashes after a successful login. If no existing Owner is available, the one-time setup command can create one in the imported database.

## Workspaces

The login page offers Owner, Store Manager, Stock Staff, and Cashier workspaces. Choosing a workspace does not grant access: the API verifies the account's assigned role at sign-in and on protected requests. Employees cannot register themselves; only the Owner can create, edit, deactivate, or reset employee accounts.

- **Owner:** store overview, catalog and stock operations, purchases, sales, suppliers, reports, and employee management.
- **Store Manager:** products, stock, purchases, suppliers, sales monitoring, and business reports.
- **Stock Staff:** product lookup, stock receipts and adjustments, recent movements, and low-stock alerts.
- **Cashier:** product search, checkout, invoices, personal sales history, and authorized returns.

The dashboards share one inventory. Purchases increase stock, sales reduce it, and checkout rejects quantities above current availability. Changes made by other users refresh automatically while a workspace is open.

## Owner dashboard and employees

The Owner dashboard displays five database-backed measures: Total Products, Today's Sales, Available Stock, Low Stock, and Total Employees. It also shows recent sales and purchases, stock totals, and active/inactive employee counts. Empty sections show zero or an empty-state message; the app does not create sample products, employees, or transactions.

Use **Manage Employees** to add and update Store Manager, Stock Staff, and Cashier accounts. Employee email addresses are unique, passwords are hashed with bcrypt, and account role/status checks are enforced by the API. Only an authenticated Owner can manage employees. Deactivated accounts cannot sign in.

## Database and configuration

The default SQLite file is `data/stockroom.sqlite`. SQLite schema and migration code are under `backend/`. The schema includes users, products, categories, suppliers, purchases and purchase items, sales and sale items, stock movements, sessions, transactions, and activity.

Copy `.env.example` to `.env` to configure the API port and data directory. `STOCKROOM_DATABASE_PATH` can point to a database file outside the project. Keep the database and backups private; the files are excluded from Git.

## Production and checks

```powershell
npm run build
npm start
npm run lint
```

The production server serves the built Vite app and API from one process. Set `API_PORT` (or `PORT`) and `STOCKROOM_DATABASE_PATH` for deployment, use HTTPS, and back up the SQLite database regularly.
