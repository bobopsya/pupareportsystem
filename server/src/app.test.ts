import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { IDLE_TIMEOUT_MS } from './auth.js';
import { loadConfig } from './config.js';
import { createCtx, type Ctx } from './context.js';
import { openDb } from './db.js';
import { purgeExpired, TRASH_RETENTION_MS } from './routes/admin.js';
import { createUser } from './routes/employees.js';
import { routeByRoads } from './routes/routing.js';
import { syncNetwork } from './routes/zerotier.js';

const KEY = 'a'.repeat(64);
let dir: string;
let ctx: Ctx;
let app: FastifyInstance;
let clock: number;

const H = { 'x-requested-with': 'zhukonet' };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zn-test-'));
  const cfg = loadConfig({ DATA_DIR: dir, DB_KEY: KEY, FILES_KEY: 'b'.repeat(64), COOKIE_SECURE: '0' });
  clock = Date.UTC(2026, 0, 1);
  ctx = createCtx(openDb(cfg.dataDir, cfg.dbKey), cfg, () => clock);
  app = await buildApp(ctx);
});

afterEach(async () => {
  await app.close();
  ctx.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function login(loginName: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', headers: H, payload: { login: loginName, password } });
  const cookie = res.cookies.find((c) => c.name === 'zn_sid');
  return { res, cookie: cookie ? `zn_sid=${cookie.value}` : '' };
}

/** Creates a user, logs in and replaces the temporary password. Returns a cookie header. */
async function session(loginName = 'admin'): Promise<string> {
  const u = await createUser(ctx, loginName, { fullName: 'Админ Тестов' }, null);
  const { cookie } = await login(loginName, u.tempPassword);
  const r = await app.inject({
    method: 'POST', url: '/api/auth/change-password', headers: { ...H, cookie },
    payload: { currentPassword: u.tempPassword, newPassword: 'Correct-Horse-42' },
  });
  expect(r.statusCode).toBe(200);
  return cookie;
}

describe('auth', () => {
  it('rejects unauthenticated API calls', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/clients' });
    expect(r.statusCode).toBe(401);
  });

  it('requires the CSRF header on writes', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'x', password: 'y' } });
    expect(r.statusCode).toBe(403);
  });

  it('forces a password change before anything else', async () => {
    const u = await createUser(ctx, 'newbie', { fullName: 'Новичок' }, null);
    const { cookie, res } = await login('newbie', u.tempPassword);
    expect(res.json().user.mustChange).toBe(true);
    const blocked = await app.inject({ method: 'GET', url: '/api/clients', headers: { cookie } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().mustChange).toBe(true);
  });

  it('locks an IP after 5 failed logins for 15 minutes', async () => {
    await session('admin');
    for (let i = 0; i < 5; i++) expect((await login('admin', 'wrong')).res.statusCode).toBe(401);
    expect((await login('admin', 'Correct-Horse-42')).res.statusCode).toBe(429);
    clock += 15 * 60 * 1000 + 1;
    expect((await login('admin', 'Correct-Horse-42')).res.statusCode).toBe(200);
    const fails = ctx.db.prepare("SELECT COUNT(*) c FROM audit WHERE action = 'login_fail'").get() as { c: number };
    expect(fails.c).toBe(6);
  });

  it('expires sessions after 30 minutes idle', async () => {
    const cookie = await session();
    clock += IDLE_TIMEOUT_MS - 1000;
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);
    clock += IDLE_TIMEOUT_MS + 1;
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('behind a proxy, takes the client IP from the last X-Forwarded-For hop only', async () => {
    const proxied = await buildApp({ ...ctx, cfg: { ...ctx.cfg, trustProxy: true } });
    await proxied.inject({
      method: 'POST', url: '/api/auth/login', payload: { login: 'nobody', password: 'x' },
      headers: { ...H, 'x-forwarded-for': '6.6.6.6, 203.0.113.7' },
    });
    await proxied.close();
    const row = ctx.db.prepare("SELECT ip FROM audit WHERE action = 'login_fail'").get() as { ip: string };
    expect(row.ip).toBe('203.0.113.7');
  });

  it('blocks fired employees', async () => {
    const cookie = await session('admin');
    const created = await app.inject({ method: 'POST', url: '/api/employees', headers: { ...H, cookie }, payload: { login: 'ivan', profile: { fullName: 'Иван' } } });
    const { employee, tempPassword } = created.json();
    await app.inject({ method: 'PUT', url: `/api/employees/${employee.id}`, headers: { ...H, cookie }, payload: { fullName: 'Иван', status: 'fired' } });
    expect((await login('ivan', tempPassword)).res.statusCode).toBe(401);
  });
});

describe('records', () => {
  it('CRUD + trash + restore for clients', async () => {
    const cookie = await session();
    const h = { ...H, cookie };
    const c = await app.inject({ method: 'POST', url: '/api/clients', headers: h, payload: { fullName: 'Пётр Петров', phones: ['+49 123'], status: 'active' } });
    expect(c.statusCode).toBe(200);
    const id = c.json().id;
    const bad = await app.inject({ method: 'POST', url: '/api/clients', headers: h, payload: { fullName: '' } });
    expect(bad.statusCode).toBe(400);

    const up = await app.inject({ method: 'PUT', url: `/api/clients/${id}`, headers: h, payload: { ...c.json(), tariff: 'Премиум', lat: 55.75, lng: 37.62 } });
    expect(up.json()).toMatchObject({ tariff: 'Премиум', lat: 55.75, lng: 37.62 });
    const badCoords = await app.inject({ method: 'PUT', url: `/api/clients/${id}`, headers: h, payload: { ...c.json(), lat: 123 } });
    expect(badCoords.statusCode).toBe(400);

    expect((await app.inject({ method: 'GET', url: '/api/clients?q=Пётр', headers: h })).json()).toHaveLength(1);
    await app.inject({ method: 'DELETE', url: `/api/clients/${id}`, headers: h });
    expect((await app.inject({ method: 'GET', url: '/api/clients', headers: h })).json()).toHaveLength(0);

    const trash = (await app.inject({ method: 'GET', url: '/api/trash', headers: h })).json();
    expect(trash[0]).toMatchObject({ kind: 'record', id, title: 'Пётр Петров' });
    await app.inject({ method: 'POST', url: '/api/trash/restore', headers: h, payload: { kind: 'record', id } });
    expect((await app.inject({ method: 'GET', url: '/api/clients', headers: h })).json()).toHaveLength(1);
  });

  it('CRUD + filters for Wi-Fi networks', async () => {
    const cookie = await session();
    const h = { ...H, cookie };
    const created = await app.inject({ method: 'POST', url: '/api/wifi-networks', headers: h, payload: { name: 'Office-5G', password: 'secret123', security: 'wpa3', status: 'active', lat: 52.52, lng: 13.405 } });
    expect(created.statusCode).toBe(200);
    const net = created.json();
    expect(net).toMatchObject({ name: 'Office-5G', security: 'wpa3', lat: 52.52, lng: 13.405 });

    await app.inject({ method: 'POST', url: '/api/wifi-networks', headers: h, payload: { name: 'Guest', status: 'inactive' } });
    expect((await app.inject({ method: 'GET', url: '/api/wifi-networks?status=active', headers: h })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/wifi-networks', headers: h })).json()).toHaveLength(2);

    const bad = await app.inject({ method: 'POST', url: '/api/wifi-networks', headers: h, payload: { name: '', lat: 999 } });
    expect(bad.statusCode).toBe(400);

    const dash = (await app.inject({ method: 'GET', url: '/api/dashboard', headers: h })).json();
    expect(dash.counts.wifi).toBe(2);
  });

  it('computes route distance server-side and routes by roads via OSRM', async () => {
    const cookie = await session();
    const h = { ...H, cookie };
    // ~111 km between (0,0) and (1,0); two legs.
    const created = await app.inject({
      method: 'POST', url: '/api/routes', headers: h,
      payload: { name: 'Выезд', points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }, { lat: 1, lng: 1 }], distanceKm: 9999 },
    });
    expect(created.statusCode).toBe(200);
    const route = created.json();
    expect(route.distanceKm).toBeGreaterThan(200);
    expect(route.distanceKm).toBeLessThan(260);
    expect(route.road).toBeNull();

    const user = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: h })).json().user;
    const fakeOsrm = async (url: string) => {
      expect(url).toContain('/route/v1/driving/0,0;0,1;1,1');
      return new Response(JSON.stringify({ code: 'Ok', routes: [{ distance: 250000, duration: 9000, geometry: { coordinates: [[0, 0], [0, 1], [1, 1]] } }] }), { status: 200 });
    };
    const road = await routeByRoads(ctx, route.id, user.id, fakeOsrm);
    expect(road).toMatchObject({ distanceKm: 250, durationMin: 150 });
    expect(road.geometry[0]).toEqual([0, 0]);

    const after = (await app.inject({ method: 'GET', url: `/api/routes/${route.id}`, headers: h })).json();
    expect(after.road.distanceKm).toBe(250);
    // Editing points drops the stale road geometry.
    const edited = await app.inject({ method: 'PUT', url: `/api/routes/${route.id}`, headers: h, payload: { ...after, points: [{ lat: 0, lng: 0 }, { lat: 2, lng: 0 }] } });
    expect(edited.json().road).toBeNull();
    expect(edited.json().distanceKm).toBeGreaterThan(200);
  });

  it('records device transfers server-side', async () => {
    const cookie = await session();
    const h = { ...H, cookie };
    const d = (await app.inject({ method: 'POST', url: '/api/devices', headers: h, payload: { name: 'ESP-01', transfers: [{ forged: true }] } })).json();
    expect(d.transfers).toEqual([]);
    const moved = (await app.inject({ method: 'PUT', url: `/api/devices/${d.id}`, headers: h, payload: { ...d, holder: { type: 'client', id: 'c1' } } })).json();
    expect(moved.transfers).toHaveLength(1);
    expect(moved.transfers[0]).toMatchObject({ from: { type: 'storage' }, to: { type: 'client', id: 'c1' }, by: 'admin' });
  });

  it('purges trash older than 30 days', async () => {
    const cookie = await session();
    const h = { ...H, cookie };
    const id = (await app.inject({ method: 'POST', url: '/api/tasks', headers: h, payload: { text: 'Тест' } })).json().id;
    await app.inject({ method: 'DELETE', url: `/api/tasks/${id}`, headers: h });
    expect(purgeExpired(ctx)).toBe(0);
    clock += TRASH_RETENTION_MS + 1;
    expect(purgeExpired(ctx)).toBe(1);
  });
});

describe('files', () => {
  it('strips EXIF from photos and stores them encrypted', async () => {
    const cookie = await session();
    const jpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#f00' } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'SECRET-GPS-MARKER' } } })
      .toBuffer();
    expect(jpeg.includes(Buffer.from('SECRET-GPS-MARKER'))).toBe(true);

    const boundary = '----zn';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="ownerType"\r\n\r\nclient\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="ownerId"\r\n\r\nc1\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nphoto\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      jpeg,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const up = await app.inject({ method: 'POST', url: '/api/files', headers: { ...H, cookie, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(up.statusCode).toBe(200);
    const file = up.json();
    expect(file.hasThumb).toBe(true);

    const onDisk = fs.readFileSync(path.join(dir, 'files', `${file.id}.bin`));
    expect(onDisk.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);

    const got = await app.inject({ method: 'GET', url: `/api/files/${file.id}`, headers: { cookie } });
    expect(got.rawPayload.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(true);
    expect(got.rawPayload.includes(Buffer.from('SECRET-GPS-MARKER'))).toBe(false);
  });
});

describe('zerotier sync', () => {
  it('merges Central members while keeping manual fields', async () => {
    const cookie = await session();
    const h = { ...H, cookie };
    const user = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: h })).json().user;
    await app.inject({ method: 'PUT', url: '/api/settings/zt-token', headers: h, payload: { token: 'test-token-123456' } });
    const net = (await app.inject({ method: 'POST', url: '/api/zt-networks', headers: h, payload: { networkId: '8056C2E21C000001', name: 'Офис' } })).json();
    expect(net.networkId).toBe('8056c2e21c000001');
    await app.inject({ method: 'POST', url: '/api/zt-members', headers: h, payload: { networkRef: net.id, nodeId: 'abcdef0123', name: 'Мой ноут', ownerType: 'employee', ownerId: user.id } });

    const fakeFetch = async (url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe('token test-token-123456');
      const body = url.endsWith('/member')
        ? [
            { nodeId: 'abcdef0123', name: 'central-name', lastOnline: clock - 1000, config: { authorized: true, ipAssignments: ['10.0.0.2'] } },
            { nodeId: '1111111111', name: 'esp32', lastOnline: clock - 60 * 60 * 1000, config: { authorized: true, ipAssignments: ['10.0.0.3'] } },
          ]
        : { config: { routes: [{ target: '10.0.0.0/24', via: null }] } };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const result = await syncNetwork(ctx, net.id, user.id, fakeFetch);
    expect(result).toEqual({ added: 1, updated: 1, total: 2 });

    const members = (await app.inject({ method: 'GET', url: `/api/zt-members?networkRef=${net.id}`, headers: h })).json();
    const mine = members.find((m: { nodeId: string }) => m.nodeId === 'abcdef0123');
    expect(mine).toMatchObject({ name: 'Мой ноут', ownerType: 'employee', online: true, ips: ['10.0.0.2'] });
    expect(members.find((m: { nodeId: string }) => m.nodeId === '1111111111').online).toBe(false);

    const settings = (await app.inject({ method: 'GET', url: '/api/settings', headers: h })).json();
    expect(settings.ztTokenSet).toBe(true);
    expect(JSON.stringify(settings)).not.toContain('test-token');
    const netAfter = (await app.inject({ method: 'GET', url: `/api/zt-networks/${net.id}`, headers: h })).json();
    expect(netAfter.subnets).toContain('10.0.0.0/24');
    expect(netAfter.lastSync).toBe(clock);
  });
});

describe('vault', () => {
  it('initialises once and logs reveal events', async () => {
    const cookie = await session();
    const h = { ...H, cookie };
    const meta = {
      version: 1, kdf: 'PBKDF2-SHA256', iterations: 600000,
      masterSalt: 'c2FsdA==', masterWrapped: { iv: 'aXY=', ct: 'Y3Q=' },
      recoverySalt: 'c2FsdA==', recoveryWrapped: { iv: 'aXY=', ct: 'Y3Q=' },
    };
    expect((await app.inject({ method: 'POST', url: '/api/vault/init', headers: h, payload: meta })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/vault/init', headers: h, payload: meta })).statusCode).toBe(409);
    const item = (await app.inject({ method: 'POST', url: '/api/vault-items', headers: h, payload: { ct: 'abc', iv: 'def', folder: 'Клиенты' } })).json();
    await app.inject({ method: 'POST', url: '/api/vault/events', headers: h, payload: { action: 'reveal', itemId: item.id } });
    const log = (await app.inject({ method: 'GET', url: '/api/audit?action=reveal', headers: h })).json();
    expect(log).toHaveLength(1);
    expect(log[0].entity_id).toBe(item.id);
  });
});

describe('static frontend', () => {
  it('serves the SPA for app routes but JSON 404 for unknown API routes', async () => {
    const web = path.join(dir, 'web');
    fs.mkdirSync(path.join(web, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><div id=root></div>');
    fs.writeFileSync(path.join(web, 'assets', 'a.js'), 'console.log(1)');
    const withWeb = await buildApp({ ...ctx, cfg: { ...ctx.cfg, webDist: web } });
    const cookie = await session();
    const page = await withWeb.inject({ method: 'GET', url: '/clients/123' });
    expect(page.headers['content-type']).toContain('text/html');
    const asset = await withWeb.inject({ method: 'GET', url: '/assets/a.js' });
    expect(asset.headers['cache-control']).toContain('immutable');
    const api404 = await withWeb.inject({ method: 'GET', url: '/api/nope', headers: { cookie } });
    expect(api404.statusCode).toBe(404);
    expect(api404.json().error).toBeDefined();
    const traversal = await withWeb.inject({ method: 'GET', url: '/..%2f..%2fetc%2fpasswd' });
    expect(traversal.headers['content-type']).toContain('text/html');
    await withWeb.close();
  });
});

describe('backup', () => {
  it('produces a zip containing the encrypted database', async () => {
    const cookie = await session();
    const r = await app.inject({ method: 'GET', url: '/api/backup', headers: { cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/zip');
    expect(r.rawPayload.subarray(0, 2).toString()).toBe('PK');
    // An unencrypted SQLite file would start with this header.
    expect(r.rawPayload.includes(Buffer.from('SQLite format 3'))).toBe(false);
  });
});

describe('map tiles proxy', () => {
  it('fetches tiles server-side, caches them and requires a session', async () => {
    const cookie = await session();
    const urls: string[] = [];
    ctx.http = async (url) => {
      urls.push(url);
      return new Response(Buffer.from('PNGDATA'), { headers: { 'content-type': 'image/png' } });
    };
    expect((await app.inject({ method: 'GET', url: '/api/tiles/10/619/320.png' })).statusCode).toBe(401);
    const a = await app.inject({ method: 'GET', url: '/api/tiles/10/619/320.png', headers: { cookie } });
    expect(a.statusCode).toBe(200);
    expect(a.headers['content-type']).toBe('image/png');
    expect(a.body).toBe('PNGDATA');
    await app.inject({ method: 'GET', url: '/api/tiles/10/619/320.png', headers: { cookie } });
    expect(urls).toEqual(['https://tile.openstreetmap.org/10/619/320.png']);
    expect((await app.inject({ method: 'GET', url: '/api/tiles/3/9/1.png', headers: { cookie } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/tiles/x/1/1.png', headers: { cookie } })).statusCode).toBe(400);
    ctx.http = async () => new Response('down', { status: 503 });
    expect((await app.inject({ method: 'GET', url: '/api/tiles/11/1/1.png', headers: { cookie } })).statusCode).toBe(502);
  });
});
