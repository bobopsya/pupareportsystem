import { PlusSquare, Share, Smartphone, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { canPrompt, hideInstall, installHidden, isIOS, isStandalone, onInstallChange, promptInstall } from '../lib/install';
import { LogoMark } from './Logo';
import { Button, Modal } from './ui';

/** Whether to offer the app at all: not inside the installed app, and only where it can be installed. */
export function useInstallable() {
  const [, render] = useState(0);
  useEffect(() => onInstallChange(() => render((n) => n + 1)), []);
  if (isStandalone()) return null;
  if (isIOS()) return 'ios' as const;
  if (canPrompt()) return 'prompt' as const;
  return null;
}

/** iPhone: there is no install button in Safari, so we explain the two taps. */
export function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Bobobank на экране «Домой»" footer={<Button onClick={onClose}>Понятно</Button>}>
      <ol className="flex flex-col gap-4 text-[15px]">
        <li className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand">1</span>
          <span className="pt-1">Откройте сайт банка в <b className="font-semibold">Safari</b> и нажмите <Share className="mx-0.5 inline size-[18px] -translate-y-0.5 text-[#007AFF]" /> «Поделиться» внизу экрана.</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand">2</span>
          <span className="pt-1">Прокрутите список и выберите <PlusSquare className="mx-0.5 inline size-[18px] -translate-y-0.5" /> «На экран „Домой“».</span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand">3</span>
          <span className="pt-1">Нажмите «Добавить». Иконка Bobobank появится рядом с другими приложениями и откроется на весь экран.</span>
        </li>
      </ol>
      <p className="mt-4 text-sm text-muted">В приложении нужно будет один раз войти по номеру и паролю.</p>
    </Modal>
  );
}

/** Opens the right flow for the device: Chrome's dialog or the iPhone instructions. */
export function useInstall() {
  const kind = useInstallable();
  const [sheet, setSheet] = useState(false);
  const start = () => (kind === 'prompt' ? void promptInstall() : setSheet(true));
  return { kind, start, sheet: <InstallSheet open={sheet} onClose={() => setSheet(false)} /> };
}

/** A dismissible card on the home screen. */
export function InstallBanner() {
  const { kind, start, sheet } = useInstall();
  const [hidden, setHidden] = useState(installHidden);
  if (!kind || hidden) return null;
  return (
    <>
      <div className="flex items-center gap-3 rounded-2xl bg-surface p-4">
        <LogoMark className="size-12 rounded-xl" />
        <button type="button" onClick={start} className="min-w-0 flex-1 text-left">
          <span className="block font-semibold">Установите Bobobank</span>
          <span className="block text-sm text-muted">Иконка на экране «Домой» — банк откроется как приложение</span>
        </button>
        <button type="button" aria-label="Скрыть подсказку" onClick={() => (hideInstall(), setHidden(true))} className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-hover">
          <X className="size-4" />
        </button>
      </div>
      {sheet}
    </>
  );
}

export const InstallIcon = Smartphone;
