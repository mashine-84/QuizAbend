// Hue-Lichtshow (Hue Entertainment): prüft den eigenen DTLS-Client gegen einen OpenSSL-Server mit denselben
// Einstellungen wie die Hue-Bridge (DTLS 1.2, PSK, AES-128-GCM, Port 2100) und den ganzen Ablauf von
// hue.lichtshow() mit einer nachgebauten Bridge: Start → Verbindung → 125 Bilder → Stopp.
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
  target: { kind: 'entertainment_configuration', id: CONF, name: 'Wohnzimmer' }, lights: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }] }));

// REST der Bridge nachbauen: Bereich mit 3 Kanälen, start/stop merken
const aktionen = [];
https.request = (opt, cb) => {
  const req = new EventEmitter(); let data = '';
  req.write = d => { data += d; }; req.destroy = () => {};
  req.end = () => {
    let antwort = '{}';
    if (opt.method === 'GET' && opt.path.endsWith('entertainment_configuration/' + CONF))
      antwort = JSON.stringify({ errors: [], data: [{ id: CONF, channels: [{ channel_id: 0 }, { channel_id: 1 }, { channel_id: 2 }] }] });
    if (opt.method === 'PUT' && opt.path.endsWith('entertainment_configuration/' + CONF)) aktionen.push(JSON.parse(data).action);
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
    ok(r.ok, 'lichtshow() meldet Erfolg: ' + r.text);
    ok(aktionen[0] === 'start' && aktionen[aktionen.length - 1] === 'stop', `Streaming gestartet und wieder gestoppt (${aktionen.join(' → ')})`);
    ok(srv.anzahl() === 125, `125 Bilder (5 s × 25) gesendet, ${srv.anzahl()} angekommen`);
    const letzte = srv.daten.subarray(srv.daten.lastIndexOf('HueStream'));
    ok(letzte.length >= 52 + 3 * 7, 'jedes Bild enthält alle 3 Kanäle');
    srv.stop();
  } catch (e) { ok(false, 'Ausnahme: ' + e.message); }
  finally { if (srv) srv.stop(); }
  console.log(fehler ? `\n${fehler} Fehler` : '\nAlles gut');
  process.exit(fehler ? 1 : 0);
})();
