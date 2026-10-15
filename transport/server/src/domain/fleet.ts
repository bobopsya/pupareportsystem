import type { Ctx } from '../context.js';

/** Bot drivers and their cars. Names, plates and colours are made up. */
const FIRST = ['Азат', 'Рустам', 'Дмитрий', 'Алишер', 'Сергей', 'Тимур', 'Фаррух', 'Андрей', 'Бобур', 'Михаил', 'Ильдар', 'Олег', 'Шерзод', 'Николай', 'Арсен', 'Владимир', 'Жамшид', 'Евгений', 'Руслан', 'Павел'];
const COLORS: [string, string][] = [
  ['Белый', '#F4F4F2'],
  ['Белый', '#F4F4F2'],
  ['Чёрный', '#1D1D1F'],
  ['Серый', '#8A8D91'],
  ['Серебристый', '#C4C7CC'],
  ['Синий', '#2A4B8D'],
  ['Жёлтый', '#FFD600'],
];
const PLATE_LETTERS = 'АВЕКМНОРСТУХ';
const REGIONS = ['77', '97', '99', '177', '197', '199', '777', '797', '799', '50', '750'];

const pick = <T>(ctx: Ctx, arr: readonly T[]) => arr[Math.floor(ctx.random() * arr.length) % arr.length];

export interface Driver {
  name: string;
  rating: number;
  trips: number;
  years: number;
}

export interface Car {
  model: string;
  color: string;
  colorHex: string;
  plate: string;
}

export function newDriver(ctx: Ctx): Driver {
  return { name: pick(ctx, FIRST), rating: Math.round((4.75 + ctx.random() * 0.24) * 100) / 100, trips: 300 + Math.floor(ctx.random() * 9000), years: 1 + Math.floor(ctx.random() * 9) };
}

export function newCar(ctx: Ctx, models: string[]): Car {
  const [color, colorHex] = pick(ctx, COLORS);
  const l = () => pick(ctx, PLATE_LETTERS.split(''));
  const digits = String(1 + Math.floor(ctx.random() * 998)).padStart(3, '0');
  return { model: pick(ctx, models), color, colorHex, plate: `${l()} ${digits} ${l()}${l()} ${pick(ctx, REGIONS)}` };
}
