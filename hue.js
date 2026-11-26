// Philips Hue: Raumlicht passend zum Spiel steuern.
// Spricht die Bridge direkt im Heimnetz über die CLIP-v2-Schnittstelle an (HTTPS, keine Zusatzpakete);
// bei einem Entertainment-Bereich als Lichtstream (Hue Entertainment, siehe „Lichtstream“ und hue-dtls.js).
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
  await streamStop();
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
  return { paired: !!cfg.appKey, ip: cfg.ip || null, enabled: !!cfg.enabled, target: cfg.target || null, lights: (cfg.lights || []).length, testing: !!testTimer,
    streamMoeglich: stromMoeglich(), stream: cfg.stream !== false, streamAktiv: stromAn(), streamFehler: stromKaputt,
    effekte: Object.entries(EFFEKTE).map(([name, text]) => ({ name, text, an: !(cfg.effekte && cfg.effekte[name] === false) })) };
}
function enable(on) { cfg.enabled = !!on; save(); if (!on) { streamStop(); restore(); } return { ok: true }; }
function forget() { streamStop(); restore(); cfg = {}; try { fs.unlinkSync(FILE); } catch (_) {} return { ok: true }; }

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
function apply(mood, onSent) {   // onSent: läuft, sobald der Befehl wirklich gesendet ist
  letzteStimmung = mood;
  if (stromAn()) { clearTimeout(pulseTimer); streamStimmung(mood); if (onSent) setTimeout(onSent, 0); return; }
  const { color, mirek, bri, ms = 800, pulse = false } = mood;
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
  } : onSent || null);
}
function stopPulse() { clearTimeout(pulseTimer); if (strom) strom.puls = false; if (cfg.group && !stromAn()) groupSend({ alert: 'none' }); }

// ---------- Lichtstream (Hue Entertainment) ----------
// Mit einem Entertainment-Bereich schickt das Quiz das Licht als verschlüsselten Stream (25 Bilder pro Sekunde) statt als
// einzelne Befehle. Übergänge und Pulsieren rechnet das Quiz selbst: sofort, gleichmäßig, ohne Umweg über Weiß oder
// Hellblau, und ohne die Grenze von ~1 Gruppenbefehl pro Sekunde. Klappt der Stream nicht oder bricht er ab,
// nimmt das Quiz automatisch wieder den normalen Weg (Gruppenbefehle). Solange der Stream läuft, gehören die Lampen
// dem Quiz (die Hue-App kommt nicht durch); in der Lobby gibt es sie zurück. Abschaltbar in den Einstellungen (cfg.stream).
const STREAM_TAKT_MS = 40;
const STREAM_GAMMA = 2;           // Helligkeit 1–100 % ist „gefühlt“ (wie bei der Bridge), der Stream erwartet Lichtwerte
const WARMWEISS = '#ffb46b';      // ≈ 2700 K – im Stream statt Farbtemperatur (mirek 370)
let strom = null, stromStart = null, stromKaputt = false, letzteStimmung = null;
const stromMoeglich = () => !!(cfg.target && cfg.target.kind === 'entertainment_configuration' && cfg.clientKey);
const streamGewollt = () => cfg.stream !== false && !stromKaputt && stromMoeglich();
const stromAn = () => !!strom;
function rgbVon(m) {
  const f = Math.pow(Math.max(0, Math.min(100, m.bri == null ? 100 : m.bri)) / 100, STREAM_GAMMA), hex = m.color || WARMWEISS;
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255 * f);
}
function streamFarbe(k, jetzt) {
  const s = strom, p = s.ms > 0 ? Math.min(1, (jetzt - s.t0) / s.ms) : 1, w = p * p * (3 - 2 * p);   // weich ein- und ausblenden
  const c = s.von[k].map((v, i) => v + (s.nach[k][i] - v) * w);
  if (s.effekt) return s.effekt(k, jetzt, c);
  if (!s.puls) return c;
  const f = 0.62 + 0.38 * Math.cos(2 * Math.PI * (jetzt - s.t0) / 1000);   // Pulsieren: einmal pro Sekunde
  return c.map(v => v * f);
}
function streamStimmung(m, zielJe) {   // zielJe(k): eigene Zielfarbe je Lampe (sonst alle gleich)
  const s = strom, jetzt = Date.now(), ziel = rgbVon(m);
  s.von = s.kanaele.map((_, k) => streamFarbe(k, jetzt));
  s.nach = s.kanaele.map((_, k) => zielJe ? zielJe(k) : ziel);
  s.t0 = jetzt; s.ms = m.ms == null ? 800 : m.ms; s.puls = !!m.pulse; s.effekt = null;
}
function streamBild() {
  const s = strom; if (!s) return;
  const jetzt = Date.now();
  try {
    s.conn.send(s.dtls.hueStream(s.id, s.seq++, s.kanaele.map((id, k) => {
      const [r, g, b] = streamFarbe(k, jetzt).map(v => Math.round(Math.max(0, Math.min(1, v)) * 65535));
      return { id, r, g, b };
    })));
  } catch (e) { console.error('Hue: Lichtstream – Senden ging nicht:', e.message); streamAbbauen(); stromKaputt = true; if (letzteStimmung) apply(letzteStimmung); }
}
// Stream aufbauen (ohne darauf zu warten: bis er steht, gilt der normale Weg). Ein Fehler schaltet für dieses Spiel auf den normalen Weg.
function streamStart() {
  if (strom || stromStart || !streamGewollt()) return stromStart || Promise.resolve(stromAn());
  const id = cfg.target.id;
  stromStart = (async () => {
    let gestartet = false;
    try {
      const dtls = require('./hue-dtls');
      const r = await clip('GET', 'entertainment_configuration/' + id);
      const conf = r.json && r.json.data && r.json.data[0];
      if (!conf) throw new Error(`Bereich nicht gefunden (HTTP ${r.status})`);
      const kanaele = (conf.channels || []).map(c => c.channel_id);
      if (!kanaele.length) throw new Error('der Bereich hat keine Lampen');
      const st = await clip('PUT', 'entertainment_configuration/' + id, { action: 'start' });
      if (st.status !== 200) throw new Error(`Bridge lehnt den Start ab (HTTP ${st.status}${((st.json && st.json.errors) || []).map(e => ': ' + e.description).join('')})`);
      gestartet = true;
      const t0 = Date.now();
      const conn = await dtls.connect({ host: cfg.ip, identity: cfg.appKey, psk: Buffer.from(cfg.clientKey, 'hex') });
      const start = letzteStimmung ? rgbVon(letzteStimmung) : [0, 0, 0];
      strom = { dtls, conn, id, kanaele, seq: 0, von: kanaele.map(() => start), nach: kanaele.map(() => start), t0: Date.now(), ms: 0, puls: false };
      if (letzteStimmung) streamStimmung({ ...letzteStimmung, ms: 300 });
      strom.timer = setInterval(streamBild, STREAM_TAKT_MS);
      strom.wacht = setInterval(streamPruefen, 15000);
      console.log(`Hue: Lichtstream läuft (${kanaele.length} Lampen, Verbindung nach ${Date.now() - t0} ms)`);
      return true;
    } catch (e) {
      console.error('Hue: Lichtstream geht nicht, nehme den normalen Weg –', e.message);
      stromKaputt = true;
      if (gestartet) clip('PUT', 'entertainment_configuration/' + id, { action: 'stop' }).catch(() => {});
      if (letzteStimmung) apply(letzteStimmung);   // normaler Weg übernimmt die aktuelle Stimmung
      return false;
    } finally { stromStart = null; }
  })();
  return stromStart;
}
// Alle 15 s: läuft der Stream an der Bridge noch? (Hue-App, anderes Programm oder Neustart der Bridge beenden ihn)
async function streamPruefen() {
  const s = strom; if (!s) return;
  let conf;
  try { const r = await clip('GET', 'entertainment_configuration/' + s.id); conf = r.json && r.json.data && r.json.data[0]; }
  catch (e) { warn(e); return; }                     // Bridge kurz nicht erreichbar: einfach weiter senden
  if (!conf || conf.status === 'active' || strom !== s) return;
  console.error('Hue: Lichtstream wurde an der Bridge beendet – baue ihn neu auf');
  streamAbbauen(); streamStart();
}
function streamAbbauen() {
  const s = strom; strom = null; if (!s) return;
  clearInterval(s.timer); clearInterval(s.wacht);
  try { s.conn.close(); } catch (_) {}
}
async function streamStop() {
  if (stromStart) await stromStart;
  stromKaputt = false;                               // nächstes Spiel probiert es wieder
  const s = strom; if (!s) return;
  streamAbbauen();
  await clip('PUT', 'entertainment_configuration/' + s.id, { action: 'stop' }).catch(warn);
  console.log('Hue: Lichtstream beendet, Lampen wieder frei');
}
// ---------- Lichteffekte (nur im Stream, einzeln abschaltbar: cfg.effekte) ----------
const EFFEKTE = { herz: 'Puls im Sekundentakt, wenn der Countdown rot wird' };
// (Lauflicht, Feuerwerk, Antwortfarben und eine Farbwelle bei der Auflösung gab es kurz – zu unruhig bzw. mit wenigen Lampen nicht zu sehen)
const effektAn = n => stromAn() && !(cfg.effekte && cfg.effekte[n] === false);
const mix = (a, b, w) => a.map((v, i) => v + (b[i] - v) * w);
// Countdown: sobald er am Fernseher rot wird (letzte 5 s), ein Puls pro Sekunde – genau beim Umspringen der Zahl,
// jeder etwas heller als der vorige (gleiche Farbe, kurz aufleuchten, dann zurück)
function herz(ende) {
  strom.effekt = (k, jetzt, c) => {
    const rest = ende - jetzt; if (rest > 5000 || rest <= 0) return c;
    const seit = (5000 - rest) % 1000, nr = Math.floor((5000 - rest) / 1000);       // nr 0–4: Zahl 5 … 1
    const b = seit < 80 ? seit / 80 : Math.exp(-(seit - 80) / 220);
    const m = Math.max(...c) || 1, hell = c.map(v => v / m * (0.18 + 0.09 * nr));    // 18 % … 54 % Lichtwert
    return mix(c, hell, b);
  };
}
// Frage: Puls am Ende des Countdowns
function frageEffekte(info) {
  if (effektAn('herz') && info.ends) herz(info.ends);
}
function streamEffektAus() {   // Effekt beenden: weich (0,3 s) zurück zur Grundfarbe
  const s = strom, jetzt = Date.now();
  s.von = s.kanaele.map((_, k) => streamFarbe(k, jetzt)); s.effekt = null; s.t0 = jetzt; s.ms = 300;
}
function setEffekt(name, on) {
  if (!EFFEKTE[name]) return { ok: false, text: 'Unbekannter Effekt.' };
  cfg.effekte = Object.assign({}, cfg.effekte, { [name]: !!on }); save(); return { ok: true };
}

function setStream(on) { cfg.stream = !!on; save(); if (!on) { streamStop(); if (letzteStimmung) apply(letzteStimmung); } return { ok: true }; }

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
const FRAGE_BRI = 40;   // Helligkeit des blau-lila Frage-Lichts in % (früher 22, dann 30 – noch zu dunkel)
// Auflösung: so lange leuchtet die Antwortfarbe hell, danach dimmt sie in derselben Farbe ab.
// Der Farbwechsel zum Blau passiert erst, wenn die Lampen fast dunkel sind – ein Übergang direkt von z. B. Orange
// nach Blau läuft bei Hue durch Weiß (die Lampe rechnet den Weg im Farbraum geradlinig).
const REVEAL_HOLD_MS = 1100;   // so lange hell in der Antwortfarbe
const REVEAL_FADE_MS = 2200;   // so lange dauert das Abdunkeln in der Antwortfarbe
// Lampenfarben der Antworten A–D: kräftigere Töne als die Kacheln, damit sie auch als Licht eindeutig sind
// und sich von Grundstimmung (Violett/Blau-Lila), Spezialfrage (Gold) und Risikofrage (Rot) abheben
const ANSWER = ['#ff4a1c', '#1e9bff', '#ffc21a', '#3fd12e'];
async function onPhase(phase, info = {}) {
  clearSeq();   // ein laufender Licht-Ablauf (Opener) endet mit jeder neuen Phase
  if (!cfg.enabled || !cfg.appKey || !(cfg.lights || []).length) return;
  if (phase === 'lobby') { await streamStop(); return restore(); }
  if (!(await ensureGroup()) && !streamGewollt()) return;   // ohne Gruppe geht nur der Stream
  // Lichtzustand vor dem Spiel merken, damit er am Ende wiederhergestellt wird – vor dem ersten Spiel-Licht,
  // also schon beim Opener (der läuft seit dem Opener vor dem Intro)
  if ((phase === 'ident' || phase === 'opening') && !snapshot) await takeSnapshot();
  if (streamGewollt() && !strom) streamStart();   // Lichtstream fürs Spiel (läuft bis zur Lobby); bis er steht, gilt der normale Weg
  let mood, key = phase;
  switch (phase) {
    case 'ident': mood = { color: VIOLET, bri: 12, ms: 400 }; break;                      // Opener: abdunkeln, dann Ablauf (s. u.)
    case 'opening': mood = { color: VIOLET, bri: 40, ms: 2500 }; break;
    case 'block': mood = { color: VIOLET, bri: 45, ms: 1000 }; break;
    case 'tiebreak': mood = { color: GOLD, bri: 80, ms: 600 }; break;                    // Stechen um Platz 1
    case 'intro': case 'preview': case 'question': case 'locked': case 'votes': key = 'question'; mood = { color: DEEP, bri: FRAGE_BRI, ms: 1200 }; break;
    case 'media': mood = { color: DEEP, bri: 8, ms: 1000 }; break;                       // Video/Audio: fast dunkel
    case 'special': mood = { color: GOLD, bri: 100, ms: 300, pulse: true }; break;     // pulsiert nur, solange der Screen da ist
    case 'risk': mood = { color: '#b3001b', bri: 100, ms: 200, pulse: true }; break;   // Risikofrage: roter Alarm
    case 'reveal': key = 'reveal' + info.q; mood = { color: info.correct != null ? ANSWER[info.correct] : ANSWER[3], bri: 100, ms: 0 }; break;   // sofort in der Antwortfarbe aufblitzen – ohne Übergang: sonst läuft die Lampe vom Blau
                                                                                   // durch den Farbraum (zum Grün über Hellblau, zum Orange über Rosa) und wird dabei schon hell
    case 'scores': mood = { color: VIOLET, bri: 40, ms: 1500 }; break;
    case 'pause': mood = { mirek: 370, bri: 100, ms: 3000 }; break;                    // hell und warmweiß
    case 'pausedim': mood = { color: VIOLET, bri: 45, ms: info.ms }; break;            // letzte Minute: langsam zum Licht der Block-Ansage
    case 'frozen': mood = { mirek: 370, bri: 60, ms: 1500 }; break;
    case 'end': mood = { color: info.winnerColor || GOLD, bri: 90, ms: 800, pulse: true }; break;
    default: return;
  }
  if (key === lastMood) {
    // Frage-Licht bleibt; der Countdown-Puls gehört aber nur zur laufenden Frage – haben alle geantwortet
    // (locked/votes), hört er sofort auf, auch wenn er schon angefangen hat
    if (stromAn()) { if (phase === 'question') frageEffekte(info); else if (strom.effekt) streamEffektAus(); }
    return;
  }
  lastMood = key;
  apply(mood);
  if (stromAn()) {   // Lichteffekte im Stream
    if (phase === 'question') frageEffekte(info);
  }
  // Opener „Vier Kacheln“: grob im Takt – mehr als ~1 Befehl pro Sekunde verträgt die Bridge nicht.
  // 1,25 s: Gold-Blitz (das „?“ erscheint bei 1,41 s, Lampen reagieren etwas verzögert), 2,35 s: sanft ins ruhige Violett.
  // Auflösung: nach dem Aufblitzen (gut 1 s – die Bridge verträgt ~1 Befehl pro Sekunde) in derselben Farbe etwas dunkler
  // nach gut 3 s langsam zurück ins gedimmte Frage-Licht – die Auflösung kann lange stehen („Übrigens“, Pub-Quiz)
  if (phase === 'reveal') {
    const farbe = info.correct != null ? ANSWER[info.correct] : ANSWER[3];
    // Schritte hängen am tatsächlichen Senden (die Warteschlange kann verzögern), damit das Abdunkeln fertig ist,
    // bevor die Farbe wechselt; eine neue Phase bricht die Kette ab (seqGen)
    const gen = seqGen, live = () => gen === seqGen, later = (ms, f) => { if (live()) seqTimers.push(setTimeout(f, ms)); };
    if (stromAn()) {   // Stream: exakt nach Zeit, Farbwechsel ohne Umweg – halten, in der Antwortfarbe abdunkeln, weich ins Frage-Blau
      later(REVEAL_HOLD_MS, () => apply({ color: farbe, bri: 1, ms: REVEAL_FADE_MS }));
      later(REVEAL_HOLD_MS + REVEAL_FADE_MS, () => apply({ color: DEEP, bri: FRAGE_BRI, ms: 1500 }));
      return;
    }
    // Den Farbwechsel im Dunkeln schicken wir direkt an jede Lampe (ohne Übergang): Einzelbefehle dürfen ~10× pro Sekunde,
    // Gruppenbefehle nur ~1× – so ist es nur einen Augenblick ganz dunkel, bevor das Blau wieder hochkommt.
    later(REVEAL_HOLD_MS, () => apply({ color: farbe, bri: 1, ms: REVEAL_FADE_MS },                  // langsam in der Antwortfarbe abdunkeln
      () => later(REVEAL_FADE_MS, () => {
        if (!live()) return;
        const c = xy(DEEP);
        for (const l of cfg.lights || []) queue(l.id, { color: { xy: c }, dimming: { brightness: 1 }, dynamics: { duration: 0 } });   // fast dunkel: Farbe springt
        later(120 * (cfg.lights || []).length + 80, () => apply({ color: DEEP, bri: FRAGE_BRI, ms: 1500 }));   // gleich danach ins normale dunkle Blau
      })));
  }
  if (phase === 'ident') {
    seqTimers.push(setTimeout(() => apply({ color: GOLD, bri: 100, ms: 100 }), 1250));
    seqTimers.push(setTimeout(() => apply({ color: VIOLET, bri: 35, ms: 1500 }), 2350));
  }
}
let seqTimers = [], seqGen = 0;
function clearSeq() { seqTimers.forEach(clearTimeout); seqTimers = []; seqGen++; }

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

// ---------- Lichtshow-Test: Hue Entertainment (verschlüsselter Lichtstream) ----------
// Prüft, ob der schnelle Weg zur Bridge klappt: Streaming starten, DTLS-Verbindung aufbauen, 5 Sekunden lang
// laufen die vier Antwortfarben über die Lampen (25 Bilder pro Sekunde), dann Streaming stoppen.
// Jeder Schritt steht im Protokoll („Hue-Lichtshow: …“). Braucht einen Unterhaltungsbereich aus der Hue-App.
let showLaeuft = false;
async function lichtshow() {
  if (showLaeuft) return { ok: false, text: 'Die Lichtshow läuft schon.' };
  if (strom || stromStart) return { ok: false, text: 'Gerade läuft ein Spiel mit Lichtstream – die Lichtshow geht nur in der Lobby.' };
  const t = cfg.target;
  if (!t || t.kind !== 'entertainment_configuration') return { ok: false, text: 'Für die Lichtshow einen Unterhaltungsbereich wählen („Anderen Bereich wählen“ › Entertainment-Bereiche). Den legst du in der Hue-App an.' };
  if (!cfg.clientKey) return { ok: false, text: 'Für die Lichtshow fehlt ein Schlüssel – bitte „Verbindung trennen“ und die Bridge neu verbinden.' };
  const log = s => console.log('Hue-Lichtshow: ' + s);
  const fehlerText = r => ((r.json && r.json.errors) || []).map(e => e.description).join(', ');
  const dtls = require('./hue-dtls');   // erst hier laden: wird nur für die Lichtshow gebraucht
  showLaeuft = true; stopTest();
  let s = null, gestartet = false, ms = 0;
  try {
    const r = await clip('GET', 'entertainment_configuration/' + t.id);
    const conf = r.json && r.json.data && r.json.data[0];
    if (!conf) throw new Error(`Bereich nicht gefunden (HTTP ${r.status}${fehlerText(r) ? ': ' + fehlerText(r) : ''})`);
    const kanaele = (conf.channels || []).map(c => c.channel_id);
    log(`Bereich „${t.name}“ mit ${kanaele.length} Kanälen`);
    if (!kanaele.length) throw new Error('Der Bereich hat keine Lampen');
    const st = await clip('PUT', 'entertainment_configuration/' + t.id, { action: 'start' });
    if (st.status !== 200) throw new Error(`Bridge lehnt den Start ab (HTTP ${st.status}${fehlerText(st) ? ': ' + fehlerText(st) : ''})`);
    gestartet = true; log('Streaming an der Bridge gestartet');
    const t0 = Date.now();
    s = await dtls.connect({ host: cfg.ip, identity: cfg.appKey, psk: Buffer.from(cfg.clientKey, 'hex') });
    ms = Date.now() - t0; log(`verschlüsselte Verbindung steht nach ${ms} ms`);
    // A–D wandern weich über die Lampen: jede Lampe blendet alle halbe Sekunde zur nächsten Antwortfarbe über
    const rgb = ANSWER.map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) * 257));
    for (let f = 0; f < 125; f++) {
      s.send(dtls.hueStream(t.id, f, kanaele.map((id, k) => {
        const p = (k + f / 12.5) % 4, a = rgb[Math.floor(p)], b = rgb[(Math.floor(p) + 1) % 4], w = p % 1;
        const m = i => Math.round(a[i] + (b[i] - a[i]) * w);
        return { id, r: m(0), g: m(1), b: m(2) };
      })));
      await new Promise(res => setTimeout(res, 40));
    }
    log('125 Bilder gesendet (5 Sekunden)');
    return { ok: true, text: `Lichtshow lief ✓ ${kanaele.length} Lampen, Verbindung nach ${ms} ms. Haben die Farben gewechselt?` };
  } catch (e) {
    log('Fehler – ' + e.message);
    return { ok: false, text: 'Lichtshow ging nicht: ' + e.message };
  } finally {
    if (s) s.close();
    if (gestartet) { await clip('PUT', 'entertainment_configuration/' + t.id, { action: 'stop' }).catch(() => {}); log('Streaming gestoppt'); }
    showLaeuft = false;
  }
}

module.exports = { status, discover, pair, targets, select, enable, forget, test, stopTest, testing, onPhase, lichtshow, setStream, setEffekt };
