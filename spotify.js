// Spotify Connect: Musik läuft auf einem Spotify-Gerät im Heimnetz (z. B. Yamaha-Receiver), das Quiz steuert nur
// „Pause“ und „Weiter“ über die offizielle Spotify-Schnittstelle (Web API). Der Pi spielt selbst keine Spotify-Musik ab.
//   - Läuft während des Spiels; pausiert, wenn das Quiz eigene Musik hat (Opener, Intro, Blockpause, Siegerehrung)
//     und bei Musik-/Filmfragen (solange Ton/Video läuft) – danach geht es weiter.
//   - Braucht Spotify Premium, eine eigene (kostenlose) Spotify-App des Besitzers und die sichere Adresse (https):
//     Spotify leitet nach dem Anmelden nur an https-Adressen zurück.
//   - Im eigenen WLAN des Pi (kein Internet) ist Spotify abgeschaltet.
// Zugangsdaten in spotify.json (nicht in Git). Anmeldung per „Authorization Code mit PKCE“ – kein geheimer Schlüssel nötig.
'use strict';
const https = require('https'), http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const FILE = path.join(__dirname, 'spotify.json');
const ACCOUNTS = process.env.SPOTIFY_ACCOUNTS || 'https://accounts.spotify.com';
const API = process.env.SPOTIFY_API || 'https://api.spotify.com/v1';
const SCOPES = 'user-read-playback-state user-modify-playback-state';
const LOG_MAX = 60;

let cfg = load();
let env = { hotspot: () => false };
let pending = null;          // laufende Anmeldung: { state, verifier, redirect, at }
let want = null;             // was das Spiel gerade möchte: 'play' | 'pause' | null (nicht eingreifen)
let current = null;          // was wir zuletzt geschickt haben
let pausedByUs = false;      // nur fortsetzen, was wir selbst angehalten haben (oder zu Spielbeginn starten)
let queue = Promise.resolve();
const logLines = [];

function load() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (_) { return {}; } }
function save() { try { fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2)); fs.chmodSync(FILE, 0o600); } catch (e) { log('Konnte spotify.json nicht speichern: ' + e.message); } }
function log(line) {
  const t = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  logLines.push(`${t}  ${line}`); if (logLines.length > LOG_MAX) logLines.shift();
  console.log('  Spotify:', line);
}

// ---------- HTTP ----------
function request(method, url, { form, json, token, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), mod = u.protocol === 'https:' ? https : http;
    const body = form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : null;
    const headers = { ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : json ? { 'Content-Type': 'application/json' } : {}),
      'Content-Length': body ? Buffer.byteLength(body) : 0 };
    const req = mod.request(u, { method, headers, timeout }, res => {
      let buf = ''; res.on('data', c => { buf += c; });
      res.on('end', () => { let data = null; try { data = buf ? JSON.parse(buf) : null; } catch (_) {} resolve({ status: res.statusCode, data, retry: Number(res.headers['retry-after']) || 0 }); });
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------- Anmeldung (PKCE) ----------
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function setClientId(id) {
  id = String(id || '').trim();
  if (!/^[0-9a-f]{32}$/i.test(id)) return { ok: false, text: 'Die Client ID sieht nicht richtig aus – 32 Zeichen aus 0–9 und a–f, steht im Spotify-Dashboard bei deiner App.' };
  if (id !== cfg.clientId) cfg = { clientId: id, enabled: cfg.enabled !== false };
  save();
  return { ok: true };
}
// Adresse für „Mit Spotify verbinden“ (redirect = https://<sichere Adresse>/spotify/callback)
function loginUrl(redirect) {
  if (!cfg.clientId) return null;
  const verifier = b64url(crypto.randomBytes(48));
  pending = { state: b64url(crypto.randomBytes(16)), verifier, redirect, at: Date.now() };
  const q = new URLSearchParams({ client_id: cfg.clientId, response_type: 'code', redirect_uri: redirect, scope: SCOPES, state: pending.state,
    code_challenge_method: 'S256', code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) });
  return `${ACCOUNTS}/authorize?${q}`;
}
async function callback(params) {
  if (params.error) return { ok: false, text: params.error === 'access_denied' ? 'Anmeldung abgebrochen.' : 'Spotify meldet: ' + params.error };
  if (!pending || params.state !== pending.state || Date.now() - pending.at > 15 * 60000) return { ok: false, text: 'Die Anmeldung ist abgelaufen – in den Einstellungen bitte erneut „Mit Spotify verbinden“ tippen.' };
  const p = pending; pending = null;
  try {
    const r = await request('POST', `${ACCOUNTS}/api/token`, { form: { grant_type: 'authorization_code', code: params.code, redirect_uri: p.redirect, client_id: cfg.clientId, code_verifier: p.verifier } });
    if (r.status !== 200 || !r.data || !r.data.access_token) return { ok: false, text: 'Spotify hat die Anmeldung nicht bestätigt' + (r.data && r.data.error_description ? ': ' + r.data.error_description : '.') };
    cfg.refresh = r.data.refresh_token; cfg.access = r.data.access_token; cfg.expires = Date.now() + (r.data.expires_in - 60) * 1000;
    const me = await api('GET', '/me');
    cfg.user = me.data && (me.data.display_name || me.data.id) || null;
    cfg.product = me.data && me.data.product || null;
    save();
    log(`Verbunden als ${cfg.user || 'unbekannt'}${cfg.product && cfg.product !== 'premium' ? ' (kein Premium – Steuerung nicht möglich)' : ''}`);
    return { ok: true, user: cfg.user };
  } catch (e) { return { ok: false, text: 'Spotify nicht erreichbar: ' + e.message }; }
}

async function token() {
  if (cfg.access && Date.now() < cfg.expires) return cfg.access;
  if (!cfg.refresh) return null;
  const r = await request('POST', `${ACCOUNTS}/api/token`, { form: { grant_type: 'refresh_token', refresh_token: cfg.refresh, client_id: cfg.clientId } });
  if (r.status !== 200 || !r.data || !r.data.access_token) {
    if (r.status === 400) { log('Anmeldung abgelaufen – bitte in den Einstellungen neu verbinden.'); cfg.refresh = null; cfg.access = null; save(); }
    return null;
  }
  cfg.access = r.data.access_token; cfg.expires = Date.now() + (r.data.expires_in - 60) * 1000;
  if (r.data.refresh_token) cfg.refresh = r.data.refresh_token;   // bei PKCE gibt es jedes Mal einen neuen
  save();
  return cfg.access;
}
async function api(method, p, json) {
  const t = await token();
  if (!t) return { status: 401, data: null };
  let r = await request(method, API + p, { token: t, json });
  if (r.status === 429 && r.retry && r.retry < 5) { await new Promise(res => setTimeout(res, r.retry * 1000)); r = await request(method, API + p, { token: t, json }); }
  return r;
}
const errText = r => {
  const reason = r.data && r.data.error && (r.data.error.reason || r.data.error.message);
  if (r.status === 401) return 'Nicht angemeldet.';
  if (r.status === 403) return reason === 'PREMIUM_REQUIRED' ? 'Dafür braucht es Spotify Premium.' : 'Spotify erlaubt das nicht' + (reason ? ` (${reason})` : '') + '.';
  if (r.status === 404) return 'Gerät nicht erreichbar – ist der Receiver an und im Netz?';
  return `Spotify-Fehler ${r.status}${reason ? ' (' + reason + ')' : ''}`;
};

// ---------- Geräte, Wiedergabe ----------
async function devices() {
  const r = await api('GET', '/me/player/devices');
  if (r.status !== 200) return { ok: false, text: errText(r) };
  return { ok: true, devices: (r.data.devices || []).map(d => ({ id: d.id, name: d.name, type: d.type, active: d.is_active, volume: d.supports_volume })) };
}
function selectDevice(id, name) { cfg.device = { id: String(id || ''), name: String(name || '') }; save(); log(`Gerät: ${cfg.device.name}`); return { ok: true }; }
function setPlaylist(link) {
  link = String(link || '').trim();
  if (!link) { cfg.playlist = null; save(); return { ok: true }; }
  const m = link.match(/(?:open\.spotify\.com\/(?:intl-\w+\/)?|spotify:)(playlist|album)[/:]([A-Za-z0-9]+)/);
  if (!m) return { ok: false, text: 'Bitte einen Spotify-Link zu einer Playlist oder einem Album einfügen (Teilen › Link kopieren).' };
  cfg.playlist = `spotify:${m[1]}:${m[2]}`; save();
  return { ok: true };
}
function enable(on) { cfg.enabled = !!on; save(); if (!on) want = null; return { ok: true }; }

// Gerät finden (die ID kann sich ändern, wenn der Receiver neu startet – dann über den Namen)
async function deviceId() {
  if (!cfg.device) return null;
  const d = await devices();
  if (!d.ok) return cfg.device.id || null;
  const hit = d.devices.find(x => x.id === cfg.device.id) || d.devices.find(x => x.name === cfg.device.name);
  if (hit && hit.id !== cfg.device.id) { cfg.device.id = hit.id; save(); }
  return hit ? hit.id : null;
}
async function play(opts = {}) {
  const id = await deviceId();
  if (!id) { log(`${cfg.device ? cfg.device.name : 'Gerät'} nicht gefunden – ist es an?`); return { ok: false, text: 'Gerät nicht gefunden – ist der Receiver an?' }; }
  const q = `?device_id=${encodeURIComponent(id)}`;
  // Weiterspielen; gibt es nichts zum Weiterspielen (oder ist es der Spielstart mit Playlist), die Playlist starten
  let r = opts.start && cfg.playlist ? { status: 0 } : await api('PUT', '/me/player/play' + q);
  if (r.status !== 204 && r.status !== 202 && r.status !== 200 && cfg.playlist) r = await api('PUT', '/me/player/play' + q, { context_uri: cfg.playlist });
  if ([200, 202, 204].includes(r.status)) return { ok: true };
  log('Abspielen ging nicht: ' + errText(r));
  return { ok: false, text: errText(r) };
}
async function pause() {
  const st = await api('GET', '/me/player');
  if (st.status === 204 || !st.data || !st.data.is_playing) return { ok: true, wasPlaying: false };   // läuft nichts: nichts zu tun
  if (cfg.device && st.data.device && st.data.device.id !== cfg.device.id && st.data.device.name !== cfg.device.name) return { ok: true, wasPlaying: false };   // spielt woanders: nicht eingreifen
  const r = await api('PUT', '/me/player/pause');
  if ([200, 202, 204].includes(r.status)) return { ok: true, wasPlaying: true };
  log('Pausieren ging nicht: ' + errText(r));
  return { ok: false, text: errText(r) };
}

const ready = () => !!(cfg.refresh && cfg.device && cfg.enabled !== false && !env.hotspot());

// ---------- Spielphasen ----------
// Quiz hat eigene Musik/Ton: Spotify pausieren. Sonst (während des Spiels) spielen. Lobby: nicht eingreifen.
const PAUSE_PHASES = new Set(['ident', 'opening', 'pause', 'media', 'end']);
const PLAY_PHASES = new Set(['block', 'intro', 'preview', 'question', 'locked', 'special', 'votes', 'reveal', 'scores', 'tiebreak']);
let gameStarted = false;
// info.sound: in der Medien-Phase läuft Ton oder Video (beim Merkbild nicht – dann weiterspielen)
function onPhase(phase, info = {}) {
  if (!ready()) return;
  if (phase === 'lobby') { gameStarted = false; pausedByUs = false; want = current = null; return; }
  if (phase === 'media' && !info.sound) phase = 'question';
  const next = PAUSE_PHASES.has(phase) ? 'pause' : PLAY_PHASES.has(phase) ? 'play' : null;
  if (!next || next === want) return;
  want = next;
  // nacheinander abarbeiten, kurz warten: schnelle Phasenwechsel (Überspringen) schicken nur den letzten Stand
  queue = queue.then(() => new Promise(r => setTimeout(r, 400))).then(async () => {
    if (want === current || !ready()) return;
    const target = want;
    try {
      if (target === 'pause') {
        const r = await pause();
        if (r.ok) { current = 'pause'; if (r.wasPlaying) { pausedByUs = true; log('Pause (Quiz spielt eigenen Ton)'); } }
      } else {
        // fortsetzen nur, wenn wir selbst angehalten haben – oder einmal zu Spielbeginn starten
        if (!pausedByUs && gameStarted) { current = 'play'; return; }
        // Spielbeginn: lief vorher schon Musik (und wir haben sie für den Opener angehalten), die fortsetzen –
        // sonst die eingestellte Playlist starten (oder das Letzte fortsetzen)
        const start = !gameStarted && !pausedByUs;
        gameStarted = true;
        const r = await play({ start });
        if (r.ok) { current = 'play'; pausedByUs = false; log(start ? 'Musik zum Spielstart' : 'Weiter'); }
      }
    } catch (e) { log('Nicht erreichbar: ' + e.message); }
  });
}

function status() {
  return { clientId: cfg.clientId || '', connected: !!cfg.refresh, user: cfg.user || null, product: cfg.product || null, device: cfg.device || null,
    playlist: cfg.playlist || null, enabled: cfg.enabled !== false, blocked: !!env.hotspot(), log: logLines.slice(-30) };
}
function forget() { cfg = { clientId: cfg.clientId, enabled: true }; save(); want = current = null; log('Verbindung getrennt.'); return { ok: true }; }
async function test(action) { return action === 'pause' ? pause() : play({ start: true }); }
function start(e) { env = { ...env, ...e }; }

module.exports = { start, status, setClientId, loginUrl, callback, devices, selectDevice, setPlaylist, enable, forget, test, onPhase };
