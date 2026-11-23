// QuizAbend – kleiner Spielserver ohne zusätzliche Pakete.
// Start: node server.js   (danach öffnet sich die TV-Ansicht im Browser)

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec, execFile } = require('child_process');
const hue = require('./hue');   // Philips Hue (optional, Proof of Concept)

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_PER_GAME = Number(process.env.FRAGEN) || 10;
const QUESTION_TIME_MS = (Number(process.env.SEKUNDEN) || 20) * 1000;
const MATCH_TIME_MS = 30000;   // Zuordnen braucht etwas länger
const TF_TIME_MS = 30000;      // Richtig oder falsch: mehrere Aussagen lesen
const IDENT_MS = 4900;         // Opener „Vier Kacheln“ (Spielstart und nach der Pause), passend zu sounds/opener.mp3
const TIEBREAK_MS = 6000;      // Ansage „Stechen!“ bei Gleichstand auf Platz 1
const TIEBREAK_MAX = 10;       // Sicherheitsnetz: so oft wird höchstens gestochen (eigentlich entscheidet schon die erste Runde)
const LOBBY_AWAY_MS = 15 * 60000;   // Lobby: so lange bleibt ein Spieler mit gesperrtem Handy angemeldet
const INTRO_MS = 3000;         // Ankündigung mit Countdown 3-2-1
const PREVIEW_MS = 6000;       // Zuordnen: Begriffe vorab zeigen
const VOTES_MS = 3500;         // erst zeigen, wer was gewählt hat …
const REVEAL_MS = 5000;        // … dann die Lösung
const ESTIMATE_REVEAL_MS = 11500;
const MAP_REVEAL_MS = 8000;       // Karte: Ring, Linien und Liste
const INFO_MS = 6000;             // Frage mit "info": so viel länger bleibt die Auflösung stehen (zum Lesen)
const INFO_MAX = 200;             // Zeichen
const MAP_VOTES_MS = 5000;        // Karte: Pins fallen nacheinander bzw. Länder färben sich // Schätzfrage: Zahl läuft erst wie eine Slotmaschine, dann die Liste
const MATCH_STEP_MS = 2200;    // Zuordnen: Paar für Paar auflösen
const SCORES_MS = 15000;        // Balken bauen sich auf, dann sortieren sich alle ein
const SCORES_EVERY = Number(process.env.RANGLISTE) || 0; // Rangliste nur am Blockende (optional zusätzlich alle X Fragen)
const OPENING_MS = 22500;      // Intro beim Spielstart (passt zur Intro-Musik: 12 Takte bei 128 BPM)
const BLOCK_MS = 4500;         // Ankündigung eines neuen Frageblocks
const SPECIAL_MS = 3500;       // Animation "Spezialfrage"
const RISK_MS = 6000;          // Alarm "Risikofrage" vor der Frage (Jingle 5,6 s)
const RISK_CURVE = 5;          // Risikofrage: Gewicht e^(5·Fortschritt) – je später, desto wahrscheinlicher

// Schwierigkeit: Gewichte (Stufe 1/2/3) am Anfang, in der Mitte und am Ende des Spiels.
// Dazwischen wird linear übergeblendet – über alle Blöcke hinweg.
const DIFFICULTY_CURVE = [[94, 5, 1], [50, 35, 15], [15, 35, 50]];
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;

const FRAGEN_DIR = path.join(__dirname, 'fragen');
const fragenRepo = require('./fragenrepo');   // Fragen-Repo (eigenes Git-Repo, Kopie unter fragen/_repo)
const meldungen = require('./meldungen');   // „⚑ Stimmt was nicht?“ – gemeldete Fragen (meldungen.json)
const { pickNext } = require('./fragenmix');   // Abwechslung bei den Fragearten (Reihenfolge im Spiel)
const bestenliste = require('./bestenliste');   // 🏆 Ewige Bestenliste (bestenliste.json)
const zertifikat = require('./zertifikat');   // sichere Adresse (https) im Heim-WLAN: DuckDNS + Let's Encrypt
const spotify = require('./spotify');         // Spotify Connect: Hintergrundmusik passend zum Spiel, Spotify-Musikfragen
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 443;
const SOUNDS_DIR = path.join(__dirname, 'sounds');
const HOTSPOT_FILE = path.join(__dirname, 'hotspot.json'); // von raspberry-pi/setup.sh angelegt: {ssid, password}
const UNDER_SYSTEMD = !!process.env.INVOCATION_ID;           // läuft als Dienst (Pi) -> Neustart nach Update automatisch
const SETTINGS_FILE = path.join(__dirname, 'einstellungen.json');
const HISTORY_FILE = path.join(__dirname, 'verlauf.json');   // welche Frage wann zuletzt gespielt wurde (über Spiele hinweg)

// ---------- Verlauf: möglichst keine Wiederholungen über mehrere Spieleabende ----------
let history = {};
try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) || {}; } catch (_) { history = {}; }
let historyTimer = null;
function markPlayed(uid) {
  history[uid] = Date.now();
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => { try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(history)); } catch (e) { console.log('  Verlauf nicht gespeichert:', e.message); } }, 1500);
}
// Aus einer Auswahl die „frischesten“ Fragen: nie gespielte zuerst, sonst das älteste Drittel
function fresher(list) {
  if (list.length < 2) return list;
  const unplayed = list.filter(q => !history[q.uid]);
  if (unplayed.length) return unplayed;
  const sorted = [...list].sort((a, b) => history[a.uid] - history[b.uid]);
  return sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 3)));
}
const VIDEO_TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/mp4' };
const AUDIO_TYPES = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav' };
const MEDIA_MAX_MS = 5 * 60 * 1000; // Sicherheitsnetz, falls der Fernseher das Ende von Video/Audio nicht meldet
const IMAGE_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

const VERSION = String(Date.now()); // ändert sich bei jedem Neustart -> Bildschirme laden neu
const COLORS = ['#ff4d6d', '#4dabf7', '#ffd43b', '#51cf66', '#cc5de8', '#ff922b', '#22d3ee', '#f783ac'];
const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🐵', '🦄', '🐧', '🐶', '🐱', '🐯', '🐨', '🐷', '🐮', '🐰', '🐻', '🐲', '🦉', '🐝', '🦖', '🐢', '🦀', '🐳', '🦩'];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// =====================================================================
// Fragenpakete:  fragen/<Hauptkategorie>/<Paket>.json  (+ Bilder daneben oder in bilder/)
// =====================================================================
let packs = [];        // [{id, group, name, questions, kinds}]
let packErrors = [];   // [{file, error}]

function jsonErrorText(err, text) {
  const m = /position (\d+)/.exec(err.message);
  const line = m ? text.slice(0, Number(m[1])).split('\n').length : null;
  return (line ? `Zeile ${line}: ` : '') + 'JSON-Fehler – fehlt ein Komma, eine Klammer oder ein Anführungszeichen?';
}

function resolveImage(dir, name, sub = 'bilder', types = IMAGE_TYPES) {
  for (const rel of [path.join(dir, name), path.join(dir, sub, name)]) {
    const full = path.join(FRAGEN_DIR, rel);
    if (full.startsWith(FRAGEN_DIR) && types[path.extname(full).toLowerCase()] && fs.existsSync(full))
      return '/media/' + rel.split(path.sep).map(encodeURIComponent).join('/');
  }
  return null;
}

// Schätzfragen mit Pegel-Anzeige: Gewichte immer, Längen nur bei Höhen ("Wie hoch …", "Höhe", "Wie groß …")
// ---------- Geografie: Karten (public/karten/*.json, erzeugt von karten/erzeugen.js) ----------
const KARTEN_DIR = path.join(__dirname, 'public', 'karten');
const KARTEN_NAMEN = require('./karten/namen.js');
const KARTEN = {};   // name -> { regions: Map(id -> {n, c}), cos, k, lon0 }
for (const f of (() => { try { return fs.readdirSync(KARTEN_DIR); } catch (_) { return []; } })()) {
  if (!f.endsWith('.json')) continue;
  try {
    const m = JSON.parse(fs.readFileSync(path.join(KARTEN_DIR, f), 'utf8'));
    const cos = Math.cos(m.lat0 * Math.PI / 180), [x0, y0, w, h] = m.vb;
    // Spielfeld (= Sichtbereich der Karte) in Breite/Länge: nur dort darf getippt werden
    const field = { s: -(y0 + h) / m.k, n: -y0 / m.k, w: x0 / (cos * m.k) + m.lon0, e: (x0 + w) / (cos * m.k) + m.lon0 };
    const inField = r => r.b[2] >= x0 && r.b[0] <= x0 + w && r.b[3] >= y0 && r.b[1] <= y0 + h;
    KARTEN[m.name] = { title: m.title, field, regions: new Map(m.regions.filter(inField).map(r => [r.id, { n: r.n }])) };
  } catch (e) { console.log('  Karte ' + f + ' nicht lesbar: ' + e.message); }
}
// Wie weit daneben noch Punkte gibt (km): Welt grob, Deutschland fein
const MAP_RANGE_KM = { welt: 2500, europa: 1000, deutschland: 250 };
// Pin-Fragen: bis zu diesem Abstand (km) zählt ein Tipp als richtig – pro Frage mit "radius" einstellbar
const MAP_RADIUS_KM = { welt: 300, europa: 100, deutschland: 25 };
const inMapField = (map, [lat, lon]) => { const f = KARTEN[map].field, t = 0.02; return lat >= f.s - t && lat <= f.n + t && lon >= f.w - t && lon <= f.e + t; };
const MAP_TIME_MS = Math.round(QUESTION_TIME_MS * 1.25);   // Karte zoomen und tippen dauert etwas länger
function findRegion(map, name) {
  const want = String(name).trim().toLowerCase(), k = KARTEN[map];
  const alias = KARTEN_NAMEN.ALIAS[want];
  for (const [id, r] of k.regions) if (id.toLowerCase() === want || r.n.toLowerCase() === want || id === alias) return id;
  return null;
}
function kmBetween(a, b) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const WEIGHT_UNIT = /^(mg|g|kg|t|gramm|kilo(gramm)?|tonnen?|pfund)$/i;
const LENGTH_UNIT = /^(mm|cm|m|km|meter|zentimeter|kilometer)$/i;
const HEIGHT_TEXT = /(?<![\wäöüß])(hoch|hohe[nrs]?|höhe|höher|groß|große[nrs]?)(?![\wäöüß])/i;   // \b kennt kein ß
function normalizeQuestion(q, dir, packName, packLevel) {
  if (!q || typeof q !== 'object') throw new Error('ist kein gültiger Eintrag');
  if (!q.frage) throw new Error('das Feld "frage" fehlt');
  const level = Number(q.schwierigkeit ?? packLevel ?? 1);
  if (![1, 2, 3].includes(level)) throw new Error('"schwierigkeit" muss 1, 2 oder 3 sein');
  const base = { category: q.kategorie || packName, text: String(q.frage), level, timeMs: Number(q.zeit) > 0 ? Number(q.zeit) * 1000 : null, image: null };
  // "info": ein Satz zur Geschichte hinter der Antwort – erscheint bei der Auflösung („💡 Übrigens …“)
  if (q.info !== undefined) {
    const info = String(q.info).replace(/\s+/g, ' ').trim();
    if (!info) throw new Error('"info" ist leer');
    if (info.length > INFO_MAX) throw new Error(`"info" ist zu lang (${info.length} Zeichen, höchstens ${INFO_MAX})`);
    base.info = info;
  }
  if (q.bild) {
    base.image = resolveImage(dir, String(q.bild));
    if (!base.image) throw new Error(`Bild "${q.bild}" nicht gefunden (in den Ordner "bilder" neben der Datei legen)`);
    // Quellenangabe (Fotograf, Lizenz) – steht klein am Bild; bei CC BY Pflicht
    if (q.bildnachweis) base.credit = String(q.bildnachweis).replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  if (q.merken !== undefined && q.merken !== false) {
    // Merkbild: das Bild erst nur kurz im Vollbild zeigen, die Frage kommt danach ohne Bild
    const secs = q.merken === true ? 8 : Number(q.merken);
    if (!base.image) throw new Error('"merken" braucht ein "bild"');
    if (q.video || q.audio) throw new Error('"merken" geht nicht zusammen mit "video" oder "audio"');
    if (!(secs >= 2 && secs <= 60)) throw new Error('"merken" muss true oder eine Sekundenzahl von 2 bis 60 sein');
    base.flash = secs;
  }
  if (q.video) {
    base.video = resolveImage(dir, String(q.video), 'videos', VIDEO_TYPES);
    if (!base.video) throw new Error(`Video "${q.video}" nicht gefunden (mp4/webm in den Ordner "videos" neben der Datei legen)`);
  }
  if (q.spotify && (q.audio || q.video)) throw new Error('"spotify" geht nicht zusammen mit "audio" oder "video"');
  if (q.spotify) {
    // Spotify-Musikfrage: Ausschnitt eines Songs läuft auf dem Spotify-Gerät (z. B. Receiver), nicht am Fernseher
    base.spotify = spotify.trackUri(q.spotify);
    if (!base.spotify) throw new Error('"spotify" muss ein Link zu einem Song sein (in Spotify: Song › Teilen › Link kopieren)');
    if (q.rueckwaerts) throw new Error('"rueckwaerts" geht bei Spotify-Fragen nicht');
  }
  if (q.audio || q.spotify) {
    if (q.audio) base.audio = resolveImage(dir, String(q.audio), 'audio', AUDIO_TYPES);
    if (q.audio && !base.audio) throw new Error(`Audio "${q.audio}" nicht gefunden (mp3/m4a/ogg/wav in den Ordner "audio" neben der Datei legen)`);
    // Quellenangabe zum Ton (Aufnahme, Lizenz) – steht beim Soundcheck klein unten rechts; bei CC BY Pflicht
    if (q.tonnachweis && q.audio) base.audioCredit = String(q.tonnachweis).replace(/\s+/g, ' ').trim().slice(0, 120);
    const start = Number(q.start ?? 0), dauer = q.dauer === undefined ? (q.spotify ? 10 : null) : Number(q.dauer);   // Spotify: Standard 10 s
    if (q.spotify && !(dauer <= 30)) throw new Error('"dauer" darf bei Spotify-Fragen höchstens 30 Sekunden sein');
    if (!(start >= 0) || (dauer !== null && !(dauer > 0))) throw new Error('"start" und "dauer" müssen Sekunden (Zahlen) sein');
    // "wiederholen": so oft ist der Ausschnitt zu hören (1–5), z. B. 3 bei einer Sekunde aus einem Song
    const repeat = q.wiederholen === undefined ? 1 : Number(q.wiederholen);
    if (!(Number.isInteger(repeat) && repeat >= 1 && repeat <= 5)) throw new Error('"wiederholen" muss eine ganze Zahl von 1 bis 5 sein (so oft ist der Ton zu hören)');
    // "pause": Sekunden Stille zwischen den Wiederholungen (Standard 2,5)
    const gap = q.pause === undefined ? 2.5 : Number(q.pause);
    if (!(gap >= 0.5 && gap <= 10)) throw new Error('"pause" muss eine Sekundenzahl von 0,5 bis 10 sein');
    base.audioOpts = { start, dauer, reverse: !!q.rueckwaerts, repeat, gap };
  }
  if (q.zuordnen) {
    const pairs = Array.isArray(q.zuordnen) ? q.zuordnen : Object.entries(q.zuordnen);
    if (pairs.length < 2 || pairs.length > 6 || pairs.some(p => !Array.isArray(p) || p.length !== 2 || !p[0] || !p[1]))
      throw new Error('"zuordnen" braucht 2 bis 6 Paare, z. B. {"Barack Obama": "Michelle"}');
    const lefts = pairs.map(p => String(p[0])), rights = pairs.map(p => String(p[1]));
    if (new Set(lefts).size !== lefts.length || new Set(rights).size !== rights.length)
      throw new Error('bei "zuordnen" darf kein Begriff doppelt vorkommen');
    return { ...base, kind: 'match', pairs: pairs.map(([a, b]) => [String(a), String(b)]) };
  }
  if (q.behauptungen) {
    // Richtig oder falsch: [["Aussage", true], …], [{"text": "…", "richtig": false}, …] oder {"Aussage": true, …}
    const raw = Array.isArray(q.behauptungen) ? q.behauptungen : Object.entries(q.behauptungen);
    const items = raw.map(b => Array.isArray(b) ? b : b && typeof b === 'object' ? [b.text ?? b.behauptung, b.richtig] : [null, null]);
    if (items.length < 2 || items.length > 5 || items.some(([t, r]) => !t || typeof r !== 'boolean'))
      throw new Error('"behauptungen" braucht 2 bis 5 Aussagen mit true/false, z. B. [["Der Mond ist ein Planet", false], …]');
    return { ...base, kind: 'tf', items: items.map(([t, r]) => [String(t), r]) };
  }
  if (q.schaetzen !== undefined) {
    const value = Number(String(q.schaetzen).replace(',', '.'));
    if (!isFinite(value)) throw new Error('"schaetzen" muss eine Zahl sein');
    // Jahreszahl erkannt ("In welchem Jahr …"): nur für die Anzeige (Ziffernblock ohne Komma, „Jahre“)
    const year = q.jahr !== undefined ? !!q.jahr : /\bJahr\b/i.test(String(q.frage)) && Number.isInteger(value) && !q.einheit?.match?.(/^(m|km|g|kg|s|%)$/);
    // Toleranz (±) nur, wenn sie bei der Frage steht ("toleranz": 2) – auch bei Jahreszahlen. Ohne: der Nächste gewinnt.
    let tolerance = q.toleranz === undefined || q.toleranz === false || q.toleranz === null ? null : Number(q.toleranz);
    if (tolerance !== null && !(tolerance >= 0)) throw new Error('"toleranz" muss eine Zahl ab 0 sein');
    // Auflösung am Fernseher: "pegel" (Säulen + steigender Wasserpegel) für Höhen und Gewichte, sonst Slotmaschine.
    // Automatisch erkannt, mit "anzeige": "pegel" | "slot" fest einstellbar.
    if (q.anzeige !== undefined && !['pegel', 'slot'].includes(q.anzeige)) throw new Error('"anzeige" muss "pegel" oder "slot" sein');
    const unit = q.einheit ? String(q.einheit) : '';
    const show = q.anzeige || (!year && value > 0 && (WEIGHT_UNIT.test(unit) || (LENGTH_UNIT.test(unit) && HEIGHT_TEXT.test(String(q.frage)))) ? 'pegel' : 'slot');
    return { ...base, kind: 'estimate', value, unit, year, tolerance, show };
  }
  if (q.karte !== undefined) {
    // Geografie: "ort": [Breite, Länge] -> Pin setzen; "land": "Österreich" -> Land/Bundesland antippen
    const map = String(q.karte).toLowerCase();
    if (!KARTEN[map]) throw new Error(`"karte" muss ${Object.keys(KARTEN).map(k => '"' + k + '"').join(', ') || 'eine vorhandene Karte'} sein`);
    if (q.ort !== undefined) {
      const o = Array.isArray(q.ort) ? q.ort.map(Number) : [];
      if (o.length !== 2 || !(Math.abs(o[0]) <= 90) || !(Math.abs(o[1]) <= 180)) throw new Error('"ort" muss [Breite, Länge] sein, z. B. [45.76, 4.84] für Lyon');
      if (q.toleranz !== undefined && !(Number(q.toleranz) > 0)) throw new Error('"toleranz" muss eine Entfernung in km über 0 sein');
      if (!inMapField(map, o)) throw new Error(`"ort" liegt außerhalb der Karte „${map}“ – Breite und Länge vertauscht?`);
      if (q.radius !== undefined && !(Number(q.radius) > 0)) throw new Error('"radius" muss eine Entfernung in km über 0 sein (bis dahin zählt der Pin als richtig)');
      const radius = q.radius !== undefined ? Number(q.radius) : MAP_RADIUS_KM[map] || 100;
      const range = Math.max(q.toleranz !== undefined ? Number(q.toleranz) : MAP_RANGE_KM[map] || 1000, radius * 2);
      return { ...base, kind: 'pin', map, target: o, name: q.name ? String(q.name) : '', radius, range };
    }
    if (q.land !== undefined) {
      const region = findRegion(map, q.land);
      if (!region) throw new Error(`"${q.land}" gibt es auf der Karte "${map}" nicht${map === 'deutschland' ? ' (dort gibt es nur die Bundesländer)' : ''}`);
      return { ...base, kind: 'land', map, region, name: KARTEN[map].regions.get(region).n };
    }
    throw new Error('Kartenfrage braucht "ort": [Breite, Länge] oder "land": "Name"');
  }
  if (Array.isArray(q.antworten) && q.antworten.length >= 2)
    return { ...base, kind: 'choice', answers: q.antworten.slice(0, 4).map(String) };
  throw new Error('es fehlen "antworten", "schaetzen", "zuordnen", "behauptungen" oder "karte"');
}

const TECH_GROUP = 'Technik-Test';
let techPacks = [];
function loadPacks() {
  const found = [], errors = [];
  const addFile = (group, rel) => {
    const full = path.join(FRAGEN_DIR, rel);
    let text, raw;
    try { text = fs.readFileSync(full, 'utf8').replace(/^﻿/, ''); raw = JSON.parse(text); }
    catch (e) { errors.push({ file: rel, error: text ? jsonErrorText(e, text) : 'Datei nicht lesbar' }); return; }
    const list = Array.isArray(raw) ? raw : raw && raw.fragen;
    const name = (!Array.isArray(raw) && raw && raw.paket) || path.basename(rel, '.json');
    if (!Array.isArray(list)) { errors.push({ file: rel, error: 'keine Liste "fragen" gefunden' }); return; }
    const questions = [], packId = rel.replace(/\\/g, '/').replace(/\.json$/i, '');
    list.forEach((q, i) => {
      try { questions.push({ ...normalizeQuestion(q, path.dirname(rel), name, !Array.isArray(raw) ? raw.schwierigkeit : undefined), uid: packId + '#' + i, pack: name }); }
      catch (e) { errors.push({ file: rel, error: `Frage ${i + 1}: ${e.message}` }); }
    });
    const kinds = {
      choice: questions.some(q => q.kind === 'choice' && !q.image), image: questions.some(q => q.image),
      estimate: questions.some(q => q.kind === 'estimate'), match: questions.some(q => q.kind === 'match'), tf: questions.some(q => q.kind === 'tf'),
      map: questions.some(q => q.kind === 'pin' || q.kind === 'land'),
    };
    const levels = [1, 2, 3].map(l => questions.filter(q => q.level === l).length);
    found.push({ id: rel.replace(/\\/g, '/').replace(/\.json$/i, ''), group, name, questions, kinds, levels });
  };
  // Gruppen = Ordner. Eingebaute Pakete liegen direkt in fragen/, die des Fragen-Repos in fragen/_repo/ (gleich aufgebaut)
  const scan = base => {
    const dir = path.join(FRAGEN_DIR, base);
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'de'))) {
      if (e.name.startsWith('.') || e.name.startsWith('_')) continue;
      if (e.isDirectory()) {
        for (const f of fs.readdirSync(path.join(dir, e.name)).sort((a, b) => a.localeCompare(b, 'de')))
          if (f.toLowerCase().endsWith('.json')) addFile(e.name, path.join(base, e.name, f));
      } else if (e.name.toLowerCase().endsWith('.json')) addFile('Sonstiges', path.join(base, e.name));
    }
  };
  scan('');
  scan('_repo');
  // Technik-Test (Ordner fragen/Technik-Test): nie im normalen Spiel, nur über ⚙️ › 🛠️ System › 🧪 Technik-Test
  techPacks = found.filter(p => p.group === TECH_GROUP);
  packs = found.filter(p => p.group !== TECH_GROUP);
  packErrors = errors;
  if (errors.length) console.log('  ⚠️  Probleme in Fragendateien:\n' + errors.map(e => `     ${e.file}: ${e.error}`).join('\n'));
}

// ---------- Einstellungen: Frageblöcke (je mit eigener Paketauswahl) + Spezialfrage ----------
const MAX_BLOCKS = 6;
let settings = { blocks: [{ count: DEFAULT_PER_GAME, disabled: [] }], special: { on: false, mult: 2 }, risk: { on: false }, sound: { on: true }, pause: { on: true, minutes: 10 }, pub: { on: false }, scoring: 'speed' };
try {
  const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  if (Array.isArray(raw.blocks)) settings.blocks = raw.blocks;
  else if (raw.disabled) settings.blocks = [{ count: raw.perGame || DEFAULT_PER_GAME, disabled: raw.disabled }]; // alte Version
  if (raw.special) settings.special = raw.special;
  if (raw.risk) settings.risk = { on: !!raw.risk.on };
  if (raw.sound) settings.sound = raw.sound;
  if (raw.pause) settings.pause = raw.pause;
  // Pub-Quiz-Modus wird bewusst nicht übernommen: nach jedem Start ist der normale Modus aktiv
  if (raw.scoring) settings.scoring = raw.scoring;
} catch (_) {}
function saveSettings() { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (_) {} }

function cleanSettings(input) {
  const blocks = (Array.isArray(input.blocks) ? input.blocks : []).slice(0, MAX_BLOCKS).map(b => ({
    count: Math.max(1, Math.min(50, Math.round(Number(b && b.count)) || DEFAULT_PER_GAME)),
    disabled: Array.isArray(b && b.disabled) ? b.disabled.filter(x => typeof x === 'string') : [],
  }));
  const sp = input.special || {}, ri = input.risk || {}, so = input.sound || {}, pa = input.pause || {}, pu = input.pub || {};
  return { blocks: blocks.length ? blocks : settings.blocks,
    special: { on: !!sp.on, mult: [2, 3, 4].includes(Number(sp.mult)) ? Number(sp.mult) : 2 },
    risk: { on: !!ri.on },
    sound: { on: so.on === undefined ? true : !!so.on },
    pause: { on: pa.on === undefined ? true : !!pa.on, minutes: Math.max(0, Math.min(60, Math.round(Number(pa.minutes ?? 10)))) },
    pub: { on: !!pu.on },
    scoring: input.scoring === 'level' ? 'level' : 'speed' };   // speed: bis ~1000 je Frage nach Tempo; level: Punkte = Schwierigkeit
}

const blockPacks = b => packs.filter(p => !b.disabled.includes(p.id));
// Spotify-Musikfragen nur, wenn Spotify verbunden ist und das Gerät gewählt (nicht im eigenen WLAN)
const usable = q => !q.spotify || (spotify.ready() && !hotspot());
const blockPool = b => blockPacks(b).flatMap(p => p.questions).filter(usable);

function blockSummary(b) {
  const ps = blockPacks(b), groups = [...new Set(ps.map(p => p.group))];
  const allOfGroup = g => packs.filter(p => p.group === g).every(p => ps.includes(p));
  // Kurzname: ganze Hauptkategorien oder einzelne Pakete
  const names = groups.flatMap(g => allOfGroup(g) ? [g] : ps.filter(p => p.group === g).map(p => p.name));
  const available = blockPool(b).length;
  return { count: b.count, available, plays: Math.min(b.count, available), packs: ps.length, names };
}

function packSummary() {
  const blocks = settings.blocks.map(blockSummary);
  return { blocks, totalPacks: packs.length, questions: blocks.reduce((s, b) => s + b.plays, 0),
    special: settings.special, risk: settings.risk, sound: settings.sound, pause: settings.pause, pub: settings.pub, scoring: settings.scoring, errors: packErrors.length };
}

function packList() {
  const groups = [];
  for (const p of packs) {
    let g = groups.find(x => x.name === p.group);
    if (!g) groups.push(g = { name: p.group, packs: [] });
    g.packs.push({ id: p.id, name: p.name, count: p.questions.length, kinds: p.kinds, levels: p.levels });
  }
  const all = packs.flatMap(p => p.questions);
  const played = all.filter(q => history[q.uid]).length;
  const tech = techPacks.map(p => ({ id: p.id, name: p.name, count: p.questions.filter(usable).length, total: p.questions.length }));
  return { groups, errors: packErrors, settings, summary: packSummary(), system: systemInfo(), history: { played, total: all.length }, repo: fragenRepo.status(), tech,
    meldungen: meldungen.count() };
}

// Wahrscheinlichkeit der Schwierigkeitsstufen für Frage g (0-basiert) von total
function levelWeights(g, total) {
  const t = total <= 1 ? 0 : g / (total - 1);
  const [a, b] = t <= 0.5 ? [DIFFICULTY_CURVE[0], DIFFICULTY_CURVE[1]] : [DIFFICULTY_CURVE[1], DIFFICULTY_CURVE[2]];
  const u = t <= 0.5 ? t * 2 : (t - 0.5) * 2;
  return a.map((x, i) => x + (b[i] - x) * u);
}

// =====================================================================
// Spielzustand
// =====================================================================
const players = new Map(); // id -> {id,name,color,avatar,score,connected,joinedAt}
const clients = new Set(); // {res, role, playerId}
let state = newGameState();
let timer = null;

function newGameState() {
  return { phase: 'lobby', questions: [], idx: -1, phaseEnds: 0, phaseMs: 0, startedAt: 0, answers: {}, results: {}, step: 0, stats: {} };
}

function currentQuestion() { return state.questions[state.idx]; }

// ---------- Host & PIN ----------
// Ohne PIN: der zuerst beigetretene, verbundene Spieler ist der Gamemaster (👑) – wie bisher.
// Mit PIN: wer die PIN eingegeben hat (oder ein gemerktes Handy hat), ist „angemeldet“ und bekommt die Krone.
// Die Krone lässt sich übergeben (crownId). Was die PIN schützt, steht in hostCfg (Raum & Technik / Spiel leiten).
const HOST_FILE = path.join(__dirname, 'host.json');
let hostCfg = { pin: null, protectTech: true, protectGame: false, devices: [] };
try { hostCfg = { ...hostCfg, ...JSON.parse(fs.readFileSync(HOST_FILE, 'utf8')) }; } catch (_) {}
const saveHost = () => { try { fs.writeFileSync(HOST_FILE, JSON.stringify(hostCfg, null, 2)); } catch (_) {} };
const pinSet = () => !!(hostCfg.pin && hostCfg.pin.hash);
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex');
let crownId = null;              // wem die Krone gerade gehört (angemeldet oder übergeben)
let pinFails = { n: 0, until: 0 };   // Schutz gegen Durchprobieren: 5 Fehlversuche -> 60 s Sperre
let pinReset = null;             // { code, until }: Code zum Zurücksetzen, steht 60 s am Fernseher

function vipId() {
  const list = [...players.values()].filter(p => p.connected).sort((a, b) => a.joinedAt - b.joinedAt);
  const c = crownId && players.get(crownId);
  if (c && c.connected) return c.id;
  const authed = pinSet() && list.find(p => p.authed);
  if (authed) return authed.id;
  return list[0] ? list[0].id : null;
}
// Spiel leiten (starten, weiter, Einstellungen für Spiel/Fragen, Spieler): der 👑 – mit „Spiel leiten“ geschützt nur angemeldet
const canLead = id => !!id && id === vipId() && (!pinSet() || !hostCfg.protectGame || !!(players.get(id) || {}).authed);
// Raum & Technik (Musik, Licht, Netzwerk, System, Fragen-Quelle): ohne PIN der 👑, mit PIN nur Angemeldete
const canTech = id => { const p = players.get(id); if (!p) return false;
  if (!pinSet()) return id === vipId();
  return hostCfg.protectTech ? !!p.authed : id === vipId() || !!p.authed; };
function pinInfo(id) {
  const p = players.get(id) || {};
  return { set: pinSet(), protectTech: hostCfg.protectTech, protectGame: hostCfg.protectGame, locked: pinFails.until > Date.now() ? Math.ceil((pinFails.until - Date.now()) / 1000) : 0,
    devices: p.authed ? hostCfg.devices.map(d => ({ id: d.id, name: d.name, added: d.added, last: d.last, mine: d.id === p.deviceId })) : [] };
}
function newDevice(p) {
  const token = crypto.randomBytes(24).toString('hex'), id = crypto.randomBytes(4).toString('hex');
  hostCfg.devices.push({ id, hash: hashToken(token), name: `Handy von ${p.name}`, added: Date.now(), last: Date.now() });
  hostCfg.devices = hostCfg.devices.slice(-10);
  p.deviceId = id;
  return token;
}
function becomeHost(p, remember) {
  p.authed = true; crownId = p.id;
  const token = remember ? newDevice(p) : null;
  saveHost(); broadcast();
  return token;
}
function pinAction(body) {
  const p = players.get(body.id), a = body.action;
  if (!p) return { ok: false, text: 'Bitte erst beitreten.' };
  const validPin = x => /^\d{4}$/.test(String(x || ''));
  const locked = () => pinFails.until > Date.now();
  const fail = () => { pinFails.n++; if (pinFails.n >= 5) { pinFails = { n: 0, until: Date.now() + 60000 }; } return { ok: false, text: locked() ? 'Zu viele Fehlversuche – 60 Sekunden warten.' : 'Falsche PIN.' }; };
  if (a === 'status') return { ok: true, pin: pinInfo(p.id) };
  if (a === 'token') {   // gemerktes Handy meldet sich an
    const d = body.token && hostCfg.devices.find(x => x.hash === hashToken(body.token));
    if (!d || !pinSet()) return { ok: false, forget: true };
    p.authed = true; p.deviceId = d.id; d.last = Date.now();
    const c = crownId && players.get(crownId);
    if (!c || !c.connected || !c.authed) crownId = p.id;   // Krone nur übernehmen, wenn sie gerade kein Angemeldeter hat
    saveHost(); broadcast();
    return { ok: true };
  }
  if (a === 'login') {
    if (!pinSet()) return { ok: false, text: 'Es gibt noch keine PIN.' };
    if (locked()) return { ok: false, text: 'Zu viele Fehlversuche – kurz warten.' };
    if (hashPin(body.pin, hostCfg.pin.salt) !== hostCfg.pin.hash) return fail();
    pinFails.n = 0;
    return { ok: true, token: becomeHost(p, body.remember !== false) };
  }
  if (a === 'set') {   // PIN festlegen (ohne PIN: der 👑) oder ändern (angemeldet)
    if (pinSet() ? !p.authed : p.id !== vipId()) return { ok: false, text: 'Nur der Host darf die PIN festlegen.' };
    if (!validPin(body.pin)) return { ok: false, text: 'Die PIN hat 4 Ziffern.' };
    const salt = crypto.randomBytes(8).toString('hex');
    hostCfg.pin = { salt, hash: hashPin(body.pin, salt) };
    return { ok: true, token: becomeHost(p, body.remember !== false && !p.deviceId) };
  }
  if (a === 'remove') {   // PIN entfernen: wieder wie ohne PIN
    if (!p.authed) return { ok: false, text: 'Nur angemeldet.' };
    hostCfg = { ...hostCfg, pin: null, devices: [] };
    for (const x of players.values()) { x.authed = false; x.deviceId = null; }
    saveHost(); broadcast(); return { ok: true };
  }
  if (a === 'options') {
    if (!p.authed) return { ok: false, text: 'Nur angemeldet.' };
    if (typeof body.protectTech === 'boolean') hostCfg.protectTech = body.protectTech;
    if (typeof body.protectGame === 'boolean') hostCfg.protectGame = body.protectGame;
    saveHost(); broadcast(); return { ok: true, pin: pinInfo(p.id) };
  }
  if (a === 'forget') {   // gemerktes Handy entfernen
    if (!p.authed) return { ok: false, text: 'Nur angemeldet.' };
    hostCfg.devices = hostCfg.devices.filter(d => d.id !== body.device);
    for (const x of players.values()) if (x.deviceId === body.device) { x.deviceId = null; if (x.id !== p.id) x.authed = false; }
    saveHost(); broadcast(); return { ok: true, pin: pinInfo(p.id) };
  }
  if (a === 'resetstart') {   // PIN vergessen: Code für 60 s am Fernseher – wer ihn sieht, ist im Raum
    if (!pinSet()) return { ok: false, text: 'Es gibt keine PIN.' };
    pinReset = { code: String(crypto.randomInt(0, 10000)).padStart(4, '0'), until: Date.now() + 60000, by: p.id, fails: 0 };
    clearTimeout(pinAction.t); pinAction.t = setTimeout(() => { pinReset = null; broadcast(); }, 60000);
    broadcast(); return { ok: true };
  }
  if (a === 'resetcode') {   // Code vom Fernseher + neue PIN
    if (!pinReset || pinReset.until < Date.now() || pinReset.by !== p.id) return { ok: false, text: 'Der Code ist abgelaufen – bitte neu anfordern.' };
    if (String(body.code) !== pinReset.code) { if (++pinReset.fails >= 3) { pinReset = null; broadcast(); } return { ok: false, text: 'Falscher Code.' }; }
    if (!validPin(body.pin)) return { ok: false, text: 'Die PIN hat 4 Ziffern.' };
    pinReset = null; clearTimeout(pinAction.t);
    const salt = crypto.randomBytes(8).toString('hex');
    hostCfg.pin = { salt, hash: hashPin(body.pin, salt) }; hostCfg.devices = [];   // alte gemerkte Handys gelten nicht mehr
    for (const x of players.values()) { x.authed = false; x.deviceId = null; }
    return { ok: true, token: becomeHost(p, body.remember !== false) };
  }
  if (a === 'crown') {   // Krone übergeben
    if (!canLead(p.id) && !p.authed) return { ok: false, text: 'Nur der 👑 (oder wer die PIN kennt) kann die Krone vergeben.' };   // Angemeldete können sie jederzeit zurückholen
    const t = players.get(body.target);
    if (!t || !t.connected) return { ok: false, text: 'Spieler ist nicht da.' };
    if (t.id === vipId()) return { ok: true };
    if (pinSet() && hostCfg.protectGame && !t.authed) return { ok: false, text: '„Spiel leiten“ ist mit der PIN geschützt – der andere braucht die PIN.' };
    crownId = t.id; broadcast(); return { ok: true };
  }
  return { ok: false, text: 'Unbekannte Aktion' };
}

// ---------- Pub-Quiz-Modus: der Host (👑) spielt nicht mit, sondern moderiert ----------
// Im Spiel gilt der Modus, der beim Start eingestellt war; der Host steht beim Start fest.
const pubActive = () => state.phase === 'lobby' ? !!(settings.pub && settings.pub.on) : !!state.pub;
const hostId = () => state.phase === 'lobby' || !state.hostId ? vipId() : state.hostId;
const isPlayer = p => !(pubActive() && p.id === hostId());

function freeSlot() {
  const used = new Set([...players.values()].map(p => p.slot));
  for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
  return -1;
}

function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }
function setPhase(phase, ms, next) {
  clearTimer();
  state.frozen = null;
  state.next = next || null;
  state.phase = phase;
  if (phase === 'end') bestenlisteEintragen();
  state.phaseMs = ms || 0;
  state.phaseEnds = ms ? Date.now() + ms : 0;
  if (ms && next) timer = setTimeout(next, ms);
  broadcast();
  hueUpdate();
  spotifyUpdate();
  // Pause: in der letzten Minute das Licht langsam herunterdimmen (bei kurzer Pause nach dem Hellwerden)
  clearTimeout(hueDimTimer);
  if (phase === 'pause' && ms) hueDimTimer = setTimeout(() => {
    if (state.phase === 'pause' && !state.frozen && !hotspot()) hue.onPhase('pausedim', { ms: Math.max(0, state.phaseEnds - Date.now() - PAUSE_GRACE_MS) }).catch(() => {});
  }, Math.max(3500, ms - 60000 - PAUSE_GRACE_MS));
  armSpotifyFinale();
}
let hueDimTimer = null;

// Blockpause: Spotify läuft weiter, in der letzten Minute spielt der Fernseher seine Countdown-Musik –
// Spotify vorher ausblenden (Fade 1,5 s + Wartezeit + Funk, darum gut 3 s Vorlauf). Ohne Dauer (∞) oder ohne Quiz-Ton: durchlaufen lassen.
const SPOTIFY_FINALE_LEAD_MS = 60000 + 500 + 3000;   // dazu kommt PAUSE_GRACE_MS (weiter unten definiert)
let spotifyFinaleTimer = null;
function armSpotifyFinale() {
  clearTimeout(spotifyFinaleTimer);
  if (state.phase !== 'pause' || state.frozen || !state.phaseEnds || !settings.sound.on) return;
  spotifyFinaleTimer = setTimeout(() => {
    if (state.phase === 'pause' && !state.frozen && !hotspot()) spotify.onPhase('pausefinale');
  }, Math.max(0, state.phaseEnds - Date.now() - SPOTIFY_FINALE_LEAD_MS - PAUSE_GRACE_MS));
}

// Licht passend zur Phase (macht nichts, solange Hue nicht eingerichtet ist – und nicht im eigenen WLAN des Pi,
// dort ist die Bridge nicht erreichbar)
function hueUpdate() {
  if (hotspot()) return;
  const q = currentQuestion(), ph = state.frozen ? 'frozen' : state.phase;
  const info = {};
  if (ph === 'reveal' && q) { info.q = state.idx; info.correct = q.kind === 'choice' ? q.correct : null; }
  if (ph === 'end') { const w = ranking()[0]; info.winnerColor = w && w.color; }
  hue.onPhase(ph, info).catch(() => {});
}

// Spotify: läuft im Spiel, pausiert bei eigener Quiz-Musik und solange bei Musik-/Filmfragen Ton/Video läuft
function spotifyUpdate() {
  if (hotspot()) return;
  const q = currentQuestion();
  spotify.onPhase(state.phase, { sound: !!(q && (q.audio || q.video || q.spotify)) });
}


function prepareQuestion(q) {
  const out = { ...q };
  if (q.kind === 'choice') {
    out.answers = shuffle(q.answers);
    out.correct = out.answers.indexOf(q.answers[0]);
  }
  if (q.kind === 'match') {
    const pairs = shuffle(q.pairs);
    out.left = pairs.map(p => p[0]);
    // Antworten mischen – aber nie so, dass sie zufällig schon in Lösungsreihenfolge neben den Begriffen stehen
    for (let tries = 0; tries < 20; tries++) {
      out.right = shuffle(pairs.map(p => p[1]));
      out.solution = pairs.map(p => out.right.indexOf(p[1])); // linker Index -> rechter Index
      if (pairs.length < 2 || out.solution.some((r, i) => r !== i)) break;
    }
  }
  if (q.kind === 'tf') {
    const items = shuffle(q.items);
    out.statements = items.map(i => i[0]); out.truths = items.map(i => i[1]);
  }
  const suffix = q.kind === 'estimate' ? ' · Schätzfrage' : q.kind === 'match' ? ' · Zuordnung' : q.kind === 'tf' ? ' · Richtig oder falsch' : '';
  if (q.flash) { out.label = 'Merkbild' + suffix; out.icon = '📸'; }
  else if (q.video) { out.label = 'Seh-Test' + suffix; out.icon = '👀'; }
  else if (q.audio) { out.label = 'Soundcheck' + suffix; out.icon = '🎧'; }
  else if (q.spotify) { out.label = 'Spotify' + suffix; out.icon = '🎵'; out.brand = 'spotify'; }
  else if (q.kind === 'pin') { out.label = 'Wo liegt das?'; out.icon = '📍'; }
  else if (q.kind === 'land') { out.label = q.map === 'deutschland' ? 'Welches Bundesland?' : 'Welches Land?'; out.icon = '🗺️'; }
  else if (q.kind === 'match') { out.label = 'Zuordnung'; out.icon = '🔗'; }
  else if (q.kind === 'tf') { out.label = 'Richtig oder falsch'; out.icon = '⚖️'; }
  else if (q.kind === 'estimate') { out.label = q.image ? 'Bilderrätsel · Schätzfrage' : 'Schätzfrage'; out.icon = q.image ? '🖼️' : '🔢'; }
  else if (q.image) { out.label = 'Bilderrätsel'; out.icon = '🖼️'; }
  out.timeMs = q.timeMs || (q.kind === 'match' ? MATCH_TIME_MS : q.kind === 'tf' ? TF_TIME_MS : q.kind === 'pin' || q.kind === 'land' ? MAP_TIME_MS : QUESTION_TIME_MS);
  return out;
}

function buildGame() {
  // Fragen für alle Blöcke ziehen: Schwierigkeit nach Spielfortschritt, keine Frage doppelt
  const plan = settings.blocks.map((b, bi) => ({ bi, ...blockSummary(b), pool: blockPool(b) })).filter(b => b.plays > 0);
  const total = plan.reduce((s, b) => s + b.plays, 0);
  const used = new Set(), out = [];
  let prev = null;   // Fragen-Mix (fragenmix.js): Abwechslung bei den Fragearten, auch über Block-Grenzen hinweg
  plan.forEach((b, n) => {
    for (let k = 0; k < b.plays; k++) {
      const left = b.pool.filter(q => !used.has(q));
      if (!left.length) break;
      const q = pickNext(left, { prev, pos: k, len: b.plays, weights: levelWeights(out.length, total), fresher });
      used.add(q); prev = q;
      out.push({ ...prepareQuestion(q), block: n, bi: b.bi, blockCount: plan.length, blockNames: b.names });
    }
    // Nummer innerhalb des Blocks (für "Block 1/2 · Frage 3/8")
    const inBlock = out.filter(x => x.block === n);
    inBlock.forEach((x, i) => { x.blockQ = i + 1; x.blockLen = inBlock.length; });
  });
  return out;
}

// ---------- Pub-Quiz: Fragenplan, den der Host vor dem Spiel bearbeiten kann ----------
let pubPlan = null;   // { items: [{ uid, bi }], special: uid | null }
const byUid = () => { const m = new Map(); packs.forEach(pk => pk.questions.forEach(q => m.set(q.uid, q))); return m; };
function planValid() {
  if (!pubPlan || !pubPlan.items.length) return false;
  const m = byUid();
  return pubPlan.items.every(it => m.has(it.uid) && it.bi < settings.blocks.length);
}
function planEnsure() {
  if (planValid()) return;
  pubPlan = { items: buildGame().map(q => ({ uid: q.uid, bi: q.bi })), special: null };
}
function planQuestions() {
  const m = byUid(), out = [];
  const bis = [...new Set(pubPlan.items.map(it => it.bi))].sort((a, b) => a - b);
  bis.forEach((bi, n) => {
    const names = blockSummary(settings.blocks[bi]).names;
    pubPlan.items.filter(it => it.bi === bi).forEach(it => out.push({ ...prepareQuestion(m.get(it.uid)), block: n, bi, blockCount: bis.length, blockNames: names }));
    const inBlock = out.filter(x => x.block === n);
    inBlock.forEach((x, i) => { x.blockQ = i + 1; x.blockLen = inBlock.length; });
  });
  return out;
}
function planItemView(q, extra) {
  const pq = prepareQuestion(q);
  return { uid: q.uid, text: q.text, kind: q.kind, icon: pq.icon || '❓', label: pq.label || 'Quizfrage', level: q.level, pack: q.pack, category: q.category, ...extra };
}
function planView() {
  const m = byUid();
  return { ok: true, specialOn: settings.special.on, special: pubPlan.special,
    blocks: settings.blocks.map((b, bi) => ({ bi, names: blockSummary(b).names })),
    items: pubPlan.items.map((it, i) => planItemView(m.get(it.uid), { i, bi: it.bi, isSpecial: pubPlan.special === it.uid })) };
}
function planAction(body) {
  planEnsure();
  const items = pubPlan.items, i = Number(body.i), it = items[i];
  const used = new Set(items.map(x => x.uid));
  const poolOf = bi => blockPool(settings.blocks[bi] || { disabled: [] });
  switch (body.action) {
    case 'get': break;
    case 'new': pubPlan = null; planEnsure(); break;
    case 'reroll': {   // zufällige andere Frage aus demselben Block, möglichst gleiche Schwierigkeit
      if (!it) return { ok: false };
      const m = byUid(), cur = m.get(it.uid), free = poolOf(it.bi).filter(q => !used.has(q.uid));
      if (!free.length) return { ok: false, text: 'Keine weiteren Fragen in diesem Block.' };
      const same = free.filter(q => q.level === cur.level), list = fresher(same.length ? same : free);
      const pick = list[Math.floor(Math.random() * list.length)];
      if (pubPlan.special === it.uid) pubPlan.special = pick.uid;
      it.uid = pick.uid;
      break;
    }
    case 'candidates': {
      if (!it) return { ok: false };
      return { ok: true, i, current: it.uid, list: poolOf(it.bi).map(q => planItemView(q, { used: used.has(q.uid) && q.uid !== it.uid })) };
    }
    case 'replace': {
      const q = byUid().get(String(body.uid));
      if (!it || !q || (used.has(q.uid) && q.uid !== it.uid)) return { ok: false, text: 'Diese Frage ist schon im Plan.' };
      if (pubPlan.special === it.uid) pubPlan.special = q.uid;
      it.uid = q.uid;
      break;
    }
    case 'move': {   // ↑/↓, über Blockgrenzen hinweg
      const d = Number(body.dir) < 0 ? -1 : 1, nb = items[i + d];
      if (!it || !nb) break;
      if (nb.bi === it.bi) { items[i] = nb; items[i + d] = it; }
      else it.bi = nb.bi;   // landet am Ende (↑) bzw. Anfang (↓) des Nachbarblocks
      break;
    }
    case 'special': if (it) pubPlan.special = pubPlan.special === it.uid ? null : it.uid; break;
    default: return { ok: false, text: 'Unbekannte Aktion' };
  }
  return planView();
}

// ---------- Risikofrage: einmal pro Spiel (wenn eingeschaltet). Richtig = Punkte, falsch = genauso viele Punkte weg,
// nicht antworten = nichts passiert. Nur Fragen mit klarem Richtig/Falsch (Auswahl, Land antippen), mindestens ★★,
// nie im ersten Drittel. Position zufällig mit exponentiell steigendem Gewicht – meist kommt sie spät.
const riskEligible = q => (q.kind === 'choice' || q.kind === 'land') && (q.level || 1) >= 2 && !q.tiebreak;
function pickRisk(qs, rnd = Math.random) {
  if (!settings.risk || !settings.risk.on || !qs.length) return null;
  const n = qs.length, from = Math.ceil(n / 3);
  const c = qs.map((q, i) => ({ q, i })).filter(({ q, i }) => i >= from && riskEligible(q) && q.uid !== state.pubSpecial);
  if (!c.length) return null;
  const w = c.map(({ i }) => Math.exp(RISK_CURVE * (n > 1 ? i / (n - 1) : 1)));
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let k = 0; k < c.length; k++) if ((r -= w[k]) <= 0) return c[k].q.uid;
  return c[c.length - 1].q.uid;
}
const isRisk = q => !!q && !!state.riskUid && q.uid === state.riskUid;

function startGame() {
  loadPacks();
  if (pubActive()) planEnsure();
  const questions = pubActive() ? planQuestions() : buildGame();
  if (!questions.length) return false;
  for (const p of players.values()) { p.score = 0; p.streak = 0; p.ready = false; }
  const pub = pubActive(), host = vipId();
  state = newGameState(); anleitung = null;
  state.pub = pub; state.hostId = pub ? host : null; state.scoring = settings.scoring;
  state.pubSpecial = pub && settings.special.on ? (pubPlan && pubPlan.special) || null : null;
  state.questions = questions;
  state.riskUid = pickRisk(questions);
  state.opening = openingInfo(questions);
  showIdent(() => setPhase('opening', OPENING_MS, nextQuestion));   // erst der Opener, dann das Intro
  return true;
}

// Technik-Test: alle Fragearten und Kombinationen der gewählten Testpakete der Reihe nach (ein Block je Paket).
// Ohne Opener, Risiko-/Spezialfrage, Stechen und Pause; zählt nicht als „schon gespielt“. Spotify-Fragen nur, wenn verbunden.
// extra = 'special' | 'risk': nur eine Auswahlfrage – mit Spezialfrage-Screen (nach dem Antworten) bzw. Risikofrage-Screen (davor)
function startTechTest(ids, extra) {
  loadPacks();
  let sel = techPacks.filter(p => !ids || ids.includes(p.id)).map(p => ({ p, qs: p.questions.filter(usable) })).filter(b => b.qs.length);
  if (extra) {
    const p = techPacks.find(x => x.questions.some(q => q.kind === 'choice' && !q.image && !q.audio && !q.video && !q.spotify));
    const q = p && p.questions.find(q => q.kind === 'choice' && !q.image && !q.audio && !q.video && !q.spotify);
    sel = q ? [{ p: { ...p, name: extra === 'risk' ? 'Risikofrage' : 'Spezialfrage' }, qs: [q] }] : [];
  }
  if (!sel.length) return false;
  const questions = [];
  sel.forEach(({ p, qs }, n) => qs.forEach((q, i) => questions.push({ ...prepareQuestion(q), block: n, bi: 0, blockCount: sel.length,
    blockNames: ['🧪 ' + p.name], blockQ: i + 1, blockLen: qs.length })));
  for (const p of players.values()) { p.score = 0; p.streak = 0; p.ready = false; }
  state = newGameState(); anleitung = null;
  state.tech = true; state.pub = false; state.hostId = null; state.scoring = settings.scoring;
  state.pubSpecial = extra === 'special' ? questions[0].uid : null; state.questions = questions;
  state.riskUid = extra === 'risk' ? questions[0].uid : null;
  state.opening = openingInfo(questions);
  console.log(`  🧪 Technik-Test: ${questions.length} Fragen aus ${sel.map(b => b.p.name).join(', ')}`);
  nextQuestion();
  return true;
}

// Opener (Branding-Einspieler): läuft beim Spielstart und nach der Pause; überspringbar
function showIdent(next) {
  state.identNext = next;
  setPhase('ident', IDENT_MS, next);
}

// Was erwartet uns heute? Kategorien gemischt, damit die Reihenfolge nichts verrät
function openingInfo(questions) {
  const blocks = [];
  questions.forEach(q => { blocks[q.block] = (blocks[q.block] || 0) + 1; });
  const cats = shuffle([...new Set(questions.map(q => q.category).filter(Boolean))]);
  const T = [
    ['choice', '❓', 'Quizfragen', q => q.kind === 'choice' && !q.image && !q.video && !q.audio && !q.spotify],
    ['image', '🖼️', 'Bilderrätsel', q => q.image && !q.flash && !q.video && !q.audio],
    ['flash', '📸', 'Merkbild', q => q.flash],
    ['estimate', '🔢', 'Schätzfragen', q => q.kind === 'estimate' && !q.image && !q.video && !q.audio && !q.spotify],
    ['match', '🔗', 'Zuordnung', q => q.kind === 'match' && !q.video && !q.audio && !q.spotify],
    ['tf', '⚖️', 'Richtig oder falsch', q => q.kind === 'tf' && !q.video && !q.audio && !q.spotify],
    ['pin', '📍', 'Wo liegt das?', q => q.kind === 'pin'],
    ['land', '🗺️', 'Länder auf der Karte', q => q.kind === 'land'],
    ['video', '👀', 'Seh-Test', q => q.video],
    ['audio', '🎧', 'Soundcheck', q => q.audio],
    ['spotify', '🎵', 'Spotify', q => q.spotify],
  ];
  const types = T.filter(([, , , f]) => questions.some(f)).map(([id, icon, label]) => ({ id, icon, label }));
  return {
    blocks: blocks.filter(Boolean), questions: questions.length, categories: cats, types,
    special: settings.special && settings.special.on ? settings.special.mult : null,
    risk: !!state.riskUid,
    pause: settings.pause && settings.pause.on && blocks.length > 1 ? settings.pause.minutes : null,
    scoring: settings.scoring,
  };
}

function nextQuestion() {
  state.idx++;
  if (state.idx >= state.questions.length) return setPhase('end');
  state.answers = {};
  state.skipped = {};   // Risikofrage: bewusst ausgesetzt
  state.results = {};
  state.step = 0;
  state.special = false;
  const q = currentQuestion(), prev = state.questions[state.idx - 1];
  if (!prev || prev.block !== q.block) setPhase('block', BLOCK_MS, beginQuestion); // neuer Block (auch wenn es nur einen gibt)
  else beginQuestion();
}

function beginQuestion() {
  if (!state.tech) markPlayed(currentQuestion().uid);   // Technik-Test zählt nicht als gespielt
  if (currentQuestion().tiebreak) return startAnswering();
  if (isRisk(currentQuestion()) && state.phase !== 'risk') return setPhase('risk', RISK_MS, beginQuestion);   // roter Alarm vor der Frage   // Stechen: die Ansage „Stechen!“ ersetzt die Fragen-Ansage
  if (currentQuestion().label) setPhase('intro', INTRO_MS, afterIntro); // neue Fragearten werden angekündigt
  else startAnswering();
}

function afterIntro() {
  const q = currentQuestion();
  if (q.flash) setPhase('media', q.flash * 1000, afterMedia);             // Merkbild: Bild nur kurz zeigen, dann die Frage
  else if (q.video || q.audio) setPhase('media', MEDIA_MAX_MS, afterMedia); // erst Video/Audio, dann die Frage
  else if (q.spotify) playSpotifySnippet(q);
  else afterMedia();
}

// Spotify-Musikfrage: Ausschnitt auf dem Spotify-Gerät, danach die Frage. Sicherheitsnetz: Gesamtdauer + 10 s
function playSpotifySnippet(q) {
  const o = q.audioOpts, n = o.repeat || 1, total = (n * o.dauer + (n - 1) * o.gap) * 1000;
  const key = state.idx;
  state.snip = null;   // { k, at }: wann Spotify die k-te Wiederholung tatsächlich gestartet hat (Anzeige am Fernseher)
  setPhase('media', total + 10000, afterMedia);
  spotify.snippet(q.spotify, o, () => state.idx === key && state.phase === 'media' && !state.frozen,
    k => { if (state.idx === key && state.phase === 'media') { state.snip = { k, at: Date.now() }; broadcast(); } }).then(r => {
    if (state.idx !== key || state.phase !== 'media' || state.frozen) return;
    if (!r.ok) console.log('  Spotify-Musikfrage ging nicht – weiter mit der Frage');
    afterMedia();
  });
}

function afterMedia() {
  if (currentQuestion().kind === 'match') setPhase('preview', PREVIEW_MS, startAnswering);
  else startAnswering();
}

function startAnswering() {
  state.startedAt = Date.now();
  state.answerEnds = state.startedAt + currentQuestion().timeMs;
  setPhase('question', currentQuestion().timeMs, endAnswering);
}

function endAnswering() {
  // Pub-Quiz: Antworten sind zu, aufgelöst wird erst auf Knopfdruck des Hosts
  if (state.pub && state.phase === 'question') return setPhase('locked', 0, null);
  if (currentQuestion().tiebreak || isRisk(currentQuestion())) return showAnswers();   // beim Stechen und bei der Risikofrage keine Spezialfrage
  // Spezialfrage: genau einmal pro Spiel. Chance steigt linear von 1 % (erste Frage) auf 100 % (letzte Frage)
  if ((settings.special.on || state.tech) && !state.specialDone && state.pubSpecial) {   // Technik-Test: auch wenn ausgeschaltet
    // vom Host festgelegte Spezialfrage
    if (currentQuestion().uid === state.pubSpecial) { state.special = true; state.specialDone = true; return setPhase('special', SPECIAL_MS, showAnswers); }
  } else if (settings.special.on && !state.specialDone && !state.tech) {
    const k = state.idx, n = state.questions.length;
    const chance = n <= 1 ? 1 : 0.01 + 0.99 * k / (n - 1);
    if (Math.random() < chance) {
      state.special = true; state.specialDone = true;
      return setPhase('special', SPECIAL_MS, showAnswers);
    }
  }
  showAnswers();
}

// Fragen, die Schritt für Schritt aufgelöst werden (Zuordnen: Paar für Paar, Richtig/falsch: Aussage für Aussage)
const stepCount = q => q.kind === 'match' ? q.left.length : q.kind === 'tf' ? q.statements.length : 0;

function showAnswers() {
  if (stepCount(currentQuestion())) reveal();
  else setPhase('votes', ['pin', 'land'].includes(currentQuestion().kind) ? MAP_VOTES_MS : VOTES_MS, reveal);
}

// ---------- Auszeichnungen bei der Siegerehrung: Statistik je Spieler während des Spiels ----------
function recordStats() {
  const q = currentQuestion();
  if (!q || q.tiebreak) return;
  for (const p of players.values()) {
    if (!isPlayer(p)) continue;
    const st = state.stats[p.id] || (state.stats[p.id] = { times: [], streak: 0, best: 0, late: 0, est: null });
    const a = state.answers[p.id], r = state.results[p.id], ok = !!(r && r.correct);
    const left = a ? Math.max(0, state.answerEnds - a.at) : 0;
    if (a && ok && q.kind !== 'estimate' && q.kind !== 'pin') st.times.push(q.timeMs - left);
    if (!a && r && r.risk) continue;   // Risikofrage ausgelassen: zählt nicht
    st.streak = ok ? st.streak + 1 : 0; st.best = Math.max(st.best, st.streak);
    if (a && ok && left <= 3000) st.late++;
    if (a && q.kind === 'estimate') {
      const err = estErr(q, a.value);
      if (!st.est || err < st.est.err) st.est = { err, value: a.value, target: q.value, unit: q.unit || '', year: !!q.year };
    }
  }
}
// Sonderpreise: nur wer sie sich verdient hat; Gleichstand -> wer zuerst beigetreten ist
function computeAwards() {
  const list = ranking().map(p => ({ p, st: state.stats[p.id] })).filter(x => x.st);
  // Preise möglichst verteilen: wer schon einen hat, kommt nur zum Zug, wenn sonst niemand die Bedingung erfüllt
  const out = [], has = id => out.some(o => o.id === id);
  const best = (score, ok) => { const c = list.filter(x => ok(x.st)).sort((a, b) => score(a.st) - score(b.st) || a.p.joined - b.p.joined); return c.find(x => !has(x.p.id)) || c[0]; };
  const nf = (n, d = 1) => n.toFixed(d).replace('.', ',');
  const avg = st => st.times.reduce((s, t) => s + t, 0) / st.times.length;
  let w = best(avg, st => st.times.length >= 2);
  if (w) out.push({ icon: '⚡', title: 'Schnellster Finger', id: w.p.id, text: `Ø ${nf(avg(w.st) / 1000)} s bis zur richtigen Antwort` });
  w = best(st => st.est.err, st => st.est);
  if (w) { const e = w.st.est, u = e.unit ? ' ' + e.unit : '', f = n => e.year ? String(n) : n.toLocaleString('de-DE');
    out.push({ icon: '🎯', title: 'Beste Schätzung', id: w.p.id, text: e.err === 0 ? `Punktgenau: ${f(e.value)}${u}` : `${f(e.value)}${u} statt ${f(e.target)}${u}${e.year ? '' : ` – nur ${e.err < 0.1 ? nf(e.err * 100) : Math.round(e.err * 100)} % daneben`}` }); }
  w = best(st => -st.best, st => st.best >= 3);
  if (w) out.push({ icon: '🔥', title: 'Längste Serie', id: w.p.id, text: `${w.st.best} richtige Antworten am Stück` });
  w = best(st => -st.late, st => st.late >= 1);
  if (w) out.push({ icon: '🍀', title: 'Glückspilz', id: w.p.id, text: `${w.st.late}× in den letzten 3 Sekunden richtig` });
  return out;
}

// Ewige Bestenliste: jedes fertig gespielte Spiel einmal eintragen (nicht der Technik-Test)
function bestenlisteEintragen() {
  if (state.tech || state.bestenliste) return;
  state.bestenliste = true;
  // „⏹ Spiel beenden“ mittendrin: zählt erst, wenn mindestens die Hälfte der Fragen gespielt ist
  if (state.idx + 1 < Math.ceil(state.questions.filter(q => !q.tiebreak).length / 2)) return console.log('  🏆 Bestenliste: Spiel zu früh beendet – zählt nicht');
  const r = ranking(), byId = Object.fromEntries(r.map(p => [p.id, p]));
  const serien = Object.fromEntries(r.map(p => [p.name, (state.stats[p.id] || {}).best || 0]));
  const awards = computeAwards().filter(a => byId[a.id]).map(a => ({ name: byId[a.id].name, title: a.title, icon: a.icon }));
  if (bestenliste.eintragen(r.map(p => ({ name: p.name, avatar: p.avatar, place: p.place })), awards, serien))
    console.log(`  🏆 Bestenliste: Spiel eingetragen (Sieg: ${r.filter(p => p.place === 1).map(p => p.name).join(', ')})`);
}

function streakBonus(p, ok) {
  p.streak = ok ? (p.streak || 0) + 1 : 0;
  return ok ? Math.min(p.streak - 1, 3) * 50 : 0;
}
const round10 = x => Math.round(x / 10) * 10;

// Wie weit daneben (Anteil): sonst relativ zum Wert. Jahreszahlen relativ dazu, wie lange es her ist (mind. 10 Jahre) –
// 1989 statt 1980 ist ein deutlicher Fehler, 1500 statt 1453 nicht so sehr (ohne Toleranz gilt das für jede Jahresfrage).
const estErr = (q, v) => Math.abs(v - q.value) / (q.year ? Math.max(10, Math.abs(new Date().getFullYear() - q.value)) : Math.max(Math.abs(q.value), 1));

function scoreQuestion() {
  const q = currentQuestion();
  if (inTiebreak(q)) return scoreTiebreak(q);
  if ((state.scoring || settings.scoring) === 'level') return scoreByLevel(q);
  const speed = a => Math.max(0, state.answerEnds - a.at) / q.timeMs; // 1 = sofort, 0 = letzte Sekunde
  const list = [...players.values()];
  if (q.kind === 'estimate') {
    const tol = q.tolerance;
    const inRange = d => tol === null || d <= tol;
    const diffs = list.map(p => state.answers[p.id]).filter(Boolean).map(a => Math.abs(a.value - q.value)).filter(inRange);
    const best = diffs.length ? Math.min(...diffs) : null;
    for (const p of list) {
      const a = state.answers[p.id];
      if (!a) { streakBonus(p, false); state.results[p.id] = { gain: 0, correct: false, answered: false }; continue; }
      const diff = Math.abs(a.value - q.value);
      // Mit Toleranz: exakt = volle Punkte, am Rand weniger, außerhalb nichts
      const acc = tol !== null ? (diff <= tol ? 1 - diff / (tol + 1) : 0)
        : q.value === 0 && !q.year ? (diff === 0 ? 1 : 0) : Math.max(0, 1 - estErr(q, a.value));
      const closest = best !== null && diff === best;
      const gain = round10(800 * acc) + (closest ? 200 : 0) + streakBonus(p, closest);
      p.score += gain;
      state.results[p.id] = { gain, correct: closest, exact: diff === 0, answered: true, value: a.value, outOfRange: !inRange(diff) };
    }
  } else if (q.kind === 'pin') {
    // Im Radius = richtig: 700–1000 Punkte (je näher, desto mehr). Außerhalb Teilpunkte bis "range" (bis 600), dann nichts.
    for (const p of list) {
      const a = state.answers[p.id];
      if (!a) { streakBonus(p, false); state.results[p.id] = { gain: 0, correct: false, answered: false }; continue; }
      const d = kmBetween(a.pos, q.target), inside = d <= q.radius;
      const base = inside ? 700 + 300 * (1 - d / q.radius) : 600 * Math.max(0, 1 - (d - q.radius) / (q.range - q.radius));
      const gain = round10(base) + streakBonus(p, inside);
      p.score += gain;
      state.results[p.id] = { gain, correct: inside, answered: true, km: Math.round(d * 10) / 10, outOfRange: d > q.range };
    }
  } else if (q.kind === 'land') {
    for (const p of list) {
      const a = state.answers[p.id], ok = !!a && a.region === q.region;
      const gain = ok ? round10(500 + 500 * speed(a)) + streakBonus(p, true) : (streakBonus(p, false), 0);
      p.score += gain;
      state.results[p.id] = { gain, correct: ok, answered: !!a, region: a ? a.region : null };
    }
  } else if (q.kind === 'match') {
    for (const p of list) {
      const a = state.answers[p.id];
      if (!a) { streakBonus(p, false); state.results[p.id] = { gain: 0, correct: false, answered: false, pairs: q.left.map(() => false) }; continue; }
      const pairs = q.solution.map((r, i) => a.order[i] === r);
      const k = pairs.filter(Boolean).length, all = k === pairs.length;
      const gain = round10((k / pairs.length) * (500 + 500 * speed(a))) + streakBonus(p, all);
      p.score += gain;
      state.results[p.id] = { gain, correct: all, answered: true, pairs, right: k };
    }
  } else if (q.kind === 'tf') {
    for (const p of list) {
      const a = state.answers[p.id];
      if (!a) { streakBonus(p, false); state.results[p.id] = { gain: 0, correct: false, answered: false, pairs: q.truths.map(() => false) }; continue; }
      const pairs = q.truths.map((t, i) => a.marks[i] === t), k = pairs.filter(Boolean).length, all = k === pairs.length;
      const gain = round10((k / pairs.length) * (500 + 500 * speed(a))) + streakBonus(p, all);
      p.score += gain;
      state.results[p.id] = { gain, correct: all, answered: true, pairs, right: k };
    }
  } else {
    for (const p of list) {
      const a = state.answers[p.id];
      const ok = !!a && a.choice === q.correct;
      const gain = ok ? round10(500 + 500 * speed(a)) + streakBonus(p, true) : (streakBonus(p, false), 0);
      p.score += gain;
      state.results[p.id] = { gain, correct: ok, answered: !!a, choice: a ? a.choice : null };
    }
  }
}

// Risikofrage: falsch = so viele Punkte abziehen, wie es für richtig gegeben hätte (gleiche Antwortzeit, ohne Serienbonus);
// nicht geantwortet = nichts passiert (auch die Serie bleibt stehen)
function applyRisk(streaks) {
  const q = currentQuestion(), level = (state.scoring || settings.scoring) === 'level';
  for (const p of players.values()) {
    const a = state.answers[p.id], r = state.results[p.id];
    if (!r) continue;
    r.risk = true;
    if (!a) { p.streak = streaks.get(p.id) || 0; if ((state.skipped || {})[p.id]) r.skipped = true; continue; }
    if (r.correct) continue;
    const speed = Math.max(0, state.answerEnds - a.at) / q.timeMs;
    const loss = level ? (q.level || 1) : round10(500 + 500 * speed);
    p.score -= loss; r.gain = -loss;
  }
}

// Alternative Wertung: richtige Antwort = so viele Punkte wie die Schwierigkeit (1–3).
// Zuordnung: jedes richtige Paar 1 Punkt. Schätzfrage: wer am nächsten dran ist (bei Toleranz nur innerhalb).
function scoreByLevel(q) {
  const list = [...players.values()], lv = q.level || 1;
  if (q.kind === 'estimate') {
    const tol = q.tolerance, inRange = d => tol === null || d <= tol;
    const diffs = list.map(p => state.answers[p.id]).filter(Boolean).map(a => Math.abs(a.value - q.value)).filter(inRange);
    const best = diffs.length ? Math.min(...diffs) : null;
    for (const p of list) {
      const a = state.answers[p.id];
      if (!a) { state.results[p.id] = { gain: 0, correct: false, answered: false }; continue; }
      const diff = Math.abs(a.value - q.value), closest = best !== null && diff === best;
      const gain = closest ? lv : 0;
      p.score += gain;
      state.results[p.id] = { gain, correct: closest, exact: diff === 0, answered: true, value: a.value, outOfRange: !inRange(diff) };
    }
  } else if (q.kind === 'pin') {
    // Im Radius = richtig = Punkte der Schwierigkeit
    for (const p of list) {
      const a = state.answers[p.id];
      if (!a) { state.results[p.id] = { gain: 0, correct: false, answered: false }; continue; }
      const d = kmBetween(a.pos, q.target), inside = d <= q.radius, gain = inside ? lv : 0;
      p.score += gain;
      state.results[p.id] = { gain, correct: inside, answered: true, km: Math.round(d * 10) / 10, outOfRange: d > q.range };
    }
  } else if (q.kind === 'land') {
    for (const p of list) {
      const a = state.answers[p.id], ok = !!a && a.region === q.region, gain = ok ? lv : 0;
      p.score += gain;
      state.results[p.id] = { gain, correct: ok, answered: !!a, region: a ? a.region : null };
    }
  } else if (q.kind === 'match') {
    for (const p of list) {
      const a = state.answers[p.id];
      if (!a) { state.results[p.id] = { gain: 0, correct: false, answered: false, pairs: q.left.map(() => false) }; continue; }
      const pairs = q.solution.map((r, i) => a.order[i] === r), k = pairs.filter(Boolean).length;
      p.score += k;
      state.results[p.id] = { gain: k, correct: k === pairs.length, answered: true, pairs, right: k };
    }
  } else if (q.kind === 'tf') {
    // Richtig oder falsch: jede richtig eingeschätzte Aussage 1 Punkt
    for (const p of list) {
      const a = state.answers[p.id];
      if (!a) { state.results[p.id] = { gain: 0, correct: false, answered: false, pairs: q.truths.map(() => false) }; continue; }
      const pairs = q.truths.map((t, i) => a.marks[i] === t), k = pairs.filter(Boolean).length;
      p.score += k;
      state.results[p.id] = { gain: k, correct: k === pairs.length, answered: true, pairs, right: k };
    }
  } else {
    for (const p of list) {
      const a = state.answers[p.id], ok = !!a && a.choice === q.correct, gain = ok ? lv : 0;
      p.score += gain;
      state.results[p.id] = { gain, correct: ok, answered: !!a, choice: a ? a.choice : null };
    }
  }
}

function reveal() {
  const risky = isRisk(currentQuestion()), streaks = risky ? new Map([...players.values()].map(p => [p.id, p.streak])) : null;
  scoreQuestion();
  if (risky) applyRisk(streaks);
  recordStats();
  if (state.special) {
    const m = settings.special.mult;
    for (const [id, r] of Object.entries(state.results)) {
      const p = players.get(id);
      if (p && r.gain) { p.score += r.gain * (m - 1); r.gain *= m; }
      r.mult = m;
    }
  }
  const q = currentQuestion();
  if (stepCount(q)) {
    state.step = 0;
    const stepOn = () => {
      state.step++;
      if (state.step >= stepCount(q)) setPhase('reveal', state.pub ? 0 : REVEAL_MS + 1500 + (q.info ? INFO_MS : 0), afterReveal);   // + Zeit für Kasten-Ausblenden und Avatare
      else setPhase('reveal', MATCH_STEP_MS, stepOn);
    };
    setPhase('reveal', 1200, stepOn);
  } else setPhase('reveal', state.pub ? 0 : (q.kind === 'estimate' ? ESTIMATE_REVEAL_MS : q.kind === 'pin' || q.kind === 'land' ? MAP_REVEAL_MS : REVEAL_MS) + (q.info ? INFO_MS : 0), state.pub ? null : afterReveal);
}

function afterReveal() {
  const last = state.idx >= state.questions.length - 1;
  // nach dem Stechen direkt zur Siegerehrung (oder noch einmal stechen, falls niemand geantwortet hat)
  if (currentQuestion().tiebreak) { if (!startTiebreak()) setPhase('end'); return; }
  const next = state.questions[state.idx + 1];
  const blockEnd = next && next.block !== currentQuestion().block;
  if (last || blockEnd || (SCORES_EVERY && (state.idx + 1) % SCORES_EVERY === 0)) showScores();
  else nextQuestion();
}

function isBlockEnd() {
  const next = state.questions[state.idx + 1];
  return !!next && next.block !== currentQuestion().block;
}

function afterScores() {
  // Spielende: erst die Rangliste, dann bei Gleichstand auf Platz 1 das Stechen, danach das Podest
  if (state.idx >= state.questions.length - 1) { if (state.tech || !startTiebreak()) setPhase('end'); }
  else if (isBlockEnd() && settings.pause.on && !state.tech) startBlockPause();
  else nextQuestion();
}

function showScores() { setPhase('scores', SCORES_MS, afterScores); }

// Pause zwischen zwei Blöcken (Bier holen, Klo …). 0 Minuten = bis der Host weiter drückt
// Nach Ablauf bleibt 0:00 noch kurz stehen (Schlussschlag der Musik), erst dann geht es weiter
const PAUSE_GRACE_MS = 1500;
function startBlockPause() {
  const ms = settings.pause.minutes * 60000;
  setPhase('pause', ms ? ms + PAUSE_GRACE_MS : 0, afterPause);
}
function afterPause() { showIdent(nextQuestion); }   // nach der Pause holt der Opener alle zurück an den Fernseher

// Spiel jederzeit anhalten: Timer einfrieren und später an derselben Stelle weitermachen
function freeze() {
  if (state.frozen || ['lobby', 'end'].includes(state.phase)) return;
  const remaining = state.phaseEnds ? Math.max(0, state.phaseEnds - Date.now()) : 0;
  clearTimer();
  state.frozen = { remaining, hadTimer: !!state.phaseEnds };
  clearTimeout(hueDimTimer); clearTimeout(spotifyFinaleTimer);
  broadcast();
  hueUpdate();
}
function unfreeze() {
  const f = state.frozen;
  if (!f) return;
  if (state.phase === 'question') state.answerEnds = Date.now() + f.remaining; // Schnelligkeit fair weiterrechnen
  if (f.hadTimer && f.remaining <= 0 && state.next) { state.frozen = null; return state.next(); }
  setPhase(state.phase, f.hadTimer ? f.remaining : 0, state.next);
}

function advance() {
  // "Weiter"-Knopf (👑 am Handy oder Leertaste am TV): überspringt Wartezeiten
  const q = currentQuestion();
  state.frozen = null;
  switch (state.phase) {
    case 'lobby': if (connectedCount() >= minPlayers() && allReady()) startGame(); break;   // erst, wenn alle „bereit“ getippt haben
    case 'opening': nextQuestion(); break;
    case 'tiebreak': nextQuestion(); break;
    case 'block': beginQuestion(); break;
    case 'risk': beginQuestion(); break;
    case 'intro': afterIntro(); break;
    case 'media': afterMedia(); break;
    case 'preview': startAnswering(); break;
    case 'question': endAnswering(); break;
    case 'locked': endAnswering(); break;   // Pub-Quiz: Host löst auf
    case 'special': showAnswers(); break;
    case 'votes': reveal(); break;
    case 'reveal':
      if (stepCount(q) && state.step < stepCount(q)) { state.step = stepCount(q); setPhase('reveal', state.pub ? 0 : REVEAL_MS + (q.info ? INFO_MS : 0), state.pub ? null : afterReveal); }
      else afterReveal();
      break;
    case 'scores': afterScores(); break;
    case 'pause': afterPause(); break;
    case 'ident': state.identNext ? state.identNext() : nextQuestion(); break;
    case 'end':
      for (const p of players.values()) { p.score = 0; p.streak = 0; }
      state = newGameState();
      setPhase('lobby');
      break;
  }
}

function connectedCount() { return [...players.values()].filter(p => p.connected && isPlayer(p)).length; }
// Lobby: Jeder tippt „Ich bin bereit!“. Gestartet wird erst, wenn alle verbundenen Spieler bereit sind
// (wer nicht reagiert, kann der 👑 entfernen). Nach jedem Spielstart ist wieder niemand bereit.
const notReady = () => [...players.values()].filter(p => p.connected && isPlayer(p) && !p.ready);
const allReady = () => !notReady().length;
const minPlayers = () => pubActive() ? 1 : MIN_PLAYERS;

function allAnswered() {
  const q = currentQuestion();
  const active = [...players.values()].filter(p => p.connected && isPlayer(p) && mayAnswer(q, p));
  return active.length > 0 && active.every(p => state.answers[p.id] || (state.skipped || {})[p.id]);
}

// =====================================================================
// Ansichten für TV und Handy
// =====================================================================
// Plätze mit Gleichstand: gleiche Punkte = gleicher Platz, danach geht es mit der Position weiter (1, 1, 3)
function ranking() {
  const list = [...players.values()].filter(isPlayer)
    .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
    .map(p => ({ id: p.id, name: p.name, color: p.color, avatar: p.avatar, score: p.score, connected: p.connected, joined: p.joinedAt,
      answered: !!(state.answers[p.id] || (state.skipped || {})[p.id]), result: state.results[p.id] || null, ready: !!p.ready }));
  list.forEach((p, i) => { p.place = i && p.score === list[i - 1].score ? list[i - 1].place : i + 1; });
  return list;
}

function rankOf(id) { const p = ranking().find(x => x.id === id); return p ? p.place : 0; }

// ---------- Stechen: Gleichstand auf Platz 1 am Spielende ----------
function topTied() {
  const top = ranking().filter(p => p.place === 1);
  return top.length > 1 ? top.map(p => p.id) : null;
}
// Schätzfrage aus allen geladenen Paketen: möglichst die schwierigste, die in diesem Spiel noch nicht dran war
function pickTiebreakQuestion() {
  const used = new Set(state.questions.map(q => q.uid));
  const all = packs.flatMap(p => p.questions).filter(q => q.kind === 'estimate' && !q.video && !q.audio && !q.spotify && !q.flash && !used.has(q.uid));
  for (const lv of [3, 2, 1]) {
    const c = fresher(all.filter(q => (q.level || 1) === lv));
    if (c.length) return c[Math.floor(Math.random() * c.length)];
  }
  return null;
}
function startTiebreak() {
  const ids = topTied();
  const round = ((state.tiebreak && state.tiebreak.round) || 0) + 1;
  if (!ids) return false;   // kein Gleichstand auf Platz 1
  const q = round <= TIEBREAK_MAX ? pickTiebreakQuestion() : null;
  if (!q) {
    // keine Schätzfrage mehr übrig (oder Sicherheitsnetz): das Los entscheidet – auf dem Podest gibt es nur einen Ersten
    const p = players.get(ids[Math.floor(Math.random() * ids.length)]);
    if (p) { p.score += 0.5; console.log('  Stechen: keine Schätzfrage mehr übrig – Los entscheidet für', p.name); }
    return false;
  }
  const prev = currentQuestion();
  state.questions.push({ ...prepareQuestion(q), label: null, block: prev.block, bi: prev.bi, blockCount: prev.blockCount, blockNames: prev.blockNames,
    blockQ: prev.blockQ, blockLen: prev.blockLen, tiebreak: true });
  state.tiebreak = { ids, round };
  setPhase('tiebreak', TIEBREAK_MS, nextQuestion);
  return true;
}
const inTiebreak = q => !!(q && q.tiebreak && state.tiebreak);
const mayAnswer = (q, p) => !inTiebreak(q) || state.tiebreak.ids.includes(p.id);
// Wertung des Stechens: wer am nächsten dran ist, bekommt einen halben Punkt – das reicht zum Entscheiden.
// Gleich nah dran? Dann gewinnt, wer schneller geantwortet hat. Hat niemand geantwortet, wird erneut gestochen.
function scoreTiebreak(q) {
  const ids = state.tiebreak.ids;
  const answered = ids.filter(id => state.answers[id])
    .map(id => ({ id, diff: Math.abs(state.answers[id].value - q.value), at: state.answers[id].at }))
    .sort((a, b) => a.diff - b.diff || a.at - b.at);
  const best = answered.length ? answered[0].diff : null, winner = answered.length ? answered[0].id : null;
  for (const id of ids) {
    const p = players.get(id), a = state.answers[id];
    if (!p) continue;
    if (!a) { state.results[id] = { gain: 0, correct: false, answered: false }; continue; }
    const diff = Math.abs(a.value - q.value), win = winner === id;
    if (win) p.score += 0.5;
    state.results[id] = { gain: win ? 0.5 : 0, correct: win, exact: diff === 0, answered: true, value: a.value, outOfRange: false };
  }
}

function baseView() {
  const q = currentQuestion();
  const ph = state.phase;
  const v = {
    phase: ph, vip: vipId(), minPlayers: minPlayers(), maxPlayers: MAX_PLAYERS, allReady: allReady(),
    pin: { set: pinSet(), protectTech: hostCfg.protectTech, protectGame: hostCfg.protectGame, resetting: !!(pinReset && pinReset.until > Date.now()) },
    taken: [...players.values()].map(p => p.avatar),   // vergebene Emojis (auch das des Gamemasters)
    pub: pubActive() ? { host: (() => { const h = players.get(hostId()); return h ? { id: h.id, name: h.name, avatar: h.avatar, color: h.color } : null; })() } : null,
    players: ranking(), qNum: state.idx + 1, qTotal: state.questions.length,
    remainingMs: state.frozen ? state.frozen.remaining : state.phaseEnds ? Math.max(0, state.phaseEnds - Date.now()) : 0, phaseMs: state.phaseMs,
    frozen: !!state.frozen, system: systemMsg,
    opening: state.phase === 'opening' ? state.opening : null,
    version: VERSION, packs: packSummary(), avatars: AVATARS,
    block: q ? { num: q.block + 1, total: q.blockCount, names: q.blockNames, q: q.blockQ, len: q.blockLen } : null,
    nextBlock: (() => { const n = state.questions[state.idx + 1]; return n && q && n.block !== q.block ? { num: n.block + 1, total: n.blockCount, names: n.blockNames } : null; })(),
    special: state.special && ['special', 'votes', 'reveal'].includes(ph) ? { mult: settings.special.mult } : null,
    risk: isRisk(q) && ['risk', 'intro', 'media', 'preview', 'question', 'locked', 'votes', 'reveal'].includes(ph),   // Risikofrage (vor der Frage angekündigt)
    // Stechen um Platz 1: wer darf antworten (nur in der Ansage und während der Stechen-Frage)
    tiebreak: state.tiebreak && (ph === 'tiebreak' || (q && q.tiebreak)) ? { ids: state.tiebreak.ids, round: state.tiebreak.round } : null,
    awards: ph === 'end' ? computeAwards() : null,   // Sonderpreise bei der Siegerehrung
    bestenliste: ['lobby', 'end'].includes(ph) ? bestenliste.info() : null,   // 🏆 Ewige Bestenliste (Lobby, Siegerehrung)
    anleitung: anleitungView(),
  };
  if (q && ['risk', 'intro', 'media', 'preview', 'question', 'locked', 'special', 'votes', 'reveal'].includes(ph)) {
    const vq = v.question = { kind: q.kind, label: q.label || null, icon: q.icon || null, category: q.category, tiebreak: !!q.tiebreak }; // Schwierigkeit wird im Spiel nicht verraten …
    // … außer bei Punkten nach Schwierigkeit: dann steht oben, was die Frage bringt (Zuordnen: 1 Punkt je Paar)
    if ((state.scoring || settings.scoring) === 'level') { vq.points = stepCount(q) ? 1 : (q.level || 1); vq.perPair = q.kind === 'match'; vq.perItem = q.kind === 'tf'; }
    if (ph === 'media' && q.spotify && state.snip) vq.snip = { k: state.snip.k, sinceMs: Date.now() - state.snip.at };
    if (ph === 'media') { vq.video = q.video || null; vq.audio = q.audio || null; vq.spotify = !!q.spotify; vq.audioOpts = q.audioOpts || null; vq.audioCredit = q.audioCredit || null; vq.flash = q.flash ? q.image : null; vq.credit = q.flash ? q.credit || null : null; }
    if (q.brand) vq.brand = q.brand;
    if (ph !== 'intro' && ph !== 'media' && q.kind === 'match') vq.left = q.left;
    if (['question', 'locked', 'special', 'votes', 'reveal'].includes(ph)) {
      vq.text = q.text; vq.image = q.flash ? null : q.image;   // Merkbild: in der Frage kein Bild mehr
      if (q.credit && (vq.image || ph === 'reveal')) vq.credit = q.credit;
      if (q.kind === 'choice') vq.answers = q.answers;
      if (q.kind === 'match') vq.right = q.right;
      if (q.kind === 'tf') vq.statements = q.statements;
      if (q.kind === 'estimate') { vq.unit = q.unit; vq.year = q.year; vq.tolerance = q.tolerance; vq.show = q.show; }
      if (q.kind === 'pin' || q.kind === 'land') vq.map = q.map;
      if (q.kind === 'pin') { vq.range = q.range; vq.radius = q.radius; }
    }
    if (ph === 'votes' || ph === 'reveal') {
      const byTime = Object.entries(state.answers).sort((a, b) => a[1].at - b[1].at);
      if (q.kind === 'choice') {
        vq.voters = q.answers.map((_, i) => byTime.filter(([, a]) => a.choice === i).map(([id]) => id));
        vq.counts = vq.voters.map(l => l.length);
      }
      if (q.kind === 'estimate')
        vq.guesses = byTime.map(([id, a]) => ({ id, value: a.value })).sort((a, b) => a.value - b.value);
      if (q.kind === 'pin') vq.pins = byTime.map(([id, a]) => ({ id, pos: a.pos }));
      if (q.kind === 'land') vq.picks = byTime.map(([id, a]) => ({ id, region: a.region, n: KARTEN[q.map].regions.get(a.region).n }));
    }
    if (ph === 'reveal') {
      if (q.kind === 'choice') vq.correct = q.correct;
      if (q.kind === 'estimate') vq.value = q.value;
      if (q.kind === 'pin') { vq.target = q.target; vq.name = q.name; }
      if (q.kind === 'land') { vq.region = q.region; vq.name = q.name; }
      if (q.kind === 'match') { vq.solution = q.solution.slice(0, state.step); vq.step = state.step; }
      if (q.kind === 'tf') { vq.truths = q.truths.slice(0, state.step); vq.step = state.step; }
      if (q.info && (!stepCount(q) || state.step >= stepCount(q))) vq.info = q.info;   // erst, wenn alles aufgedeckt ist
    }
  }
  return v;
}

// Fragen melden: bei der Auflösung (und der Rangliste direkt danach) für die gerade gespielte Frage
const meldbar = () => ['reveal', 'scores'].includes(state.phase) && !!currentQuestion() && !!currentQuestion().uid;

function viewFor(client, base) {
  if (client.role === 'tv') return { ...base, join: joinInfo(), pinReset: pinReset && pinReset.until > Date.now() ? { code: pinReset.code, until: pinReset.until } : null };
  const me = players.get(client.playerId);
  return { ...base, kicked: !me && kickedIds.has(client.playerId), me: me ? {
    id: me.id, name: me.name, color: me.color, avatar: me.avatar, score: me.score,
    rank: rankOf(me.id), isVip: vipId() === me.id, authed: !!me.authed, canLead: canLead(me.id), canTech: canTech(me.id),
    isHost: pubActive() && hostId() === me.id, hostQ: pubActive() && hostId() === me.id ? hostSolution() : null,
    answer: state.answers[me.id] || null,
    skipped: !!(state.skipped || {})[me.id],
    result: state.results[me.id] || null,
    gemeldet: meldbar() ? meldungen.mine(currentQuestion().uid, me.name) : null,
  } : null };
}

// ---------- Anleitung „So geht QuizAbend“ ----------
// Inhalt in anleitung.json (wird bei jedem Öffnen neu gelesen, also ohne Neustart änderbar). Der 👑 öffnet sie in der Lobby
// und blättert am Handy; alle können bei Folien mit "uebung" am Handy ausprobieren, der Fernseher zeigt die Tipps.
// Folien erscheinen nur, wenn das im Spiel vorkommt (nurWenn), und passend zur Wertung (wertung: speed | level).
const ANLEITUNG_FILE = path.join(__dirname, 'anleitung.json');
let anleitung = null;   // { folien, id (aktuelle Folie), tries: { folienId: { spielerId: Antwort } } }
function gameFeatures() {
  const f = new Set(), qs = settings.blocks.flatMap(blockPool);
  for (const q of qs) {
    f.add(q.kind);
    if (q.image && !q.flash) f.add('image');
    if (q.flash) f.add('flash');
    if (q.audio) f.add('audio');
    if (q.video) f.add('video');
    if (q.spotify) f.add('spotify');
  }
  if (settings.pub && settings.pub.on) f.add('pub');
  if (settings.special && settings.special.on) f.add('special');
  if (settings.risk && settings.risk.on) f.add('risk');
  if (settings.pause && settings.pause.on && settings.blocks.length > 1) f.add('pause');
  return f;
}
function anleitungInfo() {
  const h = players.get(pubActive() ? hostId() : vipId());
  const sum = packSummary(), nb = sum.blocks.filter(b => b.plays).length || 1;
  return { zeit: QUESTION_TIME_MS / 1000, fragen: sum.questions, bloecke: nb, scoring: settings.scoring,
    spezial: settings.special && settings.special.on ? settings.special.mult : null,
    pause: settings.pause && settings.pause.on && nb > 1 ? settings.pause.minutes : null,
    radius: MAP_RADIUS_KM, host: h ? { name: h.name, avatar: h.avatar, color: h.color } : null, pub: !!(settings.pub && settings.pub.on) };
}
function anleitungFolien() {
  const f = gameFeatures(), info = anleitungInfo();
  const vals = { zeit: info.zeit, host: info.host ? info.host.name : 'Der Host', fragen: info.fragen, spezial: info.spezial || 2,
    bloecke: info.bloecke === 1 ? '1 Block' : info.bloecke + ' Blöcke', pause: info.pause,
    spezial_kurz: info.spezial ? ` · ⭐ Spezialfrage ×${info.spezial}` : '', pause_kurz: info.pause != null ? ` · 🍺 ${info.pause ? info.pause + ' Min. ' : ''}Pause` : '',
    radius_welt: MAP_RADIUS_KM.welt, radius_europa: MAP_RADIUS_KM.europa, radius_deutschland: MAP_RADIUS_KM.deutschland };
  const fill = t => String(t == null ? '' : t).replace(/\{(\w+)\}/g, (m, k) => vals[k] != null ? vals[k] : m);
  return anleitung.folien.filter(x => (!x.nurWenn || [].concat(x.nurWenn).some(k => f.has(k))) && (!x.wertung || x.wertung === settings.scoring))
    .map(x => ({ id: String(x.id), icon: x.icon || null, kicker: fill(x.kicker), titel: fill(x.titel), text: fill(x.text), punkte: (x.punkte || []).map(fill),
      tipp: x.tipp ? fill(x.tipp) : null, uebung: x.uebung && KARTEN_OK(x.uebung) ? { ...x.uebung, frage: fill(x.uebung.frage) } : null }));
}
const KARTEN_OK = u => !['pin', 'land'].includes(u.art) || !!KARTEN[u.karte || 'deutschland'];
function anleitungLesen() {
  try {
    const raw = JSON.parse(fs.readFileSync(ANLEITUNG_FILE, 'utf8'));
    if (!Array.isArray(raw.folien) || !raw.folien.length) throw new Error('keine Folien');
    return raw.folien.filter(x => x && x.id && x.titel);
  } catch (e) { console.log('  Anleitung nicht lesbar: ' + e.message); return null; }
}
function anleitungView() {
  if (!anleitung || state.phase !== 'lobby') return null;
  const list = anleitungFolien();
  if (!list.length) return null;
  let idx = list.findIndex(x => x.id === anleitung.id);
  if (idx < 0) idx = Math.min(anleitung.idx || 0, list.length - 1);
  anleitung.id = list[idx].id; anleitung.idx = idx;
  const s = list[idx], u = s.uebung;
  const tries = u ? Object.entries(anleitung.tries[s.id] || {}).filter(([id]) => players.has(id)).sort((a, b) => a[1].at - b[1].at).map(([id, a]) => {
    const t = { id };
    if (u.art === 'choice') t.choice = a.choice;
    if (u.art === 'estimate') t.value = a.value;
    if (u.art === 'pin') t.pos = a.pos;
    if (u.art === 'land') { t.region = a.region; t.n = KARTEN[u.karte || 'deutschland'].regions.get(a.region).n; }
    return t;
  }) : null;
  return { idx, total: list.length, slide: s, tries, info: anleitungInfo(), list: list.map(x => ({ id: x.id, titel: x.titel })) };
}
function anleitungAction(body) {
  const a = body.action;
  if (state.phase !== 'lobby') return { ok: false, text: 'Die Anleitung geht nur vor dem Spiel.' };
  if (a === 'try') {
    const pl = players.get(body.id), v = anleitungView();
    const u = v && v.slide.uebung;
    if (!pl || !u) return { ok: false };
    let ans = null;
    if (u.art === 'choice' && [0, 1, 2, 3].includes(body.choice)) ans = { choice: body.choice };
    if (u.art === 'estimate' && Number.isFinite(Number(body.value)) && Math.abs(Number(body.value)) < 1e9 && body.value !== '') ans = { value: Number(body.value) };
    if (u.art === 'pin' && Array.isArray(body.pos) && body.pos.length === 2 && body.pos.every(Number.isFinite) && inMapField(u.karte || 'deutschland', body.pos)) ans = { pos: body.pos.map(n => Math.round(n * 1e4) / 1e4) };
    if (u.art === 'land' && KARTEN[u.karte || 'deutschland'].regions.has(body.region)) ans = { region: body.region };
    if (!ans) return { ok: false };
    (anleitung.tries[v.slide.id] = anleitung.tries[v.slide.id] || {})[pl.id] = { ...ans, at: Date.now() };   // Üben: ändern erlaubt
    return { ok: true };
  }
  if (body.role !== 'tv' && !canLead(body.id)) return { ok: false, status: 403 };
  if (a === 'start') {
    const folien = anleitungLesen();
    if (!folien) return { ok: false, text: 'anleitung.json fehlt oder ist kaputt – Details im Protokoll.' };
    anleitung = { folien, id: null, idx: 0, tries: {} };
    if (!anleitungView()) { anleitung = null; return { ok: false, text: 'Keine passenden Folien.' }; }
    return { ok: true };
  }
  if (!anleitung) return { ok: false };
  if (a === 'stop') { anleitung = null; return { ok: true }; }
  const v = anleitungView(); if (!v) return { ok: false };
  let to = v.idx;
  if (a === 'next') to++;
  else if (a === 'prev') to--;
  else if (a === 'goto') to = Math.round(Number(body.idx));
  if (!(to >= 0 && to < v.total)) return a === 'next' && to === v.total ? (anleitung = null, { ok: true, done: true }) : { ok: false };
  anleitung.idx = to; anleitung.id = v.list[to].id;
  return { ok: true };
}

// Pub-Quiz: Der Host sieht am Handy die Frage samt Lösung (zum Moderieren)
function hostSolution() {
  const q = currentQuestion();
  if (!q || !['risk', 'intro', 'media', 'preview', 'question', 'locked', 'special', 'votes', 'reveal'].includes(state.phase)) return null;
  const out = { kind: q.kind, text: q.text, category: q.category, label: q.label || null, icon: q.icon || null, special: state.pubSpecial === q.uid, risk: isRisk(q) };
  if (q.brand) out.brand = q.brand;
  if (q.kind === 'choice') { out.answers = q.answers; out.correct = q.correct; }
  if (q.kind === 'estimate') { out.value = q.value; out.unit = q.unit; out.year = q.year; out.tolerance = q.tolerance; }
  if (q.kind === 'pin') { out.solution = (q.name || 'Ort') + ` (${q.target[0].toFixed(2)}, ${q.target[1].toFixed(2)}) – richtig bis ${q.radius} km`; }
  if (q.kind === 'land') out.solution = q.name;
  if (q.kind === 'match') out.pairs = q.left.map((l, i) => [l, q.right[q.solution[i]]]);
  if (q.kind === 'tf') out.items = q.statements.map((t, i) => [t, q.truths[i]]);
  const next = state.questions[state.idx + 1];
  out.isLast = !next; out.blockEnd = !!next && next.block !== q.block;
  if (q.info) out.info = q.info;   // Gamemaster kann es vorlesen
  return out;
}

function send(client, data) {
  try { client.res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
}

function broadcast() {
  const base = baseView();
  for (const c of clients) send(c, viewFor(c, base));
}

// ---------- Netzwerk-Infos ----------
// Anfrage an einen fremden Namen, während das eigene WLAN läuft? (CAPTIVE=1 erzwingt das zum Testen)
let hotspotCache = { t: 0, on: false };
function captiveRedirect(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  if (!host || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost' || host.endsWith('.local')) return false;
  if (process.env.CAPTIVE === '1') return true;
  if (Date.now() - hotspotCache.t > 5000) hotspotCache = { t: Date.now(), on: !!hotspot() };
  return hotspotCache.on;
}

function hotspot() {
  // Eigenes WLAN des Pi aktiv? (NetworkManager-Hotspot hat immer 10.42.0.1; HOTSPOT=1 simuliert es für Tests)
  if (process.env.HOTSPOT === '1') return { ssid: 'QuizAbend', password: '' };
  const active = Object.values(os.networkInterfaces()).flat().some(i => i && i.address === '10.42.0.1');
  if (!active) return null;
  try { const h = JSON.parse(fs.readFileSync(HOTSPOT_FILE, 'utf8')); return { ssid: h.ssid, password: h.password }; } catch (_) { return { ssid: 'QuizAbend', password: '' }; }
}

function lanIp() {
  if (process.env.HOST_IP) return process.env.HOST_IP;
  if (hotspot()) return '10.42.0.1';
  const candidates = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      let prio = 3;
      if (i.address.startsWith('192.168.')) prio = 0;
      else if (i.address.startsWith('10.')) prio = 1;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(i.address)) prio = 2;
      if (/vmnet|vbox|virtual|docker|veth|utun|tailscale|zerotier|hyper-v|vethernet/i.test(name)) prio += 10;
      candidates.push({ address: i.address, prio });
    }
  }
  candidates.sort((a, b) => a.prio - b.prio);
  return candidates[0] ? candidates[0].address : 'localhost';
}

// kleine Ergebnis-Seite nach der Spotify-Anmeldung
function spotifyPage(res, ok, text, base) {
  res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotify – QuizAbend</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#14102b;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box">
<div><div style="font-size:64px">${ok ? '✅' : '⚠️'}</div><h1 style="font-size:24px">${ok ? 'Spotify verbunden' : 'Hat nicht geklappt'}</h1>
<p style="color:#b9b2e6;font-size:17px;line-height:1.4">${String(text).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</p>
<a href="${base || '/'}" style="display:inline-block;margin-top:12px;background:#f5b014;color:#1b1440;font-weight:800;padding:14px 22px;border-radius:14px;text-decoration:none">Zurück zum Quiz</a></div>`);
}

// Sichere Adresse nutzen? Nur im Heim-WLAN, mit gültigem Zertifikat und wenn der Name im Heimnetz auflöst
let httpsServer = null;
function httpsReady() {
  if (!httpsServer || !httpsServer.listening || hotspot()) return null;
  const st = zertifikat.status();
  if (!st.ready) return null;
  return `https://${st.host}${HTTPS_PORT === 443 ? '' : ':' + HTTPS_PORT}/`;
}

function joinInfo() {
  const port = PORT === 80 ? '' : `:${PORT}`;
  const host = os.hostname();
  // Feste Adresse über mDNS (z. B. quizabend.local), nur wenn der Rechner einen sinnvollen Namen hat
  const local = UNDER_SYSTEMD && host && !/^localhost$/i.test(host) && !host.includes('.') ? `http://${host.toLowerCase()}.local${port}` : null;
  const sec = httpsReady();
  if (sec) return { url: sec, local: null, secure: true, wifi: null };
  return { url: `http://${lanIp()}${port}/`, local, wifi: hotspot() };
}

// =====================================================================
// System: Update holen, Pi neu starten / ausschalten (nur Host)
// =====================================================================
let systemMsg = null;      // wird allen Bildschirmen angezeigt, z. B. "Pi fährt herunter"
const kickedIds = new Set();

function systemInfo() {
  return { canUpdate: fs.existsSync(path.join(__dirname, '.git')), canPower: process.platform === 'linux' && UNDER_SYSTEMD,
    autoRestart: UNDER_SYSTEMD, hostname: os.hostname(), wifi: wifiInfo() };
}

// ---------- Eigenes WLAN: Stand fürs Handy (ohne SSH prüfbar) ----------
let wifiCache = { service: null, connection: null };
function refreshWifi() {
  if (process.platform !== 'linux') return;
  execFile('systemctl', ['is-enabled', 'quizabend-hotspot.service'], { timeout: 3000 }, (err, out) => { wifiCache.service = String(out || '').trim() || 'fehlt'; });
  execFile('nmcli', ['-t', '-f', 'NAME', 'con', 'show'], { timeout: 3000 }, (err, out) => {
    wifiCache.connection = err ? null : String(out).split('\n').includes('QuizAbend-Hotspot');
  });
}
refreshWifi(); setInterval(refreshWifi, 30000);
function wifiInfo() {
  if (process.platform !== 'linux') return null;
  let status = null, log = [];
  try { status = JSON.parse(fs.readFileSync(path.join(__dirname, 'hotspot-status.json'), 'utf8')); } catch (_) {}
  try { log = fs.readFileSync(path.join(__dirname, 'hotspot.log'), 'utf8').trim().split('\n').slice(-40); } catch (_) {}
  const hs = hotspot() || (() => { try { return JSON.parse(fs.readFileSync(HOTSPOT_FILE, 'utf8')); } catch (_) { return null; } })();
  return { service: wifiCache.service, connection: wifiCache.connection, status, log, active: !!hotspot(),
    ssid: hs && hs.ssid, password: hs && hs.password, testPending: fs.existsSync(path.join(__dirname, 'hotspot-test')) };
}

function runSystem(action) {
  return new Promise(resolve => {
    if (action === 'update') {
      execFile('git', ['pull', '--ff-only'], { cwd: __dirname, timeout: 60000 }, async (err, out, errOut) => {
        const text = (out + errOut).trim();
        if (err) return resolve({ ok: false, text: text || String(err) });
        const changed = !/already up to date|bereits aktuell/i.test(text);
        // Fragen-Repo gleich mit aktualisieren (neue Fragen brauchen keinen Neustart)
        const fr = await fragenRepo.update();
        const frText = fr.none ? '' : fr.ok ? (fr.changed ? ' · Neue Fragen geladen ✓' : ' · Fragen aktuell ✓') : ' · Fragen: ' + fr.text;
        if (fr.ok && fr.changed && !(changed && UNDER_SYSTEMD)) { loadPacks(); pubPlan = null; broadcast(); }
        if (!changed) return resolve({ ok: true, changed: false, fragen: fr, text: text + frText });
        if (changed && UNDER_SYSTEMD) {
          systemMsg = { icon: 'update', text: 'Update installiert', sub: 'QuizAbend startet neu …' };
          broadcast();
          setTimeout(() => process.exit(0), 1500); // systemd startet den Dienst neu, Bildschirme laden automatisch neu
        }
        resolve({ ok: true, changed, restart: changed && UNDER_SYSTEMD, fragen: fr, text: text + frText });
      });
    } else if (action === 'reboot' || action === 'poweroff' || action === 'hotspottest') {
      if (!systemInfo().canPower) return resolve({ ok: false, text: 'Nur auf dem Raspberry Pi (als Dienst) möglich.' });
      if (action === 'hotspottest') {   // Merker für das Startskript: eigenes WLAN sofort für 3 Minuten
        try { fs.writeFileSync(path.join(__dirname, 'hotspot-test'), new Date().toISOString()); } catch (e) { return resolve({ ok: false, text: 'Konnte den Test nicht vorbereiten: ' + e.message }); }
        systemMsg = { icon: '📶', text: 'Test: eigenes WLAN', sub: 'Pi startet neu und öffnet für 3 Minuten das WLAN „' + ((wifiInfo() || {}).ssid || 'QuizAbend') + '“.' };
        broadcast();
        setTimeout(() => execFile('sudo', ['-n', '/usr/bin/systemctl', 'reboot'], (err, out, errOut) => {
          if (err) { systemMsg = null; broadcast(); console.error('  Neustart fehlgeschlagen:', errOut || err.message); }
        }), 1500);
        return resolve({ ok: true });
      }
      systemMsg = action === 'reboot' ? { icon: '🔄', text: 'Pi startet neu …', sub: 'Gleich geht es weiter.' }
        : { icon: '🔌', text: 'Pi fährt herunter', sub: 'Stecker noch drin lassen – das Handy sagt Bescheid, wann er raus kann.', power: 'off' };
      broadcast();
      setTimeout(() => execFile('sudo', ['-n', '/usr/bin/systemctl', action], (err, out, errOut) => {
        if (err) { systemMsg = null; broadcast(); console.error('  System-Aktion fehlgeschlagen:', errOut || err.message); }
      }), 1500);
      resolve({ ok: true });
    } else resolve({ ok: false, text: 'Unbekannte Aktion' });
  });
}

// =====================================================================
// HTTP
// =====================================================================
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (_) { resolve({}); } });
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const MIME = { '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.otf': 'font/otf' };

function serveFile(res, file) {
  const full = path.join(__dirname, 'public', file);
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Nicht gefunden'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

function serveMedia(req, res, rel) {
  let full;
  try { full = path.normalize(path.join(FRAGEN_DIR, decodeURIComponent(rel))); } catch (_) { full = ''; }
  const ext = path.extname(full).toLowerCase();
  const type = IMAGE_TYPES[ext] || VIDEO_TYPES[ext] || AUDIO_TYPES[ext];
  if (!full.startsWith(FRAGEN_DIR + path.sep) || !type) { res.writeHead(404); res.end(); return; }
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end(); return; }
    // Videos in Stücken ausliefern (Range), damit sie sofort starten und flüssig laufen
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
      let end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1, 'Cache-Control': 'max-age=3600' });
      fs.createReadStream(full, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size, 'Cache-Control': 'max-age=3600' });
      fs.createReadStream(full).pipe(res);
    }
  });
}

// Musik (Intro, letzte Pausenminute): eigene Datei sounds/<name>.* hat Vorrang vor sounds/standard/
const MUSIC = ['opener', 'pause-finale', 'quiz-intro', 'block-start', 'aufloesung', 'siegerehrung', 'rangliste', 'spezialfrage', 'risikofrage', 'countdown'];
function musicFile(name) {
  for (const dir of [SOUNDS_DIR, path.join(SOUNDS_DIR, 'standard')]) {
    for (const ext of Object.keys(AUDIO_TYPES)) {
      const f = path.join(dir, name + ext);
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
}
function serveMusic(res, name) {
  const f = MUSIC.includes(name) && musicFile(name);
  if (!f) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': AUDIO_TYPES[path.extname(f).toLowerCase()], 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}

function validAnswer(q, body) {
  if (q.kind === 'choice') {
    const choice = Number(body.choice);
    return Number.isInteger(choice) && choice >= 0 && choice < q.answers.length ? { choice } : null;
  }
  if (q.kind === 'estimate') {
    const value = Number(String(body.value).replace(',', '.'));
    return body.value !== '' && isFinite(value) && Math.abs(value) < 1e12 ? { value } : null;
  }
  if (q.kind === 'pin') {
    const pos = Array.isArray(body.pos) ? body.pos.map(Number) : [];
    if (!(pos.length === 2 && Math.abs(pos[0]) <= 90 && Math.abs(pos[1]) <= 360) || !inMapField(q.map, pos)) return null;   // nur im Spielfeld
    return { pos: [pos[0], ((pos[1] + 540) % 360) - 180] };
  }
  if (q.kind === 'land') return typeof body.region === 'string' && KARTEN[q.map].regions.has(body.region) ? { region: body.region } : null;
  if (q.kind === 'match') {
    const order = body.order, n = q.left.length;
    const ok = Array.isArray(order) && order.length === n && new Set(order).size === n && order.every(x => Number.isInteger(x) && x >= 0 && x < n);
    return ok ? { order } : null;
  }
  if (q.kind === 'tf') {
    const marks = body.marks;
    return Array.isArray(marks) && marks.length === q.statements.length && marks.every(m => typeof m === 'boolean') ? { marks } : null;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // Eigenes WLAN: Die Handys prüfen beim Verbinden, ob es Internet gibt (z. B. connectivitycheck.gstatic.com,
  // captive.apple.com). Der Pi beantwortet dort alle Namen selbst – hier leiten wir solche Anfragen auf die
  // Quiz-Seite um. Dann öffnet das Handy das Quiz von selbst, wie die Anmeldeseite eines Hotel-WLANs.
  if (captiveRedirect(req)) {
    res.writeHead(302, { Location: 'http://10.42.0.1/', 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<!doctype html><meta charset="utf-8"><title>QuizAbend</title><a href="http://10.42.0.1/">Zum QuizAbend</a>');
  }

  // Heim-WLAN mit sicherer Adresse: Handys, die über http kommen, auf https umleiten (nur Seitenaufrufe,
  // nicht der Fernseher am Pi selbst und keine API-Aufrufe)
  if (!req.socket.encrypted && req.method === 'GET' && (p === '/' || p === '/play' || p === '/play.html')) {
    const sec = httpsReady(), hostName = String(req.headers.host || '').replace(/:\d+$/, '');
    if (sec && !['localhost', '127.0.0.1', '::1'].includes(hostName)) {
      res.writeHead(302, { Location: sec.replace(/\/$/, '') + req.url, 'Cache-Control': 'no-store' });
      return res.end();
    }
  }

  if (req.method === 'GET' && (p === '/' || p === '/play')) return serveFile(res, 'play.html');
  if (req.method === 'GET' && p === '/tv') return serveFile(res, 'tv.html');
  if (req.method === 'GET' && p === '/qr.js') return serveFile(res, 'qr.js');
  if (req.method === 'GET' && p === '/icons.js') return serveFile(res, 'icons.js');
  if (req.method === 'GET' && p === '/karte.js') return serveFile(res, 'karte.js');
  if (req.method === 'GET' && p === '/anleitung.js') return serveFile(res, 'anleitung.js');
  if (req.method === 'GET' && p === '/fonts/texgyreadventor-bold.otf') return serveFile(res, 'fonts/texgyreadventor-bold.otf');   // Schrift der Lobby (TeX Gyre Adventor, GUST Font License)
  if (req.method === 'GET' && /^\/karten\/[a-z]+\.json$/.test(p) && KARTEN[p.slice(8, -5)]) return serveFile(res, 'karten/' + p.slice(8));
  if (req.method === 'GET' && p.startsWith('/media/')) return serveMedia(req, res, p.slice(7));
  if (req.method === 'GET' && p.startsWith('/sounds/')) return serveMusic(res, p.slice(8));

  if (req.method === 'GET' && p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 1500\n\n');
    const client = { res, role: url.searchParams.get('role') === 'tv' ? 'tv' : 'player', playerId: url.searchParams.get('id') || null };
    const pl = client.playerId && players.get(client.playerId);
    if (client.role === 'player' && pl) pl.connected = true;
    clients.add(client);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 15000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(client);
      if (pl && ![...clients].some(c => c.playerId === pl.id)) {
        pl.connected = false;
        // In der Lobby: wer lange weg bleibt, wird entfernt (Platz wird frei). Kurz weg (Handy im Standby,
        // App gewechselt) zählt nicht – beim Aufwecken verbindet sich das Handy mit derselben Kennung neu.
        if (state.phase === 'lobby') setTimeout(() => {
          if (state.phase === 'lobby' && players.has(pl.id) && !players.get(pl.id).connected) { players.delete(pl.id); broadcast(); }
        }, LOBBY_AWAY_MS);
        if (state.phase === 'question' && allAnswered()) return endAnswering();
      }
      broadcast();
    });
    broadcast();
    return;
  }

  if (req.method === 'POST' && p === '/api/join') {
    const body = await readBody(req);
    const existing = body.id && players.get(body.id);
    if (existing) return json(res, 200, { id: existing.id });
    const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 14);
    if (!name) return json(res, 400, { error: 'Bitte gib einen Namen ein.' });
    if ([...players.values()].some(p => p.name.toLowerCase() === name.toLowerCase()))
      return json(res, 409, { error: 'Der Name ist schon vergeben.' });
    const slot = freeSlot();
    if (slot < 0) return json(res, 409, { error: 'Das Spiel ist voll (max. 8 Spieler).' });
    const taken = new Set([...players.values()].map(p => p.avatar));
    let avatar = AVATARS.includes(body.avatar) ? body.avatar : AVATARS.find(a => !taken.has(a));
    if (taken.has(avatar)) return json(res, 409, { error: 'Dieses Emoji hat schon jemand – bitte ein anderes wählen.', avatarTaken: true });
    const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    players.set(id, { id, name, slot, color: COLORS[slot], avatar, score: 0, streak: 0, connected: false, joinedAt: Date.now() });
    broadcast();
    return json(res, 200, { id });
  }

  if (req.method === 'POST' && p === '/api/bereit') {
    const body = await readBody(req);
    const pl = players.get(body.id);
    if (!pl || state.phase !== 'lobby') return json(res, 409, { ok: false });
    pl.ready = body.ready !== false;
    broadcast();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/answer') {
    const body = await readBody(req);
    const pl = players.get(body.id);
    const q = currentQuestion();
    const answer = pl && isPlayer(pl) && mayAnswer(q, pl) && state.phase === 'question' && !state.frozen && !state.answers[pl.id] && validAnswer(q, body);
    if (!answer) return json(res, 409, { ok: false });
    state.answers[pl.id] = { ...answer, at: Date.now() };
    if (allAnswered()) endAnswering(); else broadcast();
    return json(res, 200, { ok: true });
  }

  // Risikofrage: bewusst aussetzen (zählt wie „fertig“, damit niemand auf das Ende der Zeit warten muss)
  if (req.method === 'POST' && p === '/api/aussetzen') {
    const body = await readBody(req);
    const pl = players.get(body.id), q = currentQuestion();
    if (!(pl && isPlayer(pl) && isRisk(q) && mayAnswer(q, pl) && state.phase === 'question' && !state.frozen && !state.answers[pl.id] && !state.skipped[pl.id])) return json(res, 409, { ok: false });
    state.skipped[pl.id] = true;
    if (allAnswered()) endAnswering(); else broadcast();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && (p === '/api/media' || p === '/api/video')) {
    const body = await readBody(req);
    if (body.role === 'tv' && state.phase === 'media' && !state.frozen) {
      if (body.event === 'info') console.log('  [TV-Medien]', JSON.stringify(body.info));
      else if (body.event === 'ended' || body.event === 'error') afterMedia();
      else if (body.event === 'duration' && Number(body.seconds) > 0) {
        // Sicherheitsnetz an die echte Länge anpassen (+5 s Puffer)
        const left = Math.min(MEDIA_MAX_MS, (Number(body.seconds) - (Number(body.position) || 0) + 5) * 1000);
        setPhase('media', left, afterMedia);
      }
    }
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/advance') {
    const body = await readBody(req);
    // Steuern darf der Fernseher (role=tv) oder der Gamemaster
    if (body.role !== 'tv' && !canLead(body.id)) return json(res, 403, { ok: false });
    advance();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && p === '/api/pakete') {
    if (state.phase === 'lobby') loadPacks(); // neue/geänderte Dateien sofort sehen
    broadcast();
    return json(res, 200, packList());
  }

  if (req.method === 'POST' && p === '/api/einstellungen') {
    const body = await readBody(req);
    if (!canLead(body.id) || state.phase !== 'lobby') return json(res, 403, { ok: false });
    const before = JSON.stringify(settings.blocks);
    settings = cleanSettings(body.settings || {});
    if (JSON.stringify(settings.blocks) !== before) pubPlan = null;   // andere Blöcke/Pakete -> Fragenplan neu ziehen
    if (pubPlan && pubPlan.special && !settings.special.on) pubPlan.special = null;
    saveSettings();
    broadcast();
    return json(res, 200, packList());
  }

  // Fragen-Repo: eintragen/wechseln (ersetzt die alte Kopie), aktualisieren, Schlüssel erzeugen (nur 👑)
  if (req.method === 'POST' && p === '/api/fragenrepo') {
    const body = await readBody(req);
    if (!canTech(body.id)) return json(res, 403, { ok: false });
    if (body.action === 'set' && state.phase !== 'lobby') return json(res, 409, { ok: false, text: 'Das Fragen-Repo lässt sich nur in der Lobby wechseln.' });
    const r = body.action === 'set' ? await fragenRepo.set(body.url) : body.action === 'update' ? await fragenRepo.update()
      : body.action === 'key' ? await fragenRepo.ensureKey() : { ok: false, text: 'Unbekannte Aktion' };
    if (body.action !== 'key' && (r.ok || r.removed)) { loadPacks(); pubPlan = null; broadcast(); }
    return json(res, 200, { ...r, packs: packList() });
  }

  // Verlauf zurücksetzen: danach gelten alle Fragen wieder als neu (nur 👑, nur in der Lobby)
  if (req.method === 'POST' && p === '/api/verlauf') {
    const body = await readBody(req);
    if (!canLead(body.id) || state.phase !== 'lobby') return json(res, 403, { ok: false });
    history = {};
    try { fs.writeFileSync(HISTORY_FILE, '{}'); } catch (_) {}
    pubPlan = null;
    return json(res, 200, packList());
  }

  // Frage melden („⚑ Stimmt was nicht?“): jeder Spieler, für die gerade aufgelöste Frage
  if (req.method === 'POST' && p === '/api/melden') {
    const body = await readBody(req), me = players.get(body.id);
    if (!me || !meldbar()) return json(res, 409, { ok: false });
    const q = currentQuestion();
    const ok = body.grund === null ? (meldungen.removeOne(q.uid, me.name), true) : meldungen.add(q, String(body.grund), me.name, fragenRepo.status().commit);
    if (ok && body.grund) console.log(`  ⚑ Frage gemeldet (${body.grund}) von ${me.name}: ${q.uid}`);
    broadcast();
    return json(res, ok ? 200 : 400, { ok });
  }
  // Gemeldete Fragen ansehen, herunterladen, löschen (wer das Spiel leiten darf)
  if (req.method === 'GET' && (p === '/api/meldungen' || p === '/api/meldungen.txt')) {
    if (!canLead(url.searchParams.get('id'))) return json(res, 403, { ok: false });
    if (p === '/api/meldungen') return json(res, 200, { ok: true, gruende: meldungen.GRUENDE, liste: meldungen.grouped() });
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="fragen-meldungen-${new Date().toISOString().slice(0, 10)}.txt"` });
    return res.end(meldungen.text());
  }
  if (req.method === 'POST' && p === '/api/meldungen') {
    const body = await readBody(req);
    if (!canLead(body.id)) return json(res, 403, { ok: false });
    meldungen.remove(body.uid ? String(body.uid) : null);   // eine Frage oder alle
    return json(res, 200, { ok: true, gruende: meldungen.GRUENDE, liste: meldungen.grouped() });
  }

  // Technik-Test starten (⚙️ › 🛠️ System, nur in der Lobby): packs = Liste von Paket-IDs, sonst alle
  if (req.method === 'POST' && p === '/api/techniktest') {
    const body = await readBody(req);
    if (!canTech(body.id) || state.phase !== 'lobby') return json(res, 403, { ok: false });
    const ids = Array.isArray(body.packs) ? body.packs.map(String) : null;
    const extra = ['special', 'risk'].includes(body.extra) ? body.extra : null;
    return json(res, 200, { ok: startTechTest(ids, extra) });
  }

  // Ewige Bestenliste zurücksetzen (wer das Spiel leiten darf, nur in der Lobby)
  if (req.method === 'POST' && p === '/api/bestenliste') {
    const body = await readBody(req);
    if (!canLead(body.id) || state.phase !== 'lobby') return json(res, 403, { ok: false });
    bestenliste.reset();
    console.log('  🏆 Bestenliste zurückgesetzt');
    broadcast();
    return json(res, 200, { ok: true });
  }

  // Pub-Quiz: Fragenplan bearbeiten (nur 👑, nur in der Lobby)
  if (req.method === 'POST' && p === '/api/plan') {
    const body = await readBody(req);
    if (!canLead(body.id) || state.phase !== 'lobby') return json(res, 403, { ok: false });
    loadPacks();
    return json(res, 200, planAction(body));
  }

  if (req.method === 'POST' && p === '/api/anleitung') {
    const body = await readBody(req);
    const r = anleitungAction(body);
    if (r.ok) broadcast();
    return json(res, r.status || (r.ok ? 200 : 409), r);
  }

  if (req.method === 'POST' && p === '/api/host') {
    const body = await readBody(req);
    if (body.role !== 'tv' && !canLead(body.id)) return json(res, 403, { ok: false });
    const target = players.get(body.target);
    switch (body.action) {
      case 'pause': freeze(); break;
      case 'resume': unfreeze(); break;
      case 'end': // Spiel vorzeitig beenden: direkt zur Siegerehrung mit dem aktuellen Punktestand
        if (!['lobby', 'end'].includes(state.phase)) setPhase('end');
        break;
      case 'extend': // Blockpause um 5 Minuten verlängern
        if (state.phase === 'pause') setPhase('pause', (state.phaseEnds ? Math.max(0, state.phaseEnds - Date.now()) : 0) + 5 * 60000, state.next);
        break;
      case 'kick':
        if (!target || target.id === body.id) return json(res, 400, { ok: false, error: 'Diesen Spieler kann man nicht entfernen.' });
        players.delete(target.id); delete state.answers[target.id]; kickedIds.add(target.id);
        if (state.phase === 'question' && allAnswered()) { endAnswering(); return json(res, 200, { ok: true }); }
        break;
      case 'rename': {
        const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 14);
        if (!target || !name) return json(res, 400, { ok: false, error: 'Bitte einen Namen eingeben.' });
        if ([...players.values()].some(p => p.id !== target.id && p.name.toLowerCase() === name.toLowerCase()))
          return json(res, 409, { ok: false, error: 'Der Name ist schon vergeben.' });
        target.name = name;
        break;
      }
      default: return json(res, 400, { ok: false });
    }
    broadcast();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/system') {
    const body = await readBody(req);
    if (!canTech(body.id)) return json(res, 403, { ok: false });
    return json(res, 200, await runSystem(body.action));
  }

  // Philips Hue einrichten (nur 👑)
  if (req.method === 'POST' && p === '/api/hue') {
    const body = await readBody(req);
    if (!canTech(body.id)) return json(res, 403, { ok: false });
    const a = body.action;
    let r;
    if (hotspot() && !['status', 'forget'].includes(a)) r = { ok: false, text: 'Philips Hue geht nur im Heim-WLAN – im eigenen WLAN des Pi ist die Bridge nicht erreichbar.' };
    else if (a === 'status') r = { ok: true, ...hue.status(), blocked: !!hotspot() };
    else if (a === 'discover') r = { ok: true, ips: await hue.discover() };
    else if (a === 'pair') r = await hue.pair(String(body.ip || '').trim());
    else if (a === 'targets') r = await hue.targets();
    else if (a === 'select') r = await hue.select(body.kind, String(body.target || ''));
    else if (a === 'enable') r = hue.enable(body.on);
    else if (a === 'test') r = await hue.test();
    else if (a === 'stoptest') r = hue.stopTest();
    else if (a === 'forget') r = hue.forget();
    else r = { ok: false, text: 'Unbekannte Aktion' };
    return json(res, 200, r);
  }

  // Sichere Adresse (https): Status, einrichten, prüfen, entfernen (nur 👑)
  if (req.method === 'POST' && p === '/api/https') {
    const body = await readBody(req);
    if (!canTech(body.id)) return json(res, 403, { ok: false });
    let r;
    if (body.action === 'status') r = { ok: true };
    else if (body.action === 'set') r = await zertifikat.set(body.name, body.token);
    else if (body.action === 'check') { zertifikat.tick({ force: true }).catch(() => {}); r = { ok: true, started: true }; }
    else if (body.action === 'remove') r = zertifikat.remove();
    else r = { ok: false, text: 'Unbekannte Aktion' };
    return json(res, 200, { ...r, status: { ...zertifikat.status(), active: !!httpsReady() } });
  }

  // Spotify: Einstellungen (nur 👑)
  if (req.method === 'POST' && p === '/api/spotify') {
    const body = await readBody(req);
    if (!canTech(body.id)) return json(res, 403, { ok: false });
    const a = body.action;
    let r;
    if (hotspot() && !['status', 'forget'].includes(a)) r = { ok: false, text: 'Spotify geht nur im Heim-WLAN – im eigenen WLAN des Pi gibt es kein Internet.' };
    else if (a === 'status') r = { ok: true };
    else if (a === 'client') r = spotify.setClientId(body.clientId);
    else if (a === 'devices') r = await spotify.devices();
    else if (a === 'select') r = spotify.selectDevice(body.device, body.name);
    else if (a === 'playlist') r = spotify.setPlaylist(body.link);
    else if (a === 'qvolume') r = spotify.setQuestionVolume(body.volume);
    else if (a === 'enable') r = spotify.enable(body.on);
    else if (a === 'play' || a === 'pause') r = await spotify.test(a);
    else if (a === 'forget') r = spotify.forget();
    else r = { ok: false, text: 'Unbekannte Aktion' };
    const sec = httpsReady();
    return json(res, 200, { ...r, status: { ...spotify.status(), https: sec, redirect: sec ? sec + 'spotify/callback' : null } });
  }
  // Anmelden: vom Handy aus zu Spotify, zurück kommt Spotify auf /spotify/callback (nur über die sichere Adresse)
  if (req.method === 'GET' && p === '/spotify/login') {
    const sec = httpsReady();
    if (!canTech(url.searchParams.get('id')) || !sec) return spotifyPage(res, false, sec ? 'Nur der Host kann Spotify verbinden.' : 'Erst die sichere Adresse (https) einrichten – Spotify braucht sie für die Anmeldung.', sec);
    const to = spotify.loginUrl(sec + 'spotify/callback');
    if (!to) return spotifyPage(res, false, 'Erst die Client ID eintragen.', sec);
    res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (req.method === 'GET' && p === '/spotify/callback') {
    const r = await spotify.callback(Object.fromEntries(url.searchParams));
    return spotifyPage(res, r.ok, r.ok ? `Verbunden als ${r.user || 'Spotify-Nutzer'}. Wähle jetzt in den Einstellungen dein Gerät.` : r.text, httpsReady());
  }

  // Host-PIN: anmelden, festlegen, ändern, gemerkte Handys, Zurücksetzen per Code am Fernseher, Krone übergeben
  if (req.method === 'POST' && p === '/api/pin') {
    const body = await readBody(req);
    return json(res, 200, pinAction(body));
  }

  if (req.method === 'POST' && p === '/api/leave') {
    const body = await readBody(req);
    if (players.has(body.id)) { players.delete(body.id); broadcast(); }
    return json(res, 200, { ok: true });
  }

  res.writeHead(404); res.end('Nicht gefunden');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`\n  ⚠️  Port ${PORT} ist schon belegt – läuft das Quiz schon in einem anderen Fenster?\n`);
  else console.error(err);
  process.exit(1);
});

loadPacks();
// Netzwerk ändert sich (z. B. eigenes WLAN startet nach dem Booten)? Dann TV-Lobby aktualisieren
let lastJoin = '';
setInterval(() => { const j = JSON.stringify(joinInfo()); if (j !== lastJoin) { lastJoin = j; broadcast(); } }, 10000);
// Optional zusätzlich auf einem zweiten Port lauschen (am Pi: 80 und weiterhin 3000)
const EXTRA_PORT = Number(process.env.EXTRA_PORT) || 0;
if (EXTRA_PORT && EXTRA_PORT !== PORT) http.createServer(server.listeners('request')[0]).listen(EXTRA_PORT, '0.0.0.0').on('error', () => {});
// Fragen-Repo beim Start im Hintergrund auf den neuesten Stand bringen (fehlt die Kopie, wird sie geholt)
if (fragenRepo.status().url) fragenRepo.update().then(r => { if (r.ok && r.changed) { loadPacks(); broadcast(); } if (!r.ok) console.log('  Fragen-Repo:', r.text); });

spotify.start({ hotspot: () => !!hotspot() });
// https-Server: startet, sobald es ein Zertifikat gibt; bei Erneuerung wird es ohne Neustart getauscht
zertifikat.start({
  lanIp: () => { const ip = lanIp(); return ip === '10.42.0.1' ? null : ip; },
  hotspot: () => !!hotspot(),
  onCert: c => {
    if (!c) { if (httpsServer) { httpsServer.close(); httpsServer = null; broadcast(); } return; }
    if (httpsServer) { try { httpsServer.setSecureContext({ key: c.key, cert: c.cert }); } catch (e) { console.log('  https: Zertifikat nicht übernommen:', e.message); } broadcast(); return; }
    httpsServer = require('https').createServer({ key: c.key, cert: c.cert }, server.listeners('request')[0]);
    httpsServer.on('error', e => { console.log(`  https: Port ${HTTPS_PORT} nicht nutzbar:`, e.message); httpsServer = null; });
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => { console.log(`  🔒 https läuft auf Port ${HTTPS_PORT}`); broadcast(); });
  },
});

server.listen(PORT, '0.0.0.0', () => {
  const tvUrl = `http://localhost:${PORT}/tv`;
  const s = packSummary();
  console.log('\n  🎉 QuizAbend läuft!\n');
  console.log(`  📺 Fernseher (auf diesem Gerät öffnen):  ${tvUrl}`);
  console.log(`  📱 Handys (im selben WLAN):              ${joinInfo().url}`);
  console.log(`  📚 ${s.totalPacks} Fragenpakete, ${s.blocks.length} Block/Blöcke, ${s.questions} Fragen pro Spiel\n`);
  console.log('  Beenden mit Strg+C\n');
  if (!process.env.NO_BROWSER) {
    const cmd = process.platform === 'win32' ? `start "" "${tvUrl}"` : process.platform === 'darwin' ? `open "${tvUrl}"` : `xdg-open "${tvUrl}"`;
    exec(cmd, () => {});
  }
});
