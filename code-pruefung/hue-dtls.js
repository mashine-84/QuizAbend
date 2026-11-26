// Hue-Lichtshow (Hue Entertainment): prüft den eigenen DTLS-Client gegen einen OpenSSL-Server mit denselben
// Einstellungen wie die Hue-Bridge (DTLS 1.2, PSK, AES-128-GCM, Port 2100) und den ganzen Ablauf von
// hue.lichtshow() mit einer nachgebauten Bridge: Start → Verbindung → 125 Bilder → Stopp. Dazu ein Spiel mit Lichtstream
// (Farben bei Frage und Auflösung, Ende in der Lobby) und der Rückfall auf den normalen Weg, wenn der Stream nicht geht.
// Braucht das Programm „openssl“ (auf dem Pi und in GitHub Actions vorhanden); fehlt es, wird übersprungen.
// Aufruf: node code-pruefung/hue-dtls.js
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), https = require('https'), crypto = require('crypto');
const { spawn, spawnSync } = require('child_process'), { EventEmitter } = require('events');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fehler = 0; const ok = (c, t) => { console.log((c ? '  ✓ ' : '  ✗ ') + t); if (!c) fehler++; };

if (spawnSync('openssl', ['version']).status !== 0) { console.log('openssl fehlt – Test übersprungen.'); process.exit(0); }

const APPKEY = 'quizabend-test', CLIENTKEY = crypto.randomBytes(16).toString('hex').toUpperCase();
const CONF = '1a8d99cc-967b-44f2-9202-43f976c0fa6b';

// OpenSSL-DTLS-Server; zählt die empfangenen HueStream-Nachrichten
function server() {
  const p = spawn('openssl', ['s_server', '-dtls1_2', '-accept', '2100', '-nocert', '-quiet', '-psk', CLIENTKEY,
    '-psk_identity', APPKEY, '-cipher', 'PSK-AES128-GCM-SHA256'], { stdio: ['pipe', 'pipe', 'pipe'] });
  const s = { p, daten: Buffer.alloc(0) };
  p.stdout.on('data', d => { s.daten = Buffer.concat([s.daten, d]); });
  s.anzahl = () => s.daten.toString('latin1').split('HueStream').length - 1;
  s.stop = () => { try { p.stdin.end(); p.kill(); } catch (_) {} };
  return s;
}

// hue.js + hue-dtls.js in eine Kopie mit eigener hue.json (Bridge = 127.0.0.1, Unterhaltungsbereich gewählt)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'quizabend-huedtls-'));
for (const f of ['hue.js', 'hue-dtls.js']) fs.copyFileSync(path.join(__dirname, '..', f), path.join(TMP, f));
fs.writeFileSync(path.join(TMP, 'hue.json'), JSON.stringify({ enabled: true, ip: '127.0.0.1', appKey: APPKEY, clientKey: CLIENTKEY,
  target: { kind: 'entertainment_configuration', id: CONF, name: 'Wohnzimmer' }, group: '200', lights: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }] }));

// REST der Bridge nachbauen: Bereich mit 3 Kanälen, start/stop merken
const aktionen = [], gruppe = [];
https.request = (opt, cb) => {
  const req = new EventEmitter(); let data = '';
  req.write = d => { data += d; }; req.destroy = () => {};
  req.end = () => {
    let antwort = '{}';
    if (opt.method === 'GET' && opt.path.endsWith('entertainment_configuration/' + CONF))
      antwort = JSON.stringify({ errors: [], data: [{ id: CONF, status: 'active', channels: [   // absichtlich nicht von links nach rechts sortiert
        { channel_id: 0, position: { x: 0.3 } }, { channel_id: 1, position: { x: -1 } }, { channel_id: 2, position: { x: 1 } }, { channel_id: 3, position: { x: -0.3 } }] }] });
    if (opt.method === 'PUT' && opt.path.endsWith('entertainment_configuration/' + CONF)) aktionen.push(JSON.parse(data).action);
    if (opt.method === 'PUT' && /groups\/200\/action/.test(opt.path)) gruppe.push(JSON.parse(data));
    const res = new EventEmitter(); res.statusCode = 200;
    setImmediate(() => { cb(res); res.emit('data', antwort); res.emit('end'); });
  };
  return req;
};
const hue = require(path.join(TMP, 'hue.js'));
const dtls = require(path.join(TMP, 'hue-dtls.js'));

(async () => {
  let srv;
  try {
    console.log('DTLS-Client gegen OpenSSL:');
    srv = server(); await sleep(700);
    const s = await dtls.connect({ host: '127.0.0.1', identity: APPKEY, psk: Buffer.from(CLIENTKEY, 'hex') });
    ok(true, 'Handshake klappt');
    for (let i = 0; i < 20; i++) { s.send(dtls.hueStream(CONF, i, [{ id: 0, r: 65535, g: 0, b: 0 }])); await sleep(20); }
    await sleep(300);
    ok(srv.anzahl() === 20, `20 Nachrichten gesendet, ${srv.anzahl()} angekommen`);
    const roh = srv.daten.subarray(srv.daten.indexOf('HueStream'));
    ok(roh.subarray(9, 11).equals(Buffer.from([2, 0])) && roh.subarray(16, 52).toString() === CONF, 'HueStream v2: Kopf und Bereichs-ID stimmen');
    s.close(); srv.stop(); await sleep(400);

    srv = server(); await sleep(700);
    let abgelehnt = false;
    await dtls.connect({ host: '127.0.0.1', identity: APPKEY, psk: Buffer.alloc(16, 7), timeout: 1500 }).then(c => c.close(), () => { abgelehnt = true; });
    ok(abgelehnt, 'falscher Schlüssel wird sauber abgelehnt (kein Absturz)');
    srv.stop(); await sleep(400);

    console.log('Lichtshow-Ablauf mit nachgebauter Bridge:');
    srv = server(); await sleep(700);
    const r = await hue.lichtshow();
    await sleep(300);
    ok(r.ok, 'lichtshow() meldet Erfolg: ' + r.text.replace('4 Lampen', '4 Lampen'));
    ok(aktionen[0] === 'start' && aktionen[aktionen.length - 1] === 'stop', `Streaming gestartet und wieder gestoppt (${aktionen.join(' → ')})`);
    ok(srv.anzahl() === 125, `125 Bilder (5 s × 25) gesendet, ${srv.anzahl()} angekommen`);
    const letzte = srv.daten.subarray(srv.daten.lastIndexOf('HueStream'));
    ok(letzte.length >= 52 + 4 * 7, 'jedes Bild enthält alle 4 Kanäle');
    srv.stop(); await sleep(400);

    console.log('Spiel mit Lichtstream:');
    // Farbe von Kanal 0 im zuletzt empfangenen Bild (0–65535)
    const farbe = () => { const i = srv.daten.lastIndexOf('HueStream'), b = srv.daten.subarray(i + 52 + 1, i + 52 + 7); return b.length === 6 ? [b.readUInt16BE(0), b.readUInt16BE(2), b.readUInt16BE(4)] : null; };
    srv = server(); await sleep(700); aktionen.length = 0;
    await hue.onPhase('ident'); await sleep(1500);
    ok(hue.status().streamAktiv && aktionen[0] === 'start', 'Stream startet mit dem Spiel');
    await hue.onPhase('question'); await sleep(1600);
    let c = farbe(); ok(c && c[2] > c[0] && c[2] > c[1] && c[2] < 20000, `Frage: gedimmtes Blau (${c})`);
    const vorher = srv.anzahl();
    await hue.onPhase('reveal', { q: 1, correct: 0 }); await sleep(700);   // nach der Welle (0,6 s) sind alle Lampen dran
    c = farbe(); ok(c && c[0] > 60000 && c[2] < 10000, `Auflösung A: sofort volles Orange-Rot (${c})`);
    await sleep(2000);
    c = farbe(); ok(c && c[0] < 30000 && c[0] > c[2], `danach in derselben Farbe abgedunkelt, kein Weiß (${c})`);
    await sleep(2600);
    c = farbe(); ok(c && c[2] > c[0] && c[2] < 20000, `zurück im gedimmten Blau (${c})`);
    const n = srv.anzahl() - vorher;
    ok(n > 110 && n < 145, `gleichmäßig ~25 Bilder pro Sekunde (${n} in 5,3 s)`);
    await hue.onPhase('lobby'); await sleep(300);
    const nachLobby = srv.anzahl(); await sleep(400);
    ok(!hue.status().streamAktiv && aktionen[aktionen.length - 1] === 'stop' && srv.anzahl() === nachLobby, 'Lobby: Stream gestoppt, Lampen wieder frei');
    srv.stop(); await sleep(400);

    console.log('Lichteffekte im Stream:');
    // Farbe je Kanal im zuletzt empfangenen Bild; Reihenfolge links → rechts: 1, 3, 0, 2
    const bild = () => { const i = srv.daten.lastIndexOf('HueStream'), f = {}; for (let o = i + 52; o + 7 <= srv.daten.length && srv.daten.subarray(o, o + 9).toString() !== 'HueStream'; o += 7) f[srv.daten[o]] = [srv.daten.readUInt16BE(o + 1), srv.daten.readUInt16BE(o + 3), srv.daten.readUInt16BE(o + 5)]; return f; };
    const hell = c => Math.max(...c);
    srv = server(); await sleep(700);
    await hue.onPhase('ident'); await sleep(1200);
    await hue.onPhase('intro'); await sleep(300);
    await hue.onPhase('question', { kind: 'choice', n: 4, ends: Date.now() + 4200 }); await sleep(1500);
    let f = bild();
    const blau = Object.values(f).every(c => c[2] > c[0] && c[2] > c[1]);
    ok(blau && new Set(Object.values(f).map(String)).size === 1, 'Frage: alle Lampen gleiches gedimmtes Blau (keine Antwortfarben)');
    // Countdown-Ende bei +4200 ms ab Fragebeginn: jetzt (≈1,5 s) sind noch ≈2,7 s übrig → Pulse bei 3, 2 und 1
    const verlauf = []; for (let i = 0; i < 52; i++) { verlauf.push([Date.now(), hell(bild()[1] || [0])]); await sleep(50); }
    const spitzen = verlauf.filter((v, i) => i > 0 && i < verlauf.length - 1 && v[1] > verlauf[i - 1][1] && v[1] >= verlauf[i + 1][1] && v[1] > 6000);
    ok(spitzen.length >= 2 && spitzen.length <= 3, `ein Puls pro Sekunde (${spitzen.length} Spitzen in 2,6 s)`);
    ok(spitzen.length >= 2 && spitzen[1][1] > spitzen[0][1], `jeder Puls heller als der vorige (${spitzen.map(v => v[1]).join(' < ')})`);
    await hue.onPhase('reveal', { q: 2, correct: 0 }); await sleep(170);
    f = bild();
    ok(f[1][0] > 60000 && f[2][0] < 40000, `Welle: links schon Orange-Rot (${f[1]}), rechts noch nicht (${f[2]})`);
    await sleep(700); f = bild();
    ok(f[2][0] > 60000, `Welle ist rechts angekommen (${f[2]})`);
    await hue.onPhase('special'); await sleep(600);
    const sp = []; for (let i = 0; i < 20; i++) { const b = bild(); sp.push(Object.values(b).map(hell)); await sleep(50); }
    ok(sp.every(r => Math.max(...r) - Math.min(...r) < 2000) && Math.max(...sp.flat()) > 2 * Math.min(...sp.flat()), 'Spezialfrage: alle Lampen pulsieren ruhig und gleich (kein Lauflicht)');
    await hue.onPhase('end', { winnerColor: '#4aa3f0' }); await sleep(600);
    const en = []; for (let i = 0; i < 20; i++) { const b = bild(); en.push(Object.values(b).map(hell)); await sleep(50); }
    ok(en.every(r => Math.max(...r) - Math.min(...r) < 2000), 'Siegerehrung: alle Lampen gleich (kein Feuerwerk)');
    hue.setEffekt('welle', false);
    await hue.onPhase('reveal', { q: 3, correct: 1 }); await sleep(90); f = bild();
    ok(f[2][2] > 60000, 'Welle abgeschaltet: alle Lampen sofort in der Antwortfarbe');
    hue.setEffekt('welle', true);
    await hue.onPhase('lobby'); srv.stop(); await sleep(400);

    console.log('Stream geht nicht → normaler Weg:');
    gruppe.length = 0;
    await hue.onPhase('ident'); await sleep(3600);   // kein DTLS-Server: Verbindungsaufbau läuft in die Zeitüberschreitung
    ok(!hue.status().streamAktiv && hue.status().streamFehler, 'Fehler wird erkannt und angezeigt');
    await hue.onPhase('question'); await sleep(1200);
    ok(gruppe.some(b => b.xy && b.bri), `Licht kommt über Gruppenbefehle (${gruppe.length} gesendet)`);
    await hue.onPhase('lobby');
    ok(!hue.status().streamFehler, 'in der Lobby zurückgesetzt – nächstes Spiel probiert den Stream wieder');
  } catch (e) { ok(false, 'Ausnahme: ' + e.message); }
  finally { if (srv) srv.stop(); }
  console.log(fehler ? `\n${fehler} Fehler` : '\nAlles gut');
  process.exit(fehler ? 1 : 0);
})();
