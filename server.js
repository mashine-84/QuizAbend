// TV-Quiz – kleiner Spielserver ohne zusätzliche Pakete.
// Start: node server.js   (danach öffnet sich die TV-Ansicht im Browser)

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const PORT = Number(process.env.PORT) || 3000;
const QUESTIONS_PER_GAME = Number(process.env.FRAGEN) || 10;
const QUESTION_TIME_MS = (Number(process.env.SEKUNDEN) || 20) * 1000;
const REVEAL_MS = 5000;
const SCORES_MS = 6000;
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;

const COLORS = ['#ff4d6d', '#4dabf7', '#ffd43b', '#51cf66', '#cc5de8', '#ff922b', '#22d3ee', '#f783ac'];
const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🐵', '🦄', '🐧'];

// ---------- Fragen laden ----------
function loadQuestions() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fragen.json'), 'utf8'));
  return raw.filter(q => q.frage && Array.isArray(q.antworten) && q.antworten.length >= 2);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Spielzustand ----------
const players = new Map(); // id -> {id,name,color,avatar,score,connected,joinedAt}
const clients = new Set(); // {res, role, playerId}
let state = newGameState();
let timer = null;

function newGameState() {
  return { phase: 'lobby', questions: [], idx: -1, startedAt: 0, endsAt: 0, answers: {}, results: {} };
}

function currentQuestion() { return state.questions[state.idx]; }

function vipId() {
  // Der zuerst beigetretene, verbundene Spieler darf das Spiel steuern.
  const list = [...players.values()].filter(p => p.connected).sort((a, b) => a.joinedAt - b.joinedAt);
  return list[0] ? list[0].id : null;
}

function freeSlot() {
  const used = new Set([...players.values()].map(p => p.slot));
  for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
  return -1;
}

function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }

function startGame() {
  const pool = loadQuestions();
  const picked = shuffle(pool).slice(0, QUESTIONS_PER_GAME).map(q => {
    const correctText = q.antworten[0];
    const answers = shuffle(q.antworten.slice(0, 4));
    return { category: q.kategorie || 'Quiz', text: q.frage, answers, correct: answers.indexOf(correctText) };
  });
  for (const p of players.values()) { p.score = 0; p.streak = 0; }
  state = newGameState();
  state.questions = picked;
  nextQuestion();
}

function nextQuestion() {
  clearTimer();
  state.idx++;
  if (state.idx >= state.questions.length) { state.phase = 'end'; broadcast(); return; }
  state.phase = 'question';
  state.answers = {};
  state.results = {};
  state.startedAt = Date.now();
  state.endsAt = state.startedAt + QUESTION_TIME_MS;
  timer = setTimeout(reveal, QUESTION_TIME_MS);
  broadcast();
}

function reveal() {
  clearTimer();
  const q = currentQuestion();
  for (const p of players.values()) {
    const a = state.answers[p.id];
    let gain = 0;
    if (a && a.choice === q.correct) {
      const remaining = Math.max(0, state.endsAt - a.at) / QUESTION_TIME_MS;
      p.streak = (p.streak || 0) + 1;
      gain = Math.round((500 + 500 * remaining) / 10) * 10 + Math.min(p.streak - 1, 3) * 50;
    } else {
      p.streak = 0;
    }
    p.score += gain;
    state.results[p.id] = { gain, correct: !!a && a.choice === q.correct, answered: !!a, choice: a ? a.choice : null };
  }
  state.phase = 'reveal';
  timer = setTimeout(showScores, REVEAL_MS);
  broadcast();
}

function showScores() {
  clearTimer();
  state.phase = 'scores';
  const last = state.idx >= state.questions.length - 1;
  timer = setTimeout(last ? () => { state.phase = 'end'; broadcast(); } : nextQuestion, SCORES_MS);
  broadcast();
}

function advance() {
  // "Weiter"-Knopf: überspringt Wartezeiten
  if (state.phase === 'lobby') { if (connectedCount() >= MIN_PLAYERS) startGame(); }
  else if (state.phase === 'question') reveal();
  else if (state.phase === 'reveal') showScores();
  else if (state.phase === 'scores') {
    if (state.idx >= state.questions.length - 1) { clearTimer(); state.phase = 'end'; broadcast(); }
    else nextQuestion();
  } else if (state.phase === 'end') {
    clearTimer();
    for (const p of players.values()) { p.score = 0; p.streak = 0; }
    state = newGameState();
    broadcast();
  }
}

function connectedCount() { return [...players.values()].filter(p => p.connected).length; }

function allAnswered() {
  const active = [...players.values()].filter(p => p.connected);
  return active.length > 0 && active.every(p => state.answers[p.id]);
}

// ---------- Ansichten für TV und Handy ----------
function ranking() {
  return [...players.values()]
    .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
    .map(p => ({ id: p.id, name: p.name, color: p.color, avatar: p.avatar, score: p.score, connected: p.connected,
      answered: !!state.answers[p.id], result: state.results[p.id] || null }));
}

function rankOf(id) { return ranking().findIndex(p => p.id === id) + 1; }

function baseView() {
  const q = currentQuestion();
  const v = {
    phase: state.phase, vip: vipId(), minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
    players: ranking(), qNum: state.idx + 1, qTotal: state.questions.length,
    remainingMs: state.phase === 'question' ? Math.max(0, state.endsAt - Date.now()) : 0,
    durationMs: QUESTION_TIME_MS,
  };
  if (q && state.phase !== 'lobby' && state.phase !== 'end') {
    v.question = { category: q.category, text: q.text, answers: q.answers };
    if (state.phase !== 'question') {
      v.question.correct = q.correct;
      v.question.counts = q.answers.map((_, i) => Object.values(state.answers).filter(a => a.choice === i).length);
    }
  }
  return v;
}

function viewFor(client, base) {
  if (client.role === 'tv') return { ...base, join: joinInfo() };
  const me = players.get(client.playerId);
  return { ...base, me: me ? {
    id: me.id, name: me.name, color: me.color, avatar: me.avatar, score: me.score,
    rank: rankOf(me.id), isVip: vipId() === me.id,
    myAnswer: state.answers[me.id] ? state.answers[me.id].choice : null,
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
function lanIp() {
  if (process.env.HOST_IP) return process.env.HOST_IP;
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

function joinInfo() { return { url: `http://${lanIp()}:${PORT}/` }; }

// ---------- HTTP ----------
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'GET' && (p === '/' || p === '/play')) return serveFile(res, 'play.html');
  if (req.method === 'GET' && p === '/tv') return serveFile(res, 'tv.html');
  if (req.method === 'GET' && p === '/qr.js') return serveFile(res, 'qr.js');

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
        if (state.phase === 'question' && allAnswered()) reveal();
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
    const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    players.set(id, { id, name, slot, color: COLORS[slot], avatar: AVATARS[slot], score: 0, streak: 0, connected: false, joinedAt: Date.now() });
    broadcast();
    return json(res, 200, { id });
  }

  if (req.method === 'POST' && p === '/api/answer') {
    const body = await readBody(req);
    const pl = players.get(body.id);
    const choice = Number(body.choice);
    if (!pl || state.phase !== 'question' || state.answers[pl.id] || !(choice >= 0 && choice < currentQuestion().answers.length))
      return json(res, 409, { ok: false });
    state.answers[pl.id] = { choice, at: Date.now() };
    if (allAnswered()) reveal(); else broadcast();
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && p === '/api/advance') {
    const body = await readBody(req);
    // Steuern darf der Fernseher (role=tv) oder der VIP-Spieler
    if (body.role !== 'tv' && body.id !== vipId()) return json(res, 403, { ok: false });
    advance();
    return json(res, 200, { ok: true });
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

server.listen(PORT, '0.0.0.0', () => {
  const tvUrl = `http://localhost:${PORT}/tv`;
  console.log('\n  🎉 TV-Quiz läuft!\n');
  console.log(`  📺 Fernseher (auf diesem Laptop öffnen):  ${tvUrl}`);
  console.log(`  📱 Handys (im selben WLAN):               ${joinInfo().url}\n`);
  console.log('  Beenden mit Strg+C\n');
  if (!process.env.NO_BROWSER) {
    const cmd = process.platform === 'win32' ? `start "" "${tvUrl}"` : process.platform === 'darwin' ? `open "${tvUrl}"` : `xdg-open "${tvUrl}"`;
    exec(cmd, () => {});
  }
});
