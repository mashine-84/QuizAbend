// Hue-Licht: prüft mit einer nachgebauten Bridge, welche Befehle bei den Spielphasen gesendet werden.
//   Vor allem: Bei der Auflösung leuchten die Lampen sofort in der Farbe der richtigen Antwort – nie erst weiß.
//   Außerdem: höchstens ~1 Gruppenbefehl pro Sekunde.
// Aufruf: node code-pruefung/hue.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), https = require('https'), { EventEmitter } = require('events');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fehler = 0; const ok = (c, t) => { console.log((c ? '  ✓ ' : '  ✗ ') + t); if (!c) fehler++; };

// hue.js in eine Kopie mit eigener hue.json laden (die echte bleibt unberührt)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quizabend-hue-'));
fs.copyFileSync(path.join(__dirname, '..', 'hue.js'), path.join(TMP, 'hue.js'));
fs.writeFileSync(path.join(TMP, 'hue.json'), JSON.stringify({ enabled: true, ip: '192.0.2.10', appKey: 'test', group: '7', target: { kind: 'room', id: 'r' }, lights: [{ id: 'l1', name: 'Lampe', color: true, ct: true }] }));

// Bridge nachbauen: jede Anfrage merken und mit {} beantworten
const gesendet = [];
https.request = (opt, cb) => {
  const req = new EventEmitter(); let data = '';
  req.write = d => { data += d; }; req.destroy = () => {};
  req.end = () => {
    if (opt.method === 'PUT' && /groups\/7\/action/.test(opt.path)) gesendet.push({ t: Date.now(), body: JSON.parse(data || '{}') });
    const res = new EventEmitter(); res.statusCode = 200;
    setImmediate(() => { cb(res); res.emit('data', opt.method === 'GET' ? '{"data":[]}' : '{}'); res.emit('end'); });
  };
  return req;
};
const hue = require(path.join(TMP, 'hue.js'));
const ANSWER = ['#ff4a1c', '#1e9bff', '#ffc21a', '#3fd12e'];

(async () => {
  try {
    await hue.onPhase('opening'); await sleep(50);
    await hue.onPhase('question'); await sleep(1100);
    gesendet.length = 0;
    // Auflösung mit Antwort A (Index 0, Orange) – von Orange nach Blau würde ein direkter Übergang durch Weiß laufen
    await hue.onPhase('reveal', { q: 1, correct: 0 });
    await sleep(6000);
    const g = gesendet, same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
    ok(g.length >= 3, `${g.length} Befehle bei der Auflösung`);
    ok(g.every(x => x.body.ct == null), 'kein Weiß (ct) bei der Auflösung');
    ok(g.length && Array.isArray(g[0].body.xy) && g[0].body.xy[0] > 0.5, `erster Befehl ist schon die Antwortfarbe Orange (xy ${g.length && g[0].body.xy})`);
    ok(g.length && g[0].body.bri >= 250, 'erst hell (Aufblitzen in Farbe)');
    ok(g.length > 1 && g[1].t - g[0].t <= 1700 && same(g[1].body.xy, g[0].body.xy) && g[1].body.bri < 30, `nach gut 1 s in derselben Farbe abdunkeln (${g[1] && g[1].t - g[0].t} ms, bri ${g[1] && g[1].body.bri})`);
    const wechsel = g.findIndex(x => !same(x.body.xy, g[0].body.xy));
    ok(wechsel > 0 && g[wechsel].body.bri <= 13 && g[wechsel - 1].body.bri <= 13, `Farbwechsel zum Blau erst, wenn fast dunkel (bri ${wechsel > 0 && g[wechsel - 1].body.bri} → ${wechsel > 0 && g[wechsel].body.bri})`);
    ok(wechsel > 0 && g[wechsel].t - g[wechsel - 1].t >= 1200, `Farbwechsel erst nach dem Abdunkeln (${wechsel > 0 && g[wechsel].t - g[wechsel - 1].t} ms ≥ 1200)`);
    const letzt = g[g.length - 1];
    ok(letzt && letzt.body.xy[0] < 0.2 && letzt.body.bri > 40 && letzt.body.bri <= 60 && letzt.t - g[0].t < 4500, `am Ende das normale dunkle Blau (bri ${letzt && letzt.body.bri} nach ${letzt && letzt.t - g[0].t} ms)`);
    const abst = g.slice(1).map((x, i) => x.t - g[i].t);
    ok(abst.every(a => a >= 950), `höchstens ~1 Befehl pro Sekunde (${abst.join(', ')} ms)`);

    // Schätzfrage (keine richtige Antwort-Kachel) → Grün, ebenfalls ohne Weiß
    await hue.onPhase('question'); await sleep(1100); gesendet.length = 0;
    await hue.onPhase('reveal', { q: 2, correct: null }); await sleep(1300);
    ok(gesendet.length && gesendet.every(g => g.body.ct == null) && gesendet[0].body.xy[1] > 0.5, 'Schätzfrage: sofort Grün, kein Weiß');
    // nächste Phase vor dem Dimmen: der Dimm-Befehl darf nicht mehr nachkommen
    await hue.onPhase('scores'); await sleep(200); const n0 = gesendet.length; await sleep(3500);
    ok(gesendet.slice(n0).every(g => !(g.body.bri <= 60 && g.body.xy && g.body.xy[0] < 0.2)), 'neue Phase bricht das Dimmen ab');
    void ANSWER;
  } catch (e) { ok(false, 'Ausnahme: ' + e.stack); }
  finally { fs.rmSync(TMP, { recursive: true, force: true }); }
  console.log(fehler ? `\n${fehler} Fehler` : '\nAlles in Ordnung');
  process.exit(fehler ? 1 : 0);
})();
