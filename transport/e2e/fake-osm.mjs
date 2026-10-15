// Stand-in for OSRM and Nominatim in CI: straight routes along a few points, two Moscow addresses.
//   node transport/e2e/fake-osm.mjs 8099   →   OSRM_URL=NOMINATIM_URL=http://127.0.0.1:8099
import http from 'node:http';

const port = Number(process.argv[2] ?? 8099);
const PLACES = [
  { lat: '55.757500', lon: '37.615600', name: '', display_name: 'Тверская улица, 1, Москва', category: 'building', address: { road: 'Тверская улица', house_number: '1', suburb: 'Тверской район', city: 'Москва' } },
  { lat: '55.749400', lon: '37.591700', name: '', display_name: 'улица Арбат, 10, Москва', category: 'building', address: { road: 'улица Арбат', house_number: '10', suburb: 'район Арбат', city: 'Москва' } },
];

function encode(path) {
  let out = '';
  let pl = 0;
  let pn = 0;
  const enc = (v) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    while (x >= 0x20) {
      out += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    out += String.fromCharCode(x + 63);
  };
  for (const [lat, lon] of path) {
    const a = Math.round(lat * 1e6);
    const b = Math.round(lon * 1e6);
    enc(a - pl);
    enc(b - pn);
    pl = a;
    pn = b;
  }
  return out;
}

const dist = (a, b) => {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (v) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(v));
    };
    if (u.pathname.startsWith('/route/v1/driving/')) {
      const [a, b] = u.pathname.split('/').pop().split(';').map((s) => s.split(',').map(Number).reverse());
      // An L-shaped route: first along the latitude, then along the longitude, like streets.
      const mid = [b[0], a[1]];
      const pts = [...Array.from({ length: 6 }, (_, i) => [a[0] + ((mid[0] - a[0]) * i) / 5, a[1]]), ...Array.from({ length: 6 }, (_, i) => [mid[0], mid[1] + ((b[1] - mid[1]) * (i + 1)) / 6])];
      const d = dist(a, mid) + dist(mid, b);
      return json({ code: 'Ok', routes: [{ distance: d, duration: d / 7, geometry: encode(pts) }] });
    }
    if (u.pathname === '/search') {
      const q = (u.searchParams.get('q') ?? '').toLowerCase();
      return json(PLACES.filter((p) => q.includes(p.address.road.split(' ').pop().toLowerCase().slice(0, 5)) || q.includes(p.address.road.toLowerCase().slice(0, 5))));
    }
    if (u.pathname === '/reverse') {
      return json({ ...PLACES[0], lat: u.searchParams.get('lat'), lon: u.searchParams.get('lon') });
    }
    res.writeHead(404);
    res.end('{}');
  })
  .listen(port, '127.0.0.1', () => console.log(`fake OSM on ${port}`));
