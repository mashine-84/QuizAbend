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
    // Auflösung mit Antwort B (Index 1)
    await hue.onPhase('reveal', { q: 1, correct: 1 });
    await sleep(3200);
    ok(gesendet.length >= 1, `${gesendet.length} Befehle bei der Auflösung`);
    ok(gesendet.every(g => g.body.ct == null), 'kein Weiß (ct) bei der Auflösung');
    ok(gesendet.length && Array.isArray(gesendet[0].body.xy), 'erster Befehl ist schon die Antwortfarbe');
    // xy der Antwortfarbe B vergleichen (grob: x klein, y mittel → blau)
    ok(gesendet.length && gesendet[0].body.xy[0] < 0.25, `Farbe ist Blau für B (xy ${gesendet.length && gesendet[0].body.xy})`);
    ok(gesendet.length && gesendet[0].body.bri >= 250, 'erst hell (Aufblitzen in Farbe)');
    ok(gesendet.length < 2 || gesendet[1].body.bri < gesendet[0].body.bri, 'danach etwas sanfter');
    // danach zurück ins gedimmte Frage-Licht
    await sleep(3200);
    const letzt = gesendet[gesendet.length - 1];
    ok(gesendet.length >= 3 && letzt.body.bri <= 60 && letzt.t - gesendet[0].t < 4500, `nach gut 3 s wieder gedimmt (bri ${letzt && letzt.body.bri} nach ${letzt && letzt.t - gesendet[0].t} ms)`);
    const abst = gesendet.slice(1).map((g, i) => g.t - gesendet[i].t);
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
