// Philips Hue (Variante 1, Proof of Concept): Raumlicht passend zum Spiel steuern.
// Spricht die Bridge direkt im Heimnetz über die CLIP-v2-Schnittstelle an (HTTPS, keine Zusatzpakete).
// Zugangsdaten und Auswahl liegen in hue.json (nicht in Git).
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'hue.json');
let cfg = load();
let snapshot = null;          // Lichtzustand vor dem Spiel, wird danach wiederhergestellt
let lastMood = '';

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return {}; } }
function save() { try { fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2)); } catch (e) { console.error('Hue: konnte hue.json nicht speichern', e.message); } }

// ---------- HTTPS zur Bridge ----------
// Die Bridge hat ein eigenes Zertifikat (von Signify, nicht öffentlich). Im Heimnetz akzeptieren wir es.
function request(method, host, urlPath, body, key, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({ host, port: 443, method, path: urlPath, rejectUnauthorized: false, timeout,
      headers: { 'Content-Type': 'application/json', ...(key ? { 'hue-application-key': key } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, res => {
      let buf = ''; res.on('data', c => { buf += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(buf || '{}') }); } catch (_) { resolve({ status: res.statusCode, json: null }); } });
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const clip = (method, p, body) => request(method, cfg.ip, '/clip/v2/resource/' + p, body, cfg.appKey);

// ---------- Einrichtung ----------
// Bridge im Netz finden: über den Dienst von Philips (braucht Internet). Sonst IP von Hand eingeben.
function discover() {
  return new Promise(resolve => {
    https.get('https://discovery.meethue.com/', { timeout: 5000 }, res => {
      let buf = ''; res.on('data', c => { buf += c; });
      res.on('end', () => { try { resolve((JSON.parse(buf) || []).map(b => b.internalipaddress).filter(Boolean)); } catch (_) { resolve([]); } });
    }).on('error', () => resolve([])).on('timeout', function () { this.destroy(); resolve([]); });
  });
}

// Koppeln: vorher den runden Knopf auf der Bridge drücken
async function pair(ip) {
  if (!/^[0-9a-zA-Z.\-:]+$/.test(ip || '')) return { ok: false, text: 'Ungültige Adresse.' };
  let r;
  try { r = await request('POST', ip, '/api', { devicetype: 'quizabend#pi', generateclientkey: true }); }
  catch (e) { return { ok: false, text: `Bridge unter ${ip} nicht erreichbar (${e.message}).` }; }
  const first = Array.isArray(r.json) ? r.json[0] : null;
  if (first && first.success) {
    cfg = { ip, appKey: first.success.username, clientKey: first.success.clientkey, enabled: true, target: null, lights: [] };
    save(); return { ok: true };
  }
  if (first && first.error && first.error.type === 101) return { ok: false, text: 'Erst den runden Knopf auf der Bridge drücken, dann innerhalb von 30 Sekunden auf „Verbinden“ tippen.' };
  return { ok: false, text: 'Die Bridge hat die Kopplung abgelehnt.' };
}

// Auswahl: Entertainment-Bereiche, Räume und Zonen
async function targets() {
  if (!cfg.appKey) return { ok: false, text: 'Noch nicht verbunden.' };
  try {
    const [ent, rooms, zones] = await Promise.all(['entertainment_configuration', 'room', 'zone'].map(t => clip('GET', t).then(r => (r.json && r.json.data) || [])));
    const name = x => (x.metadata && x.metadata.name) || 'Ohne Namen';
    return { ok: true, list: [
      ...ent.map(x => ({ kind: 'entertainment_configuration', id: x.id, name: name(x), group: 'Entertainment-Bereiche' })),
      ...rooms.map(x => ({ kind: 'room', id: x.id, name: name(x), group: 'Räume' })),
      ...zones.map(x => ({ kind: 'zone', id: x.id, name: name(x), group: 'Zonen' })),
    ] };
  } catch (e) { return { ok: false, text: 'Bridge nicht erreichbar: ' + e.message }; }
}

// Ausgewählten Bereich in einzelne Lampen auflösen (und merken, was sie können)
async function select(kind, id) {
  if (!['entertainment_configuration', 'room', 'zone'].includes(kind)) return { ok: false, text: 'Unbekannte Auswahl.' };
  try {
    const t = (await clip('GET', `${kind}/${encodeURIComponent(id)}`)).json;
    const item = t && t.data && t.data[0];
    if (!item) return { ok: false, text: 'Bereich nicht gefunden.' };
    let ids = [];
    if (kind === 'entertainment_configuration') ids = (item.light_services || []).map(s => s.rid);
    else if (kind === 'zone') ids = (item.children || []).filter(c => c.rtype === 'light').map(c => c.rid);
    else {
      const devices = new Set((item.children || []).filter(c => c.rtype === 'device').map(c => c.rid));
      const devs = ((await clip('GET', 'device')).json || {}).data || [];
      ids = devs.filter(d => devices.has(d.id)).flatMap(d => (d.services || []).filter(s => s.rtype === 'light').map(s => s.rid));
    }
    const all = ((await clip('GET', 'light')).json || {}).data || [];
    cfg.lights = all.filter(l => ids.includes(l.id)).map(l => ({ id: l.id, name: (l.metadata && l.metadata.name) || '', color: !!l.color, ct: !!l.color_temperature }));
    cfg.target = { kind, id, name: (item.metadata && item.metadata.name) || '' };
    cfg.group = String(item.id_v1 || '').replace('/groups/', '') || null;   // für gleichzeitige Gruppenbefehle
    save();
    return { ok: true, count: cfg.lights.length };
  } catch (e) { return { ok: false, text: 'Bridge nicht erreichbar: ' + e.message }; }
}

function status() {
  return { paired: !!cfg.appKey, ip: cfg.ip || null, enabled: !!cfg.enabled, target: cfg.target || null, lights: (cfg.lights || []).length, testing: !!testTimer };
}
function enable(on) { cfg.enabled = !!on; save(); if (!on) restore(); return { ok: true }; }
function forget() { restore(); cfg = {}; try { fs.unlinkSync(FILE); } catch (_) {} return { ok: true }; }

// ---------- Senden (höchstens ~10 Befehle pro Sekunde, wie von Philips empfohlen) ----------
const pending = new Map();    // Lampe -> nächster Zustand (neuere Befehle ersetzen ältere)
let pumping = false;
function queue(lightId, body) { pending.set(lightId, Object.assign(pending.get(lightId) || {}, body)); if (!pumping) pump(); }
async function pump() {
  pumping = true;
  while (pending.size) {
    const [id, body] = pending.entries().next().value; pending.delete(id);
    try { await clip('PUT', 'light/' + id, body); } catch (e) { warn(e); }
    await new Promise(r => setTimeout(r, 110));
  }
  pumping = false;
}
let warned = 0;
function warn(e) { if (Date.now() - warned > 60000) { warned = Date.now(); console.error('Hue: Bridge nicht erreichbar –', e.message); } }

// Gruppenbefehl: alle Lampen des Bereichs schalten gleichzeitig (wichtig für die Auflösung)
let groupNext = null, groupBusy = false, groupLast = 0, groupAfter = null;
function groupSend(body, after) {
  groupNext = Object.assign(groupNext || {}, body);
  groupAfter = after || null;          // läuft, sobald dieser Befehl wirklich gesendet ist
  if (!groupBusy) groupPump();
}
async function groupPump() {
  groupBusy = true;
  while (groupNext) {
    const wait = groupLast + 1000 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const body = groupNext, after = groupAfter; groupNext = null; groupAfter = null; groupLast = Date.now();
    try { await request('PUT', cfg.ip, `/api/${cfg.appKey}/groups/${cfg.group}/action`, body, null); } catch (e) { warn(e); }
    if (after) after();
  }
  groupBusy = false;
}
async function ensureGroup() {
  if (cfg.group || !cfg.target) return !!cfg.group;
  await select(cfg.target.kind, cfg.target.id);   // ältere hue.json ohne Gruppen-ID
  return !!cfg.group;
}

// Farbe (#rrggbb) -> CIE xy, wie Hue sie erwartet
function xy(hex) {
  const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92);
  const X = v[0] * 0.4124 + v[1] * 0.3576 + v[2] * 0.1805, Y = v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722, Z = v[0] * 0.0193 + v[1] * 0.1192 + v[2] * 0.9505;
  const s = X + Y + Z || 1;
  return { x: +(X / s).toFixed(4), y: +(Y / s).toFixed(4) };
}

// Stimmung auf den ganzen Bereich: { color: '#rrggbb' } oder { mirek: 370 } (warmweiß), bri 1–100, ms Übergang,
// pulse = Lampen pulsieren lassen (wird mit dem nächsten Befehl wieder gestoppt)
let pulseTimer = null;
function apply({ color, mirek, bri, ms = 800, pulse = false }) {
  if (!cfg.group) return;
  clearTimeout(pulseTimer);
  // Erst Farbe und Helligkeit setzen (beim Pulsieren ohne Übergang), das Pulsieren kommt als eigener Befehl danach:
  // starten beide gleichzeitig, pulsieren manche Lampen noch in der alten Farbe.
  const body = { on: true, bri: Math.max(1, Math.min(254, Math.round(bri * 2.54))), transitiontime: pulse ? 0 : Math.min(65535, Math.round(ms / 100)), alert: 'none' };
  if (color) { const c = xy(color); body.xy = [c.x, c.y]; }
  else if (mirek) body.ct = mirek;
  groupSend(body, pulse ? () => {
    // 600 ms nachdem die Farbe gesendet ist; direkt (nicht über die 1-s-Warteschlange), damit es in den kurzen Spezialfrage-Screen passt
    pulseTimer = setTimeout(() => {
      groupLast = Date.now();
      request('PUT', cfg.ip, `/api/${cfg.appKey}/groups/${cfg.group}/action`, { alert: 'lselect' }, null).catch(warn);
    }, 600);
  } : null);
}
function stopPulse() { clearTimeout(pulseTimer); if (cfg.group) groupSend({ alert: 'none' }); }

// Zustand vor dem Spiel merken und danach wiederherstellen
async function takeSnapshot() {
  try {
    const all = ((await clip('GET', 'light')).json || {}).data || [];
    const ids = new Set((cfg.lights || []).map(l => l.id));
    snapshot = all.filter(l => ids.has(l.id)).map(l => ({ id: l.id, on: l.on && l.on.on, bri: l.dimming && l.dimming.brightness,
      mirek: l.color_temperature && l.color_temperature.mirek_valid ? l.color_temperature.mirek : null, xy: l.color && l.color.xy }));
  } catch (e) { warn(e); snapshot = null; }
}
function restore() {
  stopPulse();
  if (!snapshot) return;
  for (const s of snapshot) {
    const body = { on: { on: !!s.on }, dynamics: { duration: 1500 } };
    if (s.on) {
      if (s.bri) body.dimming = { brightness: s.bri };
      if (s.mirek) body.color_temperature = { mirek: s.mirek }; else if (s.xy) body.color = { xy: s.xy };
    }
    queue(s.id, body);
  }
  snapshot = null; lastMood = '';
}

// ---------- Spielphasen -> Licht ----------
const VIOLET = '#6a3cff', DEEP = '#3b2bd6', GOLD = '#f5b014';
const ANSWER = ['#e5484d', '#3e8ef7', '#f5b014', '#2fb36d'];   // Farben der Antwortkacheln
async function onPhase(phase, info = {}) {
  if (!cfg.enabled || !cfg.appKey || !(cfg.lights || []).length) return;
  if (phase === 'lobby') return restore();
  if (!(await ensureGroup())) return;
  if (phase === 'opening' && !snapshot) await takeSnapshot();
  let mood, key = phase;
  switch (phase) {
    case 'opening': mood = { color: VIOLET, bri: 40, ms: 2500 }; break;
    case 'block': mood = { color: VIOLET, bri: 45, ms: 1000 }; break;
    case 'intro': case 'preview': case 'question': case 'votes': key = 'question'; mood = { color: DEEP, bri: 22, ms: 1200 }; break;
    case 'media': mood = { color: DEEP, bri: 8, ms: 1000 }; break;                       // Video/Audio: fast dunkel
    case 'special': mood = { color: GOLD, bri: 100, ms: 300, pulse: true }; break;     // pulsiert nur, solange der Screen da ist
    case 'reveal': key = 'reveal' + info.q; mood = { color: info.correct != null ? ANSWER[info.correct] : '#2fb36d', bri: 70, ms: 300 }; break;
    case 'scores': mood = { color: VIOLET, bri: 40, ms: 1500 }; break;
    case 'pause': mood = { mirek: 370, bri: 100, ms: 3000 }; break;                    // hell und warmweiß
    case 'pausedim': mood = { color: VIOLET, bri: 45, ms: info.ms }; break;            // letzte Minute: langsam zum Licht der Block-Ansage
    case 'frozen': mood = { mirek: 370, bri: 60, ms: 1500 }; break;
    case 'end': mood = { color: info.winnerColor || GOLD, bri: 90, ms: 800, pulse: true }; break;
    default: return;
  }
  if (key === lastMood) return;
  lastMood = key;
  apply(mood);
}

// Test: 3 Sekunden gold pulsieren, dann zurück; jederzeit abbrechbar
let testTimer = null, testOwnsSnapshot = false;
async function test() {
  if (!(cfg.lights || []).length) return { ok: false, text: 'Erst einen Bereich auswählen.' };
  if (!(await ensureGroup())) return { ok: false, text: 'Bereich hat keine Gruppe – bitte neu auswählen.' };
  if (!testTimer && !snapshot) { await takeSnapshot(); testOwnsSnapshot = true; }
  clearTimeout(testTimer);
  apply({ color: GOLD, bri: 100, ms: 300, pulse: true });
  testTimer = setTimeout(stopTest, 3000);
  return { ok: true };
}
function stopTest() {
  if (!testTimer) return { ok: true };
  clearTimeout(testTimer); testTimer = null;
  if (testOwnsSnapshot) { testOwnsSnapshot = false; restore(); } else stopPulse();
  return { ok: true };
}
function testing() { return !!testTimer; }

module.exports = { status, discover, pair, targets, select, enable, forget, test, stopTest, testing, onPhase };
