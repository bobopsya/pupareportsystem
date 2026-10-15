export type Theme = 'system' | 'light' | 'dark';

/** The theme choice is a per-device convenience, so it lives in localStorage (and may be unavailable). */
export function getTheme(): Theme {
  try {
    const t = localStorage.getItem('bb-theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]:not([media])')?.remove();
  const m = document.createElement('meta');
  m.name = 'theme-color';
  m.content = dark ? '#000000' : '#f2f3f5';
  if (t !== 'system') document.head.appendChild(m);
}

export function setTheme(t: Theme) {
  try {
    if (t === 'system') localStorage.removeItem('bb-theme');
    else localStorage.setItem('bb-theme', t);
  } catch {
    /* private mode: the choice lasts until reload */
  }
  applyTheme(t);
}
