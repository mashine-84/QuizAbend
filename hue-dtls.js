// Hue Entertainment: minimaler DTLS-1.2-Client – genau das, was die Hue-Bridge verlangt
// (Port 2100, vorab vereinbarter Schlüssel, TLS_PSK_WITH_AES_128_GCM_SHA256). Nur node:crypto und node:dgram,
// keine Abhängigkeiten (Node hat DTLS erst ab 26.9 und nur experimentell).
// Nicht dabei, weil im Heimnetz unnötig: Fragmentierung, erneutes Senden verlorener Pakete, Neuverhandlung.
// Test gegen OpenSSL mit denselben Einstellungen: node code-pruefung/hue-dtls.js
'use strict';
const dgram = require('node:dgram');
const crypto = require('node:crypto');

const V = Buffer.from([0xfe, 0xfd]);          // DTLS 1.2
const SUITE = 0x00a8;                          // TLS_PSK_WITH_AES_128_GCM_SHA256

function prf(secret, label, seed, len) {       // TLS-1.2-PRF mit SHA-256
  const s = Buffer.concat([Buffer.from(label), seed]);
  const out = []; let a = s, n = 0;
  while (n < len) {
    a = crypto.createHmac('sha256', secret).update(a).digest();
    const p = crypto.createHmac('sha256', secret).update(Buffer.concat([a, s])).digest();
    out.push(p); n += p.length;
  }
  return Buffer.concat(out).subarray(0, len);
}
const u16 = n => Buffer.from([n >> 8, n & 255]);
const u24 = n => Buffer.from([n >> 16, (n >> 8) & 255, n & 255]);
const u48 = n => { const b = Buffer.alloc(6); b.writeUIntBE(n, 0, 6); return b; };

function connect({ host, port = 2100, identity, psk, timeout = 3000 }) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const clientRandom = crypto.randomBytes(32);
    let serverRandom = null, cookie = Buffer.alloc(0), msgSeq = 0, recSeq0 = 0;
    let transcript = [];             // Handshake-Nachrichten fürs Finished (ohne 1. ClientHello und HelloVerifyRequest)
    let keys = null, recSeq1 = 0, gotServerHelloDone = false, done = false;
    const timer = setTimeout(() => { if (!done) { sock.close(); reject(new Error('DTLS: Zeitüberschreitung beim Handshake')); } }, timeout);

    const record = (type, epoch, seq, body) => Buffer.concat([Buffer.from([type]), V, u16(epoch), u48(seq), u16(body.length), body]);
    const hsMsg = (type, body) => {   // Handshake-Nachricht mit DTLS-Kopf (unfragmentiert)
      const m = Buffer.concat([Buffer.from([type]), u24(body.length), u16(msgSeq++), u24(0), u24(body.length), body]);
      return m;
    };
    const encrypt = (type, plain) => {
      const seq = recSeq1++, epochSeq = Buffer.concat([u16(1), u48(seq)]);
      const nonce = Buffer.concat([keys.cIV, epochSeq]);
      const c = crypto.createCipheriv('aes-128-gcm', keys.cKey, nonce);
      c.setAAD(Buffer.concat([epochSeq, Buffer.from([type]), V, u16(plain.length)]));
      const body = Buffer.concat([epochSeq, c.update(plain), c.final(), c.getAuthTag()]);
      return record(type, 1, seq, body);
    };
    const decrypt = (type, epochSeq, body) => {
      const explicit = body.subarray(0, 8), tag = body.subarray(body.length - 16), ct = body.subarray(8, body.length - 16);
      const d = crypto.createDecipheriv('aes-128-gcm', keys.sKey, Buffer.concat([keys.sIV, explicit]));
      d.setAAD(Buffer.concat([epochSeq, Buffer.from([type]), V, u16(ct.length)])); d.setAuthTag(tag);
      return Buffer.concat([d.update(ct), d.final()]);
    };
    const clientHello = () => {
      const body = Buffer.concat([V, clientRandom, Buffer.from([0]), Buffer.from([cookie.length]), cookie,
        u16(2), u16(SUITE), Buffer.from([1, 0])]);
      const m = hsMsg(1, body);
      transcript = [m];   // ohne HelloVerifyRequest zählt das erste ClientHello, mit ihm nur das zweite
      sock.send(record(22, 0, recSeq0++, m), port, host);
    };
    const finishClient = () => {
      const idb = Buffer.from(identity);
      const cke = hsMsg(16, Buffer.concat([u16(idb.length), idb])); transcript.push(cke);
      const N = psk.length, pre = Buffer.concat([u16(N), Buffer.alloc(N), u16(N), psk]);
      const ms = prf(pre, 'master secret', Buffer.concat([clientRandom, serverRandom]), 48);
      const kb = prf(ms, 'key expansion', Buffer.concat([serverRandom, clientRandom]), 40);
      keys = { ms, cKey: kb.subarray(0, 16), sKey: kb.subarray(16, 32), cIV: kb.subarray(32, 36), sIV: kb.subarray(36, 40) };
      const hash = crypto.createHash('sha256').update(Buffer.concat(transcript)).digest();
      const fin = hsMsg(20, prf(ms, 'client finished', hash, 12)); transcript.push(fin);
      sock.send(Buffer.concat([record(22, 0, recSeq0++, cke), record(20, 0, recSeq0++, Buffer.from([1])), encrypt(22, fin)]), port, host);
    };
    sock.on('message', buf => { try { onMessage(buf); } catch (e) { if (!done) { done = true; clearTimeout(timer); try { sock.close(); } catch (_) {} reject(new Error('DTLS: ' + e.message)); } } });
    function onMessage(buf) {
      for (let o = 0; o + 13 <= buf.length;) {
        const type = buf[o], epoch = buf.readUInt16BE(o + 3), len = buf.readUInt16BE(o + 11);
        const epochSeq = buf.subarray(o + 3, o + 11), body = buf.subarray(o + 13, o + 13 + len); o += 13 + len;
        if (type === 21) { const a = epoch ? decrypt(21, epochSeq, body) : body; if (!done) { done = true; clearTimeout(timer); sock.close(); return reject(new Error('DTLS-Alarm ' + a.toString('hex'))); } continue; }
        if (done) continue;   // nach dem Handshake schickt die Bridge nichts Wichtiges mehr
        if (type === 20) continue;                       // ChangeCipherSpec des Servers
        if (type !== 22) continue;
        const plain = epoch ? decrypt(22, epochSeq, body) : body;
        const mt = plain[0], mlen = plain.readUIntBE(1, 3), mb = plain.subarray(12, 12 + mlen);
        if (mt === 3) { cookie = mb.subarray(3, 3 + mb[2]); clientHello(); continue; }      // HelloVerifyRequest
        if (mt === 20) {                                                                     // Finished des Servers prüfen
          const hash = crypto.createHash('sha256').update(Buffer.concat(transcript)).digest();
          const ok = prf(keys.ms, 'server finished', hash, 12).equals(mb);
          done = true; clearTimeout(timer);
          if (!ok) { sock.close(); return reject(new Error('DTLS: Finished des Servers passt nicht')); }
          return resolve({ send: data => sock.send(encrypt(23, data), port, host), close: () => { try { sock.send(encrypt(21, Buffer.from([1, 0])), port, host, () => sock.close()); } catch (_) { sock.close(); } } });
        }
        transcript.push(plain.subarray(0, 12 + mlen));
        if (mt === 2) serverRandom = mb.subarray(2, 34);                                     // ServerHello
        if (mt === 14 && !gotServerHelloDone) { gotServerHelloDone = true; finishClient(); } // ServerHelloDone
      }
    }
    sock.on('error', e => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    clientHello();
  });
}

// HueStream-Nachricht (API v2): Kopf, Konfigurations-ID, je Kanal ID + RGB16
function hueStream(configId, seq, channels) {
  const head = Buffer.concat([Buffer.from('HueStream'), Buffer.from([2, 0, seq & 255, 0, 0, 0, 0]), Buffer.from(configId)]);
  return Buffer.concat([head, ...channels.map(c => Buffer.from([c.id, c.r >> 8, c.r & 255, c.g >> 8, c.g & 255, c.b >> 8, c.b & 255]))]);
}

module.exports = { connect, hueStream };
