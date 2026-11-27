// Fragen-Mix: prüft die Reihenfolge der Fragearten.
//   Teil 1 (ohne Server): Regeln direkt an fragenmix.js – auch Sonderfälle wie ein reiner Kartenblock.
//   Teil 2 (mit Server, wenn das Fragen-Repo da ist): lässt über /api/plan viele Spiele aus den echten Paketen bauen.
//   Fragen-Repo: fragen/_repo oder ../quizabend-fragen (oder FRAGEN_REPO=/pfad).
// Aufruf: node code-pruefung/fragenmix.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), { spawn } = require('child_process');
const { art, pickNext, MEDIEN } = require('../fragenmix');
const ROOT = path.join(__dirname, '..');
let fehler = 0; const ok = (c, t) => { console.log((c ? '  ✓ ' : '  ✗ ') + t); if (!c) fehler++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Folge bauen wie buildGame(): Blöcke nacheinander, prev läuft über die Block-Grenze weiter
function folge(blocks, rnd = Math.random) {
  const used = new Set(), out = []; let prev = null;
  blocks.forEach(({ pool, plays }, bi) => {
    for (let k = 0; k < plays; k++) {
      const left = pool.filter(q => !used.has(q)); if (!left.length) break;
      const q = pickNext(left, { prev, pos: k, len: plays, rnd }); used.add(q); prev = q; out.push({ ...q, bi, k, len: plays });
    }
  });
  return out;
}
const fragen = (n, pack, extra) => Array.from({ length: n }, (_, i) => ({ uid: pack + i, pack, kind: 'choice', level: 1 + (i % 3), ...extra }));

console.log('Teil 1: Regeln');
{
  // Großer Topf: 200 Spotify, 100 normale, je 5 von den anderen Arten
  const pool = [...fragen(100, 'A'), ...fragen(200, 'S', { spotify: true }), ...fragen(5, 'B', { image: true }), ...fragen(5, 'K', { kind: 'pin' }),
    ...fragen(5, 'Z', { kind: 'match' }), ...fragen(5, 'R', { kind: 'tf' }), ...fragen(10, 'E', { kind: 'estimate' }), ...fragen(5, 'T', { audio: 'x.mp3' })];
  let gleich = 0, medien = 0, start = 0, finale = 0, paket = 0; const zahl = {};
  for (let g = 0; g < 300; g++) {
    const f = folge([{ pool, plays: 10 }, { pool, plays: 10 }]);
    f.forEach((q, i) => {
      const a = art(q); zahl[a] = (zahl[a] || 0) + 1;
      if (q.k === 0 && a !== 'quiz') start++;
      if (q.k === q.len - 1 && a !== 'schaetzen') finale++;
      if (!i) return;
      const pa = art(f[i - 1]);
      if (pa !== 'quiz' && pa === a) gleich++;
      if (MEDIEN.has(pa) && MEDIEN.has(a)) medien++;
      if (f[i - 1].pack === q.pack) paket++;
    });
  }
  ok(gleich === 0, `nie zweimal dieselbe Würze-Art hintereinander (${gleich})`);
  ok(medien === 0, `Höhepunkte nie direkt hintereinander (${medien})`);
  ok(paket === 0, `nie zweimal dasselbe Paket hintereinander (${paket})`);
  ok(start === 0, `jeder Block beginnt mit einer normalen Quizfrage (${start})`);
  ok(finale === 0, `jeder Block endet mit einer Schätzfrage (${finale})`);
  const w = ['bild', 'karte', 'zuordnen', 'richtigfalsch', 'soundcheck'].map(a => zahl[a] || 0);
  ok(zahl.spotify < 3 * Math.max(...w), `Spotify (200 Fragen) überrollt die kleinen Arten nicht: ${JSON.stringify(zahl)}`);
}
{
  // Nur Kartenfragen: Regel lässt sich nicht einhalten – trotzdem volles Spiel
  const f = folge([{ pool: fragen(20, 'K', { kind: 'pin' }), plays: 10 }]);
  ok(f.length === 10, 'reiner Kartenblock: alle 10 Fragen gezogen');
  // Nur zwei Fragen im Block: kein Finale-Zwang, Block trotzdem voll
  const g = folge([{ pool: [...fragen(1, 'A'), ...fragen(3, 'E', { kind: 'estimate' })], plays: 2 }]);
  ok(g.length === 2 && art(g[0]) === 'quiz', 'kurzer Block (2): Einstieg mit Quizfrage');
  // Würze direkt vor dem Blockwechsel: Folge-Block startet trotzdem mit Quizfrage, Würze-Regel gilt über die Grenze
  const h = folge([{ pool: fragen(10, 'K', { kind: 'pin' }), plays: 3 }, { pool: [...fragen(5, 'K2', { kind: 'pin' }), ...fragen(5, 'A')], plays: 3 }]);
  ok(art(h[3]) === 'quiz', 'nach Kartenblock beginnt der nächste Block mit einer Quizfrage');
}
{
  // Verlauf: Die einzige ★-Merkbildfrage war schon dran, die ★★-Merkbilder noch nicht → sie darf nicht wiederkommen,
  // solange es noch ungespielte Merkbilder gibt (früher kam sie bei jeder ★-Merkbild-Ziehung, weil sie allein im Topf lag).
  const verlauf = { M0: 1 };
  const fresher = l => { if (l.length < 2) return l; const u = l.filter(q => !verlauf[q.uid]); if (u.length) return u;
    const s = [...l].sort((a, b) => verlauf[a.uid] - verlauf[b.uid]); return s.slice(0, Math.max(1, Math.ceil(s.length / 3))); };
  const pool = [...fragen(60, 'A'), { uid: 'M0', pack: 'M', kind: 'choice', level: 1, flash: 8 },
    ...Array.from({ length: 5 }, (_, i) => ({ uid: 'M' + (i + 1), pack: 'M', kind: 'choice', level: 2, flash: 8 })), ...fragen(20, 'E', { kind: 'estimate' })];
  let alt = 0, merk = 0;
  for (let g = 0; g < 400; g++) {
    const used = new Set(); let prev = null;
    for (let k = 0; k < 10; k++) {
      const q = pickNext(pool.filter(x => !used.has(x)), { prev, pos: k, len: 10, weights: [5, 1, 1], fresher }); used.add(q); prev = q;
      if (q.flash) merk++; if (q.uid === 'M0') alt++;
    }
  }
  ok(merk > 50 && alt === 0, `gespielte Frage kommt nicht wieder, solange ihre Art noch Frisches hat (${merk} Merkbilder, davon ${alt}× die gespielte)`);
  // Alles gespielt: die am längsten nicht gespielte kommt zuerst
  const v2 = { X0: 1, X1: 2, X2: 3, X3: 4, X4: 5, X5: 6 };
  const fr2 = l => { const s = [...l].sort((a, b) => v2[a.uid] - v2[b.uid]); return s.slice(0, Math.max(1, Math.ceil(s.length / 3))); };
  const alle = Array.from({ length: 6 }, (_, i) => ({ uid: 'X' + i, pack: 'X', kind: 'choice', level: 1 + (i % 3) }));
  let frueh = 0; for (let g = 0; g < 200; g++) if (['X0', 'X1'].includes(pickNext(alle, { fresher: fr2 }).uid)) frueh++;
  ok(frueh === 200, 'alles schon gespielt: es kommen die, die am längsten her sind');
}

// ---------- Teil 2: echte Pakete über den Server ----------
const REPO = [process.env.FRAGEN_REPO, path.join(ROOT, 'fragen', '_repo'), path.join(ROOT, '..', 'quizabend-fragen')].find(p => p && fs.existsSync(path.join(p, 'pruefen.js')));
(async () => {
  if (!REPO) { console.log('\nTeil 2 übersprungen: Fragen-Repo nicht gefunden'); return ende(); }
  console.log('\nTeil 2: echte Pakete (' + REPO + ')');
  const OHNE = new Set(['.git', 'node_modules', 'einstellungen.json', 'verlauf.json', 'hue.json', 'fragen-quelle.json', '_repo', 'spotify.json', 'https.json', '.https', 'host.json']);
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quizabend-mix-'));
  fs.cpSync(ROOT, TMP, { recursive: true, filter: s => !OHNE.has(path.basename(s)) && !s.startsWith(path.join(ROOT, 'code-pruefung')) });
  fs.symlinkSync(REPO, path.join(TMP, 'fragen', '_repo'));
  const PORT = 3970 + Math.floor(Math.random() * 9), B = 'http://127.0.0.1:' + PORT;
  let log = '';
  const srv = spawn(process.execPath, ['server.js'], { cwd: TMP, env: { ...process.env, PORT: String(PORT), NO_BROWSER: '1' } });
  srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  const post = (p, b) => fetch(B + p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(B + '/api/pakete'); break; } catch (_) { await sleep(200); } }
    const { id } = await post('/api/join', { name: 'Test', avatar: '🦊' });
    fetch(B + '/events?id=' + id).then(async r => { const rd = r.body.getReader(); for (;;) if ((await rd.read()).done) break; }).catch(() => {});   // SSE lesen, sonst gilt der Spieler als weg await sleep(300);
    const d = await (await fetch(B + '/api/pakete')).json();
    const alle = d.groups.flatMap(g => g.packs).map(p => p.id);
    // Block 1: alles; Block 2: nur Geografie (viele Karten) – dort darf die Regel nachgeben
    const geo = alle.filter(x => !/Geografie/.test(x));
    await post('/api/einstellungen', { id, settings: { ...d.settings, blocks: [{ count: 15, disabled: [] }, { count: 10, disabled: geo }] } });
    const ART = l => /^Merkbild/.test(l) ? 'merkbild' : /^Seh-Test/.test(l) ? 'sehtest' : /^Soundcheck/.test(l) ? 'soundcheck' : /^Spotify/.test(l) ? 'spotify'
      : /Wo liegt|Welches (Land|Bundesland)/.test(l) ? 'karte' : l === 'Zuordnung' ? 'zuordnen' : l === 'Richtig oder falsch' ? 'richtigfalsch'
      : /Schätzfrage/.test(l) ? 'schaetzen' : l === 'Bilderrätsel' ? 'bild' : 'quiz';
    let gleich1 = 0, paket1 = 0, start = 0, finale = 0, spiele = 0; const zahl = {}, lv = [[0, 0], [0, 0], [0, 0]];
    for (let g = 0; g < 150; g++) {
      const v = await post('/api/plan', { id, action: 'new' });
      if (!v.ok) { ok(false, 'Plan nicht erzeugt: ' + JSON.stringify(v).slice(0, 200)); break; }
      spiele++;
      const it = v.items, b1 = it.filter(x => x.bi === 0), b2 = it.filter(x => x.bi === 1);
      [b1, b2].forEach(b => { if (ART(b[0].label) !== 'quiz') start++; if (ART(b[b.length - 1].label) !== 'schaetzen') finale++; });
      b1.forEach((q, i) => {
        const a = ART(q.label); zahl[a] = (zahl[a] || 0) + 1;
        const t = Math.min(2, Math.floor(3 * i / b1.length)); lv[t][0] += q.level || 1; lv[t][1]++;
        if (!i) return;
        if (ART(b1[i - 1].label) !== 'quiz' && ART(b1[i - 1].label) === a) gleich1++;
        if (b1[i - 1].pack === q.pack) paket1++;
      });
    }
    ok(spiele === 150, `${spiele} Spiele gebaut (2 Blöcke: 15 Fragen aus allen Paketen, 10 nur Geografie)`);
    ok(gleich1 === 0, `alle Pakete: nie zweimal dieselbe Würze-Art hintereinander (${gleich1})`);
    ok(paket1 === 0, `alle Pakete: nie zweimal dasselbe Paket hintereinander (${paket1})`);
    ok(start === 0, `jeder Block beginnt mit einer Quizfrage (${start} Ausnahmen)`);
    ok(finale === 0, `jeder Block endet mit einer Schätzfrage (${finale} Ausnahmen)`);
    const avg = lv.map(([s, n]) => (s / n).toFixed(2));
    ok(avg[0] < avg[1] && avg[1] < avg[2], `Schwierigkeit steigt weiter an (Ø ★ je Drittel: ${avg.join(' → ')})`);
    console.log('  Arten in Block 1 (alle Pakete, ' + spiele * 15 + ' Fragen):', Object.entries(zahl).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${a} ${(100 * n / spiele / 15).toFixed(0)} %`).join(', '));
    ok(!/Error|TypeError/.test(log), 'keine Fehler im Server-Protokoll');
  } finally { srv.kill(); fs.rmSync(TMP, { recursive: true, force: true }); }
  ende();
})();
function ende() { console.log(fehler ? `\n${fehler} Fehler` : '\nAlles in Ordnung'); process.exitCode = fehler ? 1 : 0; }
