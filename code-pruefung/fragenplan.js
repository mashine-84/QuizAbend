// Fragenplan im Pub-Quiz: Nach einem gespielten Pub-Quiz muss der nächste Plan neu gezogen werden
// (sonst kommt dasselbe Spiel noch einmal). Ein Plan, der noch nicht angespielt wurde, bleibt dagegen stehen.
// Aufruf: node code-pruefung/fragenplan.js   Ändert nichts am Projekt selbst.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const B = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fehler = 0;
const ok = (bed, text) => { console.log((bed ? '  ✓ ' : '  ✗ ') + text); if (!bed) fehler++; };

const OHNE = new Set(['.git', 'node_modules', 'einstellungen.json', 'verlauf.json', 'hue.json', 'fragen-quelle.json', '.fragen-key', '.fragen-key.pub', '.fragen-known_hosts', '_repo']);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quizabend-'));
fs.cpSync(ROOT, TMP, { recursive: true, filter: src => !OHNE.has(path.basename(src)) && !src.startsWith(path.join(ROOT, 'code-pruefung')) });

// 30 einfache Fragen – genug, damit zwei Pläne à 4 Fragen ganz verschieden sein können
const testpaket = { paket: 'Fragenplan', fragen: Array.from({ length: 30 }, (_, i) => (
  { kategorie: 'Test', frage: `Testfrage ${i + 1}?`, antworten: ['Richtig', 'Falsch A', 'Falsch B', 'Falsch C'], schwierigkeit: 1 + i % 3 })) };
fs.mkdirSync(path.join(TMP, 'fragen', 'Fragenplan'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'fragen', 'Fragenplan', 'Fragenplan.json'), JSON.stringify(testpaket, null, 2));

let log = '';
const srv = spawn(process.execPath, ['server.js'], { cwd: TMP, env: { ...process.env, PORT: String(PORT), NO_BROWSER: '1', SEKUNDEN: '5' } });
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
let beendet = false;
srv.on('exit', code => { beendet = true; if (code) log += `\n[Server beendet mit Code ${code}]`; });

const post = (p, b) => fetch(B + p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json().then(d => [r.status, d]));
function sse(query, onView) {
  const ctl = new AbortController();
  fetch(B + '/events?' + query, { signal: ctl.signal }).then(async r => {
    const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await rd.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let k;
      while ((k = buf.indexOf('\n\n')) >= 0) {
        const line = buf.slice(0, k).split('\n').find(l => l.startsWith('data: ')); buf = buf.slice(k + 2);
        if (line && onView) try { onView(JSON.parse(line.slice(6))); } catch (_) {}
      }
    }
  }).catch(() => {});
  return ctl;
}
const warte = async (bed, ms = 30000) => { const t = Date.now(); while (!bed() && Date.now() - t < ms) await sleep(80); return bed(); };

(async () => {
  try {
    for (let i = 0; i < 100; i++) { try { await fetch(B + '/api/pakete'); break; } catch (_) { await sleep(100); } }
    const tv = { view: null };
    const verb = [sse('role=tv', v => { tv.view = v; })];
    const ids = [];
    for (const [name, avatar] of [['Gina', '🦊'], ['Ben', '🐼'], ['Cleo', '🐸']]) {
      const [, d] = await post('/api/join', { name, avatar });
      ids.push(d.id); verb.push(sse('id=' + d.id));
    }
    const host = ids[0];
    await sleep(400);

    const d = await (await fetch(B + '/api/pakete')).json();
    const settings = { ...d.settings, blocks: [{ count: 4, disabled: [] }], pause: { on: false, minutes: 10 }, pub: { on: true } };
    const [st] = await post('/api/einstellungen', { id: host, settings });
    ok(st === 200, 'Pub-Quiz eingeschaltet');

    const plan = async () => { const [, r] = await post('/api/plan', { id: host, action: 'get' }); return (r.items || []).map(x => x.uid); };
    const p1 = await plan();
    ok(p1.length === 4, `Fragenplan gezogen (${p1.length} Fragen)`);
    ok(JSON.stringify(await plan()) === JSON.stringify(p1), 'Noch nicht gespielt: Der Plan bleibt beim erneuten Öffnen gleich');

    // Spiel starten, bis die erste Frage läuft (damit zählt sie als gespielt), dann vorzeitig beenden
    for (const id of ids) await post('/api/bereit', { id });
    await sleep(200);
    await post('/api/advance', { id: host });
    await warte(() => tv.view && tv.view.phase !== 'lobby', 5000);
    ok(await warte(() => tv.view && tv.view.phase === 'question' || (tv.view && tv.view.phase !== 'lobby' && post('/api/advance', { role: 'tv' }) && false), 30000),
      'Pub-Quiz gestartet, erste Frage läuft');
    await post('/api/host', { id: host, action: 'end' });
    await warte(() => tv.view && tv.view.phase === 'end', 5000);
    await post('/api/advance', { role: 'tv' });
    ok(await warte(() => tv.view && tv.view.phase === 'lobby', 10000), 'Zurück in der Lobby');
    await sleep(1800);   // Verlauf wird verzögert gespeichert

    const p2 = await plan();
    ok(p2.length === 4, `Neuer Fragenplan gezogen (${p2.length} Fragen)`);
    ok(JSON.stringify(p2) !== JSON.stringify(p1), 'Nach dem Spiel ist es nicht mehr derselbe Plan');
    ok(!p2.includes(p1[0]), 'Die gespielte erste Frage ist im neuen Plan nicht mehr dabei');
    // Nur die erste Frage wurde gespielt – die anderen drei des alten Plans sind noch frisch und dürfen wiederkommen.

    verb.forEach(c => c.abort());
  } catch (e) {
    ok(false, 'Unerwarteter Fehler im Test: ' + (e.stack || e));
  }
  const absturz = /(TypeError|ReferenceError|SyntaxError|RangeError|Unhandled|uncaught)/i.test(log) || beendet;
  ok(!absturz, 'Keine Fehler im Server-Protokoll');
  if (absturz || fehler) console.log('\n--- Server-Protokoll ---\n' + log.slice(-4000));
  srv.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.` : '\nAlles in Ordnung.');
  process.exit(fehler ? 1 : 0);
})();
