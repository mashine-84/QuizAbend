#!/usr/bin/env node
// Erzeugt die Karten für Geografie-Fragen (public/karten/*.json) aus den Quelldateien in karten/quelle/.
// Ohne Zusatzpakete: TopoJSON entpacken, zuschneiden, projizieren, vereinfachen.
//
//   node karten/erzeugen.js
//
// Projektion: einfache Plattkarte mit Breitengrad-Ausgleich (x = (Länge − lon0) · cos(lat0) · k, y = −Breite · k).
// Das Handy rechnet einen getippten Punkt damit genau zurück in Breite/Länge (siehe public/karte.js).
const fs = require('fs'), path = require('path');
const NAMEN = require('./namen.js');
const Q = path.join(__dirname, 'quelle'), OUT = path.join(__dirname, '..', 'public', 'karten');

// ---------- TopoJSON entpacken ----------
function topoFeatures(topo, obj) {
  const { scale, translate } = topo.transform;
  const arcs = topo.arcs.map(a => { let x = 0, y = 0; return a.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; }); });
  const arc = i => i >= 0 ? arcs[i] : arcs[~i].slice().reverse();
  const ring = r => { const out = []; r.forEach((i, k) => { const a = arc(i); out.push(...(k ? a.slice(1) : a)); }); return out; };
  return topo.objects[obj].geometries.map(g => ({
    name: g.properties.name,
    polys: g.type === 'Polygon' ? [g.arcs.map(ring)] : g.type === 'MultiPolygon' ? g.arcs.map(p => p.map(ring)) : [],
  }));
}
function geoFeatures(geo) {
  return geo.features.map(f => ({ id: f.properties.id, name: f.properties.name,
    polys: f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates }));
}

// ---------- Zuschneiden (Sutherland-Hodgman an einem Rechteck in Länge/Breite) ----------
function clipRing(ring, [x0, y0, x1, y1]) {
  const edges = [[p => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
    [p => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [p => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]],
    [p => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]]];
  let pts = ring;
  for (const [inside, cut] of edges) {
    if (!pts.length) break;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (inside(a)) { out.push(a); if (!inside(b)) out.push(cut(a, b)); } else if (inside(b)) out.push(cut(a, b));
    }
    pts = out;
  }
  return pts;
}

// ---------- Vereinfachen (Douglas-Peucker) ----------
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const n = pts.length - 1, stack = [];
  if (pts[0][0] === pts[n][0] && pts[0][1] === pts[n][1]) {
    // geschlossener Ring: am weitesten entfernten Punkt teilen, sonst ist die Grundlinie ein Punkt
    let m = 1, max = -1;
    for (let i = 1; i < n; i++) { const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]); if (d > max) { max = d; m = i; } }
    keep[m] = 1; stack.push([0, m], [m, n]);
  } else stack.push([0, n]);
  while (stack.length) {
    const [a, b] = stack.pop(); let max = 0, idx = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len; if (d > max) { max = d; idx = i; } }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const area = r => { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
function centroid(r) {
  let cx = 0, cy = 0, s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length], f = a[0] * b[1] - b[0] * a[1]; cx += (a[0] + b[0]) * f; cy += (a[1] + b[1]) * f; s += f; }
  return s ? [cx / (3 * s), cy / (3 * s)] : r[0];
}

// ---------- Eine Karte bauen ----------
function build(cfg, features, background) {
  const cos = Math.cos(cfg.lat0 * Math.PI / 180), k = cfg.k;
  const proj = ([lon, lat]) => [(lon - cfg.lon0) * cos * k, -lat * k];
  const r1 = x => Math.round(x * 10) / 10;
  const shape = (polys, keepSmall) => {
    const rings = [];
    for (const poly of polys) for (const [ri, raw] of poly.entries()) {
      // Ringe über die Datumsgrenze (Russland, Fidschi): westliche Längen nach Osten verschieben
      const ring = Math.max(...raw.map(p => p[0])) - Math.min(...raw.map(p => p[0])) > 180 ? raw.map(([x, y]) => [x < 0 ? x + 360 : x, y]) : raw;
      let pts = cfg.clip ? clipRing(ring, cfg.clip) : ring;
      if (pts.length < 3) continue;
      pts = simplify(pts.map(proj), cfg.tol).map(p => [r1(p[0]), r1(p[1])]);
      if (pts.length < 3) continue;
      const a = Math.abs(area(pts));
      rings.push({ pts, a, hole: ri > 0 });
    }
    // Winzige Inseln weglassen – außer das Land besteht nur daraus (Malta, Inselstaaten)
    const big = Math.max(0, ...rings.map(r => r.a));
    const used = rings.filter(r => r.a >= cfg.minArea || (keepSmall && r.a >= big * 0.2));
    return { rings: used, big };
  };
  const closed = p => p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1];
  const d = rings => rings.map(r => 'M' + (closed(r.pts) ? r.pts.slice(0, -1) : r.pts).map(p => p.join(',')).join('L') + 'Z').join('');
  const regions = [];
  for (const f of features) {
    const { rings } = shape(f.polys, true);
    if (!rings.length) continue;
    const main = rings.filter(r => !r.hole).sort((a, b) => b.a - a.a)[0];
    const total = rings.filter(r => !r.hole).reduce((s, r) => s + r.a, 0);
    const c = centroid(main.pts).map(r1);
    const xs = rings.flatMap(r => r.pts.map(p => p[0])), ys = rings.flatMap(r => r.pts.map(p => p[1]));
    const region = { id: f.id || f.name, n: f.de || NAMEN[f.name] || f.name, d: d(rings), c, a: Math.round(total),
      b: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(r1) };   // Umriss-Rechteck (Zoom am Fernseher)
    if (total < cfg.smallArea) region.s = 1;   // klein: am Handy größerer Tippbereich, am Fernseher ein Punkt
    regions.push(region);
  }
  const out = { name: cfg.name, title: cfg.title, lat0: cfg.lat0, lon0: cfg.lon0, k, vb: cfg.vb.map(r1), regions };
  if (background) out.bg = background.map(f => d(shape(f.polys, false).rings)).filter(Boolean).join('');
  // Umgerechnet: Sichtbereich in Länge/Breite -> Kartenkoordinaten
  return out;
}
function viewBox(cfg) {
  const cos = Math.cos(cfg.lat0 * Math.PI / 180), [w, s, e, n] = cfg.view;
  const x0 = (w - cfg.lon0) * cos * cfg.k, x1 = (e - cfg.lon0) * cos * cfg.k;
  return [x0, -n * cfg.k, x1 - x0, (n - s) * cfg.k];
}

const world = JSON.parse(fs.readFileSync(path.join(Q, 'countries-50m.json'), 'utf8'));
const countries = topoFeatures(world, 'countries').filter(f => f.name !== 'Antarctica');
const states = geoFeatures(JSON.parse(fs.readFileSync(path.join(Q, 'bundeslaender.geo.json'), 'utf8')));

const MAPS = [
  { name: 'welt', title: 'Welt', lat0: 30, lon0: 10, k: 4, tol: 0.9, minArea: 2, smallArea: 18, view: [-170, -56, 190, 80], clip: null },
  { name: 'europa', title: 'Europa', lat0: 50, lon0: 12, k: 26, tol: 0.7, minArea: 6, smallArea: 160, view: [-24, 34, 44, 71], clip: [-45, 24, 72, 76], skip: ['Greenland', 'Canada'] },
  { name: 'deutschland', title: 'Deutschland', lat0: 51, lon0: 10.5, k: 160, tol: 0.6, minArea: 20, smallArea: 2500, view: [5.3, 47.15, 15.6, 55.15], clip: [-4, 43, 25, 59] },
];
fs.mkdirSync(OUT, { recursive: true });
for (const cfg of MAPS) {
  cfg.vb = viewBox(cfg);
  let map;
  if (cfg.name === 'deutschland') {
    map = build(cfg, states.map(s => ({ ...s, de: s.name })), countries.filter(f => f.name !== 'Germany'));
  } else map = build(cfg, cfg.clip ? countries.filter(f => !(cfg.skip || []).includes(f.name) && f.polys.some(p => p[0].some(([lon, lat]) => lon >= cfg.clip[0] && lon <= cfg.clip[2] && lat >= cfg.clip[1] && lat <= cfg.clip[3]))) : countries);
  const file = path.join(OUT, cfg.name + '.json');
  fs.writeFileSync(file, JSON.stringify(map));
  console.log(`${cfg.name}: ${map.regions.length} Gebiete, ${(fs.statSync(file).size / 1024).toFixed(0)} KB, klein: ${map.regions.filter(r => r.s).map(r => r.n).join(', ')}`);
}
