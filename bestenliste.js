// Ewige Bestenliste: Siege, Podestplätze und Auszeichnungen über alle Spieleabende (gespeichert in bestenliste.json).
// Spieler werden über ihren Namen wiedererkannt (Groß-/Kleinschreibung egal). Zurücksetzen: ⚙️ › 👥 Spieler.
'use strict';
const fs = require('fs'), path = require('path');

const FILE = process.env.BESTENLISTE_FILE || path.join(__dirname, 'bestenliste.json');
const neu = () => ({ seit: new Date().toISOString(), spiele: 0, spieler: {} });
let data = neu();
try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (d && d.spieler) data = d; } catch (_) {}
const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(data, null, 1)); } catch (e) { console.log('  Bestenliste nicht gespeichert:', e.message); } };
const key = name => String(name || '').trim().toLowerCase();

// Ein beendetes Spiel eintragen. ranking: [{ name, avatar, place }], awards: [{ name, title, icon }], serien: { name: längste Serie }
function eintragen(ranking, awards, serien) {
  if (!ranking || ranking.length < 2) return false;   // allein zählt nicht
  data.spiele++;
  const jetzt = new Date().toISOString();
  for (const p of ranking) {
    const k = key(p.name); if (!k) continue;
    const s = data.spieler[k] || (data.spieler[k] = { name: p.name, avatar: p.avatar, spiele: 0, siege: 0, zweite: 0, dritte: 0, preise: {}, serie: 0 });
    s.name = p.name; s.avatar = p.avatar; s.zuletzt = jetzt; s.spiele++;
    if (p.place === 1) s.siege++; else if (p.place === 2) s.zweite++; else if (p.place === 3) s.dritte++;
    s.serie = Math.max(s.serie || 0, (serien || {})[p.name] || 0);
  }
  for (const a of awards || []) {
    const s = data.spieler[key(a.name)]; if (!s) continue;
    const t = `${a.icon} ${a.title}`;
    s.preise[t] = (s.preise[t] || 0) + 1;
  }
  save();
  return true;
}

// Sortiert: Siege, dann 2./3. Plätze, dann Siegquote
function liste() {
  return Object.values(data.spieler).sort((a, b) => b.siege - a.siege || b.zweite - a.zweite || b.dritte - a.dritte
    || b.siege / b.spiele - a.siege / a.spiele || a.name.localeCompare(b.name, 'de'));
}
function info() { return { seit: data.seit, spiele: data.spiele, liste: liste() }; }
function von(name) { return data.spieler[key(name)] || null; }
function reset() { data = neu(); save(); }

module.exports = { eintragen, info, von, reset, FILE };
