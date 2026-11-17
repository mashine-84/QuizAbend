// Fragen-Mix: wählt die nächste Frage so, dass das Quiz abwechslungsreich bleibt (Beschreibung: LIESMICH.md, „Fragen-Mix“).
//   Grundton ist die normale Quizfrage (Auswahl ohne Bild/Ton) – die darf sich wiederholen.
//   Alles andere ist „Würze“: dieselbe Würze-Art nie zweimal hintereinander, und unter den Würze-Arten
//   hat jede die gleiche Chance – egal, wie viele Fragen es von ihr gibt.
'use strict';

// Art einer Frage (für die Reihenfolge). Pin und Land zählen zusammen als Karte.
function art(q) {
  if (!q) return null;
  if (q.flash) return 'merkbild';
  if (q.video) return 'sehtest';
  if (q.audio) return 'soundcheck';
  if (q.spotify) return 'spotify';
  if (q.kind === 'pin' || q.kind === 'land') return 'karte';
  if (q.kind === 'match') return 'zuordnen';
  if (q.kind === 'tf') return 'richtigfalsch';
  if (q.kind === 'estimate') return 'schaetzen';
  if (q.image) return 'bild';
  return 'quiz';
}
const MEDIEN = new Set(['bild', 'merkbild', 'soundcheck', 'spotify', 'sehtest']);   // die „Höhepunkte“

// Weiche Regeln der Reihe nach (wichtigste zuerst): Lässt sich eine nicht einhalten, fällt sie weg –
// z. B. in einem Block, der nur aus Spotify- oder Kartenfragen besteht. So bricht das Spiel nie ab.
function soft(list, ...rules) {
  let cur = list;
  for (const r of rules) { const n = cur.filter(r); if (n.length) cur = n; }
  return cur;
}

function pickWeighted(weights, rnd) {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0) return -1;
  let r = rnd() * sum;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r < 0) return i; }
  return weights.length - 1;
}

// Nächste Frage aus `left` (noch nicht verwendete Fragen des Blocks).
//   prev    – die Frage davor (auch über Block-Grenze und Pause hinweg), sonst null
//   pos/len – Position im Block (0-basiert) und Länge des Blocks
//   weights – Gewichte für ★/★★/★★★ (Schwierigkeitskurve)
//   fresher – bevorzugt nie oder lange nicht gespielte Fragen (Verlauf)
function pickNext(left, { prev = null, pos = 0, len = 1, weights = [1, 1, 1], fresher = l => l, rnd = Math.random } = {}) {
  if (!left.length) return null;
  const pa = art(prev);
  // Dramaturgie: Einstieg mit einer normalen Quizfrage, Finale mit einer Schätzfrage (die davor also keine Schätzfrage)
  const finale = len >= 3 && pos === len - 1, vorFinale = len >= 3 && pos === len - 2;
  const wunsch = q => pos === 0 ? art(q) === 'quiz' : finale ? art(q) === 'schaetzen' : !(vorFinale && art(q) === 'schaetzen');
  const cand = soft(left,
    q => !pa || pa === 'quiz' || art(q) !== pa,                     // Würze nie zweimal dieselbe Art
    wunsch,
    q => !prev || q.pack !== prev.pack,                              // nicht zweimal dasselbe Paket
    q => !(MEDIEN.has(pa) && MEDIEN.has(art(q))),                    // Höhepunkte (Bild, Ton, Spotify …) verteilen
  );

  // Schwierigkeit nach Spielfortschritt
  const byLevel = [1, 2, 3].map(l => cand.filter(q => (q.level || 1) === l));
  const li = pickWeighted(weights.map((x, i) => byLevel[i].length ? x : 0), rnd);
  let sub = li >= 0 ? byLevel[li] : cand;

  // Grundton oder Würze – im Verhältnis dessen, was im Topf liegt; unter den Würze-Arten jede gleich wahrscheinlich
  const quiz = sub.filter(q => art(q) === 'quiz');
  if (quiz.length && (quiz.length === sub.length || rnd() < quiz.length / sub.length)) sub = quiz;
  else {
    const arts = [...new Set(sub.map(art).filter(a => a !== 'quiz'))];
    const a = arts[Math.floor(rnd() * arts.length)];
    sub = sub.filter(q => art(q) === a);
  }
  const list = fresher(sub);
  return list[Math.floor(rnd() * list.length)];
}

module.exports = { art, pickNext, MEDIEN };
