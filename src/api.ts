export type Role = 'admin' | 'manager' | 'inventory' | 'sales';
export type Section = 'dashboard' | 'products' | 'stock' | 'purchases' | 'sales' | 'suppliers' | 'reports' | 'users' | 'settings';
export type TransactionType = 'purchase' | 'sale' | 'return';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  quantity: number;
  reorderAt: number;
  cost?: number;
  price?: number;
  supplierId?: string;
  imageUrl: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  address: string;
  leadTime: string;
  active: boolean;
}

export interface Transaction {
  id: string;
  type: TransactionType;
  productId: string;
  productName: string;
  supplierId: string | null;
  supplierName: string | null;
  quantity: number;
  unitAmount?: number;
  total?: number;
  invoiceNumber: string | null;
  returnedQuantity: number;
  customer: string | null;
  userId: string;
  userName: string;
  note: string;
  createdAt: string;
}

export interface Movement {
  id: string;
  productId: string;
  productName: string;
  type: 'purchase' | 'sale' | 'return' | 'adjustment';
  quantity: number;
  before: number;
  after: number;
  note: string;
  userId: string;
  userName: string;
  createdAt: string;
}

export interface Dashboard {
  totalProducts: number;
  availableUnits: number;
  lowStockItems: number;
  totalSales: number;
  lowStock: Product[];
  recentTransactions: Transaction[];
  stockDistribution?: { healthy: number; low: number; out: number };
}

export interface StoreSettings {
  name: string;
  currency: string;
  timezone: string;
}

export interface Bootstrap {
  user: User;
  store: StoreSettings;
  products: Product[];
  suppliers: Supplier[];
  categories: string[];
  transactions: Transaction[];
  movements: Movement[];
  dashboard: Dashboard;
  users: User[];
  activity: Array<{ id: string; userId: string; userName: string; action: string; createdAt: string }>;
}

export interface Report {
  period: string;
  sales: number;
  purchaseSpend: number;
  transactionCount: number;
  dailySales: Array<{ date: string; total: number }>;
  bestSelling: Array<{ product: string; quantity: number; total: number }>;
  lowStock: Product[];
}

export interface OwnerDashboard {
  totalProducts: number;
  todaySales: number;
  availableStock: number;
  lowStock: number;
  totalEmployees: number;
  recentSales: Transaction[];
  recentPurchases: Transaction[];
  stockSummary: {
    totalProducts: number;
    availableUnits: number;
    lowStock: number;
    outOfStock: number;
  };
  employeeSummary: {
    active: number;
    inactive: number;
    total: number;
  };
}

export type PurchaseRequestStatus = 'pending' | 'forwarded' | 'approved' | 'rejected';

export interface PurchaseRequest {
  id: string;
  productId: string;
  productName: string;
  supplierId: string;
  supplierName: string;
  quantity: number;
  note: string;
  status: PurchaseRequestStatus;
  requestedBy: string;
  requestedByName: string;
  forwardedBy?: string;
  forwardedByName?: string;
  forwardedNote?: string;
  forwardedAt?: string;
  reviewedBy?: string;
  reviewedByName?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DamagedProduct {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  reason: string;
  reportedBy: string;
  reportedByName: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: 'low_stock' | 'purchase_request' | 'purchase_approved' | 'purchase_rejected' | 'damaged';
  title: string;
  message: string;
  read: boolean;
  userId?: string;
  createdAt: string;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : `The request failed (${response.status}).`;
    throw new ApiError(response.status, message);
  }
  return payload as T;
}

export function canAccess(user: User, section: Section): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'manager') return ['dashboard', 'products', 'stock', 'purchases', 'reports'].includes(section);
  if (user.role === 'inventory') return ['dashboard', 'products', 'stock', 'purchases'].includes(section);
  return ['dashboard', 'products', 'sales'].includes(section);
}

export function canManageProducts(user: User) {
  return user.role === 'admin' || user.role === 'manager';
}

export function canManageSuppliers(user: User) {
  return user.role === 'admin';
}

export function canManageUsers(user: User) {
  return user.role === 'admin';
}

export function canViewFinancials(user: User) {
  return user.role === 'admin' || user.role === 'manager';
}

export function canRecordPurchases(user: User) {
  return user.role !== 'sales';
}

export function canRecordSales(user: User) {
  return user.role !== 'inventory';
}
