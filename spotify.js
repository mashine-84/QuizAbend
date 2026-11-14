// Spotify Connect: Musik läuft auf einem Spotify-Gerät im Heimnetz (z. B. Yamaha-Receiver), das Quiz steuert nur
// „Pause“ und „Weiter“ über die offizielle Spotify-Schnittstelle (Web API). Der Pi spielt selbst keine Spotify-Musik ab.
//   - Läuft während des Spiels; pausiert, wenn das Quiz eigene Musik hat (Opener, Intro, Blockseite, Blockpause, Siegerehrung)
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
let bgSaved = null;          // Hintergrundmusik vor einer Spotify-Musikfrage: { context, item, pos }
let snippetPlayed = false;   // seit der letzten Hintergrundmusik lief ein Fragen-Ausschnitt (nicht einfach „weiter“ spielen)
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
// Spotify-Link zu einem Song → spotify:track:ID (oder null)
function trackUri(link) {
  const m = String(link || '').trim().match(/(?:open\.spotify\.com\/(?:intl-\w+\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/);
  return m ? `spotify:track:${m[1]}` : null;
}
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
  // Nach einer Spotify-Musikfrage: die gemerkte Hintergrundmusik an derselben Stelle fortsetzen
  if (bgSaved) {
    const b = bgSaved; bgSaved = null; snippetPlayed = false;
    const body = b.context ? { context_uri: b.context, offset: { uri: b.item }, position_ms: b.pos } : { uris: [b.item], position_ms: b.pos };
    const r = await api('PUT', '/me/player/play' + q, body);
    if ([200, 202, 204].includes(r.status)) return { ok: true };
    log('Hintergrundmusik nicht fortgesetzt: ' + errText(r));
  }
  // Weiterspielen; gibt es nichts zum Weiterspielen (oder ist es der Spielstart mit Playlist), die Playlist starten.
  // Lief zuletzt ein Fragen-Ausschnitt, nicht „weiter“ (das wäre der Rest des Fragen-Songs) – dann nur die Playlist.
  if (snippetPlayed && !cfg.playlist) return { ok: true, skipped: true };
  let r = (opts.start || snippetPlayed) && cfg.playlist ? { status: 0 } : await api('PUT', '/me/player/play' + q);
  snippetPlayed = false;
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

// ---------- Spotify-Musikfrage: Ausschnitt eines Songs auf dem Gerät abspielen ----------
// opts: { start, dauer, repeat, gap } in Sekunden. Läuft in derselben Warteschlange wie Pause/Weiter.
// Vorher wird die Hintergrundmusik (Playlist + Stelle) gemerkt, danach geht sie dort weiter.
const wait = ms => new Promise(r => setTimeout(r, ms));
function snippet(uri, opts, stillWanted = () => true) {
  const job = queue.then(async () => {
    const id = await deviceId();
    if (!id) { log('Musikfrage: Gerät nicht gefunden'); return { ok: false }; }
    const st = await api('GET', '/me/player');
    if (!bgSaved && st.status === 200 && st.data && st.data.item && st.data.item.uri !== uri && (st.data.is_playing || pausedByUs))
      bgSaved = { context: st.data.context && st.data.context.uri || null, item: st.data.item.uri, pos: st.data.progress_ms || 0 };
    if (st.status === 200 && st.data && st.data.is_playing) await api('PUT', '/me/player/pause');
    const q = `?device_id=${encodeURIComponent(id)}`;
    const n = opts.repeat || 1, len = (opts.dauer || 10) * 1000, gap = (opts.gap ?? 2.5) * 1000;
    snippetPlayed = true;
    log(`Musikfrage: ${uri} ab ${opts.start || 0} s, ${len / 1000} s${n > 1 ? `, ${n}×` : ''}`);
    for (let k = 0; k < n; k++) {
      if (!stillWanted()) break;
      const r = await api('PUT', '/me/player/play' + q, { uris: [uri], position_ms: Math.round((opts.start || 0) * 1000) });
      if (![200, 202, 204].includes(r.status)) { log('Musikfrage ging nicht: ' + errText(r)); return { ok: false }; }
      await wait(len);
      await api('PUT', '/me/player/pause');
      if (k < n - 1) await wait(gap);
    }
    current = 'pause';
    if (bgSaved) pausedByUs = true;
    return { ok: true };
  }).catch(e => { log('Musikfrage: ' + e.message); return { ok: false }; });
  queue = job.then(() => {});
  return job;
}

// ---------- Spielphasen ----------
// Quiz hat eigene Musik/Ton: Spotify pausieren. Sonst (während des Spiels) spielen. Lobby: nicht eingreifen.
const PAUSE_PHASES = new Set(['ident', 'opening', 'block', 'pause', 'media', 'end']);   // block: Blockseite mit eigenem Jingle
const PLAY_PHASES = new Set(['intro', 'preview', 'question', 'locked', 'special', 'votes', 'reveal', 'scores', 'tiebreak']);
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

module.exports = { start, status, setClientId, loginUrl, callback, devices, selectDevice, setPlaylist, enable, forget, test, onPhase, snippet, ready, trackUri };
