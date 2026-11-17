// Fragen melden („⚑ Stimmt was nicht?“): startet den Server in einer Kopie und prüft die Meldungen per API.
//   Geprüft: nur bei Auflösung/Rangliste, Grund ändern und zurücknehmen, je Spieler eine Meldung pro Frage,
//   Liste und Textdatei nur für die Spielleitung, Datei/Position fürs Fragen-Repo, Löschen einzeln und alle.
// Aufruf: node code-pruefung/meldungen.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..'), PORT = 3950 + Math.floor(Math.random() * 9), B = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fehler = 0; const ok = (c, t) => { console.log((c ? '  ✓ ' : '  ✗ ') + t); if (!c) fehler++; };

const OHNE = new Set(['.git', 'node_modules', 'einstellungen.json', 'verlauf.json', 'meldungen.json', 'hue.json', 'fragen-quelle.json', '_repo', 'spotify.json', 'https.json', '.https', 'host.json']);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quizabend-melden-'));
fs.cpSync(ROOT, TMP, { recursive: true, filter: s => !OHNE.has(path.basename(s)) && !s.startsWith(path.join(ROOT, 'code-pruefung')) });
// Paket wie im Fragen-Repo (unter _repo), damit Datei und Position stimmen
fs.mkdirSync(path.join(TMP, 'fragen', '_repo', 'Test'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'fragen', '_repo', 'Test', 'Melden.json'), JSON.stringify({ paket: 'Melden', fragen: [1, 2, 3].map(i => (
  { frage: `Frage ${i}?`, antworten: ['Richtig', 'Falsch A', 'Falsch B', 'Falsch C'], schwierigkeit: 1 })) }));
fs.writeFileSync(path.join(TMP, 'einstellungen.json'), JSON.stringify({ blocks: [{ count: 3, disabled: [] }], special: { on: false, mult: 2 }, risk: { on: false }, sound: { on: false }, pause: { on: false, minutes: 1 }, scoring: 'speed' }));
let log = '';
const srv = spawn(process.execPath, ['server.js'], { cwd: TMP, env: { ...process.env, PORT: String(PORT), NO_BROWSER: '1', SEKUNDEN: '5' } });
srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
const post = (p, b) => fetch(B + p, { method: 'POST', body: JSON.stringify(b) }).then(async r => [r.status, await r.json().catch(() => ({}))]);
const me = {};
function sse(id) {
  fetch(B + '/events?id=' + id).then(async r => { const rd = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); let k;
      while ((k = buf.indexOf('\n\n')) >= 0) { const l = buf.slice(0, k).split('\n').find(x => x.startsWith('data: ')); buf = buf.slice(k + 2); if (l) try { me[id] = JSON.parse(l.slice(6)); } catch (_) {} } } }).catch(() => {});
}
async function bis(id, phase, max = 400) {   // weiterklicken, bis die Phase erreicht ist
  for (let i = 0; i < max && !(me[id] && me[id].phase === phase); i++) { await post('/api/advance', { id }); await sleep(40); }
  return me[id] && me[id].phase === phase;
}

(async () => {
  try {
    for (let i = 0; i < 100; i++) { try { await fetch(B + '/api/pakete'); break; } catch (_) { await sleep(100); } }
    const ids = [];
    for (const [n, a] of [['Anna', '🦊'], ['Ben', '🐼']]) { const [, d] = await post('/api/join', { name: n, avatar: a }); ids.push(d.id); sse(d.id); }
    const [anna, ben] = ids;
    await sleep(400);
    for (const id of ids) await post('/api/bereit', { id });
    await sleep(100);
    const [stL] = await post('/api/melden', { id: ben, grund: 'falsch' });
    ok(stL === 409, 'in der Lobby kann man nichts melden');

    await post('/api/advance', { id: anna });
    ok(await bis(anna, 'question'), 'erste Frage läuft');
    const [stQ] = await post('/api/melden', { id: ben, grund: 'falsch' });
    ok(stQ === 409, 'während der Frage kann man nichts melden');
    ok(await bis(anna, 'reveal'), 'Auflösung erreicht');

    const [st1, r1] = await post('/api/melden', { id: ben, grund: 'falsch' });
    ok(st1 === 200 && r1.ok, 'Ben meldet „Antwort falsch“');
    await sleep(150);
    ok(me[ben].me.gemeldet === 'falsch' && me[anna].me.gemeldet === null, 'nur Ben sieht „Gemeldet“');
    await post('/api/melden', { id: ben, grund: 'unklar' }); await sleep(150);
    ok(me[ben].me.gemeldet === 'unklar', 'Grund geändert (eine Meldung je Spieler und Frage)');
    const [stB] = await post('/api/melden', { id: anna, grund: 'quatsch' });
    ok(stB === 400, 'unbekannter Grund abgelehnt');
    await post('/api/melden', { id: anna, grund: 'leicht' });
    await post('/api/melden', { id: anna, grund: null }); await sleep(150);
    ok(me[anna].me.gemeldet === null, 'Anna nimmt ihre Meldung zurück');
    await post('/api/melden', { id: anna, grund: 'technik' });

    // Rangliste nach der letzten Frage: dort geht es auch noch
    ok(await bis(anna, 'scores'), 'Rangliste erreicht');
    const [stS] = await post('/api/melden', { id: ben, grund: 'schwer' });
    ok(stS === 200, 'in der Rangliste lässt sich die letzte Frage melden');
    ok(await bis(anna, 'end'), 'Spielende');
    await post('/api/advance', { id: anna }); await sleep(200);

    // Liste und Datei
    const no = await fetch(B + '/api/meldungen?id=' + ben);
    ok(no.status === 403, 'Ben (nicht 👑) sieht die Liste nicht');
    const L = await (await fetch(B + '/api/meldungen?id=' + anna)).json();
    ok(L.ok && L.liste.length === 2, `2 Fragen gemeldet (${L.liste && L.liste.length})`);
    const x = L.liste.find(m => Object.keys(m.gruende).includes('unklar'));
    ok(x && x.datei === 'Test/Melden.json' && x.nr >= 1 && x.loesung === 'Richtig', `Datei, Position und Lösung fürs Fragen-Repo (${x && x.datei} #${x && x.nr})`);
    ok(x && x.gruende.unklar.join() === 'Ben' && x.gruende.technik.join() === 'Anna', 'Gründe mit Namen');
    const pk = await (await fetch(B + '/api/pakete')).json();
    ok(pk.meldungen === 2, 'Zähler in den Einstellungen');
    const t = await fetch(B + '/api/meldungen.txt?id=' + anna), txt = await t.text();
    ok(t.status === 200 && /attachment; filename="fragen-meldungen-/.test(t.headers.get('content-disposition')) && /## Test\/Melden\.json, Frage \d/.test(txt) && /Frage unklar \(Ben\)/.test(txt), 'Textdatei zum Herunterladen');
    console.log(txt.split('\n').slice(0, 8).map(l => '      ' + l).join('\n'));
    await sleep(700);
    ok(fs.existsSync(path.join(TMP, 'meldungen.json')), 'gespeichert in meldungen.json');

    // Löschen
    const [, d1] = await post('/api/meldungen', { id: anna, uid: x.uid });
    ok(d1.liste.length === 1, 'eine Frage als erledigt gelöscht');
    const [stD] = await post('/api/meldungen', { id: ben });
    ok(stD === 403, 'Ben darf nicht löschen');
    const [, d2] = await post('/api/meldungen', { id: anna });
    ok(d2.liste.length === 0, 'alle gelöscht');
    ok(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').includes('meldungen.json'), 'meldungen.json steht in .gitignore');
    ok(!/TypeError|ReferenceError|Error:/.test(log), 'keine Fehler im Server-Protokoll');
  } catch (e) { ok(false, 'Ausnahme: ' + e.stack); }
  finally { srv.kill(); fs.rmSync(TMP, { recursive: true, force: true }); }
  if (fehler) console.log('\n' + log.split('\n').slice(-15).join('\n'));
  console.log(fehler ? `\n${fehler} Fehler` : '\nAlles in Ordnung');
  process.exitCode = fehler ? 1 : 0;
})();
