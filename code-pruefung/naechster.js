// „Wer kommt am nächsten ran?“ (Pin-Frage mit "naechster": true): Einlesen, Wertung in beiden Modi, Gleichstand.
// Startet den Server in einer Kopie mit eigenem Testpaket. Aufruf: node code-pruefung/naechster.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3800 + Math.floor(Math.random() * 90);
const B = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fehler = 0;
const ok = (bed, text) => { console.log((bed ? '  ✓ ' : '  ✗ ') + text); if (!bed) fehler++; };

const OHNE = new Set(['.git', 'node_modules', 'einstellungen.json', 'verlauf.json', 'hue.json', 'fragen-quelle.json', '.fragen-key', '.fragen-key.pub', '.fragen-known_hosts', '_repo', 'code-pruefung']);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quizabend-'));
fs.cpSync(ROOT, TMP, { recursive: true, filter: src => !OHNE.has(path.basename(src)) });

// Ziel: Mittelpunkt Deutschlands. 1 Breitengrad ≈ 111,2 km
const ZIEL = [51.16, 10.45];
const nord = km => [ZIEL[0] + km / 111.195, ZIEL[1]];
fs.mkdirSync(path.join(TMP, 'fragen', 'Naechster'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'fragen', 'Naechster', 'Naechster.json'), JSON.stringify({ paket: 'Naechster', fragen: [
  { frage: 'Wo liegt der Mittelpunkt Deutschlands?', karte: 'deutschland', ort: ZIEL, name: 'Niederdorla', naechster: true, schwierigkeit: 2, kategorie: 'Test' }] }));
// Fehlerhafte Fragen: dürfen nicht durchgehen
fs.mkdirSync(path.join(TMP, 'fragen', 'Kaputt'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'fragen', 'Kaputt', 'Kaputt.json'), JSON.stringify({ paket: 'Kaputt', fragen: [
  { frage: 'Mit Radius?', karte: 'deutschland', ort: ZIEL, naechster: true, radius: 20, schwierigkeit: 1 },
  { frage: 'Land?', karte: 'deutschland', land: 'Bayern', naechster: true, schwierigkeit: 1 }] }));

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
const warte = async (bed, ms = 30000) => { const t = Date.now(); while (!bed() && Date.now() - t < ms) await sleep(60); return bed(); };

(async () => {
  try {
    for (let i = 0; i < 100; i++) { try { await fetch(B + '/api/pakete'); break; } catch (_) { await sleep(100); } }
    const d = await (await fetch(B + '/api/pakete')).json();
    const fehlerText = JSON.stringify(d.errors || d.packErrors || '') + log;
    ok(/"radius" passen nicht zusammen/.test(fehlerText) || (d.errors > 0), 'naechster + radius wird abgelehnt');
    ok((d.groups || []).every(g => g.packs.every(p => p.name !== 'Kaputt' || p.count === 0)), 'Fehlerhafte Fragen kommen nicht ins Spiel');

    const tv = { view: null }, me = {};
    const verb = [sse('role=tv', v => { tv.view = v; })];
    const ids = [];
    for (const [name, avatar] of [['Anna', '🦊'], ['Ben', '🐼'], ['Cleo', '🐸']]) {
      const [, j] = await post('/api/join', { name, avatar });
      ids.push(j.id); verb.push(sse('id=' + j.id, v => { me[j.id] = v; }));
    }
    await sleep(400);
    const packId = d.groups.flatMap(g => g.packs).find(p => p.name === 'Naechster').id;

    async function runde(scoring, tipps) {
      const s = { ...d.settings, blocks: [{ count: 1, disabled: d.groups.flatMap(g => g.packs).map(p => p.id).filter(id => id !== packId) }],
        pause: { on: false, minutes: 10 }, special: { on: false, mult: 2 }, risk: { on: false }, pub: { on: false }, scoring };
      const [st] = await post('/api/einstellungen', { id: ids[0], settings: s });
      ok(st === 200, `Wertung „${scoring}“ eingestellt`);
      for (const id of ids) await post('/api/bereit', { id });
      await sleep(200);
      await post('/api/advance', { id: ids[0] });
      for (let i = 0; i < 200 && !(tv.view && tv.view.phase === 'question'); i++) { await post('/api/advance', { role: 'tv' }); await sleep(80); }
      ok(tv.view.phase === 'question' && tv.view.question.naechster === true && tv.view.question.radius === 0, 'Frage läuft: naechster an, kein Kreis');
      ok(tv.view.question.label === 'Wer kommt am nächsten ran?', `Label „${tv.view.question.label}“`);
      for (let i = 0; i < ids.length; i++) if (tipps[i] !== null) await post('/api/answer', { id: ids[i], pos: nord(tipps[i]) });
      await warte(() => tv.view && tv.view.phase === 'votes', 10000);
      for (let i = 0; i < 100 && tv.view.phase !== 'reveal'; i++) { await post('/api/advance', { role: 'tv' }); await sleep(60); }
      await sleep(300);
      const res = ids.map(id => (me[id] && me[id].me && me[id].me.result) || null);
      await post('/api/host', { id: ids[0], action: 'end' });
      await warte(() => tv.view.phase === 'end', 5000);
      for (let i = 0; i < 50 && tv.view.phase !== 'lobby'; i++) { await post('/api/advance', { role: 'tv' }); await sleep(100); }
      return res;
    }

    // Punkte nach Schwierigkeit: 50 km und 51 km (unter 3 % mehr) teilen sich den Sieg, 120 km geht leer aus
    const r1 = await runde('level', [50, 51, 120]);
    ok(r1[0] && r1[0].correct && r1[0].gain === 2, `50 km: am nächsten, 2 Punkte (${JSON.stringify(r1[0])})`);
    ok(r1[1] && r1[1].correct && r1[1].gain === 2, `51 km: Gleichstand, auch 2 Punkte (${JSON.stringify(r1[1])})`);
    ok(r1[2] && !r1[2].correct && r1[2].gain === 0, `120 km: 0 Punkte (${JSON.stringify(r1[2])})`);

    // Tempo-Wertung: Punkte nach Entfernung, nur der Nächste +200; 60 km ist mehr als 3 % weiter als 50 km
    const r2 = await runde('speed', [50, 60, null]);
    ok(r2[0] && r2[0].correct && r2[0].gain >= 200, `50 km: am nächsten, mit Bonus (${r2[0] && r2[0].gain})`);
    ok(r2[1] && !r2[1].correct && r2[1].gain > 0 && r2[1].gain < r2[0].gain - 150, `60 km: Punkte nach Entfernung, ohne Bonus (${r2[1] && r2[1].gain})`);
    ok(r2[2] && !r2[2].answered && r2[2].gain === 0, 'kein Tipp: 0 Punkte');

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
