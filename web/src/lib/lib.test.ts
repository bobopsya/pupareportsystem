import { describe, expect, it } from 'vitest';
import { dedupeKey, hostOf, parseCredentialsJson } from './jsonImport';
import { DEFAULT_GEN, generatePassword, strength } from './password';
import { pathLengthKm, routeToGpx } from './geo';
import { guessBoard, LineSplitter, parsePlotLine } from './serial';
import { createVault, decryptSecret, encryptSecret, rekey, unlockWithMaster, unlockWithRecovery } from './vaultCrypto';

describe('parseCredentialsJson', () => {
  it('parses a flat array with synonyms', () => {
    const r = parseCredentialsJson(JSON.stringify([
      { site: 'github.com', login: 'ivan', password: 'p1' },
      { url: 'https://mail.example.org/login', email: 'a@b.c', pass: 'p2' },
      { Domain: 'vk.com', Username: 'petr', PWD: 'p3', comment: 'старый' },
    ]));
    expect(r.error).toBeNull();
    expect(r.entries.map((e) => [e.site, e.login, e.password])).toEqual([
      ['github.com', 'ivan', 'p1'],
      ['mail.example.org', 'a@b.c', 'p2'],
      ['vk.com', 'petr', 'p3'],
    ]);
    expect(r.entries[2]!.notes).toBe('старый');
    expect(r.entries[1]!.url).toBe('https://mail.example.org/login');
  });

  it('finds credentials at any depth and in keyed maps', () => {
    const r = parseCredentialsJson(JSON.stringify({
      company: { accounts: { 'router.local': { user: 'admin', password: 'r00t' } } },
      list: [{ data: { name: 'Hosting', creds: { username: 'u', password: 'x' } } }],
    }));
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]).toMatchObject({ site: 'router.local', login: 'admin', password: 'r00t' });
    expect(r.entries[1]).toMatchObject({ site: 'creds', login: 'u' });
  });

  it('parses Bitwarden exports', () => {
    const r = parseCredentialsJson(JSON.stringify({
      encrypted: false,
      items: [{ type: 1, name: 'Google', notes: null, login: { username: 'me@gmail.com', password: 'g', uris: [{ uri: 'https://accounts.google.com' }] } }],
    }));
    expect(r.entries[0]).toMatchObject({ site: 'Google', login: 'me@gmail.com', password: 'g', url: 'https://accounts.google.com' });
  });

  it('keeps email in notes when login differs', () => {
    const r = parseCredentialsJson('{"site":"x.com","login":"nick","email":"n@x.com","password":"1"}');
    expect(r.entries[0]!.notes).toBe('Email: n@x.com');
  });

  it('does not name entries after the array that holds them', () => {
    const r = parseCredentialsJson('{"servers":[{"url":"https://router.local","username":"admin","pass":"x"}]}');
    expect(r.entries[0]!.site).toBe('router.local');
  });

  it('supports JSON lines and reports garbage', () => {
    expect(parseCredentialsJson('{"site":"a.com","password":"1"}\n{"site":"b.com","password":"2"}').entries).toHaveLength(2);
    expect(parseCredentialsJson('not json').error).toMatch(/Это не JSON/);
    expect(parseCredentialsJson('{"a":1}').error).toMatch(/не найдено/);
  });

  it('imports token fields and guesses Discord/Steam categories', () => {
    const r = parseCredentialsJson(JSON.stringify([
      { site: 'Discord', login: 'me@mail.com', token: 'abc.def.ghi' },
      { url: 'https://store.steampowered.com', username: 'gamer', password: 'steampass' },
      { service: 'github.com', user: 'dev', password: 'x' },
    ]));
    expect(r.entries[0]).toMatchObject({ category: 'discord', password: 'abc.def.ghi', login: 'me@mail.com' });
    expect(r.entries[1]!.category).toBe('steam');
    expect(r.entries[2]!.category).toBe('site');
  });

  it('builds duplicate keys from host + login', () => {
    expect(hostOf('https://www.GitHub.com/login')).toBe('github.com');
    expect(dedupeKey({ site: 'github.com', url: '', login: 'Ivan ' })).toBe(dedupeKey({ site: '', url: 'https://www.github.com/x', login: 'ivan' }));
  });
});

describe('vault crypto', () => {
  const ITER = 1000; // fast for tests

  it('round-trips items and unlocks with master password or recovery code', async () => {
    const { meta, recoveryCode, dek } = await createVault('master-pass', ITER);
    const sealed = await encryptSecret(dek, { site: 's', url: '', login: 'l', password: 'секрет', notes: '', category: 'discord', fields: [{ label: 'Токен', value: 'tok-123' }] });
    expect(sealed.ct).not.toContain('секрет');
    expect(sealed.ct).not.toContain('tok-123');

    const a = await unlockWithMaster(meta, 'master-pass');
    const openedA = await decryptSecret(a.dek, sealed);
    expect(openedA.password).toBe('секрет');
    expect(openedA.category).toBe('discord');
    expect(openedA.fields[0]).toEqual({ label: 'Токен', value: 'tok-123' });
    const b = await unlockWithRecovery(meta, recoveryCode.toLowerCase().replace(/-/g, ' '));
    expect((await decryptSecret(b.dek, sealed)).password).toBe('секрет');
    await expect(unlockWithMaster(meta, 'wrong')).rejects.toThrow();
  });

  it('rekey keeps existing items readable', async () => {
    const { dek, dekRaw } = await createVault('old', ITER);
    const sealed = await encryptSecret(dek, { site: 's', url: '', login: '', password: 'p', notes: '', category: 'site', fields: [] });
    const { meta } = await rekey(dekRaw, 'new', ITER);
    const { dek: dek2 } = await unlockWithMaster(meta, 'new');
    expect((await decryptSecret(dek2, sealed)).password).toBe('p');
    await expect(unlockWithMaster(meta, 'old')).rejects.toThrow();
  });
});

describe('password tools', () => {
  it('generates passwords with requested character classes', () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword({ ...DEFAULT_GEN, length: 16 });
      expect(p).toHaveLength(16);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).not.toMatch(/[Il1O0o]/);
    }
    expect(generatePassword({ ...DEFAULT_GEN, lower: false, upper: false, symbols: false, length: 8 })).toMatch(/^[2-9]{8}$/);
  });

  it('scores strength', () => {
    expect(strength('123456')).toBe(0);
    expect(strength('qT7#vL9!mZ2$pR4&')).toBe(4);
  });
});

describe('routes geo', () => {
  it('measures path length in km', () => {
    // ~111 km per degree of latitude.
    const km = pathLengthKm([{ lat: 0, lng: 0 }, { lat: 1, lng: 0 }]);
    expect(km).toBeGreaterThan(110);
    expect(km).toBeLessThan(112);
    expect(pathLengthKm([{ lat: 5, lng: 5 }])).toBe(0);
  });

  it('builds GPX with waypoints and a track', () => {
    const gpx = routeToGpx('Выезд <1>', [
      { lat: 55.75, lng: 37.62, label: 'Старт', note: 'офис' },
      { lat: 55.76, lng: 37.63, label: '', note: '' },
    ]);
    expect(gpx).toContain('<gpx');
    expect(gpx).toContain('lat="55.75" lon="37.62"');
    expect(gpx).toContain('<name>Старт</name>');
    expect(gpx).toContain('Выезд &lt;1&gt;'); // escaped
    expect((gpx.match(/<trkpt /g) ?? []).length).toBe(2);
  });
});

describe('serial helpers', () => {
  it('detects boards by VID/PID', () => {
    expect(guessBoard(0x2341, 0x0043).kind).toBe('uno');
    expect(guessBoard(0x10c4, 0xea60).kind).toBe('esp32');
    expect(guessBoard(0x303a, 0x1001).kind).toBe('esp32');
    expect(guessBoard(undefined, undefined).kind).toBe('other');
  });

  it('parses plotter lines', () => {
    expect(parsePlotLine('temp:21.5 hum:40')).toEqual({ temp: 21.5, hum: 40 });
    expect(parsePlotLine('t=1, h=-2.5')).toEqual({ t: 1, h: -2.5 });
    expect(parsePlotLine('1.5 2 3')).toEqual({ value1: 1.5, value2: 2, value3: 3 });
    expect(parsePlotLine('Booting ESP32...')).toBeNull();
  });

  it('splits stream chunks into lines', () => {
    const s = new LineSplitter();
    expect(s.push('hel')).toEqual([]);
    expect(s.push('lo\r\nwor')).toEqual(['hello']);
    expect(s.push('ld\n')).toEqual(['world']);
    expect(s.flush()).toBeNull();
  });
});
