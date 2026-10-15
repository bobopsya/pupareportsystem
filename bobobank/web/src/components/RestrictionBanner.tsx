import { ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { money } from '../lib/format';
import type { Restriction } from '../lib/types';
import { Button } from './ui';

/** Shown on top of the home screen while the bank restricts the customer's accounts. */
export function RestrictionBanner({ items }: { items: Restriction[] }) {
  const nav = useNavigate();
  if (!items.length) return null;
  return (
    <div className="mb-4 rounded-2xl bg-bad-soft p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bad text-white"><ShieldAlert className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-bad">{items.length === 1 ? items[0].typeTitle : 'Ограничения по счетам'}</div>
          <ul className="mt-1 space-y-1 text-sm text-fg/80">
            {items.map((r) => (
              <li key={r.id}>
                {r.type === 'arrest' ? `Арест ${money(r.amount)}` : r.typeTitle}: {r.reasonTitle}
                {r.comment ? ` · ${r.comment}` : ''}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="danger" className="mt-3 !bg-surface" onClick={() => nav('/app/chat')}>Написать в поддержку</Button>
        </div>
      </div>
    </div>
  );
}
