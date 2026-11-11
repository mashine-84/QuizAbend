// QuizAbend – kleiner Spielserver ohne zusätzliche Pakete.
// Start: node server.js   (danach öffnet sich die TV-Ansicht im Browser)

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execFile } = require('child_process');

const PORT = Number(process.env.PORT) || 3000;
const DEFAULT_PER_GAME = Number(process.env.FRAGEN) || 10;
const QUESTION_TIME_MS = (Number(process.env.SEKUNDEN) || 20) * 1000;
const MATCH_TIME_MS = 30000;   // Zuordnen braucht etwas länger
const INTRO_MS = 3000;         // Ankündigung mit Countdown 3-2-1
const PREVIEW_MS = 6000;       // Zuordnen: Begriffe vorab zeigen
const VOTES_MS = 3500;         // erst zeigen, wer was gewählt hat …
const REVEAL_MS = 5000;        // … dann die Lösung
const MATCH_STEP_MS = 2200;    // Zuordnen: Paar für Paar auflösen
const SCORES_MS = 6000;
const SCORES_EVERY = Number(process.env.RANGLISTE) || 5; // Rangliste nur alle X Fragen (und am Blockende)
const BLOCK_MS = 4500;         // Ankündigung eines neuen Frageblocks
const SPECIAL_MS = 3500;       // Animation "Spezialfrage"

// Schwierigkeit: Gewichte (Stufe 1/2/3) am Anfang, in der Mitte und am Ende des Spiels.
// Dazwischen wird linear übergeblendet – über alle Blöcke hinweg.
const DIFFICULTY_CURVE = [[94, 5, 1], [50, 35, 15], [15, 35, 50]];
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;

const FRAGEN_DIR = path.join(__dirname, 'fragen');
const HOTSPOT_FILE = path.join(__dirname, 'hotspot.json'); // von raspberry-pi/setup.sh angelegt: {ssid, password}
const UNDER_SYSTEMD = !!process.env.INVOCATION_ID;           // läuft als Dienst (Pi) -> Neustart nach Update automatisch
const SETTINGS_FILE = path.join(__dirname, 'einstellungen.json');
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

function normalizeQuestion(q, dir, packName, packLevel) {
  if (!q || typeof q !== 'object') throw new Error('ist kein gültiger Eintrag');
  if (!q.frage) throw new Error('das Feld "frage" fehlt');
  const level = Number(q.schwierigkeit ?? packLevel ?? 1);
  if (![1, 2, 3].includes(level)) throw new Error('"schwierigkeit" muss 1, 2 oder 3 sein');
  const base = { category: q.kategorie || packName, text: String(q.frage), level, timeMs: Number(q.zeit) > 0 ? Number(q.zeit) * 1000 : null, image: null };
  if (q.bild) {
    base.image = resolveImage(dir, String(q.bild));
    if (!base.image) throw new Error(`Bild "${q.bild}" nicht gefunden (in den Ordner "bilder" neben der Datei legen)`);
  }
  if (q.video) {
    base.video = resolveImage(dir, String(q.video), 'videos', VIDEO_TYPES);
    if (!base.video) throw new Error(`Video "${q.video}" nicht gefunden (mp4/webm in den Ordner "videos" neben der Datei legen)`);
  }
  if (q.audio) {
    base.audio = resolveImage(dir, String(q.audio), 'audio', AUDIO_TYPES);
    if (!base.audio) throw new Error(`Audio "${q.audio}" nicht gefunden (mp3/m4a/ogg/wav in den Ordner "audio" neben der Datei legen)`);
    const start = Number(q.start ?? 0), dauer = q.dauer === undefined ? null : Number(q.dauer);
    if (!(start >= 0) || (dauer !== null && !(dauer > 0))) throw new Error('"start" und "dauer" müssen Sekunden (Zahlen) sein');
    base.audioOpts = { start, dauer, reverse: !!q.rueckwaerts };
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
  if (q.schaetzen !== undefined) {
    const value = Number(String(q.schaetzen).replace(',', '.'));
    if (!isFinite(value)) throw new Error('"schaetzen" muss eine Zahl sein');
    // Jahreszahl-Fragen ("In welchem Jahr …") zählen nur bis ±2 Jahre; mit "toleranz" frei einstellbar
    const year = q.jahr !== undefined ? !!q.jahr : /\bJahr\b/i.test(String(q.frage)) && Number.isInteger(value) && !q.einheit?.match?.(/^(m|km|g|kg|s|%)$/);
    let tolerance = q.toleranz !== undefined ? Number(q.toleranz) : year ? 2 : null;
    if (tolerance !== null && !(tolerance >= 0)) throw new Error('"toleranz" muss eine Zahl ab 0 sein');
    return { ...base, kind: 'estimate', value, unit: q.einheit ? String(q.einheit) : '', year, tolerance };
  }
  if (Array.isArray(q.antworten) && q.antworten.length >= 2)
    return { ...base, kind: 'choice', answers: q.antworten.slice(0, 4).map(String) };
  throw new Error('es fehlen "antworten", "schaetzen" oder "zuordnen"');
}

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
    const questions = [];
    list.forEach((q, i) => {
      try { questions.push(normalizeQuestion(q, path.dirname(rel), name, !Array.isArray(raw) ? raw.schwierigkeit : undefined)); }
      catch (e) { errors.push({ file: rel, error: `Frage ${i + 1}: ${e.message}` }); }
    });
    const kinds = {
      choice: questions.some(q => q.kind === 'choice' && !q.image), image: questions.some(q => q.image),
      estimate: questions.some(q => q.kind === 'estimate'), match: questions.some(q => q.kind === 'match'),
    };
    const levels = [1, 2, 3].map(l => questions.filter(q => q.level === l).length);
    found.push({ id: rel.replace(/\\/g, '/').replace(/\.json$/i, ''), group, name, questions, kinds, levels });
  };
  if (fs.existsSync(FRAGEN_DIR)) {
    for (const e of fs.readdirSync(FRAGEN_DIR, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'de'))) {
      if (e.isDirectory()) {
        for (const f of fs.readdirSync(path.join(FRAGEN_DIR, e.name)).sort((a, b) => a.localeCompare(b, 'de')))
          if (f.toLowerCase().endsWith('.json')) addFile(e.name, path.join(e.name, f));
      } else if (e.name.toLowerCase().endsWith('.json')) addFile('Sonstiges', e.name);
    }
  }
  packs = found;
  packErrors = errors;
  if (errors.length) console.log('  ⚠️  Probleme in Fragendateien:\n' + errors.map(e => `     ${e.file}: ${e.error}`).join('\n'));
}

// ---------- Einstellungen: Frageblöcke (je mit eigener Paketauswahl) + Spezialfrage ----------
const MAX_BLOCKS = 6;
let settings = { blocks: [{ count: DEFAULT_PER_GAME, disabled: [] }], special: { on: false, mult: 2 }, sound: { on: true }, pause: { on: true, minutes: 10 } };
try {
  const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  if (Array.isArray(raw.blocks)) settings.blocks = raw.blocks;
  else if (raw.disabled) settings.blocks = [{ count: raw.perGame || DEFAULT_PER_GAME, disabled: raw.disabled }]; // alte Version
  if (raw.special) settings.special = raw.special;
  if (raw.sound) settings.sound = raw.sound;
  if (raw.pause) settings.pause = raw.pause;
} catch (_) {}
function saveSettings() { try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2)); } catch (_) {} }

function cleanSettings(input) {
  const blocks = (Array.isArray(input.blocks) ? input.blocks : []).slice(0, MAX_BLOCKS).map(b => ({
    count: Math.max(1, Math.min(50, Math.round(Number(b && b.count)) || DEFAULT_PER_GAME)),
    disabled: Array.isArray(b && b.disabled) ? b.disabled.filter(x => typeof x === 'string') : [],
  }));
  const sp = input.special || {}, so = input.sound || {}, pa = input.pause || {};
  return { blocks: blocks.length ? blocks : settings.blocks,
    special: { on: !!sp.on, mult: [2, 3, 4].includes(Number(sp.mult)) ? Number(sp.mult) : 2 },
    sound: { on: so.on === undefined ? true : !!so.on },
    pause: { on: pa.on === undefined ? true : !!pa.on, minutes: Math.max(0, Math.min(60, Math.round(Number(pa.minutes ?? 10)))) } };
}

const blockPacks = b => packs.filter(p => !b.disabled.includes(p.id));
const blockPool = b => blockPacks(b).flatMap(p => p.questions);

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
    special: settings.special, sound: settings.sound, pause: settings.pause, errors: packErrors.length };
}

function packList() {
  const groups = [];
  for (const p of packs) {
    let g = groups.find(x => x.name === p.group);
    if (!g) groups.push(g = { name: p.group, packs: [] });
    g.packs.push({ id: p.id, name: p.name, count: p.questions.length, kinds: p.kinds, levels: p.levels });
  }
  return { groups, errors: packErrors, settings, summary: packSummary(), system: systemInfo() };
}

// Wahrscheinlichkeit der Schwierigkeitsstufen für Frage g (0-basiert) von total
function levelWeights(g, total) {
  const t = total <= 1 ? 0 : g / (total - 1);
  const [a, b] = t <= 0.5 ? [DIFFICULTY_CURVE[0], DIFFICULTY_CURVE[1]] : [DIFFICULTY_CURVE[1], DIFFICULTY_CURVE[2]];
  const u = t <= 0.5 ? t * 2 : (t - 0.5) * 2;
  return a.map((x, i) => x + (b[i] - x) * u);
}

function pickWeighted(weights) {
  const sum = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
  return weights.length - 1;
}

// =====================================================================
// Spielzustand
// =====================================================================
const players = new Map(); // id -> {id,name,color,avatar,score,connected,joinedAt}
const clients = new Set(); // {res, role, playerId}
let state = newGameState();
let timer = null;

function newGameState() {
  return { phase: 'lobby', questions: [], idx: -1, phaseEnds: 0, phaseMs: 0, startedAt: 0, answers: {}, results: {}, step: 0 };
}

function currentQuestion() { return state.questions[state.idx]; }

function vipId() {
  // Der zuerst beigetretene, verbundene Spieler ist der Gamemaster (👑)
  const list = [...players.values()].filter(p => p.connected).sort((a, b) => a.joinedAt - b.joinedAt);
  return list[0] ? list[0].id : null;
}

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
  state.phaseMs = ms || 0;
  state.phaseEnds = ms ? Date.now() + ms : 0;
  if (ms && next) timer = setTimeout(next, ms);
  broadcast();
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
    out.right = shuffle(pairs.map(p => p[1]));
    out.solution = pairs.map(p => out.right.indexOf(p[1])); // linker Index -> rechter Index
  }
  const suffix = q.kind === 'estimate' ? ' · Schätzfrage' : q.kind === 'match' ? ' · Zuordnung' : '';
  if (q.video) { out.label = 'Seh-Test' + suffix; out.icon = '👀'; }
  else if (q.audio) { out.label = 'Soundcheck' + suffix; out.icon = '🎧'; }
  else if (q.kind === 'match') { out.label = 'Zuordnung'; out.icon = '🔗'; }
  else if (q.kind === 'estimate') { out.label = q.image ? 'Bilderrätsel · Schätzfrage' : 'Schätzfrage'; out.icon = q.image ? '🖼️' : '🔢'; }
  else if (q.image) { out.label = 'Bilderrätsel'; out.icon = '🖼️'; }
  out.timeMs = q.timeMs || (q.kind === 'match' ? MATCH_TIME_MS : QUESTION_TIME_MS);
  return out;
}

function buildGame() {
  // Fragen für alle Blöcke ziehen: Schwierigkeit nach Spielfortschritt, keine Frage doppelt
  const plan = settings.blocks.map((b, bi) => ({ bi, ...blockSummary(b), pool: blockPool(b) })).filter(b => b.plays > 0);
  const total = plan.reduce((s, b) => s + b.plays, 0);
  const used = new Set(), out = [];
  plan.forEach((b, n) => {
    for (let k = 0; k < b.plays; k++) {
      const left = b.pool.filter(q => !used.has(q));
      if (!left.length) break;
      const byLevel = [1, 2, 3].map(l => left.filter(q => q.level === l));
      const w = levelWeights(out.length, total).map((x, i) => byLevel[i].length ? x : 0);
      const list = byLevel[pickWeighted(w)];
      const q = list[Math.floor(Math.random() * list.length)];
      used.add(q);
      out.push({ ...prepareQuestion(q), block: n, blockCount: plan.length, blockNames: b.names });
    }
    // Nummer innerhalb des Blocks (für "Block 1/2 · Frage 3/8")
    const inBlock = out.filter(x => x.block === n);
    inBlock.forEach((x, i) => { x.blockQ = i + 1; x.blockLen = inBlock.length; });
  });
  return out;
}

function startGame() {
  loadPacks();
  const questions = buildGame();
  if (!questions.length) return false;
  for (const p of players.values()) { p.score = 0; p.streak = 0; }
  state = newGameState();
  state.questions = questions;
  nextQuestion();
  return true;
}

function nextQuestion() {
  state.idx++;
  if (state.idx >= state.questions.length) return setPhase('end');
  state.answers = {};
  state.results = {};
  state.step = 0;
  state.special = false;
  const q = currentQuestion(), prev = state.questions[state.idx - 1];
  if (q.blockCount > 1 && (!prev || prev.block !== q.block)) setPhase('block', BLOCK_MS, beginQuestion); // neuer Block
  else beginQuestion();
}

function beginQuestion() {
  if (currentQuestion().label) setPhase('intro', INTRO_MS, afterIntro); // neue Fragearten werden angekündigt
  else startAnswering();
}

function afterIntro() {
  const q = currentQuestion();
  if (q.video || q.audio) setPhase('media', MEDIA_MAX_MS, afterMedia); // erst Video/Audio, dann die Frage
  else afterMedia();
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
  // Spezialfrage: genau einmal pro Spiel. Chance steigt linear von 1 % (erste Frage) auf 100 % (letzte Frage)
  if (settings.special.on && !state.specialDone) {
    const k = state.idx, n = state.questions.length;
    const chance = n <= 1 ? 1 : 0.01 + 0.99 * k / (n - 1);
    if (Math.random() < chance) {
      state.special = true; state.specialDone = true;
      return setPhase('special', SPECIAL_MS, showAnswers);
    }
  }
  showAnswers();
}

function showAnswers() {
  if (currentQuestion().kind === 'match') reveal();
  else setPhase('votes', VOTES_MS, reveal);
}

function streakBonus(p, ok) {
  p.streak = ok ? (p.streak || 0) + 1 : 0;
  return ok ? Math.min(p.streak - 1, 3) * 50 : 0;
}
const round10 = x => Math.round(x / 10) * 10;

function scoreQuestion() {
  const q = currentQuestion();
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
        : q.value === 0 ? (diff === 0 ? 1 : 0) : Math.max(0, 1 - diff / Math.abs(q.value));
      const closest = best !== null && diff === best;
      const gain = round10(800 * acc) + (closest ? 200 : 0) + streakBonus(p, closest);
      p.score += gain;
      state.results[p.id] = { gain, correct: closest, exact: diff === 0, answered: true, value: a.value, outOfRange: !inRange(diff) };
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

function reveal() {
  scoreQuestion();
  if (state.special) {
    const m = settings.special.mult;
    for (const [id, r] of Object.entries(state.results)) {
      const p = players.get(id);
      if (p && r.gain) { p.score += r.gain * (m - 1); r.gain *= m; }
      r.mult = m;
    }
  }
  const q = currentQuestion();
  if (q.kind === 'match') {
    state.step = 0;
    const stepOn = () => {
      state.step++;
      if (state.step >= q.left.length) setPhase('reveal', REVEAL_MS, afterReveal);
      else setPhase('reveal', MATCH_STEP_MS, stepOn);
    };
    setPhase('reveal', 1200, stepOn);
  } else setPhase('reveal', REVEAL_MS, afterReveal);
}

function afterReveal() {
  const last = state.idx >= state.questions.length - 1;
  const next = state.questions[state.idx + 1];
  const blockEnd = next && next.block !== currentQuestion().block;
  if (last || blockEnd || (state.idx + 1) % SCORES_EVERY === 0) showScores();
  else nextQuestion();
}

function isBlockEnd() {
  const next = state.questions[state.idx + 1];
  return !!next && next.block !== currentQuestion().block;
}

function afterScores() {
  if (state.idx >= state.questions.length - 1) setPhase('end');
  else if (isBlockEnd() && settings.pause.on) startBlockPause();
  else nextQuestion();
}

function showScores() { setPhase('scores', SCORES_MS, afterScores); }

// Pause zwischen zwei Blöcken (Bier holen, Klo …). 0 Minuten = bis der Host weiter drückt
function startBlockPause() {
  const ms = settings.pause.minutes * 60000;
  setPhase('pause', ms, nextQuestion);
}

// Spiel jederzeit anhalten: Timer einfrieren und später an derselben Stelle weitermachen
function freeze() {
  if (state.frozen || ['lobby', 'end'].includes(state.phase)) return;
  const remaining = state.phaseEnds ? Math.max(0, state.phaseEnds - Date.now()) : 0;
  clearTimer();
  state.frozen = { remaining, hadTimer: !!state.phaseEnds };
  broadcast();
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
    case 'lobby': if (connectedCount() >= MIN_PLAYERS) startGame(); break;
    case 'block': beginQuestion(); break;
    case 'intro': afterIntro(); break;
    case 'media': afterMedia(); break;
    case 'preview': startAnswering(); break;
    case 'question': endAnswering(); break;
    case 'special': showAnswers(); break;
    case 'votes': reveal(); break;
    case 'reveal':
      if (q.kind === 'match' && state.step < q.left.length) { state.step = q.left.length; setPhase('reveal', REVEAL_MS, afterReveal); }
      else afterReveal();
      break;
    case 'scores': afterScores(); break;
    case 'pause': nextQuestion(); break;
    case 'end':
      for (const p of players.values()) { p.score = 0; p.streak = 0; }
      state = newGameState();
      setPhase('lobby');
      break;
  }
}

function connectedCount() { return [...players.values()].filter(p => p.connected).length; }

function allAnswered() {
  const active = [...players.values()].filter(p => p.connected);
  return active.length > 0 && active.every(p => state.answers[p.id]);
}

// =====================================================================
// Ansichten für TV und Handy
// =====================================================================
function ranking() {
  return [...players.values()]
    .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
    .map(p => ({ id: p.id, name: p.name, color: p.color, avatar: p.avatar, score: p.score, connected: p.connected,
      answered: !!state.answers[p.id], result: state.results[p.id] || null }));
}

function rankOf(id) { return ranking().findIndex(p => p.id === id) + 1; }

function baseView() {
  const q = currentQuestion();
  const ph = state.phase;
  const v = {
    phase: ph, vip: vipId(), minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
    players: ranking(), qNum: state.idx + 1, qTotal: state.questions.length,
    remainingMs: state.frozen ? state.frozen.remaining : state.phaseEnds ? Math.max(0, state.phaseEnds - Date.now()) : 0, phaseMs: state.phaseMs,
    frozen: !!state.frozen, system: systemMsg,
    version: VERSION, packs: packSummary(), avatars: AVATARS,
    block: q ? { num: q.block + 1, total: q.blockCount, names: q.blockNames, q: q.blockQ, len: q.blockLen } : null,
    nextBlock: (() => { const n = state.questions[state.idx + 1]; return n && q && n.block !== q.block ? { num: n.block + 1, total: n.blockCount, names: n.blockNames } : null; })(),
    special: state.special && ['special', 'votes', 'reveal'].includes(ph) ? { mult: settings.special.mult } : null,
  };
  if (q && ['intro', 'media', 'preview', 'question', 'special', 'votes', 'reveal'].includes(ph)) {
    const vq = v.question = { kind: q.kind, label: q.label || null, icon: q.icon || null, category: q.category }; // Schwierigkeit wird im Spiel nicht verraten
    if (ph === 'media') { vq.video = q.video || null; vq.audio = q.audio || null; vq.audioOpts = q.audioOpts || null; }
    if (ph !== 'intro' && ph !== 'media' && q.kind === 'match') vq.left = q.left;
    if (['question', 'special', 'votes', 'reveal'].includes(ph)) {
      vq.text = q.text; vq.image = q.image;
      if (q.kind === 'choice') vq.answers = q.answers;
      if (q.kind === 'match') vq.right = q.right;
      if (q.kind === 'estimate') { vq.unit = q.unit; vq.year = q.year; vq.tolerance = q.tolerance; }
    }
    if (ph === 'votes' || ph === 'reveal') {
      const byTime = Object.entries(state.answers).sort((a, b) => a[1].at - b[1].at);
      if (q.kind === 'choice') {
        vq.voters = q.answers.map((_, i) => byTime.filter(([, a]) => a.choice === i).map(([id]) => id));
        vq.counts = vq.voters.map(l => l.length);
      }
      if (q.kind === 'estimate')
        vq.guesses = byTime.map(([id, a]) => ({ id, value: a.value })).sort((a, b) => a.value - b.value);
    }
    if (ph === 'reveal') {
      if (q.kind === 'choice') vq.correct = q.correct;
      if (q.kind === 'estimate') vq.value = q.value;
      if (q.kind === 'match') { vq.solution = q.solution.slice(0, state.step); vq.step = state.step; }
    }
  }
  return v;
}

function viewFor(client, base) {
  if (client.role === 'tv') return { ...base, join: joinInfo() };
  const me = players.get(client.playerId);
  return { ...base, kicked: !me && kickedIds.has(client.playerId), me: me ? {
    id: me.id, name: me.name, color: me.color, avatar: me.avatar, score: me.score,
    rank: rankOf(me.id), isVip: vipId() === me.id,
    answer: state.answers[me.id] || null,
    result: state.results[me.id] || null,
  } : null };
}

function send(client, data) {
  try { client.res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
}

function broadcast() {
  const base = baseView();
  for (const c of clients) send(c, viewFor(c, base));
}

// ---------- Netzwerk-Infos ----------
function hotspot() {
  // Eigenes WLAN des Pi aktiv? (NetworkManager-Hotspot hat immer 10.42.0.1)
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

function joinInfo() {
  const port = PORT === 80 ? '' : `:${PORT}`;
  const host = os.hostname();
  // Feste Adresse über mDNS (z. B. quizabend.local), nur wenn der Rechner einen sinnvollen Namen hat
  const local = UNDER_SYSTEMD && host && !/^localhost$/i.test(host) && !host.includes('.') ? `http://${host.toLowerCase()}.local${port}` : null;
  return { url: `http://${lanIp()}${port}/`, local, wifi: hotspot() };
}

// =====================================================================
// System: Update holen, Pi neu starten / ausschalten (nur Host)
// =====================================================================
let systemMsg = null;      // wird allen Bildschirmen angezeigt, z. B. "Pi fährt herunter"
const kickedIds = new Set();

function systemInfo() {
  return { canUpdate: fs.existsSync(path.join(__dirname, '.git')), canPower: process.platform === 'linux' && UNDER_SYSTEMD,
    autoRestart: UNDER_SYSTEMD, hostname: os.hostname() };
}

function runSystem(action) {
  return new Promise(resolve => {
    if (action === 'update') {
      execFile('git', ['pull', '--ff-only'], { cwd: __dirname, timeout: 60000 }, (err, out, errOut) => {
        const text = (out + errOut).trim();
        if (err) return resolve({ ok: false, text: text || String(err) });
        const changed = !/already up to date|bereits aktuell/i.test(text);
        if (changed && UNDER_SYSTEMD) {
          systemMsg = { icon: '⬇️', text: 'Update installiert – QuizAbend startet neu …' };
          broadcast();
          setTimeout(() => process.exit(0), 1500); // systemd startet den Dienst neu, Bildschirme laden automatisch neu
        }
        resolve({ ok: true, changed, restart: changed && UNDER_SYSTEMD, text });
      });
    } else if (action === 'reboot' || action === 'poweroff') {
      if (!systemInfo().canPower) return resolve({ ok: false, text: 'Nur auf dem Raspberry Pi (als Dienst) möglich.' });
      systemMsg = action === 'reboot' ? { icon: '🔄', text: 'Pi startet neu …' }
        : { icon: '🔌', text: 'Pi fährt herunter. In 30 Sekunden kann der Stecker raus.' };
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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

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

function validAnswer(q, body) {
  if (q.kind === 'choice') {
    const choice = Number(body.choice);
    return Number.isInteger(choice) && choice >= 0 && choice < q.answers.length ? { choice } : null;
  }
  if (q.kind === 'estimate') {
    const value = Number(String(body.value).replace(',', '.'));
    return body.value !== '' && isFinite(value) && Math.abs(value) < 1e12 ? { value } : null;
  }
  if (q.kind === 'match') {
    const order = body.order, n = q.left.length;
    const ok = Array.isArray(order) && order.length === n && new Set(order).size === n && order.every(x => Number.isInteger(x) && x >= 0 && x < n);
    return ok ? { order } : null;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'GET' && (p === '/' || p === '/play')) return serveFile(res, 'play.html');
  if (req.method === 'GET' && p === '/tv') return serveFile(res, 'tv.html');
  if (req.method === 'GET' && p === '/qr.js') return serveFile(res, 'qr.js');
  if (req.method === 'GET' && p.startsWith('/media/')) return serveMedia(req, res, p.slice(7));

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
        // In der Lobby: wer 20 s weg bleibt, wird entfernt (Platz wird frei)
        if (state.phase === 'lobby') setTimeout(() => {
          if (state.phase === 'lobby' && players.has(pl.id) && !players.get(pl.id).connected) { players.delete(pl.id); broadcast(); }
        }, 20000);
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

  if (req.method === 'POST' && p === '/api/answer') {
    const body = await readBody(req);
    const pl = players.get(body.id);
    const q = currentQuestion();
    const answer = pl && state.phase === 'question' && !state.frozen && !state.answers[pl.id] && validAnswer(q, body);
    if (!answer) return json(res, 409, { ok: false });
    state.answers[pl.id] = { ...answer, at: Date.now() };
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
    if (body.role !== 'tv' && body.id !== vipId()) return json(res, 403, { ok: false });
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
    if (body.id !== vipId() || state.phase !== 'lobby') return json(res, 403, { ok: false });
    settings = cleanSettings(body.settings || {});
    saveSettings();
    broadcast();
    return json(res, 200, packList());
  }

  if (req.method === 'POST' && p === '/api/host') {
    const body = await readBody(req);
    if (body.role !== 'tv' && body.id !== vipId()) return json(res, 403, { ok: false });
    const target = players.get(body.target);
    switch (body.action) {
      case 'pause': freeze(); break;
      case 'resume': unfreeze(); break;
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
    if (body.id !== vipId()) return json(res, 403, { ok: false });
    return json(res, 200, await runSystem(body.action));
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
