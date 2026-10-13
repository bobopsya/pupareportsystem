import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeftRight, BarChart3, BookOpen, Check, ChevronsUpDown, Code2, Home, Landmark, Link2, LogOut, Menu, Plus, RotateCcw, Settings, ShieldHalf, X,
} from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ShopAvatar } from '../checkout/Checkout';
import { Logo } from '../components/Logo';
import { Badge, cx, Loading } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Shop } from './types';

const ShopCtx = createContext<Shop | null>(null);
export const useShop = () => useContext(ShopCtx)!;

export const useShops = () => useQuery({ queryKey: ['shops'], queryFn: () => api<{ shops: Shop[] }>('/m/shops').then((r) => r.shops) });

/** /app → first shop or onboarding. */
export function AppIndex() {
  const { data } = useShops();
  if (!data) return <Loading />;
  if (!data.length) return <Navigate to="/app/new" replace />;
  const last = Number(localStorage.getItem('gpay.shop'));
  const shop = data.find((s) => s.id === last) ?? data[0];
  return <Navigate to={`/app/${shop.id}`} replace />;
}

const NAV = [
  { to: '', label: 'Обзор', icon: Home, end: true },
  { to: 'payments', label: 'Платежи', icon: ArrowLeftRight },
  { to: 'refunds', label: 'Возвраты', icon: RotateCcw },
  { to: 'links', label: 'Ссылки и счета', icon: Link2 },
  { to: 'analytics', label: 'Аналитика', icon: BarChart3 },
  { to: 'payouts', label: 'Баланс и выплаты', icon: Landmark },
  { to: 'developers', label: 'Разработчикам', icon: Code2 },
  { to: 'settings', label: 'Настройки', icon: Settings },
];

export default function MerchantLayout() {
  const { shopId } = useParams();
  const { data: shops } = useShops();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  if (!shops) return <Loading />;
  const shop = shops.find((s) => String(s.id) === shopId);
  if (!shop) return <Navigate to="/app" replace />;
  localStorage.setItem('gpay.shop', String(shop.id));

  return (
    <ShopCtx.Provider value={shop}>
      <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 bg-surface/90 backdrop-blur border-b border-line">
          <Logo size="sm" />
          <button type="button" aria-label="Меню" className="flex size-9 items-center justify-center rounded-lg hover:bg-hover" onClick={() => setOpen(true)}>
            <Menu className="size-5" />
          </button>
        </header>
        {open && <div className="lg:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} />}
        <aside className={cx('fixed lg:sticky top-0 z-50 lg:z-auto h-screen w-[268px] lg:w-auto flex flex-col bg-surface lg:bg-transparent border-r border-line transition-transform lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
          <div className="flex items-center justify-between h-16 px-5">
            <Link to="/app"><Logo /></Link>
            <button type="button" className="lg:hidden flex size-8 items-center justify-center rounded-lg hover:bg-hover" aria-label="Закрыть меню" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </button>
          </div>
          <div className="px-3">
            <ShopSwitcher shops={shops} current={shop} />
          </div>
          <nav className="mt-4 px-3 flex flex-col gap-0.5">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={`/app/${shop.id}${n.to ? `/${n.to}` : ''}`}
                end={n.end}
                className={({ isActive }) => cx('flex items-center gap-3 h-9 px-3 rounded-lg text-sm transition-colors', isActive ? 'bg-surface lg:bg-surface text-fg font-medium shadow-card border border-line' : 'text-muted hover:text-fg hover:bg-hover border border-transparent')}
              >
                {({ isActive }) => (
                  <>
                    <n.icon className={cx('size-4', isActive && 'text-brand')} />
                    {n.label}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto px-3 pb-4 flex flex-col gap-0.5">
            <Link to="/docs" className="flex items-center gap-3 h-9 px-3 rounded-lg text-sm text-muted hover:text-fg hover:bg-hover">
              <BookOpen className="size-4" /> Документация API
            </Link>
            <UserMenu />
          </div>
        </aside>
        <main className="min-w-0 px-4 sm:px-6 lg:px-10 py-6 lg:py-8 max-w-[1240px] w-full">
          {shop.status === 'blocked' && (
            <div className="mb-5 rounded-xl border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad">Магазин заблокирован службой безопасности GPAY. Приём платежей приостановлен.</div>
          )}
          <Outlet />
        </main>
      </div>
    </ShopCtx.Provider>
  );
}

function ShopSwitcher({ shops, current }: { shops: Shop[]; current: Shop }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const loc = useLocation();
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2 text-left shadow-card hover:border-line-strong">
        <ShopAvatar shop={current} className="size-8 text-sm rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium truncate">{current.name}</span>
          <span className="block text-xs text-faint font-mono">ID {current.id}</span>
        </span>
        <ChevronsUpDown className="size-4 text-faint" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 z-20 rounded-xl border border-line bg-surface p-1 shadow-pop gp-fade-up">
          {shops.map((s) => (
            <button
              key={s.id}
              type="button"
              className="w-full flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-hover"
              onClick={() => {
                setOpen(false);
                const rest = loc.pathname.split('/').slice(3, 4).join('/');
                navigate(`/app/${s.id}${rest && !/^pay_/.test(rest) ? `/${rest}` : ''}`);
              }}
            >
              <ShopAvatar shop={s} className="size-6 text-xs rounded-md" />
              <span className="flex-1 truncate text-sm">{s.name}</span>
              {s.id === current.id && <Check className="size-4 text-brand" />}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <Link to="/app/new" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg">
            <span className="flex size-6 items-center justify-center rounded-md border border-dashed border-line-strong"><Plus className="size-3.5" /></span>
            Новый магазин
          </Link>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  return (
    <div className="mt-2 pt-3 border-t border-line">
      {user.role === 'admin' && (
        <Link to="/admin" className="flex items-center gap-3 h-9 px-3 rounded-lg text-sm text-muted hover:text-fg hover:bg-hover">
          <ShieldHalf className="size-4" /> Админка GPAY <Badge tone="brand" className="ml-auto">admin</Badge>
        </Link>
      )}
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span className="flex size-8 items-center justify-center rounded-full bg-sunken border border-line text-xs font-semibold">{user.name.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm truncate">{user.name}</span>
          <span className="block text-xs text-faint truncate">{user.email}</span>
        </span>
        <button
          type="button"
          aria-label="Выйти"
          title="Выйти"
          className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-fg"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('flex flex-col gap-5', className)}>{children}</section>;
}
