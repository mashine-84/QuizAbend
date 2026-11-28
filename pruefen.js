#!/usr/bin/env node
// Prüft alle Fragendateien unter fragen/ auf die Regeln aus fragen/REGELN.md.
//   node pruefen.js            alle Pakete
//   node pruefen.js Sport      nur Dateien, deren Pfad „Sport“ enthält
// ✗ Fehler: muss behoben werden (Exit-Code 1) · ⚠ Hinweis: bitte prüfen, darf aber bleiben, wenn es Absicht ist.
// Kein Paket nötig – nur Node.js.
const fs = require('fs'), path = require('path');
// Ländernamen aus den Karten des Quiz (wenn auffindbar): QuizAbend/public/karten/*.json
const KARTEN = {};
for (const dir of [path.join(__dirname, '..', 'QuizAbend', 'public', 'karten'), path.join(__dirname, '..', 'quizabend', 'public', 'karten'), path.join(__dirname, '..', '..', 'public', 'karten')]) {
  try {
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.json') && !KARTEN[f.slice(0, -5)]) {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      KARTEN[m.name] = new Set(m.regions.flatMap(r => [r.id.toLowerCase(), r.n.toLowerCase()]));
    }
  } catch (_) {}
}
// im QuizAbend-Repo: fragen/ (inkl. Kopie des Fragen-Repos unter fragen/_repo) – im Fragen-Repo selbst: dessen Hauptordner
const DIR = fs.existsSync(path.join(__dirname, 'fragen')) ? path.join(__dirname, 'fragen') : __dirname;
const filter = process.argv[2] || '';

// Grenzen, damit Text auf Fernseher (720p) und Handy ohne Gedrängel passt
const LIMIT = {
  frage: [100, 160],      // ab 100 Zeichen Hinweis, ab 160 Fehler
  antwort: [45, 80],
  aussage: [90, 140],
  paar: [40, 70],
  info: [140, 200],       // „💡 Übrigens“ bei der Auflösung
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
  // Aktuelles/Jahresrückblick: "stand" (JJJJ-MM-TT) ist Pflicht; älter als 2 Monate → neu erzeugen (REGELN.md, Jahresrückblick)
  const stand = !Array.isArray(raw) && raw.stand;
  if (/^Aktuelles[\\/]/.test(rel) && !stand) err('Datei', 'Pakete unter „Aktuelles“ brauchen "stand": "JJJJ-MM-TT" (Tag der Erstellung)');
  if (stand) {
    const t = Date.parse(stand + 'T00:00:00Z');
    if (!/^\d{4}-\d\d-\d\d$/.test(stand) || isNaN(t)) err('Datei', `"stand" muss ein Datum JJJJ-MM-TT sein, nicht „${stand}“`);
    else {
      const tage = Math.floor((Date.now() - t) / 864e5);
      if (tage > 61) warn('Datei', `⏰ Stand ${stand} ist ${tage} Tage alt (über 2 Monate) – Fragen neu erzeugen: nur Ereignisse der letzten 12 Monate (REGELN.md, Jahresrückblick)`);
    }
  }
  let tfTrue = 0, tfAll = 0;

  list.forEach((q, i) => {
    total++;
    const where = `#${i + 1}${q && q.frage ? ' „' + String(q.frage).slice(0, 45) + (len(q.frage) > 45 ? '…' : '') + '“' : ''}`;
    if (!q || typeof q !== 'object') return err(where, 'ist kein gültiger Eintrag');
    if (!q.frage) return err(where, 'das Feld "frage" fehlt');
    const types = ['antworten', 'schaetzen', 'zuordnen', 'behauptungen', 'karte'].filter(k => q[k] !== undefined);
    if (types.length !== 1) return err(where, types.length ? `mehrere Fragearten gleichzeitig (${types.join(', ')})` : 'es fehlt "antworten", "schaetzen", "zuordnen", "behauptungen" oder "karte"');

    // allgemein
    if (q.schwierigkeit === undefined && !(raw && raw.schwierigkeit)) warn(where, 'keine "schwierigkeit" (1, 2 oder 3) – zählt dann als 1');
    else if (q.schwierigkeit !== undefined && ![1, 2, 3].includes(q.schwierigkeit)) err(where, '"schwierigkeit" muss 1, 2 oder 3 sein');
    const fl = len(q.frage);
    if (fl > LIMIT.frage[1]) err(where, `Frage zu lang (${fl} Zeichen, max. ${LIMIT.frage[1]})`);
    else if (fl > LIMIT.frage[0]) warn(where, `Frage lang (${fl} Zeichen) – kürzer liest sich am Fernseher besser`);
    // "info": ein Satz zur Geschichte hinter der Antwort (erscheint bei der Auflösung)
    if (q.info !== undefined) {
      const il = typeof q.info === 'string' ? len(q.info.trim()) : 0;
      if (!il) err(where, '"info" muss ein Text sein');
      else if (il > LIMIT.info[1]) err(where, `"info" zu lang (${il} Zeichen, max. ${LIMIT.info[1]})`);
      else if (il > LIMIT.info[0]) warn(where, `"info" lang (${il} Zeichen) – ein, höchstens zwei kurze Sätze lesen sich am Fernseher besser`);
    }
    if (ZEITWORT.test(q.frage) && !/\b(19|20)\d\d\b/.test(q.frage)) warn(where, `„${q.frage.match(ZEITWORT)[0]}“ – veraltet die Antwort? Dann Stichtag in die Frage („Stand 2025“)`);
    const key = norm(q.frage) + '|' + norm(JSON.stringify(q.antworten || q.schaetzen || q.zuordnen || q.behauptungen || [q.karte, q.ort, q.land])) + '|' + (q.spotify || q.audio || q.video || q.bild || '');
    if (seen.has(key)) err(where, `doppelt – gleiche Frage steht schon in ${seen.get(key)}`); else seen.set(key, `${rel} #${i + 1}`);
    for (const [field, [sub, ext]] of Object.entries(MEDIA)) {
      if (!q[field]) continue;
      const name = String(q[field]), d = path.dirname(file);
      if (!ext.test(name)) err(where, `"${field}": Dateityp von „${name}“ wird nicht unterstützt`);
      else if (![path.join(d, name), path.join(d, sub, name)].some(f => fs.existsSync(f))) err(where, `"${field}": „${name}“ nicht gefunden (in den Ordner „${sub}“ neben der Datei legen)`);
    }
    if (q.merken !== undefined && !q.bild && !q.bildquelle) err(where, '"merken" braucht ein "bild"');
    // Bildausschnitt: in der Frage nur ein Teil des Bilds (x, y, Breite, Höhe in %), bei der Auflösung das ganze
    if (q.ausschnitt !== undefined) {
      const a = Array.isArray(q.ausschnitt) ? q.ausschnitt.map(Number) : [];
      if (!q.bild && !q.bildquelle) err(where, '"ausschnitt" braucht ein "bild"');
      if (a.length !== 4 || !a.every(Number.isFinite)) err(where, '"ausschnitt" muss [x, y, Breite, Höhe] in Prozent des Bilds sein, z. B. [40, 20, 25, 25]');
      else if (a[0] < 0 || a[1] < 0 || a[2] < 5 || a[3] < 5 || a[0] + a[2] > 100.001 || a[1] + a[3] > 100.001) err(where, '"ausschnitt" muss im Bild liegen (x, y ab 0; Breite, Höhe mindestens 5; x + Breite und y + Höhe höchstens 100)');
      else if (a[2] > 70 && a[3] > 70) warn(where, '"ausschnitt" ist fast das ganze Bild – lohnt sich kaum');
      if (q.merken !== undefined) err(where, '"merken" geht nicht zusammen mit "ausschnitt"');
      if (q.karte !== undefined) warn(where, '"ausschnitt" bei Kartenfragen: das Bild ist dort sehr klein');
    }
    if (q.aufdecken !== undefined) {
      if (typeof q.aufdecken !== 'boolean') err(where, '"aufdecken" muss true oder false sein');
      if (q.aufdecken && q.ausschnitt === undefined) err(where, '"aufdecken" braucht einen "ausschnitt" (dort beginnt das Bild)');
    }
    // Bilder aus freien Quellen: "bildquelle" → GitHub Actions („Bilder holen“) lädt das Bild und trägt "bild" + "bildnachweis" ein
    if (q.bildquelle !== undefined) {
      const bq = q.bildquelle, keys = bq && typeof bq === 'object' ? Object.keys(bq) : [];
      if (keys.length !== 1 || !['commons', 'artic'].includes(keys[0]))
        err(where, '"bildquelle" braucht genau eins von "commons" (Wikimedia Commons) oder "artic" (Art Institute of Chicago)');
      if (!q.bild) warn(where, '"bildquelle" ohne "bild" – wird beim Push von GitHub Actions („Bilder holen“) geholt');
      else if (!q.bildnachweis) err(where, '"bildnachweis" fehlt (trägt „Bilder holen“ automatisch ein)');
    }
    if (q.bildnachweis !== undefined && (typeof q.bildnachweis !== 'string' || len(q.bildnachweis) > 100)) err(where, '"bildnachweis" muss ein Text bis 100 Zeichen sein');
    // Töne aus Archiven: "tonquelle" → GitHub Actions („Bilder holen“) lädt den Ton und trägt "audio" + "tonnachweis" ein
    if (q.tonquelle !== undefined) {
      const tq = q.tonquelle, keys = tq && typeof tq === 'object' ? Object.keys(tq).filter(k => k !== 'urheber') : [];
      if (keys.length !== 1 || !['tierstimmen', 'bbc', 'commons'].includes(keys[0]))
        err(where, '"tonquelle" braucht genau eins von "tierstimmen" (Tierstimmenarchiv Berlin), "bbc" (BBC Sound Effects) oder "commons"');
      if (tq && tq.tierstimmen && !tq.urheber) err(where, '"tonquelle" mit "tierstimmen" braucht "urheber" (steht in der Deutschen Digitalen Bibliothek)');
      if (!q.audio) warn(where, '"tonquelle" ohne "audio" – wird beim Push von GitHub Actions („Bilder holen“) geholt');
      else if (!q.tonnachweis) err(where, '"tonnachweis" fehlt (trägt „Bilder holen“ automatisch ein)');
      if (q.dauer === undefined) warn(where, '"tonquelle": "dauer" setzen (Archivaufnahmen sind meist länger als nötig, 5–10 Sekunden reichen)');
    }
    if (q.tonnachweis !== undefined) {
      if (typeof q.tonnachweis !== 'string' || len(q.tonnachweis) > 100) err(where, '"tonnachweis" muss ein Text bis 100 Zeichen sein');
      if (!q.audio && !q.tonquelle) err(where, '"tonnachweis" gehört zu einer Frage mit "audio"');
    }
    // Spotify-Musikfrage: Song-Link, Ausschnitt läuft auf dem Spotify-Gerät
    if (q.spotify !== undefined) {
      if (!/(?:open\.spotify\.com\/(?:intl-\w+\/)?track\/|spotify:track:)[A-Za-z0-9]{22}/.test(String(q.spotify))) err(where, '"spotify" muss ein Link zu einem Song sein (Spotify: Song › Teilen › Link kopieren)');
      if (q.audio || q.video) err(where, '"spotify" geht nicht zusammen mit "audio" oder "video"');
      if (q.rueckwaerts) err(where, '"rueckwaerts" geht bei Spotify-Fragen nicht');
      if (q.dauer !== undefined && !(Number(q.dauer) > 0 && Number(q.dauer) <= 30)) err(where, '"dauer" muss bei Spotify-Fragen 1 bis 30 Sekunden sein');
      if (q.start !== undefined && !(Number(q.start) >= 0)) err(where, '"start" muss eine Sekundenzahl sein');
      if (!/(^|[\\/])Musik[\\/]Spotify\.json$/.test(rel)) warn(where, 'Spotify-Fragen gehören nach Musik/Spotify.json (Paket „Spotify“)');
    }

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
      // wie im Spiel: „Jahr“ in der Frage + ganze Zahl (und keine Einheit wie m/kg) = Jahreszahl
      const year = q.jahr !== undefined ? !!q.jahr : /\bJahr\b/i.test(q.frage) && Number.isInteger(v) && !/^(m|km|g|kg|s|%)$/.test(q.einheit || '');
      if (!year && !q.einheit && !/^wie viele\b/i.test(q.frage)) warn(where, 'keine "einheit" – bei Schätzfragen hilft z. B. „m“, „km“, „Stück“');
      // Toleranz (±) nur, wenn angegeben (kein Standard, auch nicht bei Jahreszahlen). Aktuell nur bei Jahreszahlen üblich;
      // Ereignisse der letzten 50 Jahre bekommen höchstens ±2 (kleiner geht, macht's schwerer)
      if (q.toleranz !== undefined && q.toleranz !== false) {
        if (!(typeof q.toleranz === 'number' && q.toleranz >= 0)) err(where, '"toleranz" muss eine Zahl ab 0 sein');
        else if (!year) warn(where, '"toleranz" bei einer Schätzfrage ohne Jahreszahl – aktuell nur bei Jahreszahlen vorgesehen');
        else if (q.toleranz > 2 && !/v\.\s*Chr/i.test(q.frage) && v >= new Date().getFullYear() - 50)
          warn(where, `Ereignis der letzten 50 Jahre (${v}) – hier höchstens ±2 (weniger macht es schwerer)`);
      }
    }
    if (q.karte !== undefined) {
      // Geografie: "ort": [Breite, Länge] (Pin setzen) oder "land": Name (Land/Bundesland antippen)
      const map = String(q.karte).toLowerCase();
      if (!['welt', 'europa', 'deutschland'].includes(map)) err(where, '"karte" muss "welt", "europa" oder "deutschland" sein');
      if ((q.ort !== undefined) === (q.land !== undefined)) err(where, 'Kartenfrage braucht genau eins: "ort": [Breite, Länge] oder "land": "Name"');
      if (q.ort !== undefined) {
        const o = Array.isArray(q.ort) ? q.ort.map(Number) : [];
        if (o.length !== 2 || !(Math.abs(o[0]) <= 90) || !(Math.abs(o[1]) <= 180)) err(where, '"ort" muss [Breite, Länge] sein, z. B. [45.76, 4.84]');
        else {
          if (!q.name) warn(where, 'kein "name" – er steht bei der Auflösung am Ring auf der Karte');
          const box = { europa: [-24, 34, 44, 71], deutschland: [5.3, 47.2, 15.6, 55.1] }[map];
          if (box && !(o[1] >= box[0] && o[1] <= box[2] && o[0] >= box[1] && o[0] <= box[3])) err(where, `"ort" liegt außerhalb der Karte „${map}“ – Breite und Länge vertauscht?`);
        }
        if (q.toleranz !== undefined && !(Number(q.toleranz) > 0)) err(where, '"toleranz" muss eine Entfernung in km über 0 sein');
        if (q.radius !== undefined && !(Number(q.radius) > 0)) err(where, '"radius" muss eine Entfernung in km über 0 sein (bis dahin zählt der Pin als richtig)');
        // „Wer kommt am nächsten ran?“: kein Kreis – wer am nächsten dran ist, gewinnt
        if (q.naechster !== undefined && typeof q.naechster !== 'boolean') err(where, '"naechster" muss true oder false sein');
        if (q.naechster && q.radius !== undefined) err(where, '"naechster": true und "radius" passen nicht zusammen – bei „Wer kommt am nächsten ran?“ gibt es keinen Kreis');
      }
      if (q.naechster !== undefined && q.ort === undefined) err(where, '"naechster" gibt es nur bei Pin-Fragen (mit "ort")');
      if (q.land !== undefined && KARTEN[map] && !KARTEN[map].has(String(q.land).toLowerCase())) err(where, `„${q.land}“ gibt es auf der Karte „${map}“ nicht (Namen wie in der Karte, z. B. „Nordmazedonien“, „Moldau“)`);
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
