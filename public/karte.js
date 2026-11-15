// Karten für Geografie-Fragen – gemeinsam für Fernseher und Handy.
// Karten liegen fertig unter /karten/<name>.json (erzeugt von karten/erzeugen.js aus Natural Earth, offline).
// Projektion wie im Erzeuger: x = (Länge − lon0) · cos(lat0) · k, y = −Breite · k
const KARTEN = {};
function loadKarte(name) {
  if (!KARTEN[name]) KARTEN[name] = fetch('/karten/' + name + '.json').then(r => { if (!r.ok) throw new Error('Karte fehlt'); return r.json(); })
    .then(m => { m.byId = Object.fromEntries(m.regions.map(r => [r.id, r])); m.cos = Math.cos(m.lat0 * Math.PI / 180); return m; })
    .catch(e => { delete KARTEN[name]; throw e; });
  return KARTEN[name];
}
const kProj = (m, lat, lon) => [(lon - m.lon0) * m.cos * m.k, -lat * m.k];
const kUnproj = (m, x, y) => [-y / m.k, x / (m.cos * m.k) + m.lon0];
function kDist(a, b) {   // [lat, lon] -> km (Großkreis)
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
// Kreis mit r km um einen Punkt auf Breite lat -> Halbachsen [rx, ry] in Kartenkoordinaten
const kRadius = (m, lat, km) => { const deg = km / 111.2; return [deg / Math.max(0.05, Math.cos(lat * Math.PI / 180)) * m.cos * m.k, deg * m.k]; };
const kKm = d => d < 10 ? d.toFixed(1).replace('.', ',') + ' km' : Math.round(d).toLocaleString('de-DE') + ' km';

// Karte als SVG-Text. opts.small: kleine Gebiete als Punkt (TV) bzw. Tippkreis (Handy) zeigen
function kSvg(m, opts = {}) {
  const vb = opts.vb || m.vb;
  return `<svg class="karte" viewBox="${vb.join(' ')}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
    <rect class="kmeer" x="${m.vb[0] - m.vb[2]}" y="${m.vb[1] - m.vb[3]}" width="${m.vb[2] * 3}" height="${m.vb[3] * 3}"/>
    ${m.bg ? `<path class="kbg" d="${m.bg}"/>` : ''}
    <g class="kland">${m.regions.map(r => `<path class="krg" data-id="${esc(r.id)}" d="${r.d}"/>`).join('')}</g>
    <g class="khit">${opts.small ? m.regions.filter(r => r.s).map(r => `<circle class="ksmall" data-id="${esc(r.id)}" cx="${r.c[0]}" cy="${r.c[1]}" r="0"/>`).join('') : ''}</g>
    ${opts.frame ? kFrame(m) : ''}
    <g class="kover"></g></svg>`;
}
// Spielfeld = m.vb (das zeigt der Fernseher während der Frage). Außerhalb abgedunkelt, Rahmen gestrichelt.
function kFrame(m) {
  const v = m.vb, b = [v[0] - v[2] * 3, v[1] - v[3] * 3, v[2] * 7, v[3] * 7];
  return `<path class="kout" fill-rule="evenodd" d="M${b[0]},${b[1]}h${b[2]}v${b[3]}h${-b[2]}Z M${v[0]},${v[1]}v${v[3]}h${v[2]}v${-v[3]}Z"/>
    <rect class="kframe" x="${v[0]}" y="${v[1]}" width="${v[2]}" height="${v[3]}"/>`;
}
const kInside = (m, x, y) => x >= m.vb[0] && x <= m.vb[0] + m.vb[2] && y >= m.vb[1] && y <= m.vb[1] + m.vb[3];
// Kartenmaßstab: wie viele Karten-Einheiten ein Bildschirmpixel ist (für gleich große Pins bei jedem Zoom)
function kUnit(svg) {
  const vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
  return Math.max(vb.width / (r.width || 1), vb.height / (r.height || 1));
}
// Ausschnitt, der alle Punkte zeigt (mit Rand), im Seitenverhältnis des Kastens; nie kleiner als minFrac der Karte
// top: zusätzlicher Rand oben (Anteil der Höhe), z. B. für die Frage, die oben links über der Karte liegt
function kFit(m, pts, aspect, minFrac = 0.3, top = 0) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  y0 -= Math.max(y1 - y0, m.vb[2] * minFrac / aspect / 1.5) * top;
  let w = Math.max((x1 - x0) * 1.5, m.vb[2] * minFrac), h = Math.max((y1 - y0) * 1.5, m.vb[2] * minFrac / aspect);
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  if (w >= m.vb[2] && h >= m.vb[3]) return m.vb;
  return [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h];
}
// Kleine Gebiete: Kreis mit fester Bildschirmgröße
function kSizeSmall(svg, px) {
  const u = kUnit(svg);
  svg.querySelectorAll('.ksmall').forEach(c => c.setAttribute('r', px * u));
}
// Pin: Spitze genau auf dem Punkt; size = Höhe in Bildschirmpixeln
function kPin(m, lat, lon, color, avatar, u, size = 44, cls = '') {
  const [x, y] = kProj(m, lat, lon), s = u * size / 44;
  return `<g class="kpin ${cls}" transform="translate(${x},${y}) scale(${s})"><g class="kpin-in">
    <path d="M0,0 C-6,-11 -15,-18 -15,-29 A15,15 0 1 1 15,-29 C15,-18 6,-11 0,0Z" fill="${color}" stroke="#fff" stroke-width="2.5"/>
    <text x="0" y="-23" font-size="17" text-anchor="middle">${avatar}</text></g></g>`;
}
// Gebiet unter einem Bildschirmpunkt (kleine Gebiete über ihren Tippkreis)
function kRegionAt(svg, cx, cy) {
  const el = document.elementFromPoint(cx, cy);
  return el && svg.contains(el) && el.dataset && el.dataset.id ? el.dataset.id : null;
}
function kClientToMap(svg, cx, cy) {
  const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [p.x, p.y];
}

// ---------- Handy: Karte mit Zoomen/Verschieben, Tippen setzt Pin oder wählt ein Gebiet ----------
// mode 'pin' | 'land'; onPick(value) mit [lat, lon] bzw. Gebiets-ID
function kMount(host, m, { mode, color, avatar, value, onPick }) {
  host.innerHTML = kSvg(m, { small: mode === 'land', frame: true }) + `<div class="ktoast" hidden>Außerhalb des Spielfelds – tippe im Rahmen</div><div class="kzoom"><button data-z="1.6" aria-label="Vergrößern">＋</button><button data-z="0.625" aria-label="Verkleinern">－</button></div>`;
  const svg = host.querySelector('svg'), over = svg.querySelector('.kover');
  let vb = m.vb.slice();
  const minW = m.vb[2] / 14, maxW = m.vb[2];
  const apply = () => {
    svg.setAttribute('viewBox', vb.join(' '));
    kSizeSmall(svg, 11);
    draw();
  };
  const clamp = () => {   // nur so weit verschieben, dass die Mitte im Spielfeld bleibt
    vb[2] = Math.min(maxW, Math.max(minW, vb[2])); vb[3] = vb[2] * m.vb[3] / m.vb[2];
    vb[0] = Math.min(m.vb[0] + m.vb[2] - vb[2] / 2, Math.max(m.vb[0] - vb[2] / 2, vb[0]));
    vb[1] = Math.min(m.vb[1] + m.vb[3] - vb[3] / 2, Math.max(m.vb[1] - vb[3] / 2, vb[1]));
  };
  const toast = host.querySelector('.ktoast');
  const outside = () => {   // außerhalb getippt: kein Pin, kurz vibrieren und Hinweis
    if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
    toast.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { toast.hidden = true; }, 1800);
  };
  const zoomAt = (f, cx, cy) => {
    const [mx, my] = kClientToMap(svg, cx, cy);
    const w = Math.min(maxW, Math.max(minW, vb[2] / f)), g = w / vb[2];
    vb = [mx - (mx - vb[0]) * g, my - (my - vb[1]) * g, w, vb[3] * g];
    clamp(); apply();
  };
  function draw() {
    svg.querySelectorAll('.krg.sel, .krg.selsh').forEach(e => e.remove());
    over.innerHTML = '';
    if (value == null) return;
    const u = kUnit(svg);
    if (mode === 'pin') over.innerHTML = kPin(m, value[0], value[1], color, avatar, u, 48);
    else {
      const r = m.byId[value]; if (!r) return;
      // gewähltes Gebiet hebt sich wie ein Knopf ab (Schatten darunter, leicht angehoben) – ohne Namen
      over.innerHTML = `<path class="krg selsh" d="${r.d}" transform="translate(0 ${2.5 * u})"/><path class="krg sel" d="${r.d}" style="--pc:${color}" transform="translate(0 ${-2 * u})"/>`
        + (r.s ? `<circle class="ksel" cx="${r.c[0]}" cy="${r.c[1] - 2 * u}" r="${11 * u}" style="--pc:${color}"/>` : '');
    }
  }
  // Gesten: ein Finger verschiebt, zwei Finger zoomen; kurzes Tippen wählt
  const ptrs = new Map(); let start = null, moved = false, pinch = null;
  svg.addEventListener('pointerdown', e => {
    svg.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) { start = { x: e.clientX, y: e.clientY, vb: vb.slice(), u: kUnit(svg) }; moved = false; }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), w: vb[2] }; moved = true; }
  });
  svg.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      zoomAt(vb[2] / (pinch.w * pinch.d / d), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    } else if (ptrs.size === 1 && start) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 8) moved = true;
      if (moved) { vb[0] = start.vb[0] - dx * start.u; vb[1] = start.vb[1] - dy * start.u; clamp(); apply(); }
    }
  });
  const up = e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0 && start && !moved) {
      const [x, y] = kClientToMap(svg, e.clientX, e.clientY);
      if (!kInside(m, x, y)) { start = null; return outside(); }
      if (mode === 'pin') value = kUnproj(m, x, y).map(v => +v.toFixed(4));
      else { const id = kRegionAt(svg, e.clientX, e.clientY); if (id) value = id; }
      draw(); if (navigator.vibrate) navigator.vibrate(12);
      onPick(value);
    }
    if (ptrs.size === 0) start = null;
  };
  svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY); }, { passive: false });
  host.querySelectorAll('.kzoom button').forEach(b => b.onclick = () => { const r = svg.getBoundingClientRect(); zoomAt(+b.dataset.z, r.left + r.width / 2, r.top + r.height / 2); });
  requestAnimationFrame(apply);
  return { set(v) { value = v; draw(); } };
}
