import { useQueryClient } from '@tanstack/react-query';
import { Phone, PhoneOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, errorText } from '../lib/api';
import { talk } from '../lib/format';
import { useLine, useMe } from '../lib/hooks';
import type { Call } from '../lib/types';
import { Avatar } from './Shell';
import { useToast } from './ui';

const ENDED: Record<string, string> = { ended: 'Звонок завершён', missed: 'Нет ответа', declined: 'Звонок отклонён', busy: 'Абонент занят' };

/** A soft two-tone ring through Web Audio while a call rings (no audio files). */
function useRing(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const beep = () => {
      if (!ctx || ctx.state !== 'running') return;
      for (const [f, t] of [[880, 0], [660, 0.18]] as const) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + 0.17);
      }
    };
    void ctx.resume().catch(() => undefined);
    beep();
    const id = setInterval(beep, 1600);
    try {
      navigator.vibrate?.([300, 200, 300]);
    } catch {
      /* no vibration */
    }
    return () => {
      clearInterval(id);
      void ctx?.close();
    };
  }, [on]);
}

export function CallOverlay() {
  const me = useMe();
  const q = useLine(!!me.data?.user);
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  const offset = useRef(0);
  const call = q.data?.call ?? null;
  if (call) offset.current = call.now - Date.now();
  const live = call && (call.status === 'ringing' || call.status === 'active');
  useRing(!!call && call.status === 'ringing' && call.direction === 'in');
  useEffect(() => {
    if (call?.status !== 'active') return;
    const id = setInterval(() => force((x) => x + 1), 500);
    return () => clearInterval(id);
  }, [call?.status]);
  if (!call) return null;

  const act = async (path: 'answer' | 'end') => {
    setBusy(true);
    try {
      const c = await api<Call>(`/calls/${call.id}/${path}`, { method: 'POST' });
      qc.setQueryData(['line'], (old: object | undefined) => (old ? { ...old, call: c } : old));
    } catch (e) {
      toast(errorText(e), 'bad');
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: ['line'] });
    }
  };

  const seconds = call.status === 'active' && call.answeredAt ? (Date.now() + offset.current - call.answeredAt) / 1000 : call.seconds;
  const title = call.status === 'ringing' ? (call.direction === 'in' ? 'Входящий звонок' : 'Вызов…') : call.status === 'active' ? talk(seconds) : ENDED[call.status];

  return createPortal(
    <div className="fixed inset-0 z-[1150] flex flex-col items-center bg-gradient-to-b from-[#2a1f7a] via-[#3b2fb0] to-[#5b4bff] px-6 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(4rem,env(safe-area-inset-top))] text-white" role="dialog" aria-label="Звонок">
      <p className="text-[15px] font-medium text-white/75">{title}</p>
      <div className="mt-8">
        <Avatar name={call.name} className={`size-28 text-[44px] ${call.status === 'ringing' ? 'animate-pulse' : ''}`} />
      </div>
      <h2 className="mt-6 text-center text-[30px] font-bold leading-tight">{call.name ?? call.formatted}</h2>
      {call.name && <p className="mt-1 text-[17px] text-white/80 num">{call.formatted}</p>}
      {!live && call.status === 'ended' && call.billedMin > 0 && <p className="mt-3 text-[15px] text-white/80">Списано {call.billedMin} мин из пакета</p>}
      <p className="mt-auto mb-8 max-w-xs text-center text-xs text-white/55">Игровой звонок: собеседники видят разговор в приложении, звука нет.</p>
      {live && (
        <div className="flex w-full max-w-xs items-center justify-around">
          {call.status === 'ringing' && call.direction === 'in' && (
            <button type="button" disabled={busy} onClick={() => void act('answer')} className="flex flex-col items-center gap-2 text-sm font-medium">
              <span className="flex size-[72px] items-center justify-center rounded-full bg-[#22c55e] shadow-lg">
                <Phone className="size-8" />
              </span>
              Ответить
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => void act('end')} className="flex flex-col items-center gap-2 text-sm font-medium">
            <span className="flex size-[72px] items-center justify-center rounded-full bg-[#ef4444] shadow-lg">
              <PhoneOff className="size-8" />
            </span>
            {call.status === 'ringing' && call.direction === 'in' ? 'Отклонить' : call.status === 'ringing' ? 'Отменить' : 'Завершить'}
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
