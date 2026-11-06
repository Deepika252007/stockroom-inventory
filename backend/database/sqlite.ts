import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { Store, Transaction } from '../models/store';

export function openDatabase(
  databasePath: string,
  legacyPath: string,
  createInitialStore: () => Store,
  validateStore: (value: unknown) => value is Store,
) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  database.exec(readFileSync(fileURLToPath(new URL('../models/schema.sql', import.meta.url)), 'utf8'));

  const saved = database.prepare('SELECT snapshot_json FROM application_state WHERE id = 1').get() as { snapshot_json: string } | undefined;
  let store: Store;
  let migrated = false;
  if (saved) {
    const snapshot: unknown = JSON.parse(saved.snapshot_json);
    if (!validateStore(snapshot)) throw new Error('The saved SQLite store has an invalid structure.');
    store = snapshot;
  } else if (existsSync(legacyPath)) {
    const snapshot: unknown = JSON.parse(readFileSync(legacyPath, 'utf8'));
    if (!validateStore(snapshot)) throw new Error(`The legacy store at ${legacyPath} has an invalid structure.`);
    store = snapshot;
    migrated = true;
  } else {
    store = createInitialStore();
  }
  store.saleRequests ??= {};
  persistStore(database, store);
  return { database, store, migrated };
}

export function persistStore(database: DatabaseSync, store: Store) {
  // Disable FK enforcement for the duration of the full-rebuild transaction.
  // The in-memory store is the source of truth; the relational tables are a
  // derived snapshot and FKs are meaningless mid-wipe/re-insert.
  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(`
      DELETE FROM sale_requests;
      DELETE FROM sessions;
      DELETE FROM activity;
      DELETE FROM stock_movements;
      DELETE FROM transactions;
      DELETE FROM purchase_items;
      DELETE FROM purchases;
      DELETE FROM sale_items;
      DELETE FROM sales;
      DELETE FROM products;
      DELETE FROM suppliers;
      DELETE FROM categories;
      DELETE FROM users;
      DELETE FROM store_settings;
    `);
    database.prepare('INSERT INTO store_settings (id, name, currency, timezone) VALUES (1, ?, ?, ?)')
      .run(store.store.name, store.store.currency, store.store.timezone);
    const addUser = database.prepare('INSERT INTO users (id,name,email,password_hash,role,active,created_at) VALUES (?,?,?,?,?,?,?)');
    for (const user of store.users) addUser.run(user.id, user.name, user.email, user.passwordHash, user.role, Number(user.active), user.createdAt);

    const addCategory = database.prepare('INSERT INTO categories (name) VALUES (?)');
    for (const category of store.categories) addCategory.run(category);
    const addSupplier = database.prepare('INSERT INTO suppliers (id,name,contact,email,phone,address,lead_time,active) VALUES (?,?,?,?,?,?,?,?)');
    for (const supplier of store.suppliers) {
      addSupplier.run(supplier.id, supplier.name, supplier.contact, supplier.email, supplier.phone, supplier.address, supplier.leadTime, Number(supplier.active));
    }

    const addProduct = database.prepare(`INSERT INTO products
      (id,name,sku,barcode,category,quantity,reorder_at,cost,price,supplier_id,image_url,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const product of store.products) {
      addProduct.run(product.id, product.name, product.sku, product.barcode, product.category, product.quantity, product.reorderAt,
        product.cost ?? null, product.price, product.supplierId ?? null, product.imageUrl, Number(product.active), product.createdAt, product.updatedAt);
    }

    const addTransaction = database.prepare(`INSERT INTO transactions
      (id,type,product_id,product_name,supplier_id,supplier_name,quantity,unit_amount,total,invoice_number,returned_quantity,customer,user_id,user_name,note,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const addPurchase = database.prepare('INSERT INTO purchases (id,supplier_id,user_id,note,total,created_at) VALUES (?,?,?,?,?,?)');
    const addPurchaseItem = database.prepare('INSERT INTO purchase_items (id,purchase_id,product_id,quantity,unit_cost,line_total) VALUES (?,?,?,?,?,?)');
    const addSale = database.prepare('INSERT INTO sales (id,invoice_number,customer,user_id,created_at) VALUES (?,?,?,?,?)');
    const addSaleItem = database.prepare('INSERT INTO sale_items (id,sale_id,product_id,quantity,unit_price,line_total,returned_quantity) VALUES (?,?,?,?,?,?,?)');
    const saleIds = new Map<string, string>();
    for (const transaction of store.transactions) {
      addTransaction.run(transaction.id, transaction.type, transaction.productId, transaction.productName, transaction.supplierId,
        transaction.supplierName, transaction.quantity, transaction.unitAmount, transaction.total, transaction.invoiceNumber,
        transaction.returnedQuantity, transaction.customer, transaction.userId, transaction.userName, transaction.note, transaction.createdAt);
      if (transaction.type === 'purchase' && transaction.supplierId) {
        addPurchase.run(transaction.id, transaction.supplierId, transaction.userId, transaction.note, transaction.total, transaction.createdAt);
        addPurchaseItem.run(transaction.id, transaction.id, transaction.productId, transaction.quantity, transaction.unitAmount, transaction.total);
      }
      if (transaction.type === 'sale' && transaction.invoiceNumber) {
        let saleId = saleIds.get(transaction.invoiceNumber);
        if (!saleId) {
          saleId = transaction.invoiceNumber;
          saleIds.set(transaction.invoiceNumber, saleId);
          addSale.run(saleId, transaction.invoiceNumber, transaction.customer, transaction.userId, transaction.createdAt);
        }
        addSaleItem.run(transaction.id, saleId, transaction.productId, transaction.quantity, transaction.unitAmount, transaction.total, transaction.returnedQuantity);
      }
    }
    const addMovement = database.prepare(`INSERT INTO stock_movements
      (id,product_id,product_name,type,quantity,before_quantity,after_quantity,note,user_id,user_name,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    for (const movement of store.movements) {
      addMovement.run(movement.id, movement.productId, movement.productName, movement.type, movement.quantity, movement.before,
        movement.after, movement.note, movement.userId, movement.userName, movement.createdAt);
    }
    const addSession = database.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)');
    for (const [tokenHash, session] of Object.entries(store.sessions)) {
      if (store.users.some((user) => user.id === session.userId)) addSession.run(tokenHash, session.userId, session.expiresAt);
    }
    const addActivity = database.prepare('INSERT INTO activity (id,user_id,user_name,action,created_at) VALUES (?,?,?,?,?)');
    for (const event of store.activity) {
      if (store.users.some((user) => user.id === event.userId)) addActivity.run(event.id, event.userId, event.userName, event.action, event.createdAt);
    }
    const addSaleRequest = database.prepare('INSERT INTO sale_requests (idempotency_key,user_id,transactions_json,payload_hash) VALUES (?,?,?,?)');
    for (const [key, request] of Object.entries(store.saleRequests ?? {})) {
      if (store.users.some((user) => user.id === request.userId)) addSaleRequest.run(key, request.userId, JSON.stringify(request.transactions), request.payloadHash ?? null);
    }
    database.prepare(`INSERT INTO application_state (id,snapshot_json) VALUES (1,?)
      ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json`).run(JSON.stringify(store));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

function localDayRange(timezone: string, now: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const dateParts = (date: Date) => Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  const current = dateParts(now);
  const year = Number(current.year);
  const month = Number(current.month);
  const day = Number(current.day);
  const localMidnight = (offset: number) => {
    const target = new Date(Date.UTC(year, month - 1, day + offset));
    const targetParts = {
      year: target.getUTCFullYear(),
      month: target.getUTCMonth() + 1,
      day: target.getUTCDate(),
    };
    let instant = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = dateParts(new Date(instant));
      const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
      const desired = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day);
      const adjustment = desired - rendered;
      instant += adjustment;
      if (adjustment === 0) break;
    }
    return instant;
  };
  return {
    start: new Date(localMidnight(0)).toISOString(),
    end: new Date(localMidnight(1)).toISOString(),
    date: `${current.year}-${current.month}-${current.day}`,
  };
}

function transactionFromRow(row: Record<string, unknown>): Transaction {
  return {
    id: String(row.id), type: row.type as Transaction['type'], productId: String(row.product_id), productName: String(row.product_name),
    supplierId: row.supplier_id === null ? null : String(row.supplier_id), supplierName: row.supplier_name === null ? null : String(row.supplier_name),
    quantity: Number(row.quantity), unitAmount: Number(row.unit_amount), total: Number(row.total),
    invoiceNumber: row.invoice_number === null ? null : String(row.invoice_number), returnedQuantity: Number(row.returned_quantity),
    customer: row.customer === null ? null : String(row.customer), userId: String(row.user_id), userName: String(row.user_name),
    note: String(row.note), createdAt: String(row.created_at),
  };
}

export function readEmployees(database: DatabaseSync) {
  return database.prepare(`SELECT id,name,email,role,active,created_at AS createdAt
    FROM users WHERE role <> 'admin' ORDER BY created_at DESC`).all().map((row) => ({
    ...(row as Record<string, unknown>),
    active: Boolean((row as Record<string, unknown>).active),
  }));
}

export function readOwnerDashboard(database: DatabaseSync, timezone: string) {
  const range = localDayRange(timezone, new Date());
  const stock = database.prepare(`SELECT COUNT(*) AS totalProducts,
    COALESCE(SUM(quantity), 0) AS availableUnits,
    SUM(CASE WHEN quantity <= reorder_at THEN 1 ELSE 0 END) AS lowStock,
    SUM(CASE WHEN quantity = 0 THEN 1 ELSE 0 END) AS outOfStock
    FROM products WHERE active = 1`).get() as Record<string, number>;
  const employees = database.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active,
    SUM(CASE WHEN active = 0 THEN 1 ELSE 0 END) AS inactive
    FROM users WHERE role <> 'admin'`).get() as Record<string, number>;
  const todaySales = database.prepare(`SELECT COALESCE(SUM(CASE WHEN type = 'return' THEN -total ELSE total END), 0) AS total
    FROM transactions WHERE type IN ('sale','return') AND created_at >= ? AND created_at < ?`).get(range.start, range.end) as { total: number };
  const recent = (type: 'sale' | 'purchase') => database.prepare(`SELECT id,type,product_id,product_name,supplier_id,supplier_name,quantity,unit_amount,total,
    invoice_number,returned_quantity,customer,user_id,user_name,note,created_at
    FROM transactions WHERE type = ? ORDER BY created_at DESC LIMIT 5`).all(type).map((row) => transactionFromRow(row as Record<string, unknown>));
  return {
    totalProducts: Number(stock.totalProducts ?? 0),
    todaySales: Number(todaySales.total ?? 0),
    availableStock: Number(stock.availableUnits ?? 0),
    lowStock: Number(stock.lowStock ?? 0),
    totalEmployees: Number(employees.total ?? 0),
    recentSales: recent('sale'),
    recentPurchases: recent('purchase'),
    stockSummary: {
      totalProducts: Number(stock.totalProducts ?? 0),
      availableUnits: Number(stock.availableUnits ?? 0),
      lowStock: Number(stock.lowStock ?? 0),
      outOfStock: Number(stock.outOfStock ?? 0),
    },
    employeeSummary: {
      active: Number(employees.active ?? 0),
      inactive: Number(employees.inactive ?? 0),
      total: Number(employees.total ?? 0),
    },
  };
}
