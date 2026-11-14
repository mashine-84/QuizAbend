// Rauchtest: startet den Server in einer Kopie des Projekts und spielt zwei komplette Spiele über die API durch.
//   Spiel 1: Punkte nach Schwierigkeit, alle antworten gleich → Gleichstand → Stechen muss kommen und einen Sieger finden.
//   Spiel 2: Punkte nach Tempo, zufällige Antworten, zwei Blöcke mit Pause → Pause, Opener, Rangliste, Ende.
// Aufruf: node test/rauchtest.js   (läuft auch in der GitHub-Prüfung). Ändert nichts am Projekt selbst.
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

// Kopie ohne persönliche Dateien (Einstellungen, Verlauf, Hue, Fragen-Repo-Zugang)
const OHNE = new Set(['.git', 'node_modules', 'einstellungen.json', 'verlauf.json', 'hue.json', 'fragen-quelle.json', '.fragen-key', '.fragen-key.pub', '.fragen-known_hosts']);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quizabend-'));
fs.cpSync(ROOT, TMP, { recursive: true, filter: src => !OHNE.has(path.basename(src)) && !src.startsWith(path.join(ROOT, 'test')) });

let log = '';
const srv = spawn(process.execPath, ['server.js'], { cwd: TMP, env: { ...process.env, PORT: String(PORT), NO_BROWSER: '1', SEKUNDEN: '5' } });
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });
let beendet = false;
srv.on('exit', code => { beendet = true; if (code) log += `\n[Server beendet mit Code ${code}]`; });

const post = (p, b) => fetch(B + p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json().then(d => [r.status, d]));
const zufall = n => Math.floor(Math.random() * n);

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

// Eine gültige Antwort zur Frage: gleich (alle identisch) oder zufällig
function antwort(q, gleich, nr) {
  if (q.kind === 'choice') return { choice: gleich ? 0 : zufall(q.answers.length) };
  if (q.kind === 'estimate') return { value: q.tiebreak ? nr + 1 : gleich ? 1 : zufall(1000) };
  if (q.kind === 'match') { const o = q.left.map((_, i) => i); if (!gleich) o.sort(() => Math.random() - .5); return { order: o }; }
  if (q.kind === 'tf') return { marks: q.statements.map(() => gleich ? true : Math.random() < .5) };
  return {};
}

async function spiel(name, ids, tv, einst, gleich) {
  console.log('\n' + name);
  const d = await (await fetch(B + '/api/pakete')).json();
  const s = { ...d.settings, ...einst };
  const [st] = await post('/api/einstellungen', { id: ids[0], settings: s });
  ok(st === 200, 'Einstellungen übernommen');
  await post('/api/advance', { id: ids[0] });
  const gesehen = new Set(), beantwortet = new Set();
  const start = Date.now();
  while (Date.now() - start < 240000 && !beendet) {
    await sleep(80);
    const v = tv.view;
    if (!v) continue;
    gesehen.add(v.phase);
    if (v.phase === 'end') break;
    if (v.phase === 'question' && v.question) {
      const key = v.qNum + '|' + v.question.text + '|' + (v.tiebreak ? v.tiebreak.round : '');
      if (!beantwortet.has(key)) {
        beantwortet.add(key);
        for (let i = 0; i < ids.length; i++) await post('/api/answer', { id: ids[i], ...antwort(v.question, gleich, i) });
      }
      continue;
    }
    if (v.phase !== 'lobby') await post('/api/advance', { role: 'tv' });
  }
  ok(tv.view && tv.view.phase === 'end', `Spiel zu Ende gespielt (${beantwortet.size} Fragen, Phasen: ${[...gesehen].join(' → ')})`);
  return { gesehen, v: tv.view };
}

(async () => {
  try {
    for (let i = 0; i < 100; i++) { try { await fetch(B + '/api/pakete'); break; } catch (_) { await sleep(100); } }
    const pakete = await (await fetch(B + '/api/pakete')).json();
    ok(!pakete.settings.errors, `Fragenpakete fehlerfrei geladen (${pakete.groups.flatMap(g => g.packs).length} Pakete)`);
    for (const seite of ['/', '/tv', '/play']) {
      const r = await fetch(B + seite); ok(r.status === 200 || r.status === 302, `Seite ${seite} erreichbar (${r.status})`);
    }

    const tv = { view: null };
    const verb = [sse('role=tv', v => { tv.view = v; })];
    const ids = [];
    for (const [name, avatar] of [['Anna', '🦊'], ['Ben', '🐼'], ['Cleo', '🐸']]) {
      const [st, d] = await post('/api/join', { name, avatar });
      ok(st === 200 && d.id, `${name} tritt bei`);
      ids.push(d.id); verb.push(sse('id=' + d.id));
    }
    await sleep(500);

    const s1 = await spiel('Spiel 1: Gleichstand und Stechen', ids, tv,
      { blocks: [{ count: 4, disabled: [] }], pause: { on: false, minutes: 10 }, scoring: 'level' }, true);
    ok(s1.gesehen.has('tiebreak'), 'Stechen wurde angesetzt');
    const erste = (s1.v.players || []).filter(p => p.place === 1);
    ok(erste.length === 1, `Genau ein Sieger nach dem Stechen (${erste.map(p => p.name + ' ' + p.score).join(', ')})`);

    await post('/api/advance', { role: 'tv' });   // Ende → zurück in die Lobby
    for (let i = 0; i < 50 && tv.view.phase !== 'lobby'; i++) await sleep(100);
    ok(tv.view.phase === 'lobby', 'Zurück in der Lobby');

    const s2 = await spiel('Spiel 2: zwei Blöcke mit Pause, zufällige Antworten', ids, tv,
      { blocks: [{ count: 3, disabled: [] }, { count: 3, disabled: [] }], pause: { on: true, minutes: 1 }, scoring: 'speed' }, false);
    for (const ph of ['ident', 'block', 'question', 'reveal', 'scores', 'pause'])
      ok(s2.gesehen.has(ph), `Phase „${ph}“ kam vor`);
    ok((s2.v.players || []).every(p => Number.isFinite(p.score)), 'Alle Punktestände sind Zahlen');

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
