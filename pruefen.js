#!/usr/bin/env node
// Prüft alle Fragendateien unter fragen/ auf die Regeln aus fragen/REGELN.md.
//   node pruefen.js            alle Pakete
//   node pruefen.js Sport      nur Dateien, deren Pfad „Sport“ enthält
// ✗ Fehler: muss behoben werden (Exit-Code 1) · ⚠ Hinweis: bitte prüfen, darf aber bleiben, wenn es Absicht ist.
// Kein Paket nötig – nur Node.js.
const fs = require('fs'), path = require('path');
// im QuizAbend-Repo: fragen/ (inkl. Kopie des Fragen-Repos unter fragen/_repo) – im Fragen-Repo selbst: dessen Hauptordner
const DIR = fs.existsSync(path.join(__dirname, 'fragen')) ? path.join(__dirname, 'fragen') : __dirname;
const filter = process.argv[2] || '';

// Grenzen, damit Text auf Fernseher (720p) und Handy ohne Gedrängel passt
const LIMIT = {
  frage: [100, 160],      // ab 100 Zeichen Hinweis, ab 160 Fehler
  antwort: [45, 80],
  aussage: [90, 140],
  paar: [40, 70],
};
// Wörter, die oft auf veraltende Fakten hindeuten (dann lieber Stichtag in die Frage: „Stand 2025“)
const ZEITWORT = /\b(aktuell\w*|derzeit\w*|zurzeit|momentan\w*|heute|heutig\w*|neueste\w*|jüngste\w*|amtierend\w*)\b/i;
const MEDIA = { bild: ['bilder', /\.(jpe?g|png|gif|webp|svg)$/i], video: ['videos', /\.(mp4|m4v|webm|mov)$/i], audio: ['audio', /\.(mp3|m4a|aac|ogg|opus|wav)$/i] };

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    if (e.isDirectory()) walk(f);
    else if (e.name.toLowerCase().endsWith('.json') && f.includes(filter)) files.push(f);
  }
})(DIR);

let errors = 0, warnings = 0, total = 0;
const seen = new Map();   // normalisierter Fragetext -> Fundstelle (Dubletten über alle Pakete)
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();
const len = s => [...String(s)].length;

for (const file of files.sort()) {
  const rel = path.relative(DIR, file), out = [];
  const err = (where, msg) => { out.push(`  ✗ ${where}: ${msg}`); errors++; };
  const warn = (where, msg) => { out.push(`  ⚠ ${where}: ${msg}`); warnings++; };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.log(`\n${rel}\n  ✗ Datei ist kein gültiges JSON: ${e.message}`); errors++; continue; }
  const list = Array.isArray(raw) ? raw : raw && raw.fragen;
  if (!Array.isArray(list)) { console.log(`\n${rel}\n  ✗ es fehlt die Liste "fragen"`); errors++; continue; }
  if (!Array.isArray(raw) && !raw.paket) warn('Datei', 'kein "paket"-Name (dann gilt der Dateiname)');
  let tfTrue = 0, tfAll = 0;

  list.forEach((q, i) => {
    total++;
    const where = `#${i + 1}${q && q.frage ? ' „' + String(q.frage).slice(0, 45) + (len(q.frage) > 45 ? '…' : '') + '“' : ''}`;
    if (!q || typeof q !== 'object') return err(where, 'ist kein gültiger Eintrag');
    if (!q.frage) return err(where, 'das Feld "frage" fehlt');
    const types = ['antworten', 'schaetzen', 'zuordnen', 'behauptungen'].filter(k => q[k] !== undefined);
    if (types.length !== 1) return err(where, types.length ? `mehrere Fragearten gleichzeitig (${types.join(', ')})` : 'es fehlt "antworten", "schaetzen", "zuordnen" oder "behauptungen"');

    // allgemein
    if (q.schwierigkeit === undefined && !(raw && raw.schwierigkeit)) warn(where, 'keine "schwierigkeit" (1, 2 oder 3) – zählt dann als 1');
    else if (q.schwierigkeit !== undefined && ![1, 2, 3].includes(q.schwierigkeit)) err(where, '"schwierigkeit" muss 1, 2 oder 3 sein');
    const fl = len(q.frage);
    if (fl > LIMIT.frage[1]) err(where, `Frage zu lang (${fl} Zeichen, max. ${LIMIT.frage[1]})`);
    else if (fl > LIMIT.frage[0]) warn(where, `Frage lang (${fl} Zeichen) – kürzer liest sich am Fernseher besser`);
    if (ZEITWORT.test(q.frage) && !/\b(19|20)\d\d\b/.test(q.frage)) warn(where, `„${q.frage.match(ZEITWORT)[0]}“ – veraltet die Antwort? Dann Stichtag in die Frage („Stand 2025“)`);
    const key = norm(q.frage) + '|' + norm(JSON.stringify(q.antworten || q.schaetzen || q.zuordnen || q.behauptungen));
    if (seen.has(key)) err(where, `doppelt – gleiche Frage steht schon in ${seen.get(key)}`); else seen.set(key, `${rel} #${i + 1}`);
    for (const [field, [sub, ext]] of Object.entries(MEDIA)) {
      if (!q[field]) continue;
      const name = String(q[field]), d = path.dirname(file);
      if (!ext.test(name)) err(where, `"${field}": Dateityp von „${name}“ wird nicht unterstützt`);
      else if (![path.join(d, name), path.join(d, sub, name)].some(f => fs.existsSync(f))) err(where, `"${field}": „${name}“ nicht gefunden (in den Ordner „${sub}“ neben der Datei legen)`);
    }
    if (q.merken !== undefined && !q.bild) err(where, '"merken" braucht ein "bild"');

    // je Frageart
    if (q.antworten !== undefined) {
      const a = q.antworten;
      if (!Array.isArray(a) || a.length < 2) return err(where, '"antworten" braucht mindestens 2 Einträge (die richtige zuerst)');
      if (a.length > 4) err(where, `${a.length} Antworten – nur die ersten 4 werden benutzt`);
      else if (a.length < 4) warn(where, `nur ${a.length} Antworten – 4 sind Standard`);
      if (new Set(a.map(norm)).size !== a.length) err(where, 'zwei Antworten sind gleich');
      a.forEach(x => { const l = len(x); if (l > LIMIT.antwort[1]) err(where, `Antwort zu lang (${l} Zeichen): „${String(x).slice(0, 40)}…“`); else if (l > LIMIT.antwort[0]) warn(where, `Antwort lang (${l} Zeichen): „${String(x).slice(0, 40)}…“`); });
      if (a.some(x => /^(alle|keine) (der )?(genannten|antworten)/i.test(x))) warn(where, '„alle/keine der genannten“ – lieber vier echte Antworten');
    }
    if (q.schaetzen !== undefined) {
      const v = Number(String(q.schaetzen).replace(',', '.'));
      if (!isFinite(v)) err(where, '"schaetzen" muss eine Zahl sein');
      const year = q.jahr !== undefined ? !!q.jahr : /\bJahr\b/i.test(q.frage);
      if (!year && !q.einheit && !/^wie viele\b/i.test(q.frage)) warn(where, 'keine "einheit" – bei Schätzfragen hilft z. B. „m“, „km“, „Stück“');
    }
    if (q.zuordnen !== undefined) {
      const pairs = Array.isArray(q.zuordnen) ? q.zuordnen : Object.entries(q.zuordnen);
      if (pairs.length < 2 || pairs.length > 6) err(where, `"zuordnen" braucht 2 bis 6 Paare (hat ${pairs.length})`);
      else if (pairs.length < 3 || pairs.length > 5) warn(where, `${pairs.length} Paare – 3 bis 5 spielen sich am besten`);
      pairs.flat().forEach(x => { const l = len(x); if (l > LIMIT.paar[1]) err(where, `Begriff zu lang (${l} Zeichen): „${String(x).slice(0, 40)}…“`); else if (l > LIMIT.paar[0]) warn(where, `Begriff lang (${l} Zeichen): „${String(x).slice(0, 40)}…“`); });
      const L = pairs.map(p => norm(p[0])), R = pairs.map(p => norm(p[1]));
      if (new Set(L).size !== L.length || new Set(R).size !== R.length) err(where, 'ein Begriff kommt doppelt vor');
    }
    if (q.behauptungen !== undefined) {
      const raw2 = Array.isArray(q.behauptungen) ? q.behauptungen : Object.entries(q.behauptungen);
      const items = raw2.map(b => Array.isArray(b) ? b : b && typeof b === 'object' ? [b.text ?? b.behauptung, b.richtig] : [null, null]);
      if (items.length < 2 || items.length > 5 || items.some(([t, r]) => !t || typeof r !== 'boolean')) err(where, '"behauptungen" braucht 2 bis 5 Aussagen mit true/false');
      else {
        if (items.length !== 3) warn(where, `${items.length} Aussagen – 3 sind Standard`);
        items.forEach(([t]) => { const l = len(t); if (l > LIMIT.aussage[1]) err(where, `Aussage zu lang (${l} Zeichen)`); else if (l > LIMIT.aussage[0]) warn(where, `Aussage lang (${l} Zeichen)`); });
        tfTrue += items.filter(x => x[1]).length; tfAll += items.length;
      }
    }
  });
  if (tfAll >= 6 && (tfTrue / tfAll < 0.3 || tfTrue / tfAll > 0.7)) warn('Paket', `Richtig/Falsch unausgewogen: ${tfTrue} von ${tfAll} Aussagen stimmen – etwa die Hälfte ist besser`);
  console.log(`\n${rel} (${list.length} Fragen)${out.length ? '\n' + out.join('\n') : '  ✓'}`);
}

console.log(`\n${total} Fragen in ${files.length} Dateien geprüft: ${errors} Fehler, ${warnings} Hinweise.`);
process.exit(errors ? 1 : 0);
