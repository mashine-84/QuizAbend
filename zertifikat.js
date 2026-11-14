// Sichere Adresse (https) im Heim-WLAN – damit z. B. der Bildschirm am Handy zuverlässig anbleibt (Wake-Lock).
// Ablauf, alles automatisch auf dem Pi:
//   1. DuckDNS (kostenlos): Name wie „meinquiz.duckdns.org“ zeigt auf die Heimnetz-IP des Pi (wird bei Änderung nachgetragen).
//   2. Let's Encrypt stellt ein echtes Zertifikat aus. Nachweis per DNS-Eintrag bei DuckDNS (kein Port im Router nötig).
//      Das erledigt acme.sh (wird beim ersten Mal von GitHub geholt), erneuert wird alle 60 Tage.
//   3. Prüfen, ob der Name im Heimnetz auch auflöst (manche Router blockieren das: „DNS-Rebind-Schutz“).
// Im eigenen WLAN des Pi (Hotspot, ohne Internet) ruht das alles – dort bleibt es bei http://10.42.0.1.
const fs = require('fs'), path = require('path'), dns = require('dns'), { execFile } = require('child_process');

const APP = __dirname;
const CONFIG = path.join(APP, 'https.json');            // { name, token, ip, ipAt, error, … } (gitignored)
const DIR = path.join(APP, '.https');                   // acme.sh + Zertifikate (gitignored)
const ACME_SRC = path.join(DIR, 'acme.sh-src');
const ACME_HOME = path.join(DIR, 'acme');
const LOG = path.join(DIR, 'https.log');
const ACME_REPO = process.env.ACME_REPO || 'https://github.com/acmesh-official/acme.sh';
const DUCKDNS = process.env.DUCKDNS_URL || 'https://www.duckdns.org/update';
const RENEW_DAYS = 30;                                  // so viele Tage vor Ablauf erneuern

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) || {}; } catch (_) { cfg = {}; }
const save = () => { try { fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2)); fs.chmodSync(CONFIG, 0o600); } catch (e) { log('Einstellung nicht gespeichert: ' + e.message); } };

let env = { lanIp: () => null, hotspot: () => false, onCert: () => {} };   // vom Server gesetzt
let busy = null;            // was gerade läuft (Text fürs Handy)
let timer = null;

function log(line) {
  const t = new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  try { fs.mkdirSync(DIR, { recursive: true }); fs.appendFileSync(LOG, `${t}  ${line}\n`); } catch (_) {}
  console.log('  https:', line);
}
function logTail(n = 40) { try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(-n); } catch (_) { return []; } }
function trimLog() { try { const l = fs.readFileSync(LOG, 'utf8').split('\n'); if (l.length > 400) fs.writeFileSync(LOG, l.slice(-300).join('\n')); } catch (_) {} }

const host = () => cfg.name ? `${cfg.name}.duckdns.org` : null;
const certDir = () => path.join(ACME_HOME, `${host()}_ecc`);
const certFiles = () => ({ key: path.join(certDir(), `${host()}.key`), cert: path.join(certDir(), 'fullchain.cer') });

// Zertifikat lesen: { key, cert, validTo } oder null
function readCert() {
  if (!host()) return null;
  try {
    const f = certFiles(), key = fs.readFileSync(f.key), cert = fs.readFileSync(f.cert);
    const x = new (require('crypto').X509Certificate)(cert);
    if (!x.subjectAltName || !x.subjectAltName.includes(host())) return null;
    return { key, cert, validTo: new Date(x.validTo) };
  } catch (_) { return null; }
}

function run(cmd, args, opts = {}) {
  return new Promise(resolve => execFile(cmd, args, { timeout: opts.timeout || 600000, maxBuffer: 8 << 20, env: { ...process.env, ...(opts.env || {}) }, cwd: opts.cwd || APP },
    (err, out, errOut) => resolve({ ok: !err, code: err ? err.code : 0, text: ((out || '') + (errOut || '')).trim() })));
}

// einfacher GET (ohne fetch – das ist auf dem Node des Pi noch experimentell)
function get(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? require('https') : require('http');
    const req = mod.get(url, { timeout: 15000 }, res => { let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve(d)); });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
  });
}

// 1. DuckDNS: Name auf die Heimnetz-IP setzen (nur wenn sie sich geändert hat oder lange nicht gesetzt wurde)
async function updateIp(force) {
  const ip = env.lanIp();
  if (!ip || ip === 'localhost') return { ok: false, text: 'Keine Heimnetz-Adresse gefunden.' };
  if (!force && cfg.ip === ip && cfg.ipAt && Date.now() - Date.parse(cfg.ipAt) < 24 * 3600e3) return { ok: true };
  try {
    const t = (await get(`${DUCKDNS}?domains=${encodeURIComponent(cfg.name)}&token=${encodeURIComponent(cfg.token)}&ip=${ip}`)).trim();
    if (t !== 'OK') { log(`DuckDNS lehnt ab (${t || 'keine Antwort'}) – Name und Token prüfen.`); return { ok: false, text: 'DuckDNS lehnt ab – stimmen Name und Token?' }; }
    if (cfg.ip !== ip) log(`DuckDNS: ${host()} zeigt jetzt auf ${ip}`);
    cfg.ip = ip; cfg.ipAt = new Date().toISOString(); save();
    return { ok: true };
  } catch (e) {
    log('DuckDNS nicht erreichbar: ' + e.message);
    return { ok: false, text: 'DuckDNS nicht erreichbar – gibt es Internet?' };
  }
}

// 2. acme.sh holen (einmalig) und Zertifikat ausstellen / erneuern
async function ensureAcme() {
  if (fs.existsSync(path.join(ACME_SRC, 'acme.sh'))) return { ok: true };
  log('Hole acme.sh von GitHub …');
  fs.mkdirSync(DIR, { recursive: true });
  const r = await run('git', ['clone', '--depth', '1', ACME_REPO, ACME_SRC], { timeout: 180000 });
  if (!r.ok) { log('acme.sh konnte nicht geladen werden: ' + r.text.split('\n').slice(-1)[0]); return { ok: false, text: 'acme.sh konnte nicht geladen werden (Internet?).' }; }
  return { ok: true };
}
async function issue() {
  const a = await ensureAcme();
  if (!a.ok) return a;
  log(`Zertifikat für ${host()} anfordern (dauert 1–3 Minuten) …`);
  fs.mkdirSync(ACME_HOME, { recursive: true });
  const r = await run('bash', [path.join(ACME_SRC, 'acme.sh'), '--home', ACME_HOME, '--config-home', ACME_HOME, '--issue', '--dns', 'dns_duckdns',
    '-d', host(), '--server', 'letsencrypt', '--keylength', 'ec-256', '--days', String(90 - RENEW_DAYS), '--force', '--log', path.join(DIR, 'acme.log')],
    { cwd: ACME_SRC, env: { DuckDNS_Token: cfg.token } });
  const c = readCert();
  if (c) { log(`Zertifikat erhalten ✓ gültig bis ${c.validTo.toLocaleDateString('de-DE')}`); return { ok: true }; }
  const last = r.text.split('\n').filter(l => /error|fail|invalid|timeout|unauthor/i.test(l)).slice(-2).join(' ') || r.text.split('\n').slice(-2).join(' ');
  log('Zertifikat fehlgeschlagen: ' + (last || 'unbekannter Fehler'));
  return { ok: false, text: 'Zertifikat konnte nicht ausgestellt werden (Details im Protokoll).' };
}

// 3. Löst der Name im Heimnetz auf die IP des Pi auf? (über denselben DNS-Server wie die Handys: den Router)
async function dnsCheck() {
  const ip = env.lanIp();
  try {
    const r = await dns.promises.lookup(host(), { family: 4 });
    cfg.dns = { ok: r.address === ip, got: r.address, at: new Date().toISOString() };
  } catch (e) {
    cfg.dns = { ok: false, got: null, at: new Date().toISOString() };
  }
  save();
  return cfg.dns;
}

// Ein Durchlauf: IP nachtragen, Zertifikat bei Bedarf holen, DNS prüfen, Zertifikat an den Server geben
async function tick(opts = {}) {
  if (!host() || !cfg.token) return status();
  if (env.hotspot()) { busy = null; return status(); }
  if (busy) return status();
  try {
    busy = 'Adresse eintragen …';
    const ipr = await updateIp(opts.force);
    cfg.error = ipr.ok ? null : ipr.text;
    if (ipr.ok) {
      let c = readCert();
      // nach einem Fehlschlag frühestens nach einer Stunde erneut versuchen (Let's Encrypt begrenzt Fehlversuche)
      const waited = !cfg.failAt || Date.now() - Date.parse(cfg.failAt) > 3600e3;
      if ((!c || c.validTo - Date.now() < RENEW_DAYS * 864e5) && (waited || opts.reissue || opts.force)) {
        busy = 'Zertifikat anfordern … (1–3 Minuten)';
        const r = await issue();
        cfg.failAt = r.ok ? null : new Date().toISOString();
        if (!r.ok) cfg.error = r.text;
        c = readCert();
      } else if (!c && cfg.failAt) cfg.error = cfg.error || 'Letzter Versuch fehlgeschlagen – nächster Versuch in spätestens einer Stunde.';
      busy = 'Adresse prüfen …';
      const d = await dnsCheck();
      if (c && !d.ok) log(d.got ? `${host()} zeigt im Heimnetz auf ${d.got} statt ${env.lanIp()}.` : `${host()} lässt sich im Heimnetz nicht auflösen – blockiert der Router (DNS-Rebind-Schutz)?`);
      if (c) env.onCert(c);
    }
    save(); trimLog();
  } finally { busy = null; }
  return status();
}

function status() {
  const c = readCert();
  const ready = !!(c && cfg.dns && cfg.dns.ok && !env.hotspot());
  return { name: cfg.name || '', host: host(), token: !!cfg.token, ip: cfg.ip || null, lanIp: env.lanIp(), hotspot: !!env.hotspot(),
    validTo: c ? c.validTo.toISOString() : null, dns: cfg.dns || null, error: cfg.error || null, busy, ready, log: logTail() };
}

// Name + Token eintragen (Name ohne .duckdns.org); leerer Name = abschalten
async function set(name, token) {
  name = String(name || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.duckdns\.org\/?$/, '');
  token = String(token || '').trim();
  if (!name) return remove();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) return { ok: false, text: 'Der Name darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten (ohne .duckdns.org).' };
  if (!token && name === cfg.name && cfg.token) token = cfg.token;   // Token nicht erneut eingegeben: alten behalten
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return { ok: false, text: 'Der Token sieht nicht richtig aus – er steht bei DuckDNS oben (Format xxxxxxxx-xxxx-…).' };
  if (env.hotspot()) return { ok: false, text: 'Geht nur im Heim-WLAN (der Pi braucht Internet).' };
  const changed = name !== cfg.name;
  cfg = { name, token };
  save();
  log(`Eingerichtet: ${host()}`);
  tick({ force: true, reissue: changed }).catch(e => log('Fehler: ' + e.message));
  return { ok: true, started: true };
}
function remove() {
  cfg = {}; save();
  try { fs.rmSync(ACME_HOME, { recursive: true, force: true }); } catch (_) {}
  log('Sichere Adresse entfernt.');
  env.onCert(null);
  return { ok: true, removed: true };
}

// Start: Zertifikat sofort laden (falls vorhanden), dann regelmäßig prüfen (IP alle 5 Minuten, Rest bei Bedarf)
function start(e) {
  env = { ...env, ...e };
  const c = readCert();
  if (c) env.onCert(c);
  clearInterval(timer);
  timer = setInterval(() => tick().catch(err => log('Fehler: ' + err.message)), 5 * 60000);
  setTimeout(() => tick().catch(err => log('Fehler: ' + err.message)), 5000);
}

module.exports = { start, set, remove, status, tick, readCert, host };
