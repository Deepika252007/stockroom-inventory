export type Role = 'admin' | 'manager' | 'inventory' | 'sales';
export type TransactionType = 'purchase' | 'sale' | 'return';

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
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
  price: number;
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
  unitAmount: number;
  total: number;
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

export interface Session {
  userId: string;
  expiresAt: number;
}

export interface SaleRequestRecord {
  userId: string;
  transactions: Transaction[];
  payloadHash?: string;
}

export interface Activity {
  id: string;
  userId: string;
  userName: string;
  action: string;
  createdAt: string;
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
  /** Manager who forwarded the request to owner */
  forwardedBy?: string;
  forwardedByName?: string;
  forwardedNote?: string;
  forwardedAt?: string;
  /** Admin/manager who did the final review */
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

export interface Store {
  store: { name: string; currency: string; timezone: string };
  users: User[];
  products: Product[];
  suppliers: Supplier[];
  categories: string[];
  transactions: Transaction[];
  movements: Movement[];
  activity: Activity[];
  sessions: Record<string, Session>;
  saleRequests?: Record<string, SaleRequestRecord>;
  purchaseRequests?: PurchaseRequest[];
  damagedProducts?: DamagedProduct[];
  notifications?: Notification[];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStoredStore(value: unknown): value is Store {
  return isRecord(value) && isRecord(value.store) && typeof value.store.name === 'string'
    && typeof value.store.currency === 'string' && typeof value.store.timezone === 'string'
    && Array.isArray(value.users) && Array.isArray(value.products) && Array.isArray(value.suppliers)
    && Array.isArray(value.categories) && Array.isArray(value.transactions) && Array.isArray(value.movements)
    && Array.isArray(value.activity) && isRecord(value.sessions);
}

export function emptyStore(): Store {
  return {
    store: { name: 'My Store', currency: 'USD', timezone: 'UTC' },
    users: [],
    products: [],
    suppliers: [],
    categories: [],
    transactions: [],
    movements: [],
    activity: [],
    sessions: {},
    saleRequests: {},
  };
}
