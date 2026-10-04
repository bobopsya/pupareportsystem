import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, onUnauthorized } from './api';
import type { SessionUser } from './types';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: (reason?: string) => Promise<void>;
  refresh: () => Promise<void>;
  notice: string | null;
}

const AuthContext = createContext<AuthState | null>(null);
const IDLE_MS = 30 * 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const qc = useQueryClient();
  const lastActivity = useRef(Date.now());
  const userRef = useRef<SessionUser | null>(null);
  userRef.current = user;

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ user: SessionUser | null }>('/auth/me');
      setUser(res.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const drop = useCallback(
    (reason: string | null) => {
      setUser(null);
      setNotice(reason);
      qc.clear();
    },
    [qc],
  );

  const logout = useCallback(
    async (reason?: string) => {
      await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
      drop(reason ?? null);
    },
    [drop],
  );

  useEffect(() => {
    void refresh();
    // Only an established session can "expire"; a first visit simply shows the login form.
    return onUnauthorized(() => userRef.current && drop('Сессия истекла. Войдите снова.'));
  }, [refresh, drop]);

  // Client-side idle logout mirrors the server's 30-minute idle timeout.
  useEffect(() => {
    if (!user) return;
    const bump = () => (lastActivity.current = Date.now());
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current > IDLE_MS) void logout('Вы вышли автоматически после 30 минут бездействия.');
    }, 15_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(timer);
    };
  }, [user, logout]);

  const login = useCallback(async (loginName: string, password: string) => {
    const res = await api<{ user: SessionUser }>('/auth/login', { body: { login: loginName, password } });
    lastActivity.current = Date.now();
    setNotice(null);
    setUser(res.user);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh, notice }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
