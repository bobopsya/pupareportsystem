import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type ThemePref = 'dark' | 'light' | 'system';
export type MapStyle = 'auto' | 'dark' | 'light';

const THEME_KEY = 'zn.theme';
const MAP_KEY = 'zn.mapStyle';
const EVENT = 'zn:prefs';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

const systemLight = () => window.matchMedia('(prefers-color-scheme: light)').matches;

export function resolveTheme(pref: ThemePref): 'dark' | 'light' {
  return pref === 'system' ? (systemLight() ? 'light' : 'dark') : pref;
}

/** Same logic as public/theme-init.js, which applies the theme before first paint. */
function apply(pref: ThemePref) {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function useTheme() {
  const pref = useSyncExternalStore(subscribe, () => read<ThemePref>(THEME_KEY, ['dark', 'light', 'system'], 'dark'));

  useEffect(() => {
    apply(pref);
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => write(THEME_KEY, p), []);
  return { pref, resolved: resolveTheme(pref), setPref };
}

/** Map tile style, shared by every map in the portal. "auto" follows the portal theme. */
export function useMapStyle() {
  const style = useSyncExternalStore(subscribe, () => read<MapStyle>(MAP_KEY, ['auto', 'dark', 'light'], 'auto'));
  const setStyle = useCallback((s: MapStyle) => write(MAP_KEY, s), []);
  return { style, setStyle };
}
