// Gemeldete Fragen: Spieler tippen bei der Auflösung am Handy „⚑ Stimmt was nicht?“ und einen Grund an.
// Gespeichert in meldungen.json (gitignored). Der Host sieht die Liste unter ⚙️ › 📚 Fragen und kann sie als Textdatei
// herunterladen – die gibt er Claude, der damit die Fragen im Fragen-Repo überarbeitet.
'use strict';
const fs = require('fs'), path = require('path');

const FILE = process.env.MELDUNGEN_FILE || path.join(__dirname, 'meldungen.json');
const GRUENDE = {
  falsch: '❌ Antwort falsch',
  unklar: '❓ Frage unklar',
  leicht: '😴 Zu leicht',
  schwer: '🤯 Zu schwer',
  technik: '🔇 Bild/Ton kaputt',
};

let list = [];   // [{ uid, datei, nr, paket, frage, loesung, grund, spieler, zeit, stand }]
try { list = JSON.parse(fs.readFileSync(FILE, 'utf8')) || []; } catch (_) { list = []; }
let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(() => { try { fs.writeFileSync(FILE, JSON.stringify(list, null, 1)); } catch (e) { console.log('  Meldungen nicht gespeichert:', e.message); } }, 500);
}

// Richtige Lösung als Text (damit man die Meldung ohne Spiel versteht)
function loesung(q) {
  if (q.kind === 'choice') return q.answers[Number.isInteger(q.correct) ? q.correct : 0];   // im Spiel sind die Antworten gemischt
  if (q.kind === 'estimate') return `${String(q.value).replace('.', ',')}${q.unit ? ' ' + q.unit : ''}${q.tolerance != null ? ` (±${q.tolerance})` : ''}`;
  if (q.kind === 'match') return q.pairs.map(([a, b]) => `${a} → ${b}`).join(', ');
  if (q.kind === 'tf') return q.items.map(([t, r]) => `${t} (${r ? 'richtig' : 'falsch'})`).join(' | ');
  if (q.kind === 'pin') return `${q.name || 'Ort'}${Array.isArray(q.target) ? ` [${q.target.join(', ')}]` : ''}${q.radius ? `, Radius ${q.radius} km` : ''}`;
  if (q.kind === 'land') return q.name || q.region || '';
  return '';
}

// Paket-ID „_repo/Sport/Fussball“ → Datei im Fragen-Repo „Sport/Fussball.json“, Position ab 1 (wie pruefen.js)
function ort(uid) {
  const [pack, idx] = String(uid).split('#');
  return { datei: pack.replace(/^_repo\//, '') + '.json', nr: Number(idx) + 1, repo: pack.startsWith('_repo/') };
}

function add(q, grund, spieler, stand) {
  if (!q || !q.uid || !GRUENDE[grund]) return false;
  const name = String(spieler || '?').slice(0, 20);
  // pro Spieler und Frage nur eine Meldung – ein neuer Grund ersetzt den alten
  list = list.filter(m => !(m.uid === q.uid && m.spieler === name));
  const o = ort(q.uid);
  list.push({ uid: q.uid, datei: o.datei, nr: o.nr, paket: q.pack || '', frage: q.text, loesung: loesung(q), grund, spieler: name, zeit: new Date().toISOString(), stand: stand || null });
  save();
  return true;
}
function removeOne(uid, spieler) { const n = list.length; list = list.filter(m => !(m.uid === uid && m.spieler === spieler)); if (list.length !== n) save(); }
function remove(uid) { const n = list.length; list = uid ? list.filter(m => m.uid !== uid) : []; if (list.length !== n) save(); }
function mine(uid, spieler) { const m = list.find(x => x.uid === uid && x.spieler === spieler); return m ? m.grund : null; }

// Zusammengefasst je Frage (neueste zuerst)
function grouped() {
  const by = new Map();
  for (const m of list) {
    let g = by.get(m.uid);
    if (!g) by.set(m.uid, g = { uid: m.uid, datei: m.datei, nr: m.nr, paket: m.paket, frage: m.frage, loesung: m.loesung, stand: m.stand, gruende: {}, spieler: [], zuletzt: m.zeit });
    (g.gruende[m.grund] = g.gruende[m.grund] || []).push(m.spieler);
    g.spieler.push(m.spieler);
    if (m.zeit > g.zuletzt) { g.zuletzt = m.zeit; g.frage = m.frage; g.loesung = m.loesung; g.stand = m.stand; }
  }
  return [...by.values()].sort((a, b) => b.zuletzt.localeCompare(a.zuletzt));
}

// Textdatei für Claude: alles, was man braucht, um die Frage im Fragen-Repo zu finden und zu verbessern
function text() {
  const g = grouped(), d = new Date().toLocaleDateString('de-DE');
  const out = [`# QuizAbend – gemeldete Fragen (${d}, ${g.length} ${g.length === 1 ? 'Frage' : 'Fragen'})`, '',
    'Datei und Position (ab 1) beziehen sich auf das Fragen-Repo; „Stand“ ist der Commit, mit dem gespielt wurde.', ''];
  for (const x of g) {
    out.push(`## ${x.datei}, Frage ${x.nr}`);
    out.push(`- ID: ${x.uid}${x.stand ? ` · Stand: ${x.stand}` : ''}`);
    out.push(`- Frage: ${x.frage}`);
    out.push(`- Lösung: ${x.loesung}`);
    out.push(`- Meldungen: ${Object.entries(x.gruende).map(([k, s]) => `${s.length}× ${GRUENDE[k].replace(/^\S+ /, '')} (${s.join(', ')})`).join('; ')}`);
    out.push('');
  }
  return out.join('\n');
}

module.exports = { GRUENDE, add, remove, removeOne, mine, grouped, text, count: () => grouped().length, FILE };
