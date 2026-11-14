// Fragen-Repo: Die Fragenpakete liegen in einem eigenen Git-Repo (z. B. privat auf GitHub).
// Der Pi klont es nach fragen/_repo und aktualisiert es bei „Update holen“. Für private Repos erzeugt der Pi
// einen eigenen Schlüssel – dessen öffentlichen Teil trägt man im Repo als „Deploy key“ (nur lesen) ein.
// Wechselt man das Repo, wird die alte Kopie gelöscht (im Repo selbst geht nichts verloren).
const fs = require('fs'), path = require('path'), { execFile } = require('child_process');

const APP = __dirname;
const DIR = path.join(APP, 'fragen', '_repo');            // Kopie des Fragen-Repos (gitignored)
const CONFIG = path.join(APP, 'fragen-quelle.json');      // { url, updated, commit, error } (gitignored)
const KEY = path.join(APP, '.fragen-key');                // privater Schlüssel, verlässt den Pi nie (gitignored)
const KNOWN = path.join(APP, '.fragen-known_hosts');

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')) || {}; } catch (_) { cfg = {}; }
const save = () => { try { fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2)); } catch (e) { console.log('  Fragen-Repo: Einstellung nicht gespeichert:', e.message); } };
let busy = false;

function git(args, cwd, opts = {}) {
  return new Promise(resolve => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo',
      GIT_SSH_COMMAND: `ssh -i "${KEY}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${KNOWN}" -o BatchMode=yes -o ConnectTimeout=15` };
    execFile('git', args, { cwd: cwd || APP, env, timeout: opts.timeout || 180000, maxBuffer: 4 << 20 }, (err, out, errOut) =>
      resolve({ ok: !err, text: ((out || '') + (errOut || '')).trim() }));
  });
}

// https://github.com/owner/repo(.git) <-> git@github.com:owner/repo.git
function normalize(url) {
  url = String(url || '').trim().replace(/\/+$/, '');
  const m = url.match(/^(?:https?:\/\/)?(?:www\.)?github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i) || url.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
  if (m) return { https: `https://github.com/${m[1]}/${m[2]}.git`, ssh: `git@github.com:${m[1]}/${m[2]}.git`, name: `${m[1]}/${m[2]}`, web: `https://github.com/${m[1]}/${m[2]}` };
  // andere Git-Server (und file:// zum Testen): Adresse so verwenden, wie sie ist
  if (/^(https?:\/\/|git@|ssh:\/\/|file:\/\/)\S+$/.test(url)) return { https: /^(https?|file):/.test(url) ? url : null, ssh: /^(git@|ssh:)/.test(url) ? url : null, name: url, web: null };
  return null;
}

// Fehlermeldungen von git in Klartext
function explain(text) {
  if (/Permission denied \(publickey\)|Repository not found|could not read Username|Authentication failed|access rights|terminal prompts disabled/i.test(text))
    return 'Kein Zugriff. Bei einem privaten Repo den Schlüssel unten im Repo unter Settings › Deploy keys eintragen (nur lesen), dann erneut versuchen.';
  if (/Could not resolve host|unable to access|Network is unreachable|timed out|Connection refused/i.test(text))
    return 'Keine Internetverbindung zu GitHub. Später mit „Fragen aktualisieren“ erneut versuchen.';
  return text.split('\n').filter(Boolean).slice(-2).join(' ') || 'Unbekannter Fehler';
}

function publicKey() { try { return fs.readFileSync(KEY + '.pub', 'utf8').trim(); } catch (_) { return null; } }
async function ensureKey() {
  if (publicKey()) return { ok: true };
  return new Promise(resolve => execFile('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'quizabend-pi', '-f', KEY], (err, out, errOut) => {
    if (err) return resolve({ ok: false, text: err.code === 'ENOENT' ? 'ssh-keygen fehlt auf dem Pi (Paket openssh-client).' : 'Schlüssel konnte nicht erzeugt werden: ' + (errOut || err.message) });
    try { fs.chmodSync(KEY, 0o600); } catch (_) {}
    resolve({ ok: true });
  }));
}

async function commitInfo() {
  const r = await git(['log', '-1', '--format=%h · %cd · %s', '--date=format:%d.%m.%Y %H:%M'], DIR);
  return r.ok ? r.text : null;
}

// Klonen: erst https (öffentliche Repos), sonst per Schlüssel (private Repos)
async function clone(n) {
  fs.rmSync(DIR, { recursive: true, force: true });
  let last = '';
  for (const url of [n.https, publicKey() && n.ssh].filter(Boolean)) {
    const r = await git(['clone', '--depth', '1', url, DIR]);
    if (r.ok) return { ok: true };
    last = r.text; fs.rmSync(DIR, { recursive: true, force: true });
  }
  return { ok: false, text: explain(last || 'Kein passender Zugriffsweg – bei privaten Repos zuerst den Schlüssel erzeugen.') };
}

async function finish(res) {
  cfg.error = res.ok ? null : res.text;
  if (res.ok) { cfg.updated = new Date().toISOString(); cfg.commit = await commitInfo(); }
  save();
  return res;
}

// Neues Repo eintragen (ersetzt das alte) oder mit leerer URL entfernen
async function set(url) {
  if (busy) return { ok: false, text: 'Läuft schon …' };
  if (!String(url || '').trim()) { cfg = {}; save(); fs.rmSync(DIR, { recursive: true, force: true }); return { ok: true, removed: true }; }
  const n = normalize(url);
  if (!n) return { ok: false, text: 'Das sieht nicht nach einer Repo-Adresse aus – z. B. https://github.com/name/QuizAbend-Fragen' };
  busy = true;
  try {
    cfg = { url: n.web || url };
    const res = await clone(n);
    return finish(res);
  } finally { busy = false; }
}

// Aktualisieren (bei „Update holen“ und per Knopf). changed = es gab neue Fragen
async function update() {
  if (!cfg.url) return { ok: true, none: true };
  if (busy) return { ok: false, text: 'Läuft schon …' };
  busy = true;
  try {
    const n = normalize(cfg.url);
    if (!n) return finish({ ok: false, text: 'Ungültige Repo-Adresse' });
    if (!fs.existsSync(path.join(DIR, '.git'))) return finish({ ...(await clone(n)), changed: true });
    const before = await commitInfo();
    // Die Kopie ist nur ein Spiegel: neuesten Stand holen und genau darauf setzen (auch wenn der Verlauf umgeschrieben wurde)
    const pull = () => git(['fetch', '--depth', '1', 'origin', 'HEAD'], DIR).then(r => r.ok ? git(['reset', '--hard', 'FETCH_HEAD'], DIR) : r);
    let r = await pull();
    if (!r.ok && n.ssh && publicKey()) {   // z. B. inzwischen privat: auf den Schlüssel umstellen
      await git(['remote', 'set-url', 'origin', n.ssh], DIR);
      r = await pull();
    }
    if (!r.ok) return finish({ ok: false, text: explain(r.text) });
    return finish({ ok: true, changed: (await commitInfo()) !== before });
  } finally { busy = false; }
}

function status() {
  return { url: cfg.url || null, present: fs.existsSync(path.join(DIR, '.git')), updated: cfg.updated || null, commit: cfg.commit || null,
    error: cfg.error || null, publicKey: publicKey(), busy };
}

module.exports = { set, update, status, ensureKey, DIR };
