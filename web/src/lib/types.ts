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

export interface VaultItemData {
  ct: string;
  iv: string;
  folder: string;
  tags: string[];
  clientId: string | null;
}
export type VaultItem = VaultItemData & Meta;

/** Decrypted contents of a vault item. */
export interface VaultSecret {
  site: string;
  url: string;
  login: string;
  password: string;
  notes: string;
}

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
