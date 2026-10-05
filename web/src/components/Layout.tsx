import {
  CalendarCheck,
  Cpu,
  Gauge,
  History,
  KeyRound,
  ListTodo,
  LogOut,
  Map as MapIcon,
  Menu,
  Monitor,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Route,
  Settings,
  Sun,
  Trash2,
  Usb,
  UserRound,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { initials } from '../lib/format';
import { useTheme, type ThemePref } from '../lib/theme';
import { LogoMark, Wordmark } from './Logo';
import { cx, IconButton, Segmented } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Обзор',
    items: [
      { to: '/', label: 'Дашборд', icon: <Gauge /> },
      { to: '/map', label: 'Карта', icon: <MapIcon /> },
      { to: '/tasks', label: 'Задачи', icon: <ListTodo /> },
      { to: '/checkins', label: 'Отметки', icon: <CalendarCheck /> },
    ],
  },
  {
    section: 'Люди',
    items: [
      { to: '/employees', label: 'Сотрудники', icon: <Users /> },
      { to: '/clients', label: 'Клиенты', icon: <UserRound /> },
    ],
  },
  {
    section: 'Инструменты',
    items: [
      { to: '/vault', label: 'Пароли', icon: <KeyRound /> },
      { to: '/zerotier', label: 'ZeroTier', icon: <Network /> },
      { to: '/wifi', label: 'Wi-Fi', icon: <Wifi /> },
      { to: '/routes', label: 'Маршруты', icon: <Route /> },
      { to: '/devices', label: 'Устройства', icon: <Cpu /> },
      { to: '/console', label: 'USB-консоль', icon: <Usb /> },
    ],
  },
  {
    section: 'Система',
    items: [
      { to: '/audit', label: 'Журнал', icon: <History /> },
      { to: '/trash', label: 'Корзина', icon: <Trash2 /> },
      { to: '/settings', label: 'Настройки', icon: <Settings /> },
    ],
  },
];

const COLLAPSE_KEY = 'zn.sidebar.collapsed';

function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

const THEME_OPTIONS: { id: ThemePref; label: string; icon: ReactNode }[] = [
  { id: 'dark', label: 'Тёмная', icon: <Moon className="size-3.5" /> },
  { id: 'light', label: 'Светлая', icon: <Sun className="size-3.5" /> },
  { id: 'system', label: 'Как в системе', icon: <Monitor className="size-3.5" /> },
];

/** Theme choice: a segmented control, or a single cycling button when the sidebar is collapsed. */
function ThemeSwitch({ compact }: { compact: boolean }) {
  const { pref, setPref } = useTheme();
  if (compact) {
    const i = THEME_OPTIONS.findIndex((o) => o.id === pref);
    const next = THEME_OPTIONS[(i + 1) % THEME_OPTIONS.length]!;
    return (
      <IconButton label={`Тема: ${THEME_OPTIONS[i]!.label}. Переключить на «${next.label}»`} onClick={() => setPref(next.id)}>
        {THEME_OPTIONS[i]!.icon}
      </IconButton>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
      <span className="text-xs text-faint">Тема</span>
      <Segmented value={pref} onChange={setPref} options={THEME_OPTIONS.map((o) => ({ id: o.id, label: o.icon, title: o.label }))} />
    </div>
  );
}

function Sidebar({ collapsed, onToggle, onNavigate, mobile }: { collapsed: boolean; onToggle?: () => void; onNavigate?: () => void; mobile?: boolean }) {
  const { user, logout } = useAuth();
  return (
    <div className="flex h-full flex-col">
      <div className={cx('flex h-14 shrink-0 items-center gap-2.5 border-b border-line', collapsed ? 'justify-center px-2' : 'px-4')}>
        <LogoMark size={28} className="shrink-0" />
        {!collapsed && <Wordmark className="flex-1 text-[15px]" />}
        {mobile && (
          <IconButton label="Закрыть меню" onClick={onNavigate}>
            <X className="size-4" />
          </IconButton>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((group) => (
          <div key={group.section} className="mb-4">
            {!collapsed && <div className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{group.section}</div>}
            {collapsed && <div className="mx-auto mb-2 h-px w-6 bg-line first:hidden" />}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cx(
                        'group flex h-9 items-center gap-3 rounded-md text-sm transition-colors [&>svg]:size-[18px] [&>svg]:shrink-0',
                        collapsed ? 'justify-center' : 'px-2.5',
                        isActive ? 'bg-hover text-fg' : 'text-muted hover:bg-hover/60 hover:text-fg',
                      )
                    }
                  >
                    {item.icon}
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cx('shrink-0 border-t border-line p-2', collapsed && 'flex flex-col items-center gap-1')}>
        {!collapsed && user && (
          <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-hover text-xs font-medium">{initials(user.fullName)}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{user.fullName}</div>
              <div className="truncate font-mono text-xs text-faint">{user.login}</div>
            </div>
            <IconButton label="Выйти" onClick={() => void logout()}>
              <LogOut className="size-4" />
            </IconButton>
          </div>
        )}
        {collapsed && (
          <IconButton label="Выйти" onClick={() => void logout()}>
            <LogOut className="size-4" />
          </IconButton>
        )}
        <ThemeSwitch compact={collapsed} />
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            className={cx('flex h-8 w-full items-center gap-2 rounded-md text-xs text-faint hover:bg-hover/60 hover:text-fg', collapsed ? 'justify-center' : 'px-2.5')}
            title={collapsed ? 'Развернуть панель' : 'Свернуть панель'}
          >
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
            {!collapsed && 'Свернуть'}
          </button>
        )}
      </div>
    </div>
  );
}

export function Layout() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !c;
    });
  };

  return (
    <div className="flex h-full">
      <aside className={cx('hidden md:block shrink-0 border-r border-line bg-surface transition-[width] duration-200', collapsed ? 'w-[60px]' : 'w-60')}>
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/70" />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-surface" onClick={(e) => e.stopPropagation()}>
            <Sidebar collapsed={false} mobile onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 md:hidden">
          <IconButton label="Меню" onClick={() => setMobileOpen(true)}>
            <Menu className="size-5" />
          </IconButton>
          <LogoMark size={24} />
          <Wordmark className="text-[15px]" />
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-7">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
