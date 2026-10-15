import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Star, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Initials } from './CategoryIcon';
import { cx, useToast } from './ui';

export interface Favorite {
  id: string;
  title: string;
  type: 'phone' | 'card' | 'account';
  value: string;
  bik: string | null;
  amount: number | null;
  subtitle: string;
}

export interface RecentRecipient {
  name: string;
  subtitle: string;
  type: 'phone' | 'card' | 'account';
  phone: string | null;
  cardId: string | null;
  number: string | null;
  bik: string | null;
}

/** Where a saved or recent recipient opens: the transfer screen with everything filled in. */
export function transferLink(r: { type: string; phone?: string | null; cardId?: string | null; number?: string | null; bik?: string | null; value?: string; amount?: number | null; name?: string }) {
  const q = new URLSearchParams();
  if (r.amount) q.set('amount', String(r.amount / 100));
  if (r.type === 'phone') {
    q.set('phone', r.phone ?? r.value ?? '');
    return `/app/transfer/phone?${q}`;
  }
  if (r.type === 'card') {
    q.set('card', r.cardId ?? r.value ?? '');
    if (r.name) q.set('name', r.name);
    return `/app/transfer/card?${q}`;
  }
  q.set('number', r.number ?? r.value ?? '');
  if (r.bik) q.set('bik', r.bik);
  if (r.name) q.set('name', r.name);
  return `/app/transfer/account?${q}`;
}

export const useFavorites = () => useQuery({ queryKey: ['favorites'], queryFn: () => api<{ items: Favorite[] }>('/favorites').then((r) => r.items) });

/** Row of saved recipients (and recent ones when there are no favourites yet), like quick transfers in banking apps. */
export function Favorites({ withRecent = true }: { withRecent?: boolean }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: favs } = useFavorites();
  const { data: recent } = useQuery({ queryKey: ['recent'], queryFn: () => api<{ items: RecentRecipient[] }>('/transfers/recent').then((r) => r.items), enabled: withRecent });
  const [edit, setEdit] = useState(false);
  if (!favs) return null;
  const favKeys = new Set(favs.map((f) => `${f.type}:${f.value}`));
  const extra = (recent ?? []).filter((r) => !favKeys.has(`${r.type}:${r.phone ?? r.cardId ?? r.number}`)).slice(0, Math.max(0, 8 - favs.length));
  if (!favs.length && !extra.length) return null;
  const remove = async (id: string) => {
    await api(`/favorites/${id}`, { method: 'DELETE' });
    await qc.invalidateQueries({ queryKey: ['favorites'] });
    toast('Удалено из избранного');
  };
  return (
    <section className="rounded-2xl bg-surface py-4">
      <div className="flex items-center justify-between px-4 pb-3">
        <span className="text-[15px] font-medium">{favs.length ? 'Избранное' : 'Недавние'}</span>
        {favs.length > 0 && <button type="button" onClick={() => setEdit(!edit)} className="text-sm font-medium text-brand">{edit ? 'Готово' : 'Изменить'}</button>}
      </div>
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-3">
        {favs.map((f) => (
          <div key={f.id} className="relative w-[72px] shrink-0">
            <button type="button" disabled={edit} onClick={() => nav(transferLink({ ...f, name: f.title }))} className="flex w-full flex-col items-center gap-1.5 text-center">
              <span className="relative">
                <Initials name={f.title} className="size-12 text-base" />
                <Star className="absolute -right-0.5 -bottom-0.5 size-4 rounded-full bg-surface p-[1px] text-[#FFB800]" fill="#FFB800" />
              </span>
              <span className="w-full truncate text-[12px]">{f.title}</span>
            </button>
            {edit && (
              <button type="button" aria-label={`Удалить ${f.title}`} onClick={() => void remove(f.id)} className="absolute right-1 top-0 flex size-5 items-center justify-center rounded-full bg-bad text-white">
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}
        {!edit && extra.map((r) => (
          <button key={`${r.type}${r.phone ?? r.cardId ?? r.number}`} type="button" onClick={() => nav(transferLink(r))} className={cx('flex w-[72px] shrink-0 flex-col items-center gap-1.5 text-center')}>
            <Initials name={r.name} className="size-12 text-base" />
            <span className="w-full truncate text-[12px]">{r.name}</span>
          </button>
        ))}
        {!edit && (
          <button type="button" onClick={() => nav('/app/transfer/phone')} className="flex w-[72px] shrink-0 flex-col items-center gap-1.5 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-sunken text-muted"><Plus className="size-5" /></span>
            <span className="text-[12px] text-muted">Новый</span>
          </button>
        )}
      </div>
    </section>
  );
}
