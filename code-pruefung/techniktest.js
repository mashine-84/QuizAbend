// Technik-Test: startet den Server in einer Kopie (ohne Fragen-Repo) und prüft den 🧪 Technik-Test.
//   Geprüft: Testpakete laden fehlerfrei, tauchen nicht in der normalen Paketauswahl auf, alle Fragen laufen der Reihe nach
//   durch (ein Block je Paket), ohne Pause/Stechen/Risiko-/Spezialfrage, zählen nicht als gespielt; Spotify nur wenn verbunden.
// Aufruf: node code-pruefung/techniktest.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'), PORT = 3960 + Math.floor(Math.random() * 9), B = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fehler = 0; const ok = (c, t) => { console.log((c ? '  ✓ ' : '  ✗ ') + t); if (!c) fehler++; };

const OHNE = new Set(['.git', 'node_modules', 'einstellungen.json', 'verlauf.json', 'hue.json', 'fragen-quelle.json', '_repo', 'spotify.json', 'https.json', '.https', 'host.json']);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quizabend-technik-'));
fs.cpSync(ROOT, TMP, { recursive: true, filter: s => !OHNE.has(path.basename(s)) && !s.startsWith(path.join(ROOT, 'code-pruefung')) });
// Spezialfrage, Risikofrage und Pause eingeschaltet – im Technik-Test dürfen sie trotzdem nicht kommen
fs.writeFileSync(path.join(TMP, 'einstellungen.json'), JSON.stringify({ blocks: [{ count: 10, disabled: [] }], special: { on: false, mult: 2 }, risk: { on: false }, sound: { on: false }, pause: { on: true, minutes: 1 }, scoring: 'speed' }));
let log = '';
const srv = spawn(process.execPath, ['server.js'], { cwd: TMP, env: { ...process.env, PORT: String(PORT), NO_BROWSER: '1', SEKUNDEN: '5' } });
srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
const post = (p, b) => fetch(B + p, { method: 'POST', body: JSON.stringify(b) }).then(async r => [r.status, await r.json().catch(() => ({}))]);

(async () => {
  try {
    for (let i = 0; i < 100; i++) { try { await fetch(B + '/api/pakete'); break; } catch (_) { await sleep(100); } }
    let d = await (await fetch(B + '/api/pakete')).json();
    ok(!d.errors.length, `Testpakete ohne Fehler geladen${d.errors.length ? ': ' + JSON.stringify(d.errors) : ''}`);
    ok(!d.groups.some(g => g.name === 'Technik-Test'), 'Technik-Test steht nicht in der normalen Paketauswahl');
    ok(d.summary.questions === 0, `normales Spiel hat ohne Fragen-Repo keine Fragen (${d.summary.questions})`);
    const tech = d.tech || [];
    ok(tech.length === 7, `${tech.length} Testpakete: ${tech.map(t => `${t.name} (${t.count}/${t.total})`).join(', ')}`);
    const spot = tech.find(t => /Spotify/.test(t.name));
    ok(spot && spot.count === 0 && spot.total === 3, 'Spotify-Testfragen nur, wenn Spotify verbunden ist');
    const erwartet = tech.reduce((a, t) => a + t.count, 0);

    // Ohne Spieler bzw. ohne Recht: abgelehnt
    const [st0] = await post('/api/techniktest', { id: 'niemand' });
    ok(st0 === 403, 'ohne Recht abgelehnt');

    const [, j] = await post('/api/join', { name: 'Tester', avatar: '🦊' });
    let S = null;
    fetch(B + '/events?id=' + j.id).then(async r => { const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
      for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let k;
        while ((k = buf.indexOf('\n\n')) >= 0) { const l = buf.slice(0, k).split('\n').find(x => x.startsWith('data: ')); buf = buf.slice(k + 2); if (l) try { S = JSON.parse(l.slice(6)); } catch (_) {} } } }).catch(() => {});
    await sleep(400);

    // Einzelnes Paket
    const [st1, r1] = await post('/api/techniktest', { id: j.id, packs: ['Technik-Test/4-Karte'] });
    ok(st1 === 200 && r1.ok, 'einzelnes Paket (Karte) gestartet');
    await sleep(200);
    ok(S && S.block && S.block.total === 1 && /Karte/.test(S.block.names.join()), `ein Block „${S && S.block && S.block.names}“`);
    // abbrechen: bis zum Ende durchklicken
    for (let i = 0; i < 300 && S && S.phase !== 'end'; i++) { await post('/api/advance', { id: j.id }); await sleep(30); }
    ok(S && S.phase === 'end', 'Karten-Test bis zum Ende');
    await post('/api/advance', { id: j.id }); await sleep(200);
    ok(S && S.phase === 'lobby', 'zurück in der Lobby');

    // Spezialfrage- und Risikofrage-Screen per Knopfdruck (auch wenn beides in den Einstellungen aus wäre)
    for (const [extra, phase] of [['special', 'special'], ['risk', 'risk']]) {
      const [stE, rE] = await post('/api/techniktest', { id: j.id, extra });
      const gesehen = new Set();
      for (let i = 0; i < 300 && S && S.phase !== 'end'; i++) {
        gesehen.add(S.phase);
        if (S.phase === 'question' && S.question && S.question.kind === 'choice') { await post('/api/answer', { id: j.id, choice: 0 }); await sleep(150); gesehen.add(S.phase); }
        await post('/api/advance', { id: j.id }); await sleep(25);
      }
      ok(stE === 200 && rE.ok && gesehen.has(phase), `${extra === 'risk' ? 'Risikofrage' : 'Spezialfrage'}-Screen erscheint (Phasen: ${[...gesehen].join(', ')})`);
      await post('/api/advance', { id: j.id }); await sleep(200);
    }

    // Alles nacheinander
    const [st2, r2] = await post('/api/techniktest', { id: j.id });
    ok(st2 === 200 && r2.ok, 'alle Testpakete gestartet');
    const phasen = new Set(), fragen = new Set(), arten = new Set(); let bloecke = 0;
    for (let i = 0; i < 3000 && S && S.phase !== 'end'; i++) {
      phasen.add(S.phase);
      if (S.phase === 'block') bloecke = Math.max(bloecke, S.block ? S.block.total : 0);
      if (S.question && S.block) { fragen.add(S.block.num + '/' + S.block.q); arten.add(S.question.kind + (S.question.label ? ':' + S.question.label : '')); }
      // ab und zu wirklich antworten
      if (S.phase === 'question' && S.question && S.question.kind === 'choice') await post('/api/answer', { id: j.id, answer: 0 });
      await post('/api/advance', { id: j.id }); await sleep(25);
    }
    ok(S && S.phase === 'end', 'alle Testfragen bis zum Ende durchgelaufen');
    ok(fragen.size === erwartet, `${fragen.size} von ${erwartet} Testfragen gezeigt`);
    ok(bloecke === 6, `ein Block je Paket (${bloecke}, Spotify fehlt ohne Verbindung)`);
    ok(!['pause', 'tiebreak', 'risk', 'special', 'opening', 'ident'].some(p => phasen.has(p)), `keine Pause, kein Stechen, keine Risiko-/Spezialfrage, kein Opener (Phasen: ${[...phasen].join(', ')})`);
    console.log('  Arten:', [...arten].join(' · '));
    const verlauf = fs.existsSync(path.join(TMP, 'verlauf.json')) ? JSON.parse(fs.readFileSync(path.join(TMP, 'verlauf.json'), 'utf8')) : {};
    ok(!Object.keys(verlauf).some(k => k.startsWith('Technik-Test/')), 'Testfragen zählen nicht als gespielt');
    ok(!/TypeError|ReferenceError|Error:/.test(log), 'keine Fehler im Server-Protokoll');
  } catch (e) { ok(false, 'Ausnahme: ' + e.stack); }
  finally { srv.kill(); fs.rmSync(TMP, { recursive: true, force: true }); }
  if (fehler) console.log('\n' + log.split('\n').slice(-20).join('\n'));
  console.log(fehler ? `\n${fehler} Fehler` : '\nAlles in Ordnung');
  process.exitCode = fehler ? 1 : 0;
})();
