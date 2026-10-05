import { z } from 'zod';

const str = (max = 500) => z.string().trim().max(max).default('');
const strList = (max = 200) => z.array(z.string().trim().max(max)).max(100).default([]);
const nullableId = z.string().max(64).nullable().default(null);
const tags = strList(50);

export const clientSchema = z.object({
  fullName: z.string().trim().min(1, 'Укажите ФИО').max(200),
  status: z.enum(['new', 'active', 'paused', 'former']).default('new'),
  responsibleId: nullableId,
  phones: strList(50),
  emails: strList(200),
  messengers: z
    .object({ telegram: str(100), whatsapp: str(100), signal: str(100) })
    .default({ telegram: '', whatsapp: '', signal: '' }),
  address: str(500),
  mapUrl: str(1000),
  // Site coordinates for the overview map; null when unknown.
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
  birthDate: str(20),
  document: z.object({ type: str(100), number: str(100) }).default({ type: '', number: '' }),
  serviceStart: str(20),
  tariff: str(200),
  tags,
  customFields: z.array(z.object({ key: str(100), value: str(2000) })).max(100).default([]),
  infra: z
    .array(
      z.object({
        id: z.string().max(64),
        name: str(200),
        type: str(50),
        localIp: str(100),
        ztIp: str(100),
        mac: str(50),
        note: str(1000),
      }),
    )
    .max(500)
    .default([]),
  avatarFileId: nullableId,
  notes: str(10000),
});

export const clientEventSchema = z.object({
  clientId: z.string().min(1).max(64),
  kind: z.enum(['call', 'meeting', 'visit', 'note']).default('note'),
  date: z.string().max(30),
  text: z.string().trim().min(1, 'Пустая запись').max(10000),
});

export const ztNetworkSchema = z.object({
  networkId: z.string().trim().regex(/^[0-9a-fA-F]{16}$/, 'Network ID — 16 hex-символов').transform((s) => s.toLowerCase()),
  name: z.string().trim().min(1, 'Укажите название').max(200),
  clientId: nullableId,
  subnets: strList(100),
  routes: z.array(z.object({ target: str(100), via: str(100) })).max(100).default([]),
  tags,
  notes: str(10000),
  status: z.enum(['active', 'archived']).default('active'),
  lastSync: z.number().nullable().default(null),
  poolsInfo: strList(100),
});

export const ztMemberSchema = z.object({
  networkRef: z.string().min(1).max(64),
  nodeId: z.string().trim().regex(/^[0-9a-fA-F]{10}$/, 'Node ID — 10 hex-символов').transform((s) => s.toLowerCase()),
  name: str(200),
  ownerType: z.enum(['none', 'employee', 'client', 'device']).default('none'),
  ownerId: nullableId,
  ips: strList(100),
  online: z.boolean().default(false),
  lastSeen: z.number().nullable().default(null),
  authorized: z.boolean().default(true),
  physicalAddress: str(100),
  clientVersion: str(50),
  notes: str(5000),
  source: z.enum(['manual', 'sync']).default('manual'),
});

const holderSchema = z.object({
  type: z.enum(['storage', 'employee', 'client']).default('storage'),
  id: nullableId,
});

export const deviceSchema = z.object({
  kind: z.enum(['esp32', 'uno', 'other']).default('esp32'),
  name: z.string().trim().min(1, 'Укажите название').max(200),
  chip: str(100),
  mac: str(50),
  usbSerial: str(100),
  usbVid: str(10),
  usbPid: str(10),
  flashSize: str(50),
  firmware: z.object({ name: str(200), version: str(100), flashedAt: str(30) }).default({ name: '', version: '', flashedAt: '' }),
  holder: holderSchema.default({ type: 'storage', id: null }),
  transfers: z
    .array(z.object({ ts: z.number(), from: holderSchema, to: holderSchema, by: z.string().max(100) }))
    .default([]),
  ztAddress: str(50),
  tags,
  notes: str(10000),
});

export const taskSchema = z.object({
  text: z.string().trim().min(1, 'Пустая задача').max(2000),
  assigneeId: nullableId,
  due: str(20),
  clientId: nullableId,
  done: z.boolean().default(false),
});

export const serialTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  command: z.string().max(2000),
  lineEnding: z.enum(['none', 'lf', 'cr', 'crlf']).default('lf'),
});

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

export const routeSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название маршрута').max(200),
  clientId: nullableId,
  assigneeId: nullableId,
  date: str(20),
  time: str(10),
  status: z.enum(['planned', 'in_progress', 'done', 'cancelled']).default('planned'),
  description: str(10000),
  tags,
  points: z.array(z.object({ lat, lng, label: str(200), note: str(1000) })).max(100).default([]),
  // Server-computed: straight-line length (sum of haversine between points).
  distanceKm: z.number().nonnegative().default(0),
  // Server-computed via OSRM when the user asks to route by roads.
  road: z
    .object({
      distanceKm: z.number().nonnegative(),
      durationMin: z.number().nonnegative(),
      geometry: z.array(z.tuple([lat, lng])).max(2000),
    })
    .nullable()
    .default(null),
});

/** Encrypted on the client. The server only sees ciphertext plus non-secret organisation fields. */
export const vaultItemSchema = z.object({
  ct: z.string().min(1).max(200_000),
  iv: z.string().min(1).max(100),
  folder: str(100),
  tags,
  clientId: nullableId,
});

export const wifiSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название сети (SSID)').max(200),
  password: str(200),
  security: z.enum(['open', 'wep', 'wpa', 'wpa2', 'wpa3', 'wpa2-ent', 'other']).default('wpa2'),
  band: z.enum(['', '2.4', '5', '6', 'dual']).default(''),
  hidden: z.boolean().default(false),
  status: z.enum(['active', 'inactive', 'unknown']).default('active'),
  clientId: nullableId,
  location: str(500),
  // Geo coordinates for the map view; null when unknown.
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
  tags,
  notes: str(10000),
});

export const employeeProfileSchema = z.object({
  fullName: z.string().trim().min(1, 'Укажите ФИО').max(200),
  position: str(200),
  department: str(200),
  phone: str(50),
  email: str(200),
  telegram: str(100),
  skills: tags,
  status: z.enum(['active', 'vacation', 'fired']).default('active'),
  hiredAt: str(20),
  notes: str(10000),
  avatarFileId: nullableId,
});

export type RecordType = 'client' | 'client_event' | 'zt_network' | 'zt_member' | 'device' | 'task' | 'serial_template' | 'vault_item' | 'wifi' | 'route';

export interface TypeDef {
  schema: z.ZodObject<z.ZodRawShape>;
  /** Fields listable via ?field=value filters. */
  filters: string[];
  /** Human readable title for trash/audit. */
  title: (d: Record<string, unknown>) => string;
  /** Fields only the server may set; client input is ignored and the previous value kept. */
  serverFields?: string[];
}

export const TYPES: Record<RecordType, TypeDef> = {
  client: { schema: clientSchema, filters: ['status', 'responsibleId'], title: (d) => String(d.fullName) },
  client_event: { schema: clientEventSchema, filters: ['clientId'], title: (d) => String(d.text).slice(0, 60) },
  zt_network: {
    schema: ztNetworkSchema, filters: ['clientId', 'networkId', 'status'],
    title: (d) => `${d.name} (${d.networkId})`, serverFields: ['lastSync', 'poolsInfo'],
  },
  zt_member: { schema: ztMemberSchema, filters: ['networkRef', 'ownerType', 'ownerId', 'nodeId'], title: (d) => `${d.name || d.nodeId}` },
  device: {
    schema: deviceSchema, filters: ['kind'],
    title: (d) => String(d.name), serverFields: ['transfers'],
  },
  task: { schema: taskSchema, filters: ['assigneeId', 'clientId'], title: (d) => String(d.text).slice(0, 60) },
  serial_template: { schema: serialTemplateSchema, filters: [], title: (d) => String(d.name) },
  vault_item: { schema: vaultItemSchema, filters: ['clientId', 'folder'], title: (d) => (d.folder ? `папка «${d.folder}»` : 'без папки') },
  wifi: { schema: wifiSchema, filters: ['clientId', 'status'], title: (d) => String(d.name) },
  route: { schema: routeSchema, filters: ['clientId', 'assigneeId', 'status'], title: (d) => String(d.name), serverFields: ['distanceKm', 'road'] },
};

export const TYPE_ROUTES: Record<string, RecordType> = {
  clients: 'client',
  'client-events': 'client_event',
  'zt-networks': 'zt_network',
  'zt-members': 'zt_member',
  devices: 'device',
  tasks: 'task',
  'serial-templates': 'serial_template',
  'vault-items': 'vault_item',
  'wifi-networks': 'wifi',
  routes: 'route',
};
