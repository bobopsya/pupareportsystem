export interface Meta {
  id: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SessionUser {
  id: string;
  login: string;
  fullName: string;
  mustChange: boolean;
}

export type EmployeeStatus = 'active' | 'vacation' | 'fired';

export interface EmployeeProfile {
  fullName: string;
  position: string;
  department: string;
  phone: string;
  email: string;
  telegram: string;
  skills: string[];
  status: EmployeeStatus;
  hiredAt: string;
  notes: string;
  avatarFileId: string | null;
}

export interface Employee extends EmployeeProfile {
  id: string;
  login: string;
  mustChange: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ClientStatus = 'new' | 'active' | 'paused' | 'former';

export interface InfraRow {
  id: string;
  name: string;
  type: string;
  localIp: string;
  ztIp: string;
  mac: string;
  note: string;
}

export interface ClientData {
  fullName: string;
  status: ClientStatus;
  responsibleId: string | null;
  phones: string[];
  emails: string[];
  messengers: { telegram: string; whatsapp: string; signal: string };
  address: string;
  mapUrl: string;
  lat: number | null;
  lng: number | null;
  birthDate: string;
  document: { type: string; number: string };
  serviceStart: string;
  tariff: string;
  tags: string[];
  customFields: { key: string; value: string }[];
  infra: InfraRow[];
  avatarFileId: string | null;
  notes: string;
}
export type Client = ClientData & Meta;

export type ClientEventKind = 'call' | 'meeting' | 'visit' | 'note';
export interface ClientEventData {
  clientId: string;
  kind: ClientEventKind;
  date: string;
  text: string;
}
export type ClientEvent = ClientEventData & Meta;

export interface ZtNetworkData {
  networkId: string;
  name: string;
  clientId: string | null;
  subnets: string[];
  routes: { target: string; via: string }[];
  tags: string[];
  notes: string;
  status: 'active' | 'archived';
}
export type ZtNetwork = ZtNetworkData & Meta & { lastSync: number | null; poolsInfo: string[] };

export type OwnerType = 'none' | 'employee' | 'client' | 'device';
export interface ZtMemberData {
  networkRef: string;
  nodeId: string;
  name: string;
  ownerType: OwnerType;
  ownerId: string | null;
  ips: string[];
  online: boolean;
  lastSeen: number | null;
  authorized: boolean;
  physicalAddress: string;
  clientVersion: string;
  notes: string;
  source: 'manual' | 'sync';
}
export type ZtMember = ZtMemberData & Meta;

export type HolderType = 'storage' | 'employee' | 'client';
export interface Holder {
  type: HolderType;
  id: string | null;
}
export interface DeviceData {
  kind: 'esp32' | 'uno' | 'other';
  name: string;
  chip: string;
  mac: string;
  usbSerial: string;
  usbVid: string;
  usbPid: string;
  flashSize: string;
  firmware: { name: string; version: string; flashedAt: string };
  holder: Holder;
  ztAddress: string;
  tags: string[];
  notes: string;
}
export type Device = DeviceData & Meta & { transfers: { ts: number; from: Holder; to: Holder; by: string }[] };

export interface TaskData {
  text: string;
  assigneeId: string | null;
  due: string;
  clientId: string | null;
  done: boolean;
}
export type Task = TaskData & Meta;

export interface SerialTemplateData {
  name: string;
  command: string;
  lineEnding: 'none' | 'lf' | 'cr' | 'crlf';
}
export type SerialTemplate = SerialTemplateData & Meta;

export type RouteStatus = 'planned' | 'in_progress' | 'done' | 'cancelled';
export interface RoutePoint {
  lat: number;
  lng: number;
  label: string;
  note: string;
}
export interface RouteData {
  name: string;
  clientId: string | null;
  assigneeId: string | null;
  date: string;
  time: string;
  status: RouteStatus;
  description: string;
  tags: string[];
  points: RoutePoint[];
}
export type Route = RouteData &
  Meta & {
    distanceKm: number;
    road: { distanceKm: number; durationMin: number; geometry: [number, number][] } | null;
  };

export interface VaultItemData {
  ct: string;
  iv: string;
  folder: string;
  tags: string[];
  clientId: string | null;
}
export type VaultItem = VaultItemData & Meta;

export type VaultCategory = 'site' | 'discord' | 'steam' | 'game' | 'email' | 'social' | 'other';

/** Decrypted contents of a vault item. Extra fields (Discord/Steam tokens, 2FA…) are encrypted too. */
export interface VaultSecret {
  site: string;
  url: string;
  login: string;
  password: string;
  notes: string;
  category: VaultCategory;
  fields: { label: string; value: string }[];
}

export type WifiSecurity = 'open' | 'wep' | 'wpa' | 'wpa2' | 'wpa3' | 'wpa2-ent' | 'other';
export type WifiStatus = 'active' | 'inactive' | 'unknown';

export interface WifiData {
  name: string;
  password: string;
  security: WifiSecurity;
  band: '' | '2.4' | '5' | '6' | 'dual';
  hidden: boolean;
  status: WifiStatus;
  clientId: string | null;
  location: string;
  lat: number | null;
  lng: number | null;
  tags: string[];
  notes: string;
}
export type Wifi = WifiData & Meta;

export interface AuditEntry {
  id: number;
  ts: number;
  user_id: string | null;
  user_login: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  summary: string | null;
  ip: string | null;
}
