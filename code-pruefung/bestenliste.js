// Ewige Bestenliste: startet den Server in einer Kopie, spielt zwei Spiele per API und prüft die Bestenliste.
//   Anna schätzt immer exakt, Ben weit daneben, Cleo knapp daneben → Anna gewinnt, Cleo wird Zweite, Ben Dritter.
//   Geprüft: Eintrag nach jedem Spiel (einmal), Wiedererkennen über den Namen (Groß-/Kleinschreibung egal), Auszeichnungen,
//   Technik-Test zählt nicht, Zurücksetzen nur für die Spielleitung und nur in der Lobby, gespeichert in bestenliste.json.
// Aufruf: node code-pruefung/bestenliste.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'), PORT = 3940 + Math.floor(Math.random() * 9), B = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fehler = 0; const ok = (c, t) => { console.log((c ? '  ✓ ' : '  ✗ ') + t); if (!c) fehler++; };

const OHNE = new Set(['.git', 'node_modules', 'einstellungen.json', 'verlauf.json', 'meldungen.json', 'bestenliste.json', 'hue.json', 'fragen-quelle.json', '_repo', 'spotify.json', 'https.json', '.https', 'host.json']);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quizabend-ewig-'));
fs.cpSync(ROOT, TMP, { recursive: true, filter: s => !OHNE.has(path.basename(s)) && !s.startsWith(path.join(ROOT, 'code-pruefung')) });
fs.mkdirSync(path.join(TMP, 'fragen', 'Ewig'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'fragen', 'Ewig', 'Ewig.json'), JSON.stringify({ paket: 'Ewig', fragen: [1, 2, 3, 4, 5, 6].map(i => (
  { frage: `Wie viel ist ${i} mal 100?`, schaetzen: i * 100, schwierigkeit: 1 })) }));
fs.writeFileSync(path.join(TMP, 'einstellungen.json'), JSON.stringify({ blocks: [{ count: 3, disabled: [] }], special: { on: false, mult: 2 }, risk: { on: false }, sound: { on: false }, pause: { on: false, minutes: 1 }, scoring: 'speed' }));
let log = '';
const srv = spawn(process.execPath, ['server.js'], { cwd: TMP, env: { ...process.env, PORT: String(PORT), NO_BROWSER: '1', SEKUNDEN: '5' } });
srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
const post = (p, b) => fetch(B + p, { method: 'POST', body: JSON.stringify(b) }).then(async r => [r.status, await r.json().catch(() => ({}))]);
const V = {};
function sse(id) {
  fetch(B + '/events?id=' + id).then(async r => { const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let k;
      while ((k = buf.indexOf('\n\n')) >= 0) { const l = buf.slice(0, k).split('\n').find(x => x.startsWith('data: ')); buf = buf.slice(k + 2); if (l) try { V[id] = JSON.parse(l.slice(6)); } catch (_) {} } } }).catch(() => {});
}

// Ein Spiel durchspielen: Anna exakt, Cleo knapp daneben, Ben weit daneben
async function spiel(ids) {
  const [anna, ben, cleo] = ids;
  for (const id of ids) await post('/api/bereit', { id });
  await sleep(100);
  await post('/api/advance', { id: anna });
  const done = new Set();
  for (let i = 0; i < 600 && !(V[anna] && V[anna].phase === 'end'); i++) {
    const v = V[anna];
    if (v && v.phase === 'question' && !done.has(v.qNum)) {
      done.add(v.qNum);
      const m = /Wie viel ist (\d+)/.exec(v.question.text || ''), w = m ? Number(m[1]) * 100 : 0;
      await post('/api/answer', { id: anna, value: w });
      await post('/api/answer', { id: cleo, value: w + 7 });
      await post('/api/answer', { id: ben, value: w * 5 });
    } else await post('/api/advance', { id: anna });
    await sleep(40);
  }
  await sleep(200);
  return V[anna] && V[anna].phase === 'end';
}

(async () => {
  try {
    for (let i = 0; i < 100; i++) { try { await fetch(B + '/api/pakete'); break; } catch (_) { await sleep(100); } }
    const ids = [];
    for (const [n, a] of [['Anna', '🦊'], ['Ben', '🐼'], ['Cleo', '🐸']]) { const [, d] = await post('/api/join', { name: n, avatar: a }); ids.push(d.id); sse(d.id); }
    const [anna, ben] = ids;
    await sleep(400);
    ok(V[anna].phase === 'lobby' && V[anna].bestenliste && V[anna].bestenliste.liste.length === 0, 'Lobby: Bestenliste ist leer');

    ok(await spiel(ids), 'Spiel 1 zu Ende');
    let b = V[anna].bestenliste;
    ok(b && b.spiele === 1, `Siegerehrung: Spiel eingetragen (${b && b.spiele})`);
    const e = n => b.liste.find(x => x.name === n);
    ok(e('Anna').siege === 1 && e('Cleo').zweite === 1 && e('Ben').dritte === 1, 'Sieg, 2. und 3. Platz richtig');
    ok(b.liste[0].name === 'Anna', 'Anna steht oben');
    ok(Object.keys(e('Anna').preise).some(t => /Beste Schätzung/.test(t)), `Auszeichnung „Beste Schätzung“ für Anna (${JSON.stringify(e('Anna').preise)})`);
    // Phase „end“ wird u. U. mehrfach gesetzt – trotzdem nur einmal zählen
    await sleep(300);
    ok(V[anna].bestenliste.spiele === 1, 'nur einmal eingetragen');
    await post('/api/advance', { id: anna }); await sleep(200);
    ok(V[anna].phase === 'lobby', 'zurück in der Lobby');

    // Ben verlässt das Spiel und kommt als „ben“ (klein) wieder → derselbe Eintrag
    await post('/api/leave', { id: ben }).catch(() => {});
    await post('/api/kick', { id: anna, target: ben }).catch(() => {});
    await sleep(200);
    const [, d2] = await post('/api/join', { name: 'ben', avatar: '🐼' }); sse(d2.id); await sleep(300);
    const ids2 = [anna, d2.id, ids[2]];
    ok(await spiel(ids2), 'Spiel 2 zu Ende');
    b = V[anna].bestenliste;
    ok(b.spiele === 2 && e('Anna').siege === 2 && e('Anna').spiele === 2, 'Anna: 2 Siege in 2 Spielen');
    ok(b.liste.filter(x => x.name.toLowerCase() === 'ben').length === 1 && e('ben').spiele === 2, '„ben“ = „Ben“ (ein Eintrag, Name aktualisiert)');
    await post('/api/advance', { id: anna }); await sleep(200);

    // Gleich nach dem Start mit „⏹ Spiel beenden“ abgebrochen → zählt nicht
    for (const id of ids2) await post('/api/bereit', { id });
    await sleep(100); await post('/api/advance', { id: anna });
    for (let i = 0; i < 50 && V[anna].phase !== 'question'; i++) { await post('/api/advance', { id: anna }); await sleep(40); }
    await post('/api/host', { id: anna, action: 'end' }); await sleep(300);
    ok(V[anna].phase === 'end' && V[anna].bestenliste.spiele === 2, 'vorzeitig beendet (erste Frage) zählt nicht');
    await post('/api/advance', { id: anna }); await sleep(200);

    // Technik-Test zählt nicht
    const [stT] = await post('/api/techniktest', { id: anna, packs: ['Technik-Test/4-Karte'] });
    for (let i = 0; i < 300 && V[anna].phase !== 'end'; i++) { await post('/api/advance', { id: anna }); await sleep(25); }
    ok(stT === 200 && V[anna].bestenliste.spiele === 2, 'Technik-Test zählt nicht');
    await post('/api/advance', { id: anna }); await sleep(200);

    // Gespeichert und zurücksetzen
    ok(JSON.parse(fs.readFileSync(path.join(TMP, 'bestenliste.json'), 'utf8')).spiele === 2, 'gespeichert in bestenliste.json');
    const [stB] = await post('/api/bestenliste', { id: d2.id });
    ok(stB === 403, 'Ben (nicht 👑) darf nicht zurücksetzen');
    const [stR] = await post('/api/bestenliste', { id: anna }); await sleep(200);
    ok(stR === 200 && V[anna].bestenliste.spiele === 0 && V[anna].bestenliste.liste.length === 0, 'Anna setzt zurück – alles bei null');
    ok(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').includes('bestenliste.json'), 'bestenliste.json steht in .gitignore');
    ok(!/TypeError|ReferenceError|Error:/.test(log), 'keine Fehler im Server-Protokoll');
  } catch (e) { ok(false, 'Ausnahme: ' + e.stack); }
  finally { srv.kill(); fs.rmSync(TMP, { recursive: true, force: true }); }
  if (fehler) console.log('\n' + log.split('\n').slice(-15).join('\n'));
  console.log(fehler ? `\n${fehler} Fehler` : '\nAlles in Ordnung');
  process.exitCode = fehler ? 1 : 0;
})();
