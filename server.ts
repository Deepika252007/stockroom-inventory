import 'dotenv/config';
import { randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, verifyPassword } from './backend/auth/password';
import { openDatabase, persistStore } from './backend/database/sqlite';
import { createOwnerRouter } from './backend/routes/owner';
import { allowRoles, type AuthenticatedRequest } from './backend/middleware/roles';
import { emptyStore, isRecord, isStoredStore, type Activity, type DamagedProduct, type Movement, type Notification, type Product, type PurchaseRequest, type Role, type SaleRequestRecord, type Session, type Store, type Supplier, type Transaction, type TransactionType, type User } from './backend/models/store';

const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
const PRODUCTION = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const SESSION_TTL = 12 * 60 * 60 * 1000;
const DATA_DIR = path.resolve(process.env.STOCKROOM_DATA_DIR ?? 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const DATABASE_FILE = path.resolve(process.env.STOCKROOM_DATABASE_PATH ?? path.join(DATA_DIR, 'stockroom.sqlite'));
const COOKIE_NAME = 'stockroom_session';
const roles = ['admin', 'manager', 'inventory', 'sales'] as const;

const openedStore = openDatabase(DATABASE_FILE, DATA_FILE, emptyStore, isStoredStore);
const databaseConnection = openedStore.database;
let store = openedStore.store;
const migrated = openedStore.migrated;
if (migrated) console.log(`Migrated existing store data from ${DATA_FILE} into SQLite. The source file was preserved.`);
let mutationQueue: Promise<void> = Promise.resolve();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

async function mutate<T>(operation: () => T | Promise<T>): Promise<T> {
  let release!: () => void;
  const previous = mutationQueue;
  mutationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const before = structuredClone(store);
  try {
    const result = await operation();
    persistStore(databaseConnection, store);
    return result;
  } catch (error) {
    store = before;
    throw error;
  } finally {
    release();
  }
}

function text(value: unknown, field: string, maxLength = 160): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw HttpError(400, `${field} is required and must be at most ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, maxLength = 240): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > maxLength) throw HttpError(400, `${field} must be at most ${maxLength} characters.`);
  return value.trim();
}

function numberValue(value: unknown, field: string, min = 0): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(result) || result < min || result > 1_000_000_000) throw HttpError(400, `${field} must be at least ${min}.`);
  return result;
}

function validRole(value: unknown): value is Role {
  return typeof value === 'string' && roles.includes(value as Role);
}

function newId(prefix: string) {
  return `${prefix}-${randomBytes(12).toString('hex')}`;
}

function HttpError(status: number, message: string) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function publicUser(user: User) {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

function cookieToken(request: Request) {
  const cookie = request.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
  return cookie?.slice(COOKIE_NAME.length + 1) ?? '';
}

function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function setSessionCookie(response: Response, token: string, expiresAt: number) {
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Expires=${new Date(expiresAt).toUTCString()}`];
  if (PRODUCTION) parts.push('Secure');
  response.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(response: Response) {
  response.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${PRODUCTION ? '; Secure' : ''}`);
}

function recordActivity(user: User, action: string) {
  store.activity.unshift({ id: newId('act'), userId: user.id, userName: user.name, action, createdAt: new Date().toISOString() });
  store.activity = store.activity.slice(0, 1000);
}

function requireAuth(request: AuthenticatedRequest, _response: Response, next: NextFunction) {
  const token = cookieToken(request);
  const session = token ? store.sessions[tokenDigest(token)] : undefined;
  if (!session || session.expiresAt <= Date.now()) {
    if (session) delete store.sessions[tokenDigest(token)];
    return next(HttpError(401, 'Please sign in to continue.'));
  }
  const user = store.users.find((item) => item.id === session.userId && item.active);
  if (!user) return next(HttpError(401, 'This account is inactive or no longer available.'));
  request.user = user;
  return next();
}

function requireObjectBody(request: Request): Record<string, unknown> {
  if (!isRecord(request.body)) throw HttpError(400, 'A JSON object is required.');
  return request.body;
}

function productById(id: string) {
  const product = store.products.find((item) => item.id === id && item.active);
  if (!product) throw HttpError(404, 'Product not found.');
  return product;
}

function supplierById(id: unknown) {
  if (typeof id !== 'string' || !id) throw HttpError(400, 'Choose a supplier.');
  const supplier = store.suppliers.find((item) => item.id === id && item.active);
  if (!supplier) throw HttpError(400, 'Choose an active supplier.');
  return supplier;
}

function inventorySummary() {
  const products = store.products.filter((item) => item.active);
  const transactions = store.transactions.filter((item) => item.type === 'sale' || item.type === 'return');
  const totalSales = transactions.reduce((sum, item) => sum + (item.type === 'sale' ? item.total : -item.total), 0);
  const lowStock = products.filter((item) => item.quantity <= item.reorderAt);
  return {
    totalProducts: products.length,
    availableUnits: products.reduce((sum, item) => sum + item.quantity, 0),
    lowStockItems: lowStock.length,
    totalSales,
    lowStock,
    recentTransactions: store.transactions.slice(0, 8),
    stockDistribution: {
      healthy: products.filter((item) => item.quantity > item.reorderAt).length,
      low: lowStock.filter((item) => item.quantity > 0).length,
      out: products.filter((item) => item.quantity === 0).length,
    },
  };
}

function canViewAllTransactions(user: User) {
  return user.role === 'admin' || user.role === 'manager';
}

function safeTransaction(transaction: Transaction, user: User) {
  if (user.role !== 'inventory') return transaction;
  const { unitAmount: _unitAmount, total: _total, ...inventoryTransaction } = transaction;
  return inventoryTransaction;
}

function safeProduct(product: Product, user: User) {
  if (user.role === 'admin' || user.role === 'manager') return product;
  return { ...product, cost: undefined, supplierId: undefined };
}

function dashboardFor(user: User) {
  const summary = inventorySummary();
  if (user.role === 'inventory') delete (summary as Partial<typeof summary>).totalSales;
  summary.lowStock = summary.lowStock.map((product) => safeProduct(product, user));
  if (user.role === 'sales') {
    const ownSales = store.transactions.filter((item) => item.userId === user.id && (item.type === 'sale' || item.type === 'return'));
    summary.totalSales = ownSales.reduce((sum, item) => sum + (item.type === 'sale' ? item.total : -item.total), 0);
    summary.recentTransactions = ownSales.slice(0, 8);
  }
  return summary;
}

function reportData(period: string) {
  const now = Date.now();
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: store.store.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateKey = (date: Date) => {
    const parts = Object.fromEntries(dateFormatter.formatToParts(date).map((item) => [item.type, item.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const localDateParts = Object.fromEntries(dateFormatter.formatToParts(new Date(now)).map((item) => [item.type, item.value]));
  const todayKey = `${localDateParts.year}-${localDateParts.month}-${localDateParts.day}`;
  const calendarDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(Number(localDateParts.year), Number(localDateParts.month) - 1, Number(localDateParts.day) - (6 - index), 12));
    return date.toISOString().slice(0, 10);
  });
  const boundaries: Record<string, number> = {
    day: 0,
    week: now - 7 * 24 * 60 * 60 * 1000,
    month: now - 30 * 24 * 60 * 60 * 1000,
    all: 0,
  };
  const boundary = boundaries[period] ?? boundaries.month;
  const filtered = store.transactions.filter((item) => period === 'day'
    ? dateKey(new Date(item.createdAt)) === todayKey
    : new Date(item.createdAt).getTime() >= boundary);
  const sales = filtered.filter((item) => item.type === 'sale');
  const purchases = filtered.filter((item) => item.type === 'purchase');
  const returns = filtered.filter((item) => item.type === 'return');
  const bestSelling = new Map<string, { product: string; quantity: number; total: number }>();
  [...sales, ...returns].forEach((item) => {
    const current = bestSelling.get(item.productId) ?? { product: item.productName, quantity: 0, total: 0 };
    const direction = item.type === 'return' ? -1 : 1;
    current.quantity += direction * item.quantity;
    current.total += direction * item.total;
    bestSelling.set(item.productId, current);
  });
  return {
    period,
    sales: sales.reduce((sum, item) => sum + item.total, 0) - returns.reduce((sum, item) => sum + item.total, 0),
    purchaseSpend: purchases.reduce((sum, item) => sum + item.total, 0),
    transactionCount: filtered.length,
    dailySales: calendarDays.map((date) => ({
      date,
      total: store.transactions.filter((item) => dateKey(new Date(item.createdAt)) === date && (item.type === 'sale' || item.type === 'return'))
        .reduce((sum, item) => sum + (item.type === 'sale' ? item.total : -item.total), 0),
    })),
    bestSelling: [...bestSelling.values()].filter((item) => item.quantity > 0).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    lowStock: store.products.filter((item) => item.active && item.quantity <= item.reorderAt),
  };
}

function requireCsrfOrigin(request: Request, _response: Response, next: NextFunction) {
  const origin = request.get('origin');
  if (origin && new URL(origin).host !== request.get('host')) return next(HttpError(403, 'Requests must originate from this store.'));
  return next();
}

async function main() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (PRODUCTION) response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  }, requireCsrfOrigin);

  app.get('/api/setup', (_request, response) => {
    response.json({ required: store.users.filter((user) => user.role === 'admin').length === 0 });
  });

  app.post('/api/auth/login', async (request, response, next) => {
    try {
      const body = requireObjectBody(request);
      const email = text(body.email, 'Email', 254).toLowerCase();
      const password = typeof body.password === 'string' ? body.password : '';
      const workspaceRole = body.workspaceRole;
      if (workspaceRole !== undefined && !validRole(workspaceRole)) throw HttpError(400, 'Choose a valid workspace.');
      const source = request.ip ?? 'unknown';
      const attempts = loginAttempts.get(source);
      if (attempts && attempts.resetAt > Date.now() && attempts.count >= 8) throw HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
      const user = store.users.find((item) => item.email.toLowerCase() === email);
      if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
        const current = loginAttempts.get(source);
        loginAttempts.set(source, current && current.resetAt > Date.now()
          ? { count: current.count + 1, resetAt: current.resetAt }
          : { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
        throw HttpError(401, 'Email or password is incorrect.');
      }
      if (workspaceRole && user.role !== workspaceRole) {
        throw HttpError(403, `This account belongs to the ${user.role} workspace. Choose the correct workspace to continue.`);
      }
      loginAttempts.delete(source);
      const upgradedPasswordHash = user.passwordHash.startsWith('$2') ? null : await hashPassword(password);
      const token = randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + SESSION_TTL;
      await mutate(() => {
        if (upgradedPasswordHash) user.passwordHash = upgradedPasswordHash;
        store.sessions[tokenDigest(token)] = { userId: user.id, expiresAt };
        recordActivity(user, 'signed in');
      });
      setSessionCookie(response, token, expiresAt);
      response.json({ user: publicUser(user), store: store.store });
    } catch (error) { next(error); }
  });

  app.get('/api/auth/me', requireAuth, (request: AuthenticatedRequest, response) => {
    response.json({ user: publicUser(request.user!), store: store.store, expiresIn: SESSION_TTL });
  });

  app.post('/api/auth/logout', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const token = cookieToken(request);
      await mutate(() => {
        delete store.sessions[tokenDigest(token)];
        recordActivity(request.user!, 'signed out');
      });
      clearSessionCookie(response);
      response.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.use('/api', requireAuth);

  app.use('/api/owner', allowRoles('admin'), createOwnerRouter(databaseConnection, () => store));

  app.get('/api/bootstrap', (request: AuthenticatedRequest, response) => {
    const user = request.user!;
    const products = store.products.filter((item) => item.active).map((item) => safeProduct(item, user));
    const transactions = canViewAllTransactions(user)
      ? store.transactions
      : user.role === 'inventory'
        ? store.transactions.filter((item) => item.type === 'purchase')
        : store.transactions.filter((item) => item.userId === user.id && (item.type === 'sale' || item.type === 'return'));
    response.json({
      user: publicUser(user),
      store: store.store,
      products,
      suppliers: user.role === 'sales' ? [] : store.suppliers.filter((item) => item.active),
      categories: store.categories,
      transactions: transactions.map((item) => safeTransaction(item, user)),
      movements: user.role === 'sales' ? [] : store.movements.slice(0, 100),
      dashboard: dashboardFor(user),
      users: user.role === 'admin' ? store.users.map(publicUser) : [],
      activity: user.role === 'admin' ? store.activity.slice(0, 50) : [],
    });
  });

  app.put('/api/store', allowRoles('admin'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const body = requireObjectBody(request);
      const currency = text(body.currency, 'Currency', 3).toUpperCase();
      const timezone = text(body.timezone, 'Timezone', 80);
      try {
        new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(0);
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
      } catch {
        throw HttpError(400, 'Choose a supported currency and timezone.');
      }
      await mutate(() => {
        store.store.name = text(body.name, 'Store name', 120);
        store.store.currency = currency;
        store.store.timezone = timezone;
        recordActivity(request.user!, 'updated store settings');
      });
      response.json({ store: store.store });
    } catch (error) { next(error); }
  });

  app.post('/api/categories', allowRoles('admin', 'manager'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const name = text(requireObjectBody(request).name, 'Category name', 60);
      await mutate(() => {
        if (store.categories.some((item) => item.toLowerCase() === name.toLowerCase())) throw HttpError(409, 'That category already exists.');
        store.categories.push(name);
        store.categories.sort((a, b) => a.localeCompare(b));
        recordActivity(request.user!, `created category ${name}`);
      });
      response.status(201).json({ categories: store.categories });
    } catch (error) { next(error); }
  });

  app.delete('/api/categories/:name', allowRoles('admin', 'manager'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const category = request.params.name;
      await mutate(() => {
        // Block only if active/visible products still use this category
        if (store.products.some((item) => item.active && item.category === category)) {
          throw HttpError(409, 'Remove or reassign all active products in this category first.');
        }
        // Clear the category on any archived (inactive) products so the SQLite FK does not fire
        for (const item of store.products) {
          if (item.category === category) item.category = '';
        }
        store.categories = store.categories.filter((item) => item !== category);
        recordActivity(request.user!, `deleted category ${category}`);
      });
      response.json({ categories: store.categories });
    } catch (error) { next(error); }
  });

  app.post('/api/products', allowRoles('admin', 'manager'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const body = requireObjectBody(request);
      const product = await mutate(() => {
        const sku = text(body.sku, 'SKU', 64);
        if (store.products.some((item) => item.sku.toLowerCase() === sku.toLowerCase())) throw HttpError(409, 'A product with this SKU already exists.');
        const barcode = optionalText(body.barcode, 'Barcode', 80);
        if (barcode && store.products.some((item) => item.barcode === barcode)) throw HttpError(409, 'A product with this barcode already exists.');
        const category = text(body.category, 'Category', 60);
        if (!store.categories.includes(category)) throw HttpError(400, 'Choose a valid product category.');
        const supplier = supplierById(body.supplierId);
        const now = new Date().toISOString();
        const item: Product = {
          id: newId('prd'), name: text(body.name, 'Product name'), sku, barcode,
          category, quantity: numberValue(body.quantity, 'Quantity'), reorderAt: numberValue(body.reorderAt, 'Reorder point'),
          cost: numberValue(body.cost, 'Purchase cost'), price: numberValue(body.price, 'Selling price'),
          supplierId: supplier.id, imageUrl: optionalText(body.imageUrl, 'Image URL', 2000), active: true, createdAt: now, updatedAt: now,
        };
        store.products.unshift(item);
        if (item.quantity > 0) addMovement(item, 'adjustment', item.quantity, 0, item.quantity, 'Opening inventory', request.user!);
        recordActivity(request.user!, `created product ${item.name}`);
        return item;
      });
      response.status(201).json({ product });
    } catch (error) { next(error); }
  });

  app.put('/api/products/:id', allowRoles('admin', 'manager'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const body = requireObjectBody(request);
      const product = await mutate(() => {
        const item = productById(request.params.id);
        const category = text(body.category, 'Category', 60);
        if (!store.categories.includes(category)) throw HttpError(400, 'Choose a valid product category.');
        const supplier = supplierById(body.supplierId);
        const sku = text(body.sku, 'SKU', 64);
        if (store.products.some((candidate) => candidate.id !== item.id && candidate.sku.toLowerCase() === sku.toLowerCase())) throw HttpError(409, 'A product with this SKU already exists.');
        const barcode = optionalText(body.barcode, 'Barcode', 80);
        if (barcode && store.products.some((candidate) => candidate.id !== item.id && candidate.barcode === barcode)) throw HttpError(409, 'A product with this barcode already exists.');
        item.name = text(body.name, 'Product name');
        item.sku = sku;
        item.barcode = barcode;
        item.category = category;
        item.reorderAt = numberValue(body.reorderAt, 'Reorder point');
        item.cost = numberValue(body.cost, 'Purchase cost');
        item.price = numberValue(body.price, 'Selling price');
        item.supplierId = supplier.id;
        item.imageUrl = optionalText(body.imageUrl, 'Image URL', 2000);
        item.updatedAt = new Date().toISOString();
        recordActivity(request.user!, `updated product ${item.name}`);
        return item;
      });
      response.json({ product });
    } catch (error) { next(error); }
  });

  app.delete('/api/products/:id', allowRoles('admin', 'manager'), async (request: AuthenticatedRequest, response, next) => {
    try {
      await mutate(() => {
        const product = productById(request.params.id);
        product.active = false;
        product.updatedAt = new Date().toISOString();
        recordActivity(request.user!, `archived product ${product.name}`);
      });
      response.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.post('/api/stock', allowRoles('admin', 'manager', 'inventory'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const body = requireObjectBody(request);
      const quantity = numberValue(body.quantity, 'Quantity', 1);
      if (body.operation !== 'in' && body.operation !== 'out') throw HttpError(400, 'Choose stock-in or stock-out.');
      await mutate(() => {
        const product = productById(text(body.productId, 'Product'));
        const before = product.quantity;
        if (body.operation === 'out' && before < quantity) throw HttpError(409, 'This adjustment would make available stock negative.');
        product.quantity += body.operation === 'in' ? quantity : -quantity;
        product.updatedAt = new Date().toISOString();
        addMovement(product, 'adjustment', body.operation === 'in' ? quantity : -quantity, before, product.quantity, optionalText(body.note, 'Note', 240) || 'Manual stock adjustment', request.user!);
        recordActivity(request.user!, `adjusted stock for ${product.name}`);
      });
      response.json({ product: safeProduct(productById(String(body.productId)), request.user!), dashboard: dashboardFor(request.user!) });
    } catch (error) { next(error); }
  });

  app.post('/api/purchases', allowRoles('admin', 'manager', 'inventory'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const body = requireObjectBody(request);
      const productId = text(body.productId, 'Product');
      const quantity = numberValue(body.quantity, 'Quantity', 1);
      const supplierId = text(body.supplierId, 'Supplier');
      const transaction = await mutate(() => {
        const product = productById(productId);
        const supplier = supplierById(supplierId);
        const cost = request.user!.role === 'inventory'
          ? product.cost ?? 0
          : body.unitCost === undefined ? (product.cost ?? 0) : numberValue(body.unitCost, 'Unit cost');
        const before = product.quantity;
        product.quantity += quantity;
        if (request.user!.role !== 'inventory') product.cost = cost;
        product.supplierId = supplier.id;
        product.updatedAt = new Date().toISOString();
        const entry: Transaction = {
          id: newId('txn'), type: 'purchase', productId, productName: product.name, supplierId: supplier.id,
          supplierName: supplier.name, quantity, unitAmount: cost, total: cost * quantity, invoiceNumber: null,
          returnedQuantity: 0, customer: null, userId: request.user!.id, userName: request.user!.name,
          note: optionalText(body.note, 'Note', 240), createdAt: new Date().toISOString(),
        };
        store.transactions.unshift(entry);
        addMovement(product, 'purchase', quantity, before, product.quantity, entry.note || `Purchase from ${supplier.name}`, request.user!);
        recordActivity(request.user!, `received ${quantity} × ${product.name}`);
        return entry;
      });
      response.status(201).json({ transaction: safeTransaction(transaction, request.user!), dashboard: dashboardFor(request.user!) });
    } catch (error) { next(error); }
  });

  app.post('/api/sales', allowRoles('admin', 'manager', 'sales'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const body = requireObjectBody(request);
      const requestId = optionalText(body.requestId, 'Request ID', 80);
      if (requestId && !/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) throw HttpError(400, 'The checkout request ID is invalid.');
      const submittedItems = Array.isArray(body.items)
        ? body.items
        : [{ productId: body.productId, quantity: body.quantity }];
      if (submittedItems.length < 1 || submittedItems.length > 50) throw HttpError(400, 'A sale must contain between 1 and 50 product lines.');
      const quantities = new Map<string, number>();
      submittedItems.forEach((value) => {
        if (!isRecord(value)) throw HttpError(400, 'Each sale line must include a product and quantity.');
        const productId = text(value.productId, 'Product');
        const quantity = numberValue(value.quantity, 'Quantity', 1);
        if (!Number.isSafeInteger(quantity)) throw HttpError(400, 'Sale quantities must be whole units.');
        quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
      });
      const customer = optionalText(body.customer, 'Customer', 120) || null;
      const note = optionalText(body.note, 'Note', 240);
      const payloadHash = createHash('sha256')
        .update(JSON.stringify({ items: [...quantities].sort(([left], [right]) => left.localeCompare(right)), customer, note }))
        .digest('hex');
      const result = await mutate(() => {
        const idempotencyKey = requestId ? `${request.user!.id}:${requestId}` : '';
        const previous = idempotencyKey ? store.saleRequests?.[idempotencyKey] : undefined;
        if (previous) {
          if (previous.payloadHash && previous.payloadHash !== payloadHash) throw HttpError(409, 'This checkout request ID was already used for a different sale.');
          return { transactions: previous.transactions, replayed: true };
        }

        const lines = [...quantities].map(([productId, quantity]) => {
          const product = productById(productId);
          if (product.quantity < quantity) throw HttpError(409, `Only ${product.quantity} units of ${product.name} are currently available.`);
          return { product, quantity };
        });
        const now = new Date().toISOString();
        const invoiceNumber = `INV-${now.slice(0, 10).replaceAll('-', '')}-${randomBytes(3).toString('hex').toUpperCase()}`;
        const entries = lines.map(({ product, quantity }): Transaction => {
          const before = product.quantity;
          product.quantity -= quantity;
          product.updatedAt = now;
          const entry: Transaction = {
            id: newId('txn'), type: 'sale', productId: product.id, productName: product.name, supplierId: null, supplierName: null,
            quantity, unitAmount: product.price, total: product.price * quantity, invoiceNumber,
            returnedQuantity: 0, customer, userId: request.user!.id, userName: request.user!.name, note, createdAt: now,
          };
          store.transactions.unshift(entry);
          addMovement(product, 'sale', -quantity, before, product.quantity, invoiceNumber, request.user!);
          return entry;
        });
        recordActivity(request.user!, `completed ${invoiceNumber} with ${entries.length} product line${entries.length === 1 ? '' : 's'}`);
        if (idempotencyKey) {
          store.saleRequests ??= {};
          store.saleRequests[idempotencyKey] = { userId: request.user!.id, transactions: entries, payloadHash };
          const requestKeys = Object.keys(store.saleRequests);
          requestKeys.slice(0, Math.max(0, requestKeys.length - 500)).forEach((key) => { delete store.saleRequests![key]; });
        }
        return { transactions: entries, replayed: false };
      });
      const safeTransactions = result.transactions.map((transaction) => safeTransaction(transaction, request.user!));
      response.status(result.replayed ? 200 : 201).json({
        transaction: safeTransactions[0],
        transactions: safeTransactions,
        replayed: result.replayed,
        dashboard: dashboardFor(request.user!),
      });
    } catch (error) { next(error); }
  });

  app.post('/api/sales/:id/return', allowRoles('admin', 'manager', 'sales'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const quantity = numberValue(requireObjectBody(request).quantity, 'Quantity', 1);
      const returned = await mutate(() => {
        const sale = store.transactions.find((item) => item.id === request.params.id && item.type === 'sale');
        if (!sale) throw HttpError(404, 'Sale not found.');
        if (request.user!.role === 'sales' && sale.userId !== request.user!.id) throw HttpError(403, 'You can only process a return for your own sale.');
        if (sale.quantity - sale.returnedQuantity < quantity) throw HttpError(409, 'The return exceeds the unreturned quantity on this sale.');
        const product = store.products.find((item) => item.id === sale.productId);
        if (!product) throw HttpError(409, 'The original product is no longer available.');
        sale.returnedQuantity += quantity;
        const before = product.quantity;
        product.quantity += quantity;
        product.updatedAt = new Date().toISOString();
        const entry: Transaction = {
          id: newId('txn'), type: 'return', productId: sale.productId, productName: sale.productName,
          supplierId: null, supplierName: null, quantity, unitAmount: sale.unitAmount,
          total: sale.unitAmount * quantity, invoiceNumber: sale.invoiceNumber, returnedQuantity: 0,
          customer: sale.customer, userId: request.user!.id, userName: request.user!.name,
          note: `Return against ${sale.invoiceNumber}`, createdAt: new Date().toISOString(),
        };
        store.transactions.unshift(entry);
        addMovement(product, 'return', quantity, before, product.quantity, entry.note, request.user!);
        recordActivity(request.user!, `processed a return for ${sale.invoiceNumber}`);
        return entry;
      });
      response.status(201).json({ transaction: returned, dashboard: dashboardFor(request.user!) });
    } catch (error) { next(error); }
  });

  app.get('/api/suppliers', allowRoles('admin', 'manager', 'inventory'), (_request, response) => {
    response.json({ suppliers: store.suppliers.filter((supplier) => supplier.active) });
  });

  app.post('/api/suppliers', allowRoles('admin', 'manager'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const body = requireObjectBody(request);
      const supplier = await mutate(() => {
        const email = text(body.email, 'Email', 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw HttpError(400, 'Enter a valid supplier email.');
        const item: Supplier = {
          id: newId('sup'), name: text(body.name, 'Supplier name'), contact: text(body.contact, 'Contact person'),
          email, phone: optionalText(body.phone, 'Phone', 40), address: optionalText(body.address, 'Address', 240),
          leadTime: optionalText(body.leadTime, 'Lead time', 80), active: true,
        };
        store.suppliers.unshift(item);
        recordActivity(request.user!, `created supplier ${item.name}`);
        return item;
      });
      response.status(201).json({ supplier });
    } catch (error) { next(error); }
  });

  app.put('/api/suppliers/:id', allowRoles('admin', 'manager'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const body = requireObjectBody(request);
      const supplier = await mutate(() => {
        const item = store.suppliers.find((entry) => entry.id === request.params.id && entry.active);
        if (!item) throw HttpError(404, 'Supplier not found.');
        item.name = text(body.name, 'Supplier name');
        item.contact = text(body.contact, 'Contact person');
        item.email = text(body.email, 'Email', 254).toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item.email)) throw HttpError(400, 'Enter a valid supplier email.');
        item.phone = optionalText(body.phone, 'Phone', 40);
        item.address = optionalText(body.address, 'Address', 240);
        item.leadTime = optionalText(body.leadTime, 'Lead time', 80);
        recordActivity(request.user!, `updated supplier ${item.name}`);
        return item;
      });
      response.json({ supplier });
    } catch (error) { next(error); }
  });

  app.delete('/api/suppliers/:id', allowRoles('admin', 'manager'), async (request: AuthenticatedRequest, response, next) => {
    try {
      await mutate(() => {
        const supplier = store.suppliers.find((entry) => entry.id === request.params.id && entry.active);
        if (!supplier) throw HttpError(404, 'Supplier not found.');
        if (store.products.some((item) => item.active && item.supplierId === supplier.id)) throw HttpError(409, 'Reassign this supplier’s products before deactivating them.');
        supplier.active = false;
        recordActivity(request.user!, `deactivated supplier ${supplier.name}`);
      });
      response.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.get('/api/movements', allowRoles('admin', 'manager', 'inventory'), (request: AuthenticatedRequest, response) => {
    response.json({ movements: store.movements.slice(0, 500) });
  });

  app.get('/api/transactions', allowRoles('admin', 'manager'), (_request, response) => {
    response.json({ transactions: store.transactions });
  });

  app.get('/api/transactions/mine', allowRoles('admin', 'manager', 'sales'), (request: AuthenticatedRequest, response) => {
    const transactions = store.transactions.filter((item) => item.userId === request.user!.id);
    response.json({ transactions });
  });

  app.get('/api/reports', allowRoles('admin', 'manager'), (request, response) => {
    const period = typeof request.query.period === 'string' ? request.query.period : 'month';
    response.json(reportData(period));
  });

  app.get('/api/reports/inventory', allowRoles('admin', 'manager', 'inventory'), (_request, response) => {
    const products = store.products.filter((item) => item.active);
    response.json({
      inventory: products.map((item) => ({
        id: item.id, name: item.name, sku: item.sku, category: item.category, quantity: item.quantity,
        reorderAt: item.reorderAt, lowStock: item.quantity <= item.reorderAt,
        ...(requestRole(_request) === 'inventory' ? {} : { cost: item.cost, price: item.price }),
      })),
      lowStock: products.filter((item) => item.quantity <= item.reorderAt).map((item) => safeProduct(item, (_request as AuthenticatedRequest).user!)),
    });
  });

  app.get('/api/users', allowRoles('admin'), (_request, response) => {
    response.json({ users: store.users.filter((user) => user.role !== 'admin').map(publicUser), activity: store.activity.slice(0, 250) });
  });

  app.post('/api/users', allowRoles('admin'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const body = requireObjectBody(request);
      const name = text(body.name, 'Name');
      const email = text(body.email, 'Email', 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw HttpError(400, 'Enter a valid email address.');
      if (!validRole(body.role) || body.role === 'admin') throw HttpError(400, 'New employees must be assigned the Manager, Inventory Staff, or Sales Staff role.');
      const passwordHash = await hashPassword(body.password as string);
      const user = await mutate(() => {
        if (store.users.some((item) => item.email.toLowerCase() === email)) throw HttpError(409, 'An account already uses this email.');
        const item: User = { id: newId('usr'), name, email, passwordHash, role: body.role as Role, active: true, createdAt: new Date().toISOString() };
        store.users.push(item);
        recordActivity(request.user!, `created ${item.role} account for ${item.email}`);
        return item;
      });
      response.status(201).json({ user: publicUser(user) });
    } catch (error) { next(error); }
  });

  app.put('/api/users/:id', allowRoles('admin'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const body = requireObjectBody(request);
      const user = await mutate(async () => {
        const target = store.users.find((item) => item.id === request.params.id);
        if (!target) throw HttpError(404, 'Account not found.');
        if (target.role === 'admin') throw HttpError(403, 'Owner accounts cannot be managed as employees.');
        const nextRole = body.role === undefined ? target.role : body.role;
        const nextActive = body.active === undefined ? target.active : body.active;
        if (!validRole(nextRole) || nextRole === 'admin') throw HttpError(400, 'Employees can only be assigned Manager, Inventory Staff, or Sales Staff.');
        if (body.name !== undefined) target.name = text(body.name, 'Name');
        if (body.email !== undefined) {
          const email = text(body.email, 'Email', 254).toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw HttpError(400, 'Enter a valid email address.');
          if (store.users.some((item) => item.id !== target.id && item.email.toLowerCase() === email)) throw HttpError(409, 'An account already uses this email.');
          target.email = email;
        }
        if (body.role !== undefined) {
          if (!validRole(body.role) || body.role === 'admin') throw HttpError(400, 'Employees can only be assigned Manager, Inventory Staff, or Sales Staff.');
          target.role = body.role;
        }
        if (body.active !== undefined) {
          if (typeof body.active !== 'boolean') throw HttpError(400, 'Account status must be active or inactive.');
          target.active = body.active;
          if (!target.active) {
            Object.entries(store.sessions).forEach(([key, session]) => { if (session.userId === target.id) delete store.sessions[key]; });
          }
        }
        if (body.password !== undefined) {
          target.passwordHash = await hashPassword(body.password as string);
          Object.entries(store.sessions).forEach(([key, session]) => { if (session.userId === target.id) delete store.sessions[key]; });
        }
        recordActivity(request.user!, `updated account for ${target.email}`);
        return target;
      });
      response.json({ user: publicUser(user) });
    } catch (error) { next(error); }
  });

  // Purchase Requests
  app.get('/api/purchase-requests', requireAuth, (request: AuthenticatedRequest, response) => {
    const user = request.user!;
    const requests = store.purchaseRequests ?? [];
    if (user.role === 'admin') return response.json({ purchaseRequests: requests });
    if (user.role === 'manager') return response.json({ purchaseRequests: requests });
    // inventory / sales staff: only see their own requests
    return response.json({ purchaseRequests: requests.filter((r) => r.requestedBy === user.id) });
  });

  app.post('/api/purchase-requests', allowRoles('admin', 'manager', 'inventory', 'sales'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const body = requireObjectBody(request);
      const result = await mutate(() => {
        const product = productById(text(body.productId, 'Product'));
        const supplier = supplierById(body.supplierId);
        const quantity = numberValue(body.quantity, 'Quantity', 1);
        const req: PurchaseRequest = {
          id: newId('preq'), productId: product.id, productName: product.name,
          supplierId: supplier.id, supplierName: supplier.name, quantity,
          note: optionalText(body.note, 'Note', 240),
          status: 'pending', requestedBy: request.user!.id, requestedByName: request.user!.name,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        store.purchaseRequests = store.purchaseRequests ?? [];
        store.purchaseRequests.unshift(req);
        // Notify all managers and admins
        addNotification('purchase_request', `New Purchase Request from ${request.user!.name}`,
          `${request.user!.name} requested ${quantity}× ${product.name} from ${supplier.name}`, undefined);
        recordActivity(request.user!, `submitted purchase request for ${quantity}× ${product.name}`);
        return req;
      });
      response.status(201).json({ purchaseRequest: result });
    } catch (error) { next(error); }
  });

  // Manager reviews a staff request: either forwards to owner or rejects
  app.put('/api/purchase-requests/:id/manager-review', allowRoles('manager'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const body = requireObjectBody(request);
      const action = body.action as string;
      if (action !== 'forward' && action !== 'reject') throw HttpError(400, 'Action must be "forward" or "reject".');
      const result = await mutate(() => {
        const req = (store.purchaseRequests ?? []).find((r) => r.id === request.params.id);
        if (!req) throw HttpError(404, 'Purchase request not found.');
        if (req.status !== 'pending') throw HttpError(409, 'This request has already been reviewed.');
        if (req.requestedBy === request.user!.id) throw HttpError(403, 'You cannot review your own purchase request.');
        const now = new Date().toISOString();
        if (action === 'forward') {
          req.status = 'forwarded';
          req.forwardedBy = request.user!.id;
          req.forwardedByName = request.user!.name;
          req.forwardedNote = optionalText(body.note, 'Note', 240);
          req.forwardedAt = now;
          req.updatedAt = now;
          // Notify owner(s) that a request is waiting for final approval
          addNotification('purchase_request',
            `Request Forwarded for Approval — ${req.productName}`,
            `${request.user!.name} reviewed and forwarded ${req.quantity}× ${req.productName} request from ${req.requestedByName} for your approval.`,
            undefined);
          // Notify the requester that their request was accepted by manager
          addNotification('purchase_approved',
            'Your Request Was Accepted by Manager',
            `${request.user!.name} accepted your request for ${req.quantity}× ${req.productName} and forwarded it to the Owner for final approval.`,
            req.requestedBy);
          recordActivity(request.user!, `forwarded purchase request for ${req.quantity}× ${req.productName} to Owner`);
        } else {
          req.status = 'rejected';
          req.reviewedBy = request.user!.id;
          req.reviewedByName = request.user!.name;
          req.reviewNote = optionalText(body.reviewNote, 'Rejection reason', 240);
          req.updatedAt = now;
          // Notify the requester of rejection
          addNotification('purchase_rejected',
            'Purchase Request Rejected',
            `Your request for ${req.quantity}× ${req.productName} was rejected by ${request.user!.name}${req.reviewNote ? ': ' + req.reviewNote : '.'}`,
            req.requestedBy);
          recordActivity(request.user!, `rejected purchase request for ${req.quantity}× ${req.productName}`);
        }
        return req;
      });
      response.json({ purchaseRequest: result });
    } catch (error) { next(error); }
  });

  // Owner gives final approval/rejection on a forwarded request
  app.put('/api/purchase-requests/:id/review', allowRoles('admin'), async (request: AuthenticatedRequest, response, next) => {
    try {
      const body = requireObjectBody(request);
      const status = body.status as string;
      if (status !== 'approved' && status !== 'rejected') throw HttpError(400, 'Status must be approved or rejected.');
      const result = await mutate(() => {
        const req = (store.purchaseRequests ?? []).find((r) => r.id === request.params.id);
        if (!req) throw HttpError(404, 'Purchase request not found.');
        // Owner can approve/reject pending OR forwarded requests
        if (req.status !== 'pending' && req.status !== 'forwarded') {
          throw HttpError(409, 'This request has already been reviewed.');
        }
        req.status = status as 'approved' | 'rejected';
        req.reviewedBy = request.user!.id;
        req.reviewedByName = request.user!.name;
        req.reviewNote = optionalText(body.reviewNote, 'Review note', 240);
        req.updatedAt = new Date().toISOString();
        const notifType = status === 'approved' ? 'purchase_approved' : 'purchase_rejected';
        addNotification(notifType,
          `Purchase Request ${status === 'approved' ? 'Approved' : 'Rejected'} by Owner`,
          `Your request for ${req.quantity}× ${req.productName} was ${status} by ${request.user!.name}.`,
          req.requestedBy);
        // Also notify the manager who forwarded it
        if (req.forwardedBy && req.forwardedBy !== request.user!.id) {
          addNotification(notifType,
            `Forwarded Request ${status === 'approved' ? 'Approved' : 'Rejected'}`,
            `The request for ${req.quantity}× ${req.productName} that you forwarded has been ${status} by the Owner.`,
            req.forwardedBy);
        }
        recordActivity(request.user!, `${status} purchase request for ${req.quantity}× ${req.productName}`);
        return req;
      });
      response.json({ purchaseRequest: result });
    } catch (error) { next(error); }
  });

  // Damaged Products
  app.get('/api/damaged', requireAuth, (request: AuthenticatedRequest, response) => {
    response.json({ damagedProducts: store.damagedProducts ?? [] });
  });

  app.post('/api/damaged', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const body = requireObjectBody(request);
      const quantity = numberValue(body.quantity, 'Quantity', 1);
      const result = await mutate(() => {
        const product = productById(text(body.productId, 'Product'));
        if (product.quantity < quantity) throw HttpError(409, 'Not enough stock to mark as damaged.');
        const before = product.quantity;
        product.quantity -= quantity;
        product.updatedAt = new Date().toISOString();
        addMovement(product, 'adjustment', -quantity, before, product.quantity, `Damaged: ${optionalText(body.reason, 'Reason', 240) || 'Reported as damaged'}`, request.user!);
        const damaged: DamagedProduct = {
          id: newId('dmg'), productId: product.id, productName: product.name, quantity,
          reason: optionalText(body.reason, 'Reason', 240),
          reportedBy: request.user!.id, reportedByName: request.user!.name, createdAt: new Date().toISOString(),
        };
        store.damagedProducts = store.damagedProducts ?? [];
        store.damagedProducts.unshift(damaged);
        addNotification('damaged', 'Damaged Products Reported', `${request.user!.name} reported ${quantity}× ${product.name} as damaged.`, undefined);
        recordActivity(request.user!, `reported ${quantity}× ${product.name} as damaged`);
        return damaged;
      });
      response.status(201).json({ damagedProduct: result });
    } catch (error) { next(error); }
  });

  // Notifications
  app.get('/api/notifications', requireAuth, (request: AuthenticatedRequest, response) => {
    const user = request.user!;
    const all = store.notifications ?? [];
    const mine = all.filter((n) => !n.userId || n.userId === user.id || user.role === 'admin');
    response.json({ notifications: mine.slice(0, 50) });
  });

  app.put('/api/notifications/:id/read', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      await mutate(() => {
        const notif = (store.notifications ?? []).find((n) => n.id === request.params.id);
        if (notif) notif.read = true;
      });
      response.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.put('/api/notifications/read-all', requireAuth, async (request: AuthenticatedRequest, response, next) => {
    try {
      const user = request.user!;
      await mutate(() => {
        (store.notifications ?? []).forEach((n) => {
          if (!n.userId || n.userId === user.id || user.role === 'admin') n.read = true;
        });
      });
      response.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.use('/api', (_request, _response, next) => next(HttpError(404, 'API endpoint not found.')));
  app.use((error: Error & { status?: number }, _request: Request, response: Response, _next: NextFunction) => {
    if ((error as Error & { type?: string }).type === 'entity.parse.failed') {
      response.status(400).json({ error: 'Request body must contain valid JSON.' });
      return;
    }
    const status = error.status ?? 500;
    if (status >= 500) console.error('API request failed.', error);
    response.status(status).json({ error: status >= 500 ? 'The request could not be completed.' : error.message });
  });

  if (PRODUCTION) {
    app.use(express.static(path.resolve('dist')));
    app.get('*', (_request, response) => response.sendFile(path.resolve('dist/index.html')));
  }

  const host = PRODUCTION ? '0.0.0.0' : (process.env.HOST ?? '127.0.0.1');
  app.listen(PORT, host, () => {
    console.log(`Stockroom API is running at http://localhost:${PORT}`);
    console.log(`SQLite database: ${DATABASE_FILE}`);
    if (!store.users.some((user) => user.role === 'admin')) console.log('No Owner account exists. Run npm run owner:create to initialize one.');
  });
}

function addNotification(type: Notification['type'], title: string, message: string, userId: string | undefined) {
  store.notifications = store.notifications ?? [];
  store.notifications.unshift({
    id: newId('notif'), type, title, message, read: false, userId, createdAt: new Date().toISOString(),
  });
  if (store.notifications.length > 200) store.notifications = store.notifications.slice(0, 200);
}

function addMovement(product: Product, type: Movement['type'], quantity: number, before: number, after: number, note: string, user: User) {
  store.movements.unshift({
    id: newId('mov'), productId: product.id, productName: product.name, type, quantity,
    before, after, note, userId: user.id, userName: user.name, createdAt: new Date().toISOString(),
  });
}

function requestRole(request: Request): Role {
  return (request as AuthenticatedRequest).user!.role;
}

main().catch((error: unknown) => {
  console.error('Unable to start the Stockroom server.', error);
  process.exitCode = 1;
});
