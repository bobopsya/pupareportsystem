export type LatLon = [number, number];

export interface Place {
  lat: number;
  lon: number;
  title: string;
  subtitle: string;
  outside?: boolean;
}

export interface Me {
  user: { id: string; name: string; role: 'rider' | 'admin'; phone: string; rating: number; linked: boolean; accountLast4: string | null } | null;
  bankUrl: string | null;
  bankEnabled: boolean;
}

export interface Account {
  linked: boolean;
  accountLast4?: string;
  accountName?: string;
  available?: number;
  limit?: number;
  unavailable?: boolean;
}

export interface TariffOption {
  id: TariffId;
  title: string;
  price: number;
  eta: number;
  seats: number;
  cars: string[];
}
export type TariffId = 'econom' | 'comfort' | 'comfort_plus' | 'business' | 'kids';

export interface Estimate {
  id: string;
  distance: number;
  duration: number;
  route: LatLon[];
  approx: boolean;
  surge: number;
  childSeat: number;
  tariffs: TariffOption[];
  timeScale: number;
}

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

export type RideStatus = 'searching' | 'driver_coming' | 'arrived' | 'in_ride' | 'completed' | 'cancelled';

export interface Ride {
  id: string;
  status: RideStatus;
  tariff: { id: TariffId; title: string; waitPerMin: number };
  from: Place;
  to: Place;
  distance: number;
  duration: number;
  route: LatLon[];
  fullRoute: LatLon[];
  surge: number;
  price: number;
  holdAmount: number;
  finalPrice: number | null;
  cancelFee: number;
  childSeat: boolean;
  comment: string;
  driver: Driver | null;
  car: Car | null;
  position: { pos: LatLon; heading: number } | null;
  motion: { path: LatLon[]; startAt: number; endAt: number } | null;
  etaS: number | null;
  waiting: { waitedS: number; freeS: number; autoBoardAt: number } | null;
  freeCancelUntil: number | null;
  cancelFeeNow: number;
  timeScale: number;
  bank: { status: string; pending: boolean; error: string | null };
  rating: number | null;
  tip: number;
  progress: number | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  cancelledAt: number | null;
  cancelledBy: string | null;
  now: number;
}

export interface HistoryItem {
  id: string;
  status: RideStatus;
  tariff: string;
  tariffId: TariffId;
  from: Place;
  to: Place;
  amount: number;
  car: Car | null;
  rating: number | null;
  tip: number;
  distance: number;
  createdAt: number;
  finishedAt: number | null;
  bankStatus: string;
}

export interface SavedPlace {
  id: string;
  kind: 'home' | 'work' | 'fav';
  title: string;
  address: string;
  lat: number;
  lon: number;
}
