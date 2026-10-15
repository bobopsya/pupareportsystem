/** "Add to Home Screen": iOS has no install prompt, so we show instructions; Chrome hands us its own prompt. */
interface PromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: PromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    listeners.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((f) => f());
  });
}

export const onInstallChange = (f: () => void) => {
  listeners.add(f);
  return () => void listeners.delete(f);
};

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const canPrompt = () => !!deferred;

/** Shows Chrome's install dialog; false when there is no prompt to show. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  listeners.forEach((f) => f());
  return outcome === 'accepted';
}

const KEY = 'bt-install-hidden';
export function installHidden() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
export function hideInstall() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* private mode */
  }
}
