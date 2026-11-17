// Risikofrage: startet den Server in einer Kopie und spielt Spiele über die API durch.
//   Anna antwortet immer richtig, Ben immer falsch, Cleo falsch – nur bei der Risikofrage gar nicht.
//   Geprüft: Alarm-Phase vor der Frage, nie im ersten Drittel, nur ★★-Fragen, Plus/Minus/Null, ohne Einstellung keine Risikofrage.
// Aufruf: node test/risikofrage.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'), PORT = 3990 + Math.floor(Math.random() * 9), B = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fehler = 0; const ok = (c, t) => { console.log((c ? '  ✓ ' : '  ✗ ') + t); if (!c) fehler++; };

const OHNE = new Set(['.git', 'node_modules', 'einstellungen.json', 'verlauf.json', 'hue.json', 'fragen-quelle.json', '_repo', 'spotify.json', 'https.json', '.https', 'host.json']);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quizabend-risiko-'));
fs.cpSync(ROOT, TMP, { recursive: true, filter: s => !OHNE.has(path.basename(s)) && !s.startsWith(path.join(ROOT, 'test')) });
const N = 12;   // Fragen pro Spiel: 6 leichte (★, nie Risikofrage) und 6 mittlere (★★)
fs.mkdirSync(path.join(TMP, 'fragen', 'Risiko'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'fragen', 'Risiko', 'Risiko.json'), JSON.stringify({ paket: 'Risiko', fragen: [
  ...[1, 2, 3, 4, 5, 6].map(i => ({ kategorie: 'Test', frage: `Leicht ${i}?`, antworten: ['Richtig', 'Falsch A', 'Falsch B', 'Falsch C'], schwierigkeit: 1 })),
  ...[1, 2, 3, 4, 5, 6].map(i => ({ kategorie: 'Test', frage: `Mittel ${i}?`, antworten: ['Richtig', 'Falsch A', 'Falsch B', 'Falsch C'], schwierigkeit: 2 })),
] }));
let log = '', beendet = false;
const srv = spawn(process.execPath, ['server.js'], { cwd: TMP, env: { ...process.env, PORT: String(PORT), NO_BROWSER: '1', SEKUNDEN: '5' } });
srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
srv.on('exit', () => { beendet = true; });
const post = (p, b) => fetch(B + p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json().then(d => [r.status, d]));
function sse(q, on) {
  fetch(B + '/events?' + q).then(async r => { const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let k;
      while ((k = buf.indexOf('\n\n')) >= 0) { const l = buf.slice(0, k).split('\n').find(x => x.startsWith('data: ')); buf = buf.slice(k + 2); if (l) try { on(JSON.parse(l.slice(6))); } catch (_) {} } } }).catch(() => {});
}

async function spiel(name, ids, tv, me, riskOn) {
  console.log('\n' + name);
  const d = await (await fetch(B + '/api/pakete')).json();
  await post('/api/einstellungen', { id: ids[0], settings: { ...d.settings, blocks: [{ count: N, disabled: d.groups.flatMap(g => g.packs).map(p => p.id).filter(id => !/Risiko/.test(id)) }], pause: { on: false, minutes: 10 }, risk: { on: riskOn }, scoring: 'speed' } });
  for (const id of ids) await post('/api/bereit', { id });
  await sleep(150); await post('/api/advance', { id: ids[0] });
  const out = { phases: [], riskQ: null, riskText: null, before: null, after: null, results: null, alarmBefore: false };
  const done = new Set(); let lastPh = '', t0 = Date.now();
  while (Date.now() - t0 < 120000 && !beendet) {
    await sleep(60);
    const v = tv.view; if (!v) continue;
    if (v.phase !== lastPh) { out.phases.push(v.phase + (v.risk ? '!' : '')); lastPh = v.phase; }
    if (v.phase === 'end') break;
    if (v.phase === 'question' && v.question && !done.has(v.qNum)) {
      done.add(v.qNum);
      await sleep(100); const pq = me[ids[0]].question || v.question;
      const r = (pq.answers || []).indexOf('Richtig'), f = (r + 1) % 4;
      if (r < 0) { ok(false, 'Antworten nicht gefunden: ' + JSON.stringify(pq).slice(0, 200)); continue; }
      if (v.risk) { out.riskQ = v.qNum; out.riskText = v.question.text; out.before = ids.map(id => me[id].me.score); out.alarmBefore = out.phases.slice(-3).some(x => x.startsWith('risk')); }
      await post('/api/answer', { id: ids[0], choice: r });
      await post('/api/answer', { id: ids[1], choice: f });
      if (!v.risk) await post('/api/answer', { id: ids[2], choice: f });
      continue;
    }
    if (v.phase === 'reveal' && v.risk && !out.results) { await sleep(200); out.results = ids.map(id => me[id].me.result); out.after = ids.map(id => me[id].me.score); }
    if (v.phase !== 'lobby') await post('/api/advance', { role: 'tv' });
  }
  ok(tv.view.phase === 'end', 'Spiel zu Ende gespielt');
  await post('/api/advance', { role: 'tv' }); for (let i = 0; i < 40 && tv.view.phase !== 'lobby'; i++) await sleep(100);
  return out;
}

(async () => {
  try {
    for (let i = 0; i < 100; i++) { try { await fetch(B + '/api/pakete'); break; } catch (_) { await sleep(100); } }
    const tv = { view: null }, me = {}, ids = [];
    sse('role=tv', v => { tv.view = v; });
    for (const [n, a] of [['Anna', '🦊'], ['Ben', '🐼'], ['Cleo', '🐸']]) { const [, d] = await post('/api/join', { name: n, avatar: a }); ids.push(d.id); sse('id=' + d.id, v => { me[d.id] = v; }); }
    await sleep(500);
    const pos = [];
    for (let g = 1; g <= 4; g++) {
      const o = await spiel(`Spiel ${g}: Risikofrage an`, ids, tv, me, true);
      ok(o.riskQ !== null, `Risikofrage kam (Frage ${o.riskQ} von ${N})`);
      if (o.riskQ === null) continue;
      pos.push(o.riskQ);
      ok(o.alarmBefore, 'Roter Alarm (Phase „risk“) direkt vor der Frage');
      ok(o.riskQ > Math.ceil(N / 3), 'Nicht im ersten Drittel');
      ok(/^Mittel/.test(o.riskText), `Mindestens ★★ („${o.riskText}“)`);
      const [ra, rb, rc] = o.results, [da, db, dc] = o.after.map((x, i) => x - o.before[i]);
      ok(ra.correct && da > 0 && da === ra.gain, `Anna richtig: +${da}`);
      ok(!rb.correct && rb.answered && db < 0 && db === rb.gain && -db >= 500 && -db <= 1000 && -db % 10 === 0, `Ben falsch: ${db}`);
      ok(-db <= da && -db >= da - 150, `Ben verliert so viel, wie es für richtig gegeben hätte (ohne Serienbonus): ${-db} ≤ ${da}`);
      ok(!rc.answered && dc === 0, 'Cleo setzt aus: ±0');
    }
    const o = await spiel('Spiel 5: Risikofrage aus', ids, tv, me, false);
    ok(o.riskQ === null && !o.phases.some(p => p.startsWith('risk')), 'Ohne Einstellung keine Risikofrage');
    console.log('\nPositionen der Risikofrage: ' + pos.join(', '));
  } catch (e) { fehler++; console.log('  ✗ Abbruch: ' + e.stack); }
  srv.kill();
  if (fehler) { console.log('\n' + log.slice(-2000)); console.log(`\n${fehler} Fehler`); process.exit(1); }
  console.log('\nAlles gut'); process.exit(0);
})();
