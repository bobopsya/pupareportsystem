import { useQuery } from '@tanstack/react-query';
import { Bus, Footprints, Moon } from 'lucide-react';
import { api, errorText } from '../lib/api';
import { minutes, rub } from '../lib/format';
import type { BusOption } from '../lib/types';
import { cx, ErrorNote, Loading, Modal } from './ui';

export const BUS_RED = '#d0021b';

/** Line number in the line's colour, like on a bus stop sign. */
export function BusBadge({ num, colour, className }: { num: string; colour: string | null; className?: string }) {
  return (
    <span className={cx('inline-flex h-7 min-w-9 items-center justify-center rounded-lg px-2 text-[15px] font-bold leading-none text-white', className)} style={{ background: colour || BUS_RED }}>
      {num}
    </span>
  );
}

interface Board {
  id: string;
  name: string;
  lines: { route: number; ref: string; colour: string | null; to: string; night: boolean; minutes: number[] }[];
}

/** Departure board of a stop: lines and minutes until the next buses. */
export function StopBoard({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error } = useQuery({ queryKey: ['stop', id], queryFn: () => api<Board>(`/bus/stops/${id}`), enabled: !!id, refetchInterval: 10_000 });
  return (
    <Modal open={!!id} onClose={onClose} title={data?.name ?? 'Остановка'}>
      {error ? (
        <ErrorNote>{errorText(error)}</ErrorNote>
      ) : !data ? (
        <Loading />
      ) : !data.lines.length ? (
        <p className="text-[15px] text-muted">Отсюда автобусы не отправляются — это конечная.</p>
      ) : (
        <div className="-mx-1 flex flex-col">
          {data.lines.map((l) => (
            <div key={l.route} className="flex items-center gap-3 rounded-2xl px-1 py-2.5">
              <BusBadge num={l.ref} colour={l.colour} />
              <span className="min-w-0 flex-1 truncate text-[15px]">→ {l.to}</span>
              <span className="shrink-0 text-right text-[15px] font-semibold num">
                {l.minutes.length ? l.minutes.map((m) => (m <= 0 ? 'сейчас' : `${m} мин`)).join(', ') : <span className="inline-flex items-center gap-1 text-sm font-normal text-muted"><Moon className="size-3.5" />не ходит</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-faint">Маршруты и остановки — OpenStreetMap. Время прибытия — по игровому расписанию.</p>
    </Modal>
  );
}

/** Variants of a direct bus between two points. */
export function BusOptions({ options, selected, onSelect }: { options: BusOption[]; selected: number; onSelect: (n: number) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => (
        <button key={o.n} type="button" onClick={() => onSelect(o.n)} className={cx('rounded-2xl border-2 p-3 text-left transition-colors', selected === o.n ? 'border-ink bg-surface' : 'border-transparent bg-sunken')}>
          <div className="flex items-center gap-2">
            <BusBadge num={o.ref} colour={o.colour} />
            <span className="min-w-0 flex-1 truncate text-sm text-muted">→ {o.to}</span>
            <span className="shrink-0 text-[17px] font-bold num">{minutes(o.totalS)}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            <span className="inline-flex items-center gap-1"><Footprints className="size-3.5" />{Math.round(o.board.walkM / 10) * 10} м до «{o.board.name}»</span>
            <span className="inline-flex items-center gap-1"><Bus className="size-3.5" />через {minutes(o.waitS)}, {o.stops} ост.</span>
            <span className="font-semibold text-fg">{rub(o.fare)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
