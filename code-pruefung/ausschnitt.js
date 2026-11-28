// Bildausschnitt ("ausschnitt") und Aufdecken ("aufdecken"): Einlesen, Fehlermeldungen und was der Fernseher bekommt.
// Startet den Server in einer Kopie mit eigenem Testpaket. Aufruf: node code-pruefung/ausschnitt.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3700 + Math.floor(Math.random() * 90);
const B = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fehler = 0;
const ok = (bed, text) => { console.log((bed ? '  ✓ ' : '  ✗ ') + text); if (!bed) fehler++; };

const OHNE = new Set(['.git', 'node_modules', 'einstellungen.json', 'verlauf.json', 'hue.json', 'fragen-quelle.json', '.fragen-key', '.fragen-key.pub', '.fragen-known_hosts', '_repo', 'code-pruefung']);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quizabend-'));
fs.cpSync(ROOT, TMP, { recursive: true, filter: src => !OHNE.has(path.basename(src)) });

const BILD = path.join(ROOT, 'fragen', 'Technik-Test', 'bilder', 'formen.png');
const paket = (name, fragen) => {
  fs.mkdirSync(path.join(TMP, 'fragen', name, 'bilder'), { recursive: true });
  fs.copyFileSync(BILD, path.join(TMP, 'fragen', name, 'bilder', 'formen.png'));
  fs.writeFileSync(path.join(TMP, 'fragen', name, name + '.json'), JSON.stringify({ paket: name, fragen }));
};
const auswahl = { antworten: ['Stern', 'Kreis', 'Quadrat', 'Dreieck'], schwierigkeit: 1, kategorie: 'Test' };
paket('Gut', [{ frage: 'Welche Form?', bild: 'formen.png', ausschnitt: [80, 18, 16, 25], aufdecken: true, ...auswahl }]);
// Jede dieser Fragen muss abgelehnt werden
const kaputt = [
  [{ frage: 'Ohne Bild?', ausschnitt: [0, 0, 50, 50], ...auswahl }, '"ausschnitt" braucht ein "bild"'],
  [{ frage: 'Zu groß?', bild: 'formen.png', ausschnitt: [60, 0, 50, 50], ...auswahl }, 'muss im Bild liegen'],
  [{ frage: 'Drei Zahlen?', bild: 'formen.png', ausschnitt: [10, 10, 20], ...auswahl }, '[x, y, Breite, Höhe]'],
  [{ frage: 'Aufdecken ohne Ausschnitt?', bild: 'formen.png', aufdecken: true, ...auswahl }, '"aufdecken" braucht einen "ausschnitt"'],
  [{ frage: 'Merkbild?', bild: 'formen.png', merken: 5, ausschnitt: [0, 0, 50, 50], ...auswahl }, '"merken" geht nicht zusammen mit "ausschnitt"'],
];
kaputt.forEach(([q], i) => paket('Kaputt' + i, [q]));

let log = '';
const srv = spawn(process.execPath, ['server.js'], { cwd: TMP, env: { ...process.env, PORT: String(PORT), NO_BROWSER: '1', SEKUNDEN: '8' } });
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

(async () => {
  try {
    for (let i = 0; i < 100; i++) { try { await fetch(B + '/api/pakete'); break; } catch (_) { await sleep(100); } }
    const ids = [], verb = [], tv = { view: null };
    verb.push(sse('role=tv', v => { tv.view = v; }));
    for (const [name, avatar] of [['Anna', '🦊'], ['Ben', '🐼']]) {
      const [, j] = await post('/api/join', { name, avatar });
      ids.push(j.id); verb.push(sse('id=' + j.id));
    }
    await sleep(300);
    const d = await (await fetch(B + '/api/pakete')).json();
    const packs = d.groups.flatMap(g => g.packs);
    ok(packs.find(p => p.name === 'Gut') && packs.find(p => p.name === 'Gut').count === 1, 'Gute Frage mit Ausschnitt und Aufdecken wird geladen');
    kaputt.forEach(([q, meldung], i) => {
      const p = packs.find(x => x.name === 'Kaputt' + i);
      ok(!p || p.count === 0, `abgelehnt: ${q.frage}`);
      ok(log.includes(meldung) || JSON.stringify(d).includes(meldung), `  Meldung „${meldung}“`);
    });

    const s = { ...d.settings, blocks: [{ count: 1, disabled: packs.filter(p => p.name !== 'Gut').map(p => p.id) }], pause: { on: false, minutes: 10 }, special: { on: false, mult: 2 }, risk: { on: false }, pub: { on: false } };
    await post('/api/einstellungen', { id: ids[0], settings: s });
    for (const id of ids) await post('/api/bereit', { id });
    await sleep(200);
    await post('/api/advance', { id: ids[0] });
    for (let i = 0; i < 200 && !(tv.view && tv.view.phase === 'question'); i++) { await post('/api/advance', { role: 'tv' }); await sleep(80); }
    const q = tv.view.question || {};
    ok(tv.view.phase === 'question' && JSON.stringify(q.ausschnitt) === '[80,18,16,25]' && q.aufdecken === true, `Fernseher bekommt Ausschnitt und Aufdecken (${JSON.stringify(q.ausschnitt)}, ${q.aufdecken})`);
    ok(q.label === 'Bilderrätsel · Aufdecken', `Label „${q.label}“`);
    verb.forEach(c => c.abort());
  } catch (e) {
    ok(false, 'Unerwarteter Fehler im Test: ' + (e.stack || e));
  }
  const absturz = /(TypeError|ReferenceError|SyntaxError|RangeError|Unhandled|uncaught)/i.test(log) || beendet;
  ok(!absturz, 'Keine Fehler im Server-Protokoll');
  if (absturz || fehler) console.log('\n--- Server-Protokoll ---\n' + log.slice(-3000));
  srv.kill();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fehler ? `\n${fehler} Prüfung(en) fehlgeschlagen.` : '\nAlles in Ordnung.');
  process.exit(fehler ? 1 : 0);
})();
