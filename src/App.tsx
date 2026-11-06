import { useState, useEffect, useRef, type FormEvent } from 'react';
import {
  LayoutDashboard, Package, ShoppingCart, Users, Settings, Bell,
  LogOut, Plus, Search, Edit2, Trash2, X, Check,
  BarChart2, Download, Eye, EyeOff,
  Truck, ClipboardList, Boxes,
  AlertCircle, FileText, RotateCcw, Menu, Activity,
  ShoppingBag, Warehouse, LockKeyhole, UserPlus, Archive,
  SlidersHorizontal, BarChart3, ArrowRight, Tag as TagIcon,
  CheckCircle, XCircle, Moon, Sun, Star, DollarSign,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import type {
  Bootstrap, Product, Supplier, Transaction, User, Role, Section, Report,
  OwnerDashboard, PurchaseRequest, DamagedProduct, Notification,
} from './api';
import {
  api, ApiError, canAccess, canManageProducts, canManageSuppliers,
  canManageUsers, canViewFinancials, canRecordPurchases, canRecordSales,
} from './api';

type AuthMode = 'loading' | 'login' | 'app';
type ModalKind =
  | 'product' | 'purchase' | 'sale' | 'return' | 'stock' | 'supplier'
  | 'user' | 'category' | 'settings' | 'purchase_request' | 'damaged'
  | 'review_request' | 'manager_review' | null;
type Theme = 'dark' | 'light';

function fmt(v: number | undefined, code: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: code || 'USD', maximumFractionDigits: 2 }).format(v ?? 0);
}
function fmtDate(v: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v));
}
function initials(name: string) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}
function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click(); URL.revokeObjectURL(url);
}

const ROLE_META: Record<Role, { label: string; badge: string; cls: string }> = {
  admin:     { label: 'Owner',           badge: 'OWNER',     cls: 'role-admin' },
  manager:   { label: 'Manager',         badge: 'MANAGER',   cls: 'role-manager' },
  inventory: { label: 'Inventory Staff', badge: 'INVENTORY', cls: 'role-inventory' },
  sales:     { label: 'Sales Staff',     badge: 'SALES',     cls: 'role-sales' },
};

const MENU: { id: Section; label: string; icon: typeof LayoutDashboard; roles: Role[] }[] = [
  { id: 'dashboard',  label: 'Dashboard',  icon: LayoutDashboard, roles: ['admin','manager','inventory','sales'] },
  { id: 'products',   label: 'Products',   icon: Package,         roles: ['admin','manager','inventory','sales'] },
  { id: 'stock',      label: 'Stock',      icon: Boxes,           roles: ['admin','manager','inventory'] },
  { id: 'purchases',  label: 'Purchases',  icon: Truck,           roles: ['admin','manager','inventory'] },
  { id: 'sales',      label: 'Sales',      icon: ShoppingCart,    roles: ['admin','sales'] },
  { id: 'suppliers',  label: 'Suppliers',  icon: ClipboardList,   roles: ['admin'] },
  { id: 'reports',    label: 'Reports',    icon: BarChart2,       roles: ['admin','manager'] },
  { id: 'users',      label: 'Team',       icon: Users,           roles: ['admin'] },
  { id: 'settings',   label: 'Settings',   icon: Settings,        roles: ['admin'] },
];

const WORKSPACES: { role: Role; title: string; desc: string; badge: string }[] = [
  { role: 'admin',     title: 'Owner',           desc: 'Full store control, finances, team management.', badge: 'FULL ACCESS' },
  { role: 'manager',   title: 'Store Manager',   desc: 'Products, purchasing, suppliers and reports.',   badge: 'OPERATIONS' },
  { role: 'inventory', title: 'Inventory Staff', desc: 'Stock movements, receipts and alerts.',          badge: 'INVENTORY' },
  { role: 'sales',     title: 'Sales Staff',     desc: 'Products, sales and personal invoices.',         badge: 'SALES DESK' },
];

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, accent = false, warn = false }: {
  label: string; value: string; sub?: string; icon: typeof LayoutDashboard; accent?: boolean; warn?: boolean;
}) {
  return (
    <div className={`stat-card${accent ? ' stat-accent' : ''}${warn ? ' stat-warn' : ''}`}>
      <div className="stat-top"><span className="stat-label">{label}</span><span className="stat-icon"><Icon size={16} /></span></div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ── Glass Panel ───────────────────────────────────────────────────────────────
function Panel({ title, sub, children, action }: {
  title: string; sub?: string; children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="glass-panel">
      <div className="panel-hdr">
        <div><div className="panel-title">{title}</div>{sub && <div className="panel-sub">{sub}</div>}</div>
        {action && <div>{action}</div>}
      </div>
      {children}
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
function Badge({ text, tone = 'default' }: { text: string; tone?: 'default' | 'green' | 'amber' | 'red' | 'blue' | 'purple' }) {
  return <span className={`badge badge-${tone}`}>{text}</span>;
}

// ── Empty State ───────────────────────────────────────────────────────────────
function Empty({ icon: Icon, text }: { icon: typeof LayoutDashboard; text: string }) {
  return <div className="empty-state"><Icon size={28} /><span>{text}</span></div>;
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444'];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div className="avatar-circle" style={{ width: size, height: size, fontSize: size * 0.35, background: color }}>
      {initials(name)}
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  return <div className="toast"><Check size={14} />{message}</div>;
}

// ── SalesChart ────────────────────────────────────────────────────────────────
function SalesChartWidget({ report, currency }: { report: Report | null; currency: string }) {
  if (!report || !report.dailySales.length) return <Empty icon={BarChart3} text="No sales data for this period" />;
  const data = report.dailySales.slice(-14).map((d) => ({
    date: new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    total: d.total,
  }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false}
          tickFormatter={(v) => fmt(v, currency).replace(/\.00$/, '')} />
        <Tooltip
          contentStyle={{ background: 'rgba(15,23,42,.9)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#94a3b8' }} itemStyle={{ color: '#e2e8f0' }}
          formatter={(v: unknown) => [fmt(Number(v), currency), 'Sales']}
        />
        <Area type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2} fill="url(#sg)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── StockDonut ────────────────────────────────────────────────────────────────
function StockDonut({ healthy, low, out }: { healthy: number; low: number; out: number }) {
  const total = healthy + low + out || 1;
  const data = [
    { name: 'Healthy', value: healthy, color: '#10b981' },
    { name: 'Low',     value: low,     color: '#f59e0b' },
    { name: 'Out',     value: out,     color: '#ef4444' },
  ].filter((d) => d.value > 0);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <PieChart width={100} height={100}>
        <Pie data={data} cx={46} cy={46} innerRadius={30} outerRadius={46} dataKey="value" strokeWidth={0}>
          {data.map((d) => <Cell key={d.name} fill={d.color} />)}
        </Pie>
      </PieChart>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map((d) => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--t-muted)' }}>{d.name}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--t-text)' }}>
              {d.value} <span style={{ color: 'var(--t-muted)', fontWeight: 400 }}>({Math.round(d.value / total * 100)}%)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── BestSellers chart ─────────────────────────────────────────────────────────
function BestSellersChart({ items, currency }: { items: Array<{ product: string; quantity: number; total: number }>; currency: string }) {
  if (!items.length) return <Empty icon={ShoppingBag} text="No sales this period" />;
  const data = items.slice(0, 6).map((i) => ({ name: i.product.length > 14 ? i.product.slice(0, 14) + '…' : i.product, qty: i.quantity, total: i.total }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={{ background: 'rgba(15,23,42,.9)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, fontSize: 11 }}
          labelStyle={{ color: '#94a3b8' }} itemStyle={{ color: '#e2e8f0' }} />
        <Bar dataKey="qty" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── 3D Warehouse Visual ───────────────────────────────────────────────────────
function WarehouseVisual() {
  return (
    <div className="warehouse3d">
      <div className="wh-floor" />
      <div className="wh-back" />
      <div className="wh-rack wh-rack-l">
        {[0,1,2,3].map((r) => (
          <div className="wh-shelf" key={r}>
            {[0,1,2,3,4].map((b) => (
              <div key={b} className="wh-box" style={{ animationDelay: `${(r * 5 + b) * -0.4}s`, opacity: 0.7 + Math.random() * 0.3 }} />
            ))}
          </div>
        ))}
      </div>
      <div className="wh-rack wh-rack-r">
        {[0,1,2,3].map((r) => (
          <div className="wh-shelf" key={r}>
            {[0,1,2,3,4].map((b) => (
              <div key={b} className="wh-box wh-box-alt" style={{ animationDelay: `${(r * 5 + b) * -0.3}s` }} />
            ))}
          </div>
        ))}
      </div>
      <div className="wh-conveyor">
        <div className="wh-belt" />
        <div className="wh-item" style={{ animationDelay: '0s' }} />
        <div className="wh-item" style={{ animationDelay: '-1.2s' }} />
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [mode, setMode] = useState<AuthMode>('loading');
  const [setupRequired, setSetupRequired] = useState(false);
  const [workspace, setWorkspace] = useState<Role | null>(null);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) || 'dark');
  const [data, setData] = useState<Bootstrap | null>(null);
  const [ownerDash, setOwnerDash] = useState<OwnerDashboard | null>(null);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);
  const [damagedProducts, setDamagedProducts] = useState<DamagedProduct[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [reportPeriod, setReportPeriod] = useState('month');
  const [section, setSection] = useState<Section>('dashboard');
  const [modal, setModal] = useState<ModalKind>(null);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editRequest, setEditRequest] = useState<PurchaseRequest | null>(null);
  const [selectedSale, setSelectedSale] = useState<Transaction | null>(null);
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState('All');
  const [formErr, setFormErr] = useState('');
  const [pageErr, setPageErr] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [invoice, setInvoice] = useState<Transaction | null>(null);
  const [saleLines, setSaleLines] = useState([{ id: 1, productId: '', quantity: '1' }]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const user = data?.user ?? null;
  const currency = data?.store.currency ?? 'USD';
  const products = data?.products ?? [];
  const transactions = data?.transactions ?? [];
  const suppliers = data?.suppliers ?? [];
  const movements = data?.movements ?? [];
  const lowStock = products.filter((p) => p.quantity <= p.reorderAt);
  const unreadNotifs = notifications.filter((n) => !n.read).length;
  const pendingRequests = purchaseRequests.filter((r) => r.status === 'pending').length;

  const canFinancials = user ? canViewFinancials(user) : false;
  const canProducts = user ? canManageProducts(user) : false;
  const canSuppliers = user ? canManageSuppliers(user) : false;
  const canUsers = user ? canManageUsers(user) : false;
  const canPurchase = user ? canRecordPurchases(user) : false;
  const canSell = user ? canRecordSales(user) : false;

  const filteredProducts = products.filter((p) => {
    const q = query.trim().toLowerCase();
    return (!q || `${p.name} ${p.sku} ${p.barcode} ${p.category}`.toLowerCase().includes(q))
      && (catFilter === 'All' || p.category === catFilter);
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const notify = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  };

  const loadExtras = async (u: User) => {
    const calls: Promise<void>[] = [
      api<{ notifications: Notification[] }>('/api/notifications').then((r) => setNotifications(r.notifications)).catch(() => {}),
      // All roles load their own requests (backend filters to own for non-admin/manager)
      api<{ purchaseRequests: PurchaseRequest[] }>('/api/purchase-requests').then((r) => setPurchaseRequests(r.purchaseRequests)).catch(() => {}),
    ];
    if (u.role === 'admin' || u.role === 'manager') {
      calls.push(api<{ damagedProducts: DamagedProduct[] }>('/api/damaged').then((r) => setDamagedProducts(r.damagedProducts)).catch(() => {}));
    }
    if (u.role === 'admin') {
      calls.push(api<OwnerDashboard>('/api/owner/dashboard').then(setOwnerDash).catch(() => {}));
    }
    await Promise.all(calls);
  };

  const refresh = async () => {
    const b = await api<Bootstrap>('/api/bootstrap');
    setData(b);
    await loadExtras(b.user);
    return b;
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const status = await api<{ required: boolean }>('/api/setup');
        if (!active) return;
        setSetupRequired(status.required);
        if (status.required) { setMode('login'); return; }
        try {
          const b = await api<Bootstrap>('/api/bootstrap');
          if (active) {
            setData(b);
            await loadExtras(b.user);
            setMode('app');
          }
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) { if (active) setMode('login'); }
          else throw e;
        }
      } catch (e) {
        if (active) { setPageErr(e instanceof Error ? e.message : 'Cannot connect to server.'); setMode('login'); }
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (mode !== 'app' || !canFinancials) return;
    let active = true;
    api<Report>(`/api/reports?period=${reportPeriod}`).then((r) => { if (active) setReport(r); }).catch(() => {});
    return () => { active = false; };
  }, [mode, reportPeriod, canFinancials, section]);

  useEffect(() => {
    if (mode !== 'app' || modal || invoice) return;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refresh().catch((e) => {
        if (e instanceof ApiError && e.status === 401) { setData(null); setMode('login'); }
      });
    }, 30_000);
    return () => clearInterval(t);
  }, [mode, modal, invoice]);

  const nav = (s: Section) => {
    if (!user || !canAccess(user, s)) return;
    setSection(s); setPageErr(''); setSidebarOpen(false); setQuery(''); setCatFilter('All');
  };

  const closeModal = () => {
    setModal(null); setEditProduct(null); setEditSupplier(null); setEditUser(null);
    setEditRequest(null); setSelectedSale(null); setFormErr(''); setSaleLines([{ id: 1, productId: '', quantity: '1' }]);
  };

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormErr(''); setAuthBusy(true);
    const vals = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (setupRequired) throw new Error('Run npm run owner:create to set up the first Owner account.');
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ ...vals, workspaceRole: workspace }) });
      const b = await api<Bootstrap>('/api/bootstrap');
      setData(b);
      await loadExtras(b.user);
      setMode('app'); setSection('dashboard'); setWorkspace(null); setPageErr('');
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Sign in failed.');
    } finally { setAuthBusy(false); }
  };

  const handleLogout = async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
    setData(null); setOwnerDash(null); setPurchaseRequests([]); setDamagedProducts([]);
    setNotifications([]); setMode('login'); setSection('dashboard'); setWorkspace(null);
  };

  const afterAction = async (msg: string) => {
    await refresh(); closeModal(); notify(msg);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormErr(''); setBusy(true);
    const fd = new FormData(e.currentTarget);
    const vals = Object.fromEntries(fd.entries());
    const num = (k: string) => Number(vals[k] ?? 0);
    try {
      if (modal === 'product') {
        const path = editProduct ? `/api/products/${editProduct.id}` : '/api/products';
        await api(path, { method: editProduct ? 'PUT' : 'POST', body: JSON.stringify({ ...vals, quantity: num('quantity'), reorderAt: num('reorderAt'), cost: num('cost'), price: num('price') }) });
        await afterAction(editProduct ? 'Product updated.' : 'Product added.');
      } else if (modal === 'purchase') {
        await api('/api/purchases', { method: 'POST', body: JSON.stringify({ ...vals, quantity: num('quantity'), unitCost: num('unitCost') }) });
        await afterAction('Stock received and updated.');
      } else if (modal === 'sale') {
        // ── client-side validation ────────────────────────────────────────────
        if (saleLines.some((l) => !l.productId)) throw new Error('Please select a product for every row.');
        if (saleLines.some((l) => Number(l.quantity) < 1)) throw new Error('Every item must have a quantity of at least 1.');
        // merge duplicates
        const merged = new Map<string, number>();
        for (const l of saleLines) merged.set(l.productId, (merged.get(l.productId) ?? 0) + Number(l.quantity));
        // stock check (frontend guard — backend re-checks atomically)
        for (const [pid, qty] of merged) {
          const p = products.find((x) => x.id === pid);
          if (p && qty > p.quantity) throw new Error(`Only ${p.quantity} unit${p.quantity === 1 ? '' : 's'} of "${p.name}" are available.`);
        }
        const items = [...merged].map(([productId, quantity]) => ({ productId, quantity }));
        const requestId = `sale-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const res = await api<{ transaction: Transaction; transactions: Transaction[] }>('/api/sales', {
          method: 'POST',
          body: JSON.stringify({ items, customer: vals.customer, note: vals.note, requestId }),
        });
        setInvoice(res.transaction);
        await afterAction(`Sale recorded — ${res.transaction.invoiceNumber}.`);
      } else if (modal === 'stock') {
        await api('/api/stock', { method: 'POST', body: JSON.stringify({ ...vals, quantity: num('quantity') }) });
        await afterAction('Stock adjusted.');
      } else if (modal === 'return' && selectedSale) {
        await api(`/api/sales/${selectedSale.id}/return`, { method: 'POST', body: JSON.stringify({ quantity: num('quantity') }) });
        await afterAction('Return processed.');
      } else if (modal === 'supplier') {
        const path = editSupplier ? `/api/suppliers/${editSupplier.id}` : '/api/suppliers';
        await api(path, { method: editSupplier ? 'PUT' : 'POST', body: JSON.stringify(vals) });
        await afterAction(editSupplier ? 'Supplier updated.' : 'Supplier added.');
      } else if (modal === 'user') {
        const payload: Record<string, unknown> = { ...vals };
        if (payload.active !== undefined) payload.active = payload.active === 'true';
        if (editUser && !payload.password) delete payload.password;
        const path = editUser ? `/api/users/${editUser.id}` : '/api/users';
        await api(path, { method: editUser ? 'PUT' : 'POST', body: JSON.stringify(payload) });
        await afterAction(editUser ? 'Account updated.' : 'Employee created.');
      } else if (modal === 'category') {
        await api('/api/categories', { method: 'POST', body: JSON.stringify(vals) });
        await afterAction('Category added.');
      } else if (modal === 'settings') {
        await api('/api/store', { method: 'PUT', body: JSON.stringify(vals) });
        await afterAction('Settings saved.');
      } else if (modal === 'purchase_request') {
        await api('/api/purchase-requests', { method: 'POST', body: JSON.stringify({ ...vals, quantity: num('quantity') }) });
        await afterAction('Purchase request submitted.');
      } else if (modal === 'damaged') {
        await api('/api/damaged', { method: 'POST', body: JSON.stringify({ ...vals, quantity: num('quantity') }) });
        await afterAction('Damaged report submitted. Stock deducted.');
      } else if (modal === 'review_request' && editRequest) {
        // Owner: approve or reject (works on pending or forwarded requests)
        await api(`/api/purchase-requests/${editRequest.id}/review`, { method: 'PUT', body: JSON.stringify({ status: vals.status, reviewNote: vals.reviewNote }) });
        await afterAction(`Request ${vals.status}.`);
      } else if (modal === 'manager_review' && editRequest) {
        // Manager: forward to owner or reject
        await api(`/api/purchase-requests/${editRequest.id}/manager-review`, { method: 'PUT', body: JSON.stringify({ action: vals.action, note: vals.note, reviewNote: vals.reviewNote }) });
        await afterAction(vals.action === 'forward' ? 'Request forwarded to Owner for approval.' : 'Request rejected.');
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setData(null); setMode('login'); }
      else setFormErr(e instanceof Error ? e.message : 'Action failed.');
    } finally { setBusy(false); }
  };

  const deleteProduct = async (p: Product) => {
    if (!confirm(`Archive "${p.name}"?`)) return;
    try { await api(`/api/products/${p.id}`, { method: 'DELETE' }); await refresh(); notify(`${p.name} archived.`); }
    catch (e) { setPageErr(e instanceof Error ? e.message : 'Failed.'); }
  };

  const deleteSupplier = async (s: Supplier) => {
    if (!confirm(`Deactivate "${s.name}"?`)) return;
    try { await api(`/api/suppliers/${s.id}`, { method: 'DELETE' }); await refresh(); notify('Supplier deactivated.'); }
    catch (e) { setPageErr(e instanceof Error ? e.message : 'Failed.'); }
  };

  const deleteCategory = async (cat: string) => {
    if (!confirm(`Remove "${cat}"?`)) return;
    try { await api(`/api/categories/${encodeURIComponent(cat)}`, { method: 'DELETE' }); await refresh(); notify('Category removed.'); }
    catch (e) { setPageErr(e instanceof Error ? e.message : 'Failed.'); }
  };

  const markAllRead = async () => {
    try { await api('/api/notifications/read-all', { method: 'PUT', body: '{}' }); setNotifications((n) => n.map((x) => ({ ...x, read: true }))); }
    catch {}
  };

  const exportInventory = (items: Product[], file: string) => {
    downloadCsv(file, [
      ['Product','SKU','Category','Qty','Reorder At',...(canFinancials ? ['Cost','Price'] : [])],
      ...items.map((p) => [p.name, p.sku, p.category, p.quantity, p.reorderAt, ...(canFinancials ? [p.cost ?? 0, p.price ?? 0] : [])]),
    ]);
    notify('Export downloaded.');
  };

  const exportTransactions = (type?: string) => {
    const rows = transactions.filter((t) => !type || t.type === type);
    downloadCsv(`${type ?? 'transactions'}.csv`, [
      ['Type','Product','Qty','Date','Staff',...(canFinancials ? ['Total'] : [])],
      ...rows.map((t) => [t.type, t.productName, t.quantity, t.createdAt, t.userName, ...(canFinancials ? [t.total ?? 0] : [])]),
    ]);
    notify('Export downloaded.');
  };

  const visibleMenu = MENU.filter((m) => user && canAccess(user, m.id));
  const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

  // ── Loading screen ───────────────────────────────────────────────────────────
  if (mode === 'loading') {
    return (
      <div className="launch-screen">
        <div className="launch-brand"><Warehouse size={28} /><span>stockroom</span></div>
        <div className="launch-spinner" />
        <span>Loading…</span>
      </div>
    );
  }

  // ── Login screen ─────────────────────────────────────────────────────────────
  if (mode === 'login') {
    return (
      <div className="login-page">
        <div className="login-left">
          <div className="login-brand"><Warehouse size={24} /><span>stockroom</span></div>
          <div className="login-hero">
            <WarehouseVisual />
            <div className="login-hero-text">
              <h1>Inventory<br /><span>Management</span></h1>
              <p>Real-time stock control, purchase tracking, and team management — all in one place.</p>
            </div>
            <div className="login-stats">
              <div><strong>3</strong><span>Role Dashboards</span></div>
              <div><strong>100%</strong><span>Real-time Data</span></div>
              <div><strong>∞</strong><span>Transactions</span></div>
            </div>
          </div>
        </div>
        <div className="login-right">
          <div className="login-card">
            <div className="login-card-hdr">
              <LockKeyhole size={20} />
              <h2>{workspace ? WORKSPACES.find((w) => w.role === workspace)?.title ?? 'Sign In' : 'Choose Workspace'}</h2>
              <p>{workspace ? 'Enter your credentials to continue.' : 'Select your role to access the system.'}</p>
            </div>
            {setupRequired && (
              <div className="alert alert-warn">
                <AlertCircle size={15} />
                No owner account yet. Run <code>npm run owner:create</code> to create one.
              </div>
            )}
            {pageErr && <div className="alert alert-err"><AlertCircle size={15} />{pageErr}</div>}
            {!workspace ? (
              <div className="workspace-grid">
                {WORKSPACES.map((w) => (
                  <button key={w.role} className={`workspace-card workspace-${w.role}`} onClick={() => { setWorkspace(w.role); setFormErr(''); }}>
                    <span className="ws-badge">{w.badge}</span>
                    <strong>{w.title}</strong>
                    <span>{w.desc}</span>
                    <ArrowRight size={14} className="ws-arrow" />
                  </button>
                ))}
              </div>
            ) : (
              <>
                <button className="back-btn" onClick={() => { setWorkspace(null); setFormErr(''); }}>
                  ← Change workspace
                </button>
                <form className="login-form" onSubmit={handleLogin}>
                  <label>Email<input type="email" name="email" required placeholder="you@store.com" autoComplete="username" /></label>
                  <label>Password
                    <div className="pw-wrap">
                      <input type={showPwd ? 'text' : 'password'} name="password" required placeholder="Password" autoComplete="current-password" />
                      <button type="button" className="pw-toggle" onClick={() => setShowPwd(!showPwd)}>{showPwd ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                    </div>
                  </label>
                  {formErr && <div className="alert alert-err"><AlertCircle size={15} />{formErr}</div>}
                  <button className="btn btn-primary btn-lg" disabled={authBusy}>
                    {authBusy ? 'Signing in…' : 'Sign In'} <ArrowRight size={16} />
                  </button>
                </form>
              </>
            )}
            <div className="login-footer"><LockKeyhole size={12} /> Secure access · Role-based permissions</div>
          </div>
        </div>
      </div>
    );
  }

  if (!data || !user) return <div className="launch-screen"><span>Session lost. <button onClick={() => location.reload()}>Reload</button></span></div>;

  // ── App shell ────────────────────────────────────────────────────────────────
  const roleInfo = ROLE_META[user.role];

  return (
    <div className={`app-root theme-${theme}`} data-theme={theme}>
      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <Warehouse size={20} />
          <span>stockroom</span>
        </div>
        <div className="sidebar-store">
          <div className="sidebar-store-icon">{data.store.name.charAt(0)}</div>
          <div>
            <div className="sidebar-store-name">{data.store.name}</div>
            <div className={`role-badge ${roleInfo.cls}`}>{roleInfo.badge}</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {visibleMenu.map((m) => {
            const Icon = m.icon;
            const alert = m.id === 'stock' && lowStock.length > 0;
            const reqAlert = m.id === 'dashboard' && pendingRequests > 0 && user.role === 'admin';
            return (
              <button
                key={m.id}
                className={`nav-item${section === m.id ? ' nav-active' : ''}`}
                onClick={() => nav(m.id)}
              >
                <Icon size={17} />
                <span>{m.label}</span>
                {alert && <span className="nav-badge">{lowStock.length}</span>}
                {reqAlert && <span className="nav-badge nav-badge-purple">{pendingRequests}</span>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <Avatar name={user.name} size={30} />
            <div>
              <div className="sidebar-user-name">{user.name}</div>
              <div className="sidebar-user-role">{roleInfo.label}</div>
            </div>
            <button className="icon-btn" onClick={handleLogout} title="Sign out"><LogOut size={15} /></button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="main-area">
        {/* Topbar */}
        <header className="topbar">
          <button className="mobile-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}><Menu size={20} /></button>
          <div className="topbar-breadcrumb">
            <span className="topbar-store">{data.store.name}</span>
            <span className="topbar-sep">/</span>
            <span className="topbar-section">{MENU.find((m) => m.id === section)?.label ?? 'Dashboard'}</span>
          </div>
          <div className="topbar-right">
            <button className={`theme-toggle${theme === 'dark' ? ' theme-dark' : ''}`} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div className="notif-wrap">
              <button className="icon-btn notif-btn" onClick={() => setNotifOpen(!notifOpen)}>
                <Bell size={17} />
                {unreadNotifs > 0 && <span className="notif-dot">{unreadNotifs}</span>}
              </button>
              {notifOpen && (
                <div className="notif-panel">
                  <div className="notif-hdr">
                    <span>Notifications</span>
                    {unreadNotifs > 0 && <button className="text-btn" onClick={markAllRead}>Mark all read</button>}
                  </div>
                  {notifications.length === 0 ? <div className="notif-empty">No notifications</div> : notifications.slice(0, 10).map((n) => (
                    <div key={n.id} className={`notif-item${n.read ? '' : ' notif-unread'}`}>
                      <div className="notif-title">{n.title}</div>
                      <div className="notif-msg">{n.message}</div>
                      <div className="notif-time">{fmtDate(n.createdAt)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Avatar name={user.name} size={30} />
          </div>
        </header>

        {/* Page */}
        <div className="page-body">
          {pageErr && (
            <div className="page-err"><AlertCircle size={15} />{pageErr}<button onClick={() => setPageErr('')}><X size={14} /></button></div>
          )}

          {section === 'dashboard' && (
            <DashboardPage
              data={data} ownerDash={ownerDash} report={report} reportPeriod={reportPeriod}
              purchaseRequests={purchaseRequests} damagedProducts={damagedProducts}
              canFinancials={canFinancials} canPurchase={canPurchase} canSell={canSell}
              onNav={nav} onModal={(k, extra?: PurchaseRequest) => { if (extra) setEditRequest(extra); setModal(k); }}
              onInvoice={setInvoice}
            />
          )}
          {section === 'products' && (
            <ProductsPage
              products={filteredProducts} allProducts={products} data={data}
              query={query} catFilter={catFilter} canProducts={canProducts} canFinancials={canFinancials} canPurchase={canPurchase}
              onQuery={setQuery} onCat={setCatFilter}
              onAdd={() => { setEditProduct(null); setModal('product'); }}
              onEdit={(p) => { setEditProduct(p); setModal('product'); }}
              onDelete={deleteProduct}
              onStock={() => setModal('stock')}
              onExport={() => exportInventory(filteredProducts, 'inventory.csv')}
            />
          )}
          {section === 'stock' && (
            <StockPage
              products={products} movements={movements} lowStock={lowStock} canPurchase={canPurchase}
              onAdjust={() => setModal('stock')}
              onPurchase={() => setModal('purchase')}
              onRequest={() => setModal('purchase_request')}
              onDamaged={() => setModal('damaged')}
            />
          )}
          {section === 'purchases' && (
            <PurchasesPage
              data={data} purchaseRequests={purchaseRequests} canPurchase={canPurchase} user={user}
              onPurchase={() => setModal('purchase')}
              onRequest={() => setModal('purchase_request')}
              onReview={(r) => { setEditRequest(r); setModal('review_request'); }}
              onManagerReview={(r) => { setEditRequest(r); setModal('manager_review'); }}
              onExport={() => exportTransactions('purchase')}
            />
          )}
          {section === 'sales' && (
            <SalesPage
              data={data} canSell={canSell} canFinancials={canFinancials}
              onSale={() => { setSaleLines([{ id: 1, productId: '', quantity: '1' }]); setModal('sale'); }}
              onReturn={(t) => { setSelectedSale(t); setModal('return'); }}
              onInvoice={setInvoice}
              onExport={() => exportTransactions('sale')}
            />
          )}
          {section === 'suppliers' && (
            <SuppliersPage
              suppliers={suppliers} canManage={canSuppliers}
              onAdd={() => { setEditSupplier(null); setModal('supplier'); }}
              onEdit={(s) => { setEditSupplier(s); setModal('supplier'); }}
              onDelete={deleteSupplier}
            />
          )}
          {section === 'reports' && canFinancials && (
            <ReportsPage
              report={report} data={data} period={reportPeriod}
              onPeriod={setReportPeriod}
              onExportInventory={() => exportInventory(products, 'inventory-report.csv')}
              onExportSales={() => exportTransactions('sale')}
              onExportPurchases={() => exportTransactions('purchase')}
            />
          )}
          {section === 'users' && canUsers && (
            <TeamPage
              data={data} purchaseRequests={purchaseRequests} damagedProducts={damagedProducts}
              onAdd={() => { setEditUser(null); setModal('user'); }}
              onEdit={(u) => { setEditUser(u); setModal('user'); }}
              onAddCat={() => setModal('category')}
              onDeleteCat={deleteCategory}
            />
          )}
          {section === 'settings' && canUsers && (
            <SettingsPage
              data={data}
              onEdit={() => setModal('settings')}
              onAddCat={() => setModal('category')}
              onDeleteCat={deleteCategory}
            />
          )}
        </div>
      </div>

      {/* Modals */}
      {modal && (
        <ModalOverlay onClose={closeModal} wide={modal === 'sale'}>
          <form className="modal-form" onSubmit={handleSubmit}>
            <div className="modal-hdr">
              <h3>{modalTitle(modal, editProduct, editSupplier, editUser, editRequest)}</h3>
              <button type="button" className="icon-btn" onClick={closeModal}><X size={18} /></button>
            </div>
            <div className="modal-body">
              {modal === 'product' && <ProductForm product={editProduct} data={data} />}
              {modal === 'purchase' && <PurchaseForm data={data} canFinancials={canFinancials} />}
              {modal === 'sale' && <SaleForm data={data} lines={saleLines} onLines={setSaleLines} currency={currency} />}
              {modal === 'stock' && <StockForm data={data} />}
              {modal === 'return' && selectedSale && <ReturnForm sale={selectedSale} />}
              {modal === 'supplier' && <SupplierForm supplier={editSupplier} />}
              {modal === 'user' && <UserForm user={editUser} />}
              {modal === 'category' && <CategoryForm data={data} onDelete={deleteCategory} />}
              {modal === 'settings' && <SettingsForm data={data} />}
              {modal === 'purchase_request' && <PurchaseRequestForm data={data} />}
              {modal === 'damaged' && <DamagedForm data={data} />}
              {modal === 'review_request' && editRequest && <ReviewRequestForm req={editRequest} />}
              {modal === 'manager_review' && editRequest && <ManagerReviewForm req={editRequest} />}
            </div>
            {formErr && <div className="alert alert-err modal-err"><AlertCircle size={14} />{formErr}</div>}
            {modal !== 'category' && (
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Saving…' : modalSubmit(modal, editProduct, editSupplier, editUser)}
                </button>
              </div>
            )}
          </form>
        </ModalOverlay>
      )}

      {invoice && <InvoiceDialog tx={invoice} allTx={transactions} store={data.store} onClose={() => setInvoice(null)} />}
      {toast && <Toast message={toast} onDone={() => setToast('')} />}
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      {notifOpen && <div className="notif-backdrop" onClick={() => setNotifOpen(false)} />}
    </div>
  );
}

// ── Modal overlay ─────────────────────────────────────────────────────────────
function ModalOverlay({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal-card${wide ? ' modal-card-wide' : ''}`}>{children}</div>
    </div>
  );
}

function modalTitle(kind: ModalKind, p: Product | null, s: Supplier | null, u: User | null, r: PurchaseRequest | null) {
  const m: Record<NonNullable<ModalKind>, string> = {
    product: p ? 'Edit Product' : 'Add Product',
    purchase: 'Receive Stock',
    sale: 'New Sale',
    return: 'Process Return',
    stock: 'Adjust Stock',
    supplier: s ? 'Edit Supplier' : 'Add Supplier',
    user: u ? 'Edit Account' : 'Add Employee',
    category: 'Manage Categories',
    settings: 'Store Settings',
    purchase_request: 'Submit Purchase Request',
    damaged: 'Report Damaged Products',
    review_request: r ? `Owner Review — ${r.productName}` : 'Owner Review',
    manager_review: r ? `Manager Review — ${r.productName}` : 'Manager Review',
  };
  return kind ? (m[kind] ?? '') : '';
}

function modalSubmit(kind: ModalKind, p: Product | null, s: Supplier | null, u: User | null) {
  if (kind === 'product') return p ? 'Save Changes' : 'Add Product';
  if (kind === 'sale') return 'Complete Sale';
  if (kind === 'return') return 'Process Return';
  if (kind === 'supplier') return s ? 'Save Changes' : 'Add Supplier';
  if (kind === 'user') return u ? 'Save Changes' : 'Create Account';
  if (kind === 'manager_review') return 'Submit Decision';
  return 'Save';
}

// ── Dashboard Page ────────────────────────────────────────────────────────────
function DashboardPage({ data, ownerDash, report, reportPeriod, purchaseRequests, damagedProducts, canFinancials, canPurchase, canSell, onNav, onModal, onInvoice }: {
  data: Bootstrap; ownerDash: OwnerDashboard | null; report: Report | null; reportPeriod: string;
  purchaseRequests: PurchaseRequest[]; damagedProducts: DamagedProduct[];
  canFinancials: boolean; canPurchase: boolean; canSell: boolean;
  onNav: (s: Section) => void; onModal: (k: ModalKind, r?: PurchaseRequest) => void; onInvoice: (t: Transaction) => void;
}) {
  const { user, products, transactions, dashboard } = data;
  const currency = data.store.currency;
  const lowStock = products.filter((p) => p.quantity <= p.reorderAt);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: data.store.timezone }).format(new Date());
  const todaySales = transactions
    .filter((t) => t.type === 'sale' && new Intl.DateTimeFormat('en-CA', { timeZone: data.store.timezone }).format(new Date(t.createdAt)) === today)
    .reduce((s, t) => s + (t.total ?? 0), 0);
  const pendingReqs = purchaseRequests.filter((r) => r.status === 'pending');

  if (user.role === 'admin') {
    // ── Owner Dashboard ────────────────────────────────────────────────────────
    const sd = dashboard.stockDistribution ?? { healthy: 0, low: 0, out: 0 };
    return (
      <div className="page owner-dashboard">
        <div className="page-hdr">
          <div>
            <div className="page-eyebrow">OWNER DASHBOARD</div>
            <h1>Your Store Overview</h1>
            <p className="page-sub">Complete business visibility — finances, stock, team, and operations.</p>
          </div>
          <div className="page-actions">
            <button className="btn btn-ghost" onClick={() => onNav('reports')}><BarChart2 size={15} /> Reports</button>
            <button className="btn btn-primary" onClick={() => onNav('users')}><Users size={15} /> Manage Team</button>
          </div>
        </div>

        {/* KPI row */}
        <div className="stats-grid stats-grid-5">
          <StatCard label="Total Products" value={dashboard.totalProducts.toString()} sub="active catalog" icon={Package} />
          <StatCard label="Units In Stock" value={dashboard.availableUnits.toLocaleString()} sub="across all products" icon={Boxes} />
          <StatCard label="Today's Sales" value={fmt(todaySales, currency)} sub="sales revenue today" icon={DollarSign} accent />
          <StatCard label="Low Stock" value={lowStock.length.toString()} sub="need reordering" icon={AlertCircle} warn={lowStock.length > 0} />
          <StatCard label="Team Members" value={data.users.length.toString()} sub="active accounts" icon={Users} />
        </div>

        {ownerDash && (
          <div className="stats-grid stats-grid-4" style={{ marginTop: 12 }}>
            <StatCard label="Total Sales (period)" value={fmt(ownerDash.todaySales, currency)} sub="this period" icon={ShoppingBag} />
            <StatCard label="Recent Purchases" value={ownerDash.recentPurchases.length.toString()} sub="stock receipts" icon={Truck} />
            <StatCard label="Out of Stock" value={ownerDash.stockSummary.outOfStock.toString()} sub="zero qty products" icon={AlertCircle} warn={ownerDash.stockSummary.outOfStock > 0} />
            <StatCard label="Active Staff" value={ownerDash.employeeSummary.active.toString()} sub="of total accounts" icon={Users} />
          </div>
        )}

        <div className="dashboard-grid-2col">
          <Panel title="Sales Trend" sub={`Last 14 days · ${reportPeriod}`}>
            <SalesChartWidget report={report} currency={currency} />
          </Panel>
          <Panel title="Stock Health">
            <StockDonut healthy={sd.healthy} low={sd.low} out={sd.out} />
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => onNav('stock')}>View Stock</button>
              {lowStock.length > 0 && <button className="btn btn-sm btn-warn" onClick={() => onNav('stock')}>{lowStock.length} Low Stock Items</button>}
            </div>
          </Panel>
        </div>

        <div className="dashboard-grid-2col">
          <Panel title="Pending Purchase Requests" sub={`${pendingReqs.length} awaiting approval`}
            action={pendingReqs.length > 0 ? <button className="btn btn-sm btn-primary" onClick={() => onNav('purchases')}>View All</button> : undefined}>
            {pendingReqs.length === 0 ? <Empty icon={CheckCircle} text="No pending requests" /> : (
              <div className="req-list">
                {pendingReqs.slice(0, 5).map((r) => (
                  <div key={r.id} className="req-row">
                    <div className="req-info">
                      <strong>{r.productName}</strong>
                      <span>Qty: {r.quantity} · {r.supplierName}</span>
                      <span className="req-by">By {r.requestedByName}</span>
                    </div>
                    <div className="req-actions">
                      <button className="btn btn-sm btn-green" onClick={() => onModal('review_request', r)}><CheckCircle size={13} /> Review</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Recent Activity" sub="latest team actions">
            {data.activity.length === 0 ? <Empty icon={Activity} text="No activity yet" /> : (
              <div className="activity-list">
                {data.activity.slice(0, 8).map((a) => (
                  <div key={a.id} className="activity-row">
                    <Avatar name={a.userName} size={24} />
                    <div className="activity-info">
                      <span><strong>{a.userName}</strong> {a.action}</span>
                      <small>{fmtDate(a.createdAt)}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {ownerDash && ownerDash.recentSales.length > 0 && (
          <Panel title="Recent Sales" sub="latest transactions"
            action={<button className="btn btn-sm btn-ghost" onClick={() => onNav('sales')}>View All</button>}>
            <TxTable transactions={ownerDash.recentSales} currency={currency} canFinancials={canFinancials} onInvoice={onInvoice} />
          </Panel>
        )}
      </div>
    );
  }

  if (user.role === 'manager') {
    // ── Manager Dashboard ──────────────────────────────────────────────────────
    // Requests the manager can act on: pending ones submitted by OTHER staff
    const actionableReqs = purchaseRequests.filter(
      (r) => r.status === 'pending' && r.requestedBy !== user.id
    );
    return (
      <div className="page manager-dashboard">
        <div className="page-hdr">
          <div>
            <div className="page-eyebrow">MANAGER DASHBOARD</div>
            <h1>Operations Overview</h1>
            <p className="page-sub">Daily stock operations, purchases, and supplier management.</p>
          </div>
          <div className="page-actions">
            <button className="btn btn-ghost" onClick={() => onModal('purchase_request')}>Request Stock</button>
            <button className="btn btn-primary" onClick={() => onModal('purchase')}><Truck size={15} /> Receive Stock</button>
          </div>
        </div>
        <div className="stats-grid stats-grid-4">
          <StatCard label="Total Products" value={dashboard.totalProducts.toString()} sub="active items" icon={Package} />
          <StatCard label="Units In Stock" value={dashboard.availableUnits.toLocaleString()} icon={Boxes} />
          <StatCard label="Today's Sales" value={fmt(todaySales, currency)} sub="gross revenue today" icon={DollarSign} accent />
          <StatCard label="Pending Requests" value={actionableReqs.length.toString()} sub="awaiting your review" icon={FileText} warn={actionableReqs.length > 0} />
        </div>

        {/* ── Staff Stock Requests panel ─────────────────────────────────── */}
        <Panel
          title="Staff Stock Requests"
          sub={actionableReqs.length > 0 ? `${actionableReqs.length} pending your review` : 'No pending requests'}
          action={<button className="btn btn-sm btn-ghost" onClick={() => onNav('purchases')}><FileText size={13} /> View All</button>}
        >
          {actionableReqs.length === 0 ? (
            <Empty icon={CheckCircle} text="All staff requests have been reviewed" />
          ) : (
            <div className="data-table">
              <table>
                <thead><tr>
                  <th>Product</th><th>Requested By</th><th>Qty</th><th>Supplier</th><th>Date</th><th>Actions</th>
                </tr></thead>
                <tbody>
                  {actionableReqs.slice(0, 6).map((r) => {
                    const currentStock = products.find((p) => p.id === r.productId)?.quantity ?? '—';
                    return (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.productName}</strong>
                          {r.note && <div style={{ fontSize: 10, color: 'var(--t-muted)', marginTop: 2 }}>{r.note}</div>}
                        </td>
                        <td style={{ fontSize: 11 }}>{r.requestedByName}</td>
                        <td>
                          <span style={{ fontWeight: 700 }}>{r.quantity}</span>
                          <span style={{ fontSize: 10, color: 'var(--t-muted)', marginLeft: 4 }}>({currentStock} in stock)</span>
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--t-muted)' }}>{r.supplierName}</td>
                        <td style={{ fontSize: 10, color: 'var(--t-muted)' }}>{fmtDate(r.createdAt)}</td>
                        <td>
                          <div className="row-actions" style={{ opacity: 1 }}>
                            <button className="btn btn-sm btn-green" onClick={() => onModal('manager_review', r)}>
                              <CheckCircle size={12} /> Accept
                            </button>
                            <button className="btn btn-sm btn-warn" onClick={() => onModal('manager_review', r)}>
                              <XCircle size={12} /> Reject
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <div className="dashboard-grid-2col">
          <Panel title="Sales This Period" sub="daily revenue trend">
            <SalesChartWidget report={report} currency={currency} />
          </Panel>
          <Panel title="Stock Watch" sub={`${lowStock.length} items at or below reorder point`}>
            {lowStock.length === 0 ? <Empty icon={CheckCircle} text="All stock above reorder points" /> : (
              <div className="low-stock-list">
                {lowStock.slice(0, 6).map((p) => (
                  <div key={p.id} className="low-stock-row">
                    <div className="ls-info">
                      <strong>{p.name}</strong>
                      <span>{p.sku} · Reorder at {p.reorderAt}</span>
                    </div>
                    <Badge text={`${p.quantity} left`} tone={p.quantity === 0 ? 'red' : 'amber'} />
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
        <div className="dashboard-grid-2col">
          <Panel title="Recent Transactions"
            action={<button className="btn btn-sm btn-ghost" onClick={() => onNav('sales')}>View All</button>}>
            <TxTable transactions={transactions.slice(0, 6)} currency={currency} canFinancials={canFinancials} onInvoice={onInvoice} />
          </Panel>
          <Panel title="Best Selling Products" sub={report ? `Last ${reportPeriod}` : 'Loading…'}>
            <BestSellersChart items={report?.bestSelling ?? []} currency={currency} />
          </Panel>
        </div>
        <div className="quick-actions">
          <button className="qa-btn" onClick={() => onNav('products')}><Package size={20} /><span>Products</span></button>
          <button className="qa-btn" onClick={() => onModal('purchase')}><Truck size={20} /><span>Receive Stock</span></button>
          <button className="qa-btn" onClick={() => onModal('purchase_request')}><FileText size={20} /><span>Request Stock</span></button>
          <button className="qa-btn" onClick={() => onNav('reports')}><BarChart2 size={20} /><span>Reports</span></button>
          <button className="qa-btn" onClick={() => onModal('damaged')}><AlertCircle size={20} /><span>Report Damage</span></button>
        </div>
      </div>
    );
  }

  if (user.role === 'inventory') {
    // ── Inventory Staff Dashboard ──────────────────────────────────────────────
    const recentMovements = data.movements.slice(0, 8);
    return (
      <div className="page inventory-dashboard">
        <div className="page-hdr">
          <div>
            <div className="page-eyebrow">INVENTORY DASHBOARD</div>
            <h1>Stock Operations</h1>
            <p className="page-sub">Track stock levels, receive purchases, and report damages.</p>
          </div>
          <div className="page-actions">
            <button className="btn btn-ghost" onClick={() => onModal('damaged')}><AlertCircle size={15} /> Report Damage</button>
            <button className="btn btn-primary" onClick={() => onModal('purchase')}><Truck size={15} /> Receive Stock</button>
          </div>
        </div>
        <div className="stats-grid stats-grid-4">
          <StatCard label="Products" value={products.filter((p) => p.quantity > 0).length.toString()} sub="in stock" icon={Package} />
          <StatCard label="Total Units" value={dashboard.availableUnits.toLocaleString()} icon={Boxes} />
          <StatCard label="Low Stock" value={lowStock.length.toString()} sub="need reordering" icon={AlertCircle} warn={lowStock.length > 0} />
          <StatCard label="Out of Stock" value={products.filter((p) => p.quantity === 0).length.toString()} sub="zero quantity" icon={XCircle} warn />
        </div>
        <div className="dashboard-grid-2col">
          <Panel title="Low Stock Alerts" sub="at or below reorder point"
            action={<button className="btn btn-sm btn-primary" onClick={() => onModal('purchase_request')}>Request Stock</button>}>
            {lowStock.length === 0 ? <Empty icon={CheckCircle} text="All items above reorder points" /> : (
              <div className="low-stock-list">
                {lowStock.slice(0, 8).map((p) => (
                  <div key={p.id} className="low-stock-row">
                    <div className="ls-info">
                      <strong>{p.name}</strong>
                      <span>SKU: {p.sku}</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <Badge text={`${p.quantity} left`} tone={p.quantity === 0 ? 'red' : 'amber'} />
                      <div style={{ fontSize: 10, color: 'var(--t-muted)', marginTop: 2 }}>reorder at {p.reorderAt}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Recent Stock Movements">
            {recentMovements.length === 0 ? <Empty icon={Activity} text="No movements yet" /> : (
              <div className="movement-list">
                {recentMovements.map((m) => (
                  <div key={m.id} className="movement-row">
                    <span className={`mv-type mv-${m.type}`}>{m.type}</span>
                    <div className="mv-info">
                      <strong>{m.productName}</strong>
                      <span>{m.before} → {m.after}</span>
                    </div>
                    <span className={`mv-qty ${m.quantity < 0 ? 'qty-neg' : 'qty-pos'}`}>
                      {m.quantity > 0 ? '+' : ''}{m.quantity}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
        <div className="quick-actions">
          <button className="qa-btn" onClick={() => onModal('purchase')}><Truck size={20} /><span>Receive Stock</span></button>
          <button className="qa-btn" onClick={() => onModal('stock')}><Boxes size={20} /><span>Adjust Stock</span></button>
          <button className="qa-btn" onClick={() => onModal('purchase_request')}><FileText size={20} /><span>Request Purchase</span></button>
          <button className="qa-btn" onClick={() => onModal('damaged')}><AlertCircle size={20} /><span>Report Damage</span></button>
          <button className="qa-btn" onClick={() => onNav('products')}><Package size={20} /><span>Browse Products</span></button>
          <button className="qa-btn" onClick={() => onNav('stock')}><Activity size={20} /><span>Stock History</span></button>
        </div>
      </div>
    );
  }

  // ── Sales Staff Dashboard ────────────────────────────────────────────────────
  const myTx = transactions.filter((t) => t.userId === user.id);
  const mySalesToday = myTx.filter((t) => t.type === 'sale' && new Intl.DateTimeFormat('en-CA', { timeZone: data.store.timezone }).format(new Date(t.createdAt)) === today);
  const myRevToday = mySalesToday.reduce((s, t) => s + (t.total ?? 0), 0);
  const inStockCount = products.filter((p) => p.quantity > 0).length;
  return (
    <div className="page sales-dashboard">
      <div className="page-hdr">
        <div>
          <div className="page-eyebrow">SALES DASHBOARD</div>
          <h1>Sales Station</h1>
          <p className="page-sub">Record sales, search products, and view your personal history.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => onNav('products')}><Search size={15} /> Browse Products</button>
          <button className="btn btn-primary" onClick={() => onModal('sale')}><Plus size={15} /> New Sale</button>
        </div>
      </div>
      <div className="stats-grid stats-grid-4">
        <StatCard label="My Sales Today" value={mySalesToday.length.toString()} sub="invoices completed" icon={ShoppingCart} />
        <StatCard label="My Revenue Today" value={fmt(myRevToday, data.store.currency)} sub="total today" icon={DollarSign} accent />
        <StatCard label="Products In Stock" value={inStockCount.toString()} sub="available to sell" icon={Package} />
        <StatCard label="Total My Sales" value={myTx.filter((t) => t.type === 'sale').length.toString()} sub="all time" icon={Star} />
      </div>
      <div className="dashboard-grid-2col">
        <Panel title="My Recent Sales"
          action={<button className="btn btn-sm btn-ghost" onClick={() => onNav('sales')}>View All</button>}>
          {myTx.filter((t) => t.type === 'sale').length === 0
            ? <Empty icon={ShoppingCart} text="No sales yet — start your first sale" />
            : <TxTable transactions={myTx.filter((t) => t.type === 'sale').slice(0, 6)} currency={data.store.currency} canFinancials={false} onInvoice={onInvoice} />}
        </Panel>
        <Panel title="Low Stock Notice" sub="items running low">
          {lowStock.length === 0
            ? <Empty icon={CheckCircle} text="All items well stocked" />
            : <div className="low-stock-list">{lowStock.slice(0, 6).map((p) => (
                <div key={p.id} className="low-stock-row">
                  <div className="ls-info"><strong>{p.name}</strong><span>{p.category}</span></div>
                  <Badge text={`${p.quantity} left`} tone={p.quantity === 0 ? 'red' : 'amber'} />
                </div>
              ))}</div>}
        </Panel>
      </div>
      <div className="quick-actions">
        <button className="qa-btn" onClick={() => onModal('sale')}><ShoppingCart size={20} /><span>New Sale</span></button>
        <button className="qa-btn" onClick={() => onNav('products')}><Search size={20} /><span>Search Products</span></button>
        <button className="qa-btn" onClick={() => onNav('sales')}><FileText size={20} /><span>My Sales History</span></button>
        <button className="qa-btn" onClick={() => onModal('damaged')}><AlertCircle size={20} /><span>Report Damage</span></button>
      </div>
    </div>
  );
}

// ── Transaction Table ─────────────────────────────────────────────────────────
function TxTable({ transactions, currency, canFinancials, onInvoice }: {
  transactions: Transaction[]; currency: string; canFinancials: boolean; onInvoice?: (t: Transaction) => void;
}) {
  if (!transactions.length) return <Empty icon={FileText} text="No transactions" />;
  return (
    <div className="data-table">
      <table>
        <thead><tr>
          <th>Type</th><th>Product</th><th>Qty</th>
          {canFinancials && <th>Amount</th>}
          <th>Date</th>
          {onInvoice && <th></th>}
        </tr></thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id}>
              <td><Badge text={t.type} tone={t.type === 'sale' ? 'green' : t.type === 'purchase' ? 'blue' : 'amber'} /></td>
              <td>{t.productName}</td>
              <td>{t.quantity}</td>
              {canFinancials && <td>{fmt(t.total, currency)}</td>}
              <td style={{ fontSize: 11, color: 'var(--t-muted)' }}>{fmtDate(t.createdAt)}</td>
              {onInvoice && t.invoiceNumber && <td><button className="text-btn" onClick={() => onInvoice(t)}><FileText size={13} /></button></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Products Page ─────────────────────────────────────────────────────────────
function ProductsPage({ products, allProducts, data, query, catFilter, canProducts, canFinancials, canPurchase, onQuery, onCat, onAdd, onEdit, onDelete, onStock, onExport }: {
  products: Product[]; allProducts: Product[]; data: Bootstrap; query: string; catFilter: string;
  canProducts: boolean; canFinancials: boolean; canPurchase: boolean;
  onQuery: (q: string) => void; onCat: (c: string) => void;
  onAdd: () => void; onEdit: (p: Product) => void; onDelete: (p: Product) => void;
  onStock: () => void; onExport: () => void;
}) {
  return (
    <div className="page">
      <div className="page-hdr">
        <div>
          <div className="page-eyebrow">PRODUCT CATALOG</div>
          <h1>Products</h1>
          <p className="page-sub">{allProducts.length} active products in {data.categories.length} categories</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={onExport}><Download size={15} /> Export</button>
          {canPurchase && <button className="btn btn-ghost" onClick={onStock}><Boxes size={15} /> Adjust Stock</button>}
          {canProducts && <button className="btn btn-primary" onClick={onAdd}><Plus size={15} /> Add Product</button>}
        </div>
      </div>
      <div className="table-toolbar">
        <div className="search-box"><Search size={14} /><input placeholder="Search products…" value={query} onChange={(e) => onQuery(e.target.value)} /></div>
        <select className="select" value={catFilter} onChange={(e) => onCat(e.target.value)}>
          <option value="All">All Categories</option>
          {data.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="table-count">{products.length} results</span>
      </div>
      {products.length === 0 ? <Empty icon={Package} text="No products found" /> : (
        <div className="data-table">
          <table>
            <thead><tr>
              <th>Product</th><th>SKU</th><th>Category</th><th>Stock</th>
              {canFinancials && <th>Price</th>}
              <th>Status</th>
              {canProducts && <th>Actions</th>}
            </tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td><code style={{ fontSize: 11 }}>{p.sku}</code></td>
                  <td><Badge text={p.category} /></td>
                  <td>
                    <span className={p.quantity === 0 ? 'qty qty-out' : p.quantity <= p.reorderAt ? 'qty qty-low' : 'qty qty-ok'}>
                      {p.quantity}
                    </span>
                  </td>
                  {canFinancials && <td>{fmt(p.price, data.store.currency)}</td>}
                  <td>
                    {p.quantity === 0 ? <Badge text="Out of Stock" tone="red" /> :
                     p.quantity <= p.reorderAt ? <Badge text="Low Stock" tone="amber" /> :
                     <Badge text="In Stock" tone="green" />}
                  </td>
                  {canProducts && (
                    <td>
                      <div className="row-actions">
                        <button className="icon-btn-sm" onClick={() => onEdit(p)}><Edit2 size={13} /></button>
                        <button className="icon-btn-sm icon-btn-danger" onClick={() => onDelete(p)}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Stock Page ────────────────────────────────────────────────────────────────
function StockPage({ products, movements, lowStock, canPurchase, onAdjust, onPurchase, onRequest, onDamaged }: {
  products: Product[]; movements: Bootstrap['movements']; lowStock: Product[]; canPurchase: boolean;
  onAdjust: () => void; onPurchase: () => void; onRequest: () => void; onDamaged: () => void;
}) {
  return (
    <div className="page">
      <div className="page-hdr">
        <div>
          <div className="page-eyebrow">STOCK MANAGEMENT</div>
          <h1>Stock Levels</h1>
          <p className="page-sub">{lowStock.length} items need attention</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={onDamaged}><AlertCircle size={15} /> Report Damage</button>
          {canPurchase && <button className="btn btn-ghost" onClick={onRequest}><FileText size={15} /> Request Stock</button>}
          {canPurchase && <button className="btn btn-ghost" onClick={onAdjust}><Boxes size={15} /> Adjust Stock</button>}
          {canPurchase && <button className="btn btn-primary" onClick={onPurchase}><Truck size={15} /> Receive Stock</button>}
        </div>
      </div>
      <div className="dashboard-grid-2col">
        <Panel title="Low Stock Alerts" sub={`${lowStock.length} items at or below reorder point`}>
          {lowStock.length === 0 ? <Empty icon={CheckCircle} text="All stock above reorder points" /> : (
            <div className="low-stock-list">
              {lowStock.map((p) => (
                <div key={p.id} className="low-stock-row">
                  <div className="ls-info">
                    <strong>{p.name}</strong>
                    <span>{p.sku} · {p.category}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Badge text={`${p.quantity} left`} tone={p.quantity === 0 ? 'red' : 'amber'} />
                    <div style={{ fontSize: 10, marginTop: 2, color: 'var(--t-muted)' }}>reorder at {p.reorderAt}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Recent Stock Movements">
          {movements.length === 0 ? <Empty icon={Activity} text="No movements recorded" /> : (
            <div className="movement-list">
              {movements.slice(0, 12).map((m) => (
                <div key={m.id} className="movement-row">
                  <span className={`mv-type mv-${m.type}`}>{m.type}</span>
                  <div className="mv-info">
                    <strong>{m.productName}</strong>
                    <span>{m.note} · {fmtDate(m.createdAt)}</span>
                  </div>
                  <span className={`mv-qty ${m.quantity < 0 ? 'qty-neg' : 'qty-pos'}`}>
                    {m.quantity > 0 ? '+' : ''}{m.quantity}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ── Status label helpers ──────────────────────────────────────────────────────
function reqStatusBadge(status: PurchaseRequest['status']) {
  if (status === 'approved') return <Badge text="Approved" tone="green" />;
  if (status === 'rejected') return <Badge text="Rejected" tone="red" />;
  if (status === 'forwarded') return <Badge text="Pending Owner Approval" tone="blue" />;
  return <Badge text="Pending Review" tone="amber" />;
}

// ── Purchases Page ────────────────────────────────────────────────────────────
function PurchasesPage({ data, purchaseRequests, canPurchase, user, onPurchase, onRequest, onReview, onManagerReview, onExport }: {
  data: Bootstrap; purchaseRequests: PurchaseRequest[]; canPurchase: boolean; user: User;
  onPurchase: () => void; onRequest: () => void;
  onReview: (r: PurchaseRequest) => void;
  onManagerReview: (r: PurchaseRequest) => void;
  onExport: () => void;
}) {
  const purchases = data.transactions.filter((t) => t.type === 'purchase');
  const pendingCount = purchaseRequests.filter((r) => r.status === 'pending').length;
  const forwardedCount = purchaseRequests.filter((r) => r.status === 'forwarded').length;
  const showActions = user.role === 'admin' || user.role === 'manager';
  return (
    <div className="page">
      <div className="page-hdr">
        <div>
          <div className="page-eyebrow">PURCHASING</div>
          <h1>Purchases & Requests</h1>
          <p className="page-sub">{purchases.length} purchase transactions</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={onExport}><Download size={15} /> Export</button>
          <button className="btn btn-ghost" onClick={onRequest}><FileText size={15} /> Request Stock</button>
          {canPurchase && <button className="btn btn-primary" onClick={onPurchase}><Truck size={15} /> Receive Stock</button>}
        </div>
      </div>

      {purchaseRequests.length > 0 && (
        <Panel
          title="Stock Requests"
          sub={`${pendingCount} pending review · ${forwardedCount} awaiting Owner approval`}
        >
          <div className="data-table">
            <table>
              <thead><tr>
                <th>Product</th><th>Requested By</th><th>Qty</th><th>Supplier</th>
                <th>Status</th><th>Date</th>
                {showActions && <th>Actions</th>}
              </tr></thead>
              <tbody>
                {purchaseRequests.map((r) => {
                  // What action is available for this row?
                  const managerCanAct = user.role === 'manager'
                    && r.status === 'pending'
                    && r.requestedBy !== user.id;
                  const adminCanAct = user.role === 'admin'
                    && (r.status === 'pending' || r.status === 'forwarded');
                  return (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.productName}</strong>
                        {r.note && <div style={{ fontSize: 10, color: 'var(--t-muted)', marginTop: 2 }}>{r.note}</div>}
                      </td>
                      <td style={{ fontSize: 11 }}>{r.requestedByName}</td>
                      <td>{r.quantity}</td>
                      <td style={{ fontSize: 11, color: 'var(--t-muted)' }}>{r.supplierName}</td>
                      <td>
                        {reqStatusBadge(r.status)}
                        {r.forwardedByName && (
                          <div style={{ fontSize: 9, color: 'var(--t-muted)', marginTop: 2 }}>
                            via {r.forwardedByName}
                          </div>
                        )}
                        {r.reviewedByName && r.reviewNote && (
                          <div style={{ fontSize: 9, color: 'var(--t-muted)', marginTop: 2 }} title={r.reviewNote}>
                            Note: {r.reviewNote.slice(0, 40)}{r.reviewNote.length > 40 ? '…' : ''}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--t-muted)' }}>{fmtDate(r.createdAt)}</td>
                      {showActions && (
                        <td>
                          {managerCanAct && (
                            <button className="btn btn-sm btn-primary" onClick={() => onManagerReview(r)}>
                              Review
                            </button>
                          )}
                          {adminCanAct && (
                            <button className="btn btn-sm btn-primary" onClick={() => onReview(r)}>
                              Review
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Purchase History" sub="all stock receipts">
        <TxTable transactions={purchases} currency={data.store.currency} canFinancials={canViewFinancials(user)} />
      </Panel>
    </div>
  );
}

// ── Sales Page ────────────────────────────────────────────────────────────────
function SalesPage({ data, canSell, canFinancials, onSale, onReturn, onInvoice, onExport }: {
  data: Bootstrap; canSell: boolean; canFinancials: boolean;
  onSale: () => void; onReturn: (t: Transaction) => void;
  onInvoice: (t: Transaction) => void; onExport: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const { user } = data;
  const sales = data.transactions.filter((t) => t.type === 'sale' || t.type === 'return');
  const displayed = filter === 'mine' ? sales.filter((t) => t.userId === user.id) : sales;
  return (
    <div className="page">
      <div className="page-hdr">
        <div>
          <div className="page-eyebrow">SALES HISTORY</div>
          <h1>Sales & Invoices</h1>
          <p className="page-sub">{sales.length} total transactions</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={onExport}><Download size={15} /> Export</button>
          {canSell && <button className="btn btn-primary" onClick={onSale}><Plus size={15} /> New Sale</button>}
        </div>
      </div>
      <div className="table-toolbar">
        <div className="filter-tabs">
          <button className={`ftab${filter === 'all' ? ' ftab-active' : ''}`} onClick={() => setFilter('all')}>All Sales</button>
          <button className={`ftab${filter === 'mine' ? ' ftab-active' : ''}`} onClick={() => setFilter('mine')}>My Sales</button>
        </div>
        <span className="table-count">{displayed.length} records</span>
      </div>
      {displayed.length === 0 ? <Empty icon={ShoppingCart} text="No sales recorded yet" /> : (
        <div className="data-table">
          <table>
            <thead><tr>
              <th>Invoice</th><th>Type</th><th>Product</th><th>Qty</th>
              {canFinancials && <th>Total</th>}
              <th>Customer</th><th>Staff</th><th>Date</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {displayed.map((t) => (
                <tr key={t.id}>
                  <td><code style={{ fontSize: 11 }}>{t.invoiceNumber ?? '—'}</code></td>
                  <td><Badge text={t.type} tone={t.type === 'sale' ? 'green' : 'amber'} /></td>
                  <td>{t.productName}</td>
                  <td>{t.quantity}</td>
                  {canFinancials && <td>{fmt(t.total, data.store.currency)}</td>}
                  <td style={{ color: 'var(--t-muted)', fontSize: 11 }}>{t.customer ?? 'Walk-in'}</td>
                  <td style={{ color: 'var(--t-muted)', fontSize: 11 }}>{t.userName}</td>
                  <td style={{ color: 'var(--t-muted)', fontSize: 11 }}>{fmtDate(t.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      {t.invoiceNumber && <button className="icon-btn-sm" onClick={() => onInvoice(t)}><FileText size={13} /></button>}
                      {canSell && t.type === 'sale' && t.quantity > t.returnedQuantity && (
                        <button className="icon-btn-sm" onClick={() => onReturn(t)} title="Process return"><RotateCcw size={13} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Suppliers Page ────────────────────────────────────────────────────────────
function SuppliersPage({ suppliers, canManage, onAdd, onEdit, onDelete }: {
  suppliers: Supplier[]; canManage: boolean;
  onAdd: () => void; onEdit: (s: Supplier) => void; onDelete: (s: Supplier) => void;
}) {
  return (
    <div className="page">
      <div className="page-hdr">
        <div>
          <div className="page-eyebrow">SUPPLIER DIRECTORY</div>
          <h1>Suppliers</h1>
          <p className="page-sub">{suppliers.length} active suppliers</p>
        </div>
        <div className="page-actions">
          {canManage && <button className="btn btn-primary" onClick={onAdd}><Plus size={15} /> Add Supplier</button>}
        </div>
      </div>
      {suppliers.length === 0 ? <Empty icon={ClipboardList} text="No suppliers added yet" /> : (
        <div className="data-table">
          <table>
            <thead><tr>
              <th>Name</th><th>Contact</th><th>Email</th><th>Phone</th><th>Lead Time</th>
              {canManage && <th>Actions</th>}
            </tr></thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td>{s.contact}</td>
                  <td style={{ color: 'var(--t-muted)' }}>{s.email}</td>
                  <td style={{ color: 'var(--t-muted)' }}>{s.phone || '—'}</td>
                  <td>{s.leadTime || '—'}</td>
                  {canManage && (
                    <td>
                      <div className="row-actions">
                        <button className="icon-btn-sm" onClick={() => onEdit(s)}><Edit2 size={13} /></button>
                        <button className="icon-btn-sm icon-btn-danger" onClick={() => onDelete(s)}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Reports Page ──────────────────────────────────────────────────────────────
function ReportsPage({ report, data, period, onPeriod, onExportInventory, onExportSales, onExportPurchases }: {
  report: Report | null; data: Bootstrap; period: string;
  onPeriod: (p: string) => void;
  onExportInventory: () => void; onExportSales: () => void; onExportPurchases: () => void;
}) {
  const currency = data.store.currency;
  return (
    <div className="page">
      <div className="page-hdr">
        <div>
          <div className="page-eyebrow">ANALYTICS & REPORTS</div>
          <h1>Reports</h1>
          <p className="page-sub">Real data from your store transactions</p>
        </div>
        <div className="page-actions">
          <select className="select" value={period} onChange={(e) => onPeriod(e.target.value)}>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="year">This Year</option>
          </select>
          <button className="btn btn-ghost" onClick={onExportSales}><Download size={15} /> Sales CSV</button>
          <button className="btn btn-ghost" onClick={onExportPurchases}><Download size={15} /> Purchases CSV</button>
          <button className="btn btn-ghost" onClick={onExportInventory}><Download size={15} /> Inventory CSV</button>
        </div>
      </div>

      {report && (
        <>
          <div className="stats-grid stats-grid-4">
            <StatCard label="Sales Revenue" value={fmt(report.sales, currency)} sub={`this ${period}`} icon={DollarSign} accent />
            <StatCard label="Purchase Spend" value={fmt(report.purchaseSpend, currency)} sub={`this ${period}`} icon={Truck} />
            <StatCard label="Transactions" value={report.transactionCount.toString()} sub="total operations" icon={Activity} />
            <StatCard label="Gross Profit" value={fmt(report.sales - report.purchaseSpend, currency)} sub="sales minus purchases" icon={Star} accent />
          </div>

          <div className="dashboard-grid-2col">
            <Panel title="Daily Sales" sub={`Last 14 days`}>
              <SalesChartWidget report={report} currency={currency} />
            </Panel>
            <Panel title="Best Selling Products" sub="by units sold">
              <BestSellersChart items={report.bestSelling} currency={currency} />
            </Panel>
          </div>

          {report.lowStock.length > 0 && (
            <Panel title="Low Stock Report" sub={`${report.lowStock.length} items need reordering`}>
              <div className="data-table">
                <table>
                  <thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Current Stock</th><th>Reorder Point</th></tr></thead>
                  <tbody>
                    {report.lowStock.map((p) => (
                      <tr key={p.id}>
                        <td><strong>{p.name}</strong></td>
                        <td><code style={{ fontSize: 11 }}>{p.sku}</code></td>
                        <td><Badge text={p.category} /></td>
                        <td><Badge text={p.quantity.toString()} tone={p.quantity === 0 ? 'red' : 'amber'} /></td>
                        <td>{p.reorderAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </>
      )}
      {!report && <Empty icon={BarChart2} text="Loading report data…" />}
    </div>
  );
}

// ── Team Page ─────────────────────────────────────────────────────────────────
function TeamPage({ data, purchaseRequests, damagedProducts, onAdd, onEdit, onAddCat, onDeleteCat }: {
  data: Bootstrap; purchaseRequests: PurchaseRequest[]; damagedProducts: DamagedProduct[];
  onAdd: () => void; onEdit: (u: User) => void; onAddCat: () => void; onDeleteCat: (c: string) => void;
}) {
  return (
    <div className="page">
      <div className="page-hdr">
        <div>
          <div className="page-eyebrow">TEAM MANAGEMENT</div>
          <h1>Team & Employees</h1>
          <p className="page-sub">{data.users.length} accounts</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={onAddCat}><SlidersHorizontal size={15} /> Categories</button>
          <button className="btn btn-primary" onClick={onAdd}><UserPlus size={15} /> Add Employee</button>
        </div>
      </div>

      <Panel title="Employees" sub="all team accounts">
        {data.users.length === 0 ? <Empty icon={Users} text="No employees yet" /> : (
          <div className="data-table">
            <table>
              <thead><tr>
                <th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Joined</th><th>Actions</th>
              </tr></thead>
              <tbody>
                {data.users.filter((u) => u.role !== 'admin').map((u) => (
                  <tr key={u.id}>
                    <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Avatar name={u.name} size={28} /><strong>{u.name}</strong></div></td>
                    <td style={{ color: 'var(--t-muted)' }}>{u.email}</td>
                    <td><Badge text={ROLE_META[u.role].label} tone={u.role === 'manager' ? 'green' : u.role === 'inventory' ? 'blue' : 'amber'} /></td>
                    <td><Badge text={u.active ? 'Active' : 'Inactive'} tone={u.active ? 'green' : 'red'} /></td>
                    <td style={{ fontSize: 11, color: 'var(--t-muted)' }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td><button className="icon-btn-sm" onClick={() => onEdit(u)}><Edit2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="dashboard-grid-2col">
        <Panel title="Recent Activity" sub="team actions">
          {data.activity.length === 0 ? <Empty icon={Activity} text="No activity" /> : (
            <div className="activity-list">
              {data.activity.slice(0, 10).map((a) => (
                <div key={a.id} className="activity-row">
                  <Avatar name={a.userName} size={24} />
                  <div className="activity-info">
                    <span><strong>{a.userName}</strong> {a.action}</span>
                    <small>{fmtDate(a.createdAt)}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Damaged Product Reports" sub={`${damagedProducts.length} reports`}>
          {damagedProducts.length === 0 ? <Empty icon={Archive} text="No damage reports" /> : (
            <div className="movement-list">
              {damagedProducts.slice(0, 8).map((d) => (
                <div key={d.id} className="movement-row">
                  <span className="mv-type mv-damaged">damaged</span>
                  <div className="mv-info">
                    <strong>{d.productName}</strong>
                    <span>{d.reason || 'No reason given'} · {d.reportedByName}</span>
                  </div>
                  <span className="mv-qty qty-neg">-{d.quantity}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ── Settings Page ─────────────────────────────────────────────────────────────
function SettingsPage({ data, onEdit, onAddCat, onDeleteCat }: {
  data: Bootstrap; onEdit: () => void; onAddCat: () => void; onDeleteCat: (c: string) => void;
}) {
  return (
    <div className="page">
      <div className="page-hdr">
        <div>
          <div className="page-eyebrow">CONFIGURATION</div>
          <h1>Store Settings</h1>
          <p className="page-sub">Store identity, currency, and categories</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={onEdit}><Settings size={15} /> Edit Settings</button>
        </div>
      </div>
      <div className="dashboard-grid-2col">
        <Panel title="Store Information">
          <div className="settings-list">
            <div className="settings-row"><span>Store Name</span><strong>{data.store.name}</strong></div>
            <div className="settings-row"><span>Currency</span><strong>{data.store.currency}</strong></div>
            <div className="settings-row"><span>Timezone</span><strong>{data.store.timezone}</strong></div>
          </div>
        </Panel>
        <Panel title="Product Categories" sub={`${data.categories.length} categories`}
          action={<button className="btn btn-sm btn-primary" onClick={onAddCat}><Plus size={13} /> Add</button>}>
          {data.categories.length === 0 ? <Empty icon={TagIcon} text="No categories yet" /> : (
            <div className="cat-list">
              {data.categories.map((c) => (
                <div key={c} className="cat-row">
                  <Badge text={c} />
                  <button className="icon-btn-sm icon-btn-danger" onClick={() => onDeleteCat(c)}><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ── Form components ───────────────────────────────────────────────────────────

function ProductForm({ product, data }: { product: Product | null; data: Bootstrap }) {
  return (
    <div className="form-grid">
      <label>Product Name *<input name="name" required defaultValue={product?.name} placeholder="e.g. Blue Pen" /></label>
      <label>SKU *<input name="sku" required defaultValue={product?.sku} placeholder="e.g. PEN-001" /></label>
      <label>Barcode<input name="barcode" defaultValue={product?.barcode} placeholder="Optional" /></label>
      <label>Category *
        <select name="category" required defaultValue={product?.category ?? ''}>
          <option value="" disabled>Select category</option>
          {data.categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label>Supplier
        <select name="supplierId" defaultValue={product?.supplierId ?? ''}>
          <option value="">No supplier</option>
          {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {!product && <label>Initial Quantity<input type="number" name="quantity" min="0" defaultValue="0" /></label>}
      <label>Reorder Point<input type="number" name="reorderAt" min="0" defaultValue={product?.reorderAt ?? 5} /></label>
      <label>Purchase Cost<input type="number" name="cost" min="0" step="0.01" defaultValue={product?.cost ?? 0} /></label>
      <label>Selling Price *<input type="number" name="price" min="0" step="0.01" required defaultValue={product?.price ?? 0} /></label>
      <label className="field-full">Image URL<input name="imageUrl" defaultValue={product?.imageUrl} placeholder="https://…" /></label>
    </div>
  );
}

function PurchaseForm({ data, canFinancials }: { data: Bootstrap; canFinancials: boolean }) {
  return (
    <div className="form-grid">
      <label className="field-full">Product *
        <select name="productId" required>
          <option value="" disabled>Select product</option>
          {data.products.map((p) => <option key={p.id} value={p.id}>{p.name} (in stock: {p.quantity})</option>)}
        </select>
      </label>
      <label className="field-full">Supplier *
        <select name="supplierId" required>
          <option value="" disabled>Select supplier</option>
          {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label>Quantity Received *<input type="number" name="quantity" min="1" required defaultValue="1" /></label>
      {canFinancials && <label>Unit Cost<input type="number" name="unitCost" min="0" step="0.01" defaultValue="0" /></label>}
      <label className="field-full">Note<input name="note" placeholder="Optional reference or note" /></label>
    </div>
  );
}

function SaleForm({ data, lines, onLines, currency }: {
  data: Bootstrap; lines: { id: number; productId: string; quantity: string }[];
  onLines: (l: { id: number; productId: string; quantity: string }[]) => void; currency: string;
}) {
  // Compute per-line totals and grand total; merge duplicate productIds for total
  const usedIds = new Set(lines.map((l) => l.productId).filter(Boolean));

  const lineData = lines.map((line) => {
    const prod = data.products.find((p) => p.id === line.productId) ?? null;
    const qty = Math.max(0, Number(line.quantity) || 0);
    const lineTotal = prod ? (prod.price ?? 0) * qty : 0;
    const isDuplicate = line.productId
      ? lines.filter((l) => l.productId === line.productId).length > 1
      : false;
    const overStock = prod && qty > prod.quantity;
    return { line, prod, qty, lineTotal, isDuplicate, overStock };
  });

  const grandTotal = lineData.reduce((s, d) => s + d.lineTotal, 0);

  const addLine = () => onLines([...lines, { id: Date.now(), productId: '', quantity: '1' }]);
  const removeLine = (id: number) => onLines(lines.filter((l) => l.id !== id));
  const updateLine = (id: number, patch: Partial<{ productId: string; quantity: string }>) =>
    onLines(lines.map((l) => l.id === id ? { ...l, ...patch } : l));

  return (
    <div className="form-grid">
      {/* ── Items table ─────────────────────────────────────────────────────── */}
      <div className="field-full">
        <div className="sale-items-hdr">
          <span>Items</span>
          <span className="sale-col-price">Unit Price</span>
          <span className="sale-col-qty">Qty</span>
          <span className="sale-col-total">Line Total</span>
          <span className="sale-col-del" />
        </div>

        {lineData.map(({ line, prod, qty, lineTotal, isDuplicate, overStock }) => (
          <div key={line.id} className={`sale-line-row${isDuplicate ? ' sale-line-dup' : ''}${overStock ? ' sale-line-err' : ''}`}>
            {/* Product selector */}
            <select
              className="sale-col-product"
              value={line.productId}
              onChange={(e) => updateLine(line.id, { productId: e.target.value })}
            >
              <option value="" disabled>Select product…</option>
              {data.products
                .filter((p) => p.quantity > 0 || p.id === line.productId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.quantity} in stock)
                  </option>
                ))}
            </select>

            {/* Unit price */}
            <span className="sale-col-price sale-price-cell">
              {prod ? fmt(prod.price ?? 0, currency) : '—'}
            </span>

            {/* Quantity */}
            <input
              className="sale-col-qty"
              type="number"
              min={1}
              max={prod?.quantity ?? undefined}
              value={line.quantity}
              onChange={(e) => updateLine(line.id, { quantity: e.target.value })}
            />

            {/* Line total */}
            <span className={`sale-col-total sale-price-cell${overStock ? ' sale-err-text' : ''}`}>
              {overStock
                ? `max ${prod!.quantity}`
                : prod
                ? fmt(lineTotal, currency)
                : '—'}
            </span>

            {/* Remove row */}
            <span className="sale-col-del">
              {lines.length > 1 && (
                <button type="button" className="icon-btn-sm icon-btn-danger" onClick={() => removeLine(line.id)} title="Remove item">
                  <X size={12} />
                </button>
              )}
            </span>
          </div>
        ))}

        {/* Duplicate warning */}
        {lineData.some((d) => d.isDuplicate) && (
          <div className="sale-warn">
            <AlertCircle size={12} /> Duplicate products will be merged into one line on checkout.
          </div>
        )}

        <button type="button" className="btn btn-sm btn-ghost sale-add-btn" onClick={addLine}>
          <Plus size={13} /> Add Item
        </button>
      </div>

      {/* ── Customer & note ─────────────────────────────────────────────────── */}
      <label>Customer Name<input name="customer" placeholder="Walk-in customer" /></label>
      <label>Note<input name="note" placeholder="Optional note" /></label>

      {/* ── Grand total ─────────────────────────────────────────────────────── */}
      <div className="field-full sale-total">
        <div>
          <span style={{ fontSize: 11, color: 'var(--t-muted)' }}>
            {lineData.filter((d) => d.prod).length} item{lineData.filter((d) => d.prod).length === 1 ? '' : 's'}
          </span>
          <div style={{ fontSize: 11, color: 'var(--t-muted)', marginTop: 2 }}>Grand Total</div>
        </div>
        <strong>{fmt(grandTotal, currency)}</strong>
      </div>
    </div>
  );
}

function StockForm({ data }: { data: Bootstrap }) {
  return (
    <div className="form-grid">
      <label className="field-full">Product *
        <select name="productId" required>
          <option value="" disabled>Select product</option>
          {data.products.map((p) => <option key={p.id} value={p.id}>{p.name} (qty: {p.quantity})</option>)}
        </select>
      </label>
      <label>Operation *
        <select name="operation" required>
          <option value="in">Stock In (+)</option>
          <option value="out">Stock Out (-)</option>
        </select>
      </label>
      <label>Quantity *<input type="number" name="quantity" min="1" required defaultValue="1" /></label>
      <label className="field-full">Note<input name="note" placeholder="Reason for adjustment" /></label>
    </div>
  );
}

function ReturnForm({ sale }: { sale: Transaction }) {
  const maxQty = sale.quantity - sale.returnedQuantity;
  return (
    <div className="form-grid">
      <div className="field-full return-info">
        <strong>{sale.productName}</strong>
        <span>Invoice: {sale.invoiceNumber}</span>
        <span>Sold: {sale.quantity} · Already returned: {sale.returnedQuantity} · Max returnable: {maxQty}</span>
      </div>
      <label className="field-full">Quantity to Return *
        <input type="number" name="quantity" min="1" max={maxQty} required defaultValue="1" />
      </label>
    </div>
  );
}

function SupplierForm({ supplier }: { supplier: Supplier | null }) {
  return (
    <div className="form-grid">
      <label>Supplier Name *<input name="name" required defaultValue={supplier?.name} /></label>
      <label>Contact Person *<input name="contact" required defaultValue={supplier?.contact} /></label>
      <label>Email *<input type="email" name="email" required defaultValue={supplier?.email} /></label>
      <label>Phone<input name="phone" defaultValue={supplier?.phone} /></label>
      <label className="field-full">Address<input name="address" defaultValue={supplier?.address} /></label>
      <label>Lead Time<input name="leadTime" defaultValue={supplier?.leadTime} placeholder="e.g. 3-5 days" /></label>
    </div>
  );
}

function UserForm({ user }: { user: User | null }) {
  return (
    <div className="form-grid">
      <label>Full Name *<input name="name" required defaultValue={user?.name} /></label>
      <label>Email *<input type="email" name="email" required defaultValue={user?.email} /></label>
      <label>Role *
        <select name="role" required defaultValue={user?.role ?? 'sales'}>
          <option value="manager">Manager</option>
          <option value="inventory">Inventory Staff</option>
          <option value="sales">Sales Staff</option>
        </select>
      </label>
      <label>Status
        <select name="active" defaultValue={user ? String(user.active) : 'true'}>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </label>
      <label className="field-full">{user ? 'New Password (leave blank to keep)' : 'Password *'}
        <input type="password" name="password" required={!user} minLength={8} placeholder={user ? 'Leave blank to keep current' : 'Min 8 characters'} />
      </label>
    </div>
  );
}

function CategoryForm({ data, onDelete }: { data: Bootstrap; onDelete: (c: string) => void }) {
  return (
    <div className="form-grid">
      <label className="field-full">New Category Name *<input name="name" required placeholder="e.g. Electronics" /></label>
      {data.categories.length > 0 && (
        <div className="field-full">
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: 'var(--t-text)' }}>Existing Categories</div>
          <div className="cat-list">
            {data.categories.map((c) => (
              <div key={c} className="cat-row">
                <Badge text={c} />
                <button type="button" className="icon-btn-sm icon-btn-danger" onClick={() => onDelete(c)}><X size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="modal-footer field-full">
        <button type="submit" className="btn btn-primary"><Plus size={14} /> Add Category</button>
      </div>
    </div>
  );
}

function SettingsForm({ data }: { data: Bootstrap }) {
  return (
    <div className="form-grid">
      <label className="field-full">Store Name *<input name="name" required defaultValue={data.store.name} /></label>
      <label>Currency *<input name="currency" required defaultValue={data.store.currency} placeholder="USD" maxLength={3} /></label>
      <label>Timezone *<input name="timezone" required defaultValue={data.store.timezone} placeholder="UTC" /></label>
    </div>
  );
}

function PurchaseRequestForm({ data }: { data: Bootstrap }) {
  return (
    <div className="form-grid">
      <label className="field-full">Product *
        <select name="productId" required>
          <option value="" disabled>Select product</option>
          {data.products.map((p) => <option key={p.id} value={p.id}>{p.name} (current stock: {p.quantity})</option>)}
        </select>
      </label>
      <label className="field-full">Supplier *
        <select name="supplierId" required>
          <option value="" disabled>Select supplier</option>
          {data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label>Quantity Needed *<input type="number" name="quantity" min="1" required defaultValue="1" /></label>
      <label className="field-full">Notes / Justification<input name="note" placeholder="Why is this stock needed?" /></label>
    </div>
  );
}

function DamagedForm({ data }: { data: Bootstrap }) {
  return (
    <div className="form-grid">
      <label className="field-full">Product *
        <select name="productId" required>
          <option value="" disabled>Select product</option>
          {data.products.map((p) => <option key={p.id} value={p.id}>{p.name} (qty: {p.quantity})</option>)}
        </select>
      </label>
      <label>Damaged Quantity *<input type="number" name="quantity" min="1" required defaultValue="1" /></label>
      <label className="field-full">Reason / Description<input name="reason" placeholder="e.g. Broken during handling" /></label>
    </div>
  );
}

function ReviewRequestForm({ req }: { req: PurchaseRequest }) {
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  return (
    <div className="form-grid">
      <div className="field-full review-req-info">
        <div className="req-detail"><span>Product</span><strong>{req.productName}</strong></div>
        <div className="req-detail"><span>Requested By</span><strong>{req.requestedByName}</strong></div>
        <div className="req-detail"><span>Quantity</span><strong>{req.quantity} units</strong></div>
        <div className="req-detail"><span>Supplier</span><strong>{req.supplierName}</strong></div>
        {req.forwardedByName && (
          <div className="req-detail"><span>Forwarded By</span><strong>{req.forwardedByName}</strong></div>
        )}
        {req.note && <div className="req-detail"><span>Staff Note</span><strong>{req.note}</strong></div>}
        {req.forwardedNote && <div className="req-detail"><span>Manager Note</span><strong>{req.forwardedNote}</strong></div>}
      </div>
      <label className="field-full">Owner Decision *
        <select name="status" required value={decision} onChange={(e) => setDecision(e.target.value as 'approved' | 'rejected')}>
          <option value="approved">Approve — allow stock to be received</option>
          <option value="rejected">Reject</option>
        </select>
      </label>
      <label className="field-full">
        {decision === 'rejected' ? 'Rejection Reason *' : 'Note (optional)'}
        <input name="reviewNote" required={decision === 'rejected'}
          placeholder={decision === 'rejected' ? 'Reason for rejection…' : 'Optional note to team'} />
      </label>
    </div>
  );
}

function ManagerReviewForm({ req }: { req: PurchaseRequest }) {
  const [action, setAction] = useState<'forward' | 'reject'>('forward');
  return (
    <div className="form-grid">
      <div className="field-full review-req-info">
        <div className="req-detail"><span>Product</span><strong>{req.productName}</strong></div>
        <div className="req-detail"><span>Requested By</span><strong>{req.requestedByName}</strong></div>
        <div className="req-detail"><span>Requested Qty</span><strong>{req.quantity} units</strong></div>
        <div className="req-detail"><span>Supplier</span><strong>{req.supplierName}</strong></div>
        {req.note && <div className="req-detail"><span>Reason / Note</span><strong>{req.note}</strong></div>}
      </div>

      {/* Action toggle buttons */}
      <div className="field-full req-action-btns">
        <button
          type="button"
          className={`req-action-btn${action === 'forward' ? ' req-action-active req-action-accept' : ''}`}
          onClick={() => setAction('forward')}
        >
          <CheckCircle size={15} /> Accept &amp; Forward to Owner
        </button>
        <button
          type="button"
          className={`req-action-btn${action === 'reject' ? ' req-action-active req-action-reject' : ''}`}
          onClick={() => setAction('reject')}
        >
          <XCircle size={15} /> Reject Request
        </button>
      </div>

      {/* Hidden field carries the chosen action to handleSubmit */}
      <input type="hidden" name="action" value={action} />

      {action === 'forward' && (
        <label className="field-full">
          Note to Owner (optional)
          <input name="note" placeholder="Any context for the Owner…" />
        </label>
      )}
      {action === 'reject' && (
        <label className="field-full">
          Rejection Reason *
          <input name="reviewNote" required placeholder="Provide a reason so staff can resubmit if needed…" />
        </label>
      )}

      <div className="field-full req-action-hint">
        {action === 'forward'
          ? '✓ Status will change to "Pending Owner Approval". Stock is NOT added until goods are physically received.'
          : '✗ The request will be closed. Staff will receive a rejection notification with your reason.'}
      </div>
    </div>
  );
}

// ── Invoice Dialog ─────────────────────────────────────────────────────────────
function InvoiceDialog({ tx, allTx, store, onClose }: {
  tx: Transaction; allTx: Transaction[]; store: Bootstrap['store']; onClose: () => void;
}) {
  const related = allTx.filter((t) => t.invoiceNumber === tx.invoiceNumber && t.type === 'sale');
  const total = related.reduce((s, t) => s + (t.total ?? 0), 0);
  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card invoice-card">
        <div className="invoice-hdr">
          <div>
            <div style={{ fontSize: 11, color: 'var(--t-muted)', letterSpacing: '1px', fontWeight: 600 }}>INVOICE</div>
            <h3 style={{ margin: '4px 0 0', fontSize: 18 }}>{tx.invoiceNumber}</h3>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="invoice-meta">
          <div><span>Store</span><strong>{store.name}</strong></div>
          <div><span>Customer</span><strong>{tx.customer || 'Walk-in'}</strong></div>
          <div><span>Date</span><strong>{fmtDate(tx.createdAt)}</strong></div>
          <div><span>Staff</span><strong>{tx.userName}</strong></div>
        </div>
        <div className="data-table" style={{ margin: '16px 0' }}>
          <table>
            <thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
            <tbody>
              {related.map((t) => (
                <tr key={t.id}>
                  <td>{t.productName}</td>
                  <td>{t.quantity}</td>
                  <td>{fmt(t.unitAmount, store.currency)}</td>
                  <td><strong>{fmt(t.total, store.currency)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="invoice-total">
          <span>Total</span>
          <strong>{fmt(total, store.currency)}</strong>
        </div>
        <div className="modal-footer" style={{ marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={() => window.print()}><Download size={14} /> Print</button>
        </div>
      </div>
    </div>
  );
}
