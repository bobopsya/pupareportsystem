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
  vehicle: 'car' | 'bus';
}
export type TariffId = 'econom' | 'comfort' | 'comfort_plus' | 'business' | 'kids' | 'minibus' | 'bus' | 'bus_business';

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

export type Mode = 'taxi' | 'bus' | 'heli' | 'jet';
export type RideStatus =
  | 'awaiting_payment'
  | 'searching' | 'driver_coming' | 'arrived' | 'in_ride'
  | 'waiting_bus' | 'bus_arrived' | 'on_bus'
  | 'preparing' | 'boarding' | 'in_flight'
  | 'completed' | 'cancelled';

export interface BusStop {
  name: string;
  lat: number;
  lon: number;
  at: number;
}

export interface BusOption {
  n: number;
  route: number;
  ref: string;
  kind: string;
  colour: string | null;
  to: string;
  fare: number;
  board: { idx: number; name: string; lat: number; lon: number; walkM: number };
  alight: { idx: number; name: string; lat: number; lon: number; walkM: number };
  stops: number;
  walkS: number;
  waitS: number;
  rideS: number;
  totalS: number;
  distance: number;
  path: LatLon[];
}

export interface BusPlan {
  id: string;
  options: BusOption[];
  timeScale: number;
}

export interface AirPlace {
  code: string;
  title: string;
  subtitle: string;
  lat: number;
  lon: number;
}

export interface AirOption {
  id: string;
  title: string;
  model: string;
  seats: number;
  price: number;
  durationS: number;
  available: boolean;
  reason: string | null;
}

export interface AirQuote {
  id: string;
  kind: 'heli' | 'jet';
  from: AirPlace;
  to: AirPlace;
  distance: number;
  route: LatLon[];
  options: AirOption[];
  timeScale: number;
}

export interface Ride {
  id: string;
  mode: Mode;
  bus: (Omit<BusOption, 'n' | 'path' | 'walkS' | 'waitS' | 'rideS' | 'totalS' | 'distance' | 'fare'> & { dep: number; boardAt: number; alightAt: number; line: { path: LatLon[]; stops: BusStop[] } | null }) | null;
  air: { kind: 'heli' | 'jet'; classId: string; className: string; model: string; seats: number; from: string; to: string } | null;
  confirmation: { url: string | null; expiresAt: number | null } | null;
  boardingUntil: number | null;
  finishAt: number | null;
  busLeavesAt: number | null;
  status: RideStatus;
  tariff: { id: TariffId; title: string; waitPerMin: number; vehicle: 'car' | 'bus' };
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
  mode: Mode;
  colour: string | null;
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
