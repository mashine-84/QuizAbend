// Anleitung „So geht QuizAbend“: Grafiken für die Folien am Fernseher (eine je Folien-ID aus anleitung.json).
// Alle Grafiken sind SVG mit viewBox 300×210 und passen sich dem Kasten an. info kommt vom Server (zeit, spezial, radius, host …).
// Neue Folie ohne eigene Grafik? Dann zeigt der Fernseher das Icon groß – eine Grafik hier ist schöner, aber nicht nötig.
const ANL_C = ['#e5484d', '#3e8ef7', '#f5b014', '#2fb36d'];
const anlPhone = (x, y, w, h, inner, glow) => `<g transform="translate(${x},${y})"><rect width="${w}" height="${h}" rx="9" fill="#221a4d" stroke="${glow || '#4a4580'}" stroke-width="2.5"/>${inner}</g>`;
const anlTiles = (w, h, pick) => ANL_C.map((c, i) => `<rect x="${6 + (i % 2) * (w / 2 - 3)}" y="${10 + Math.floor(i / 2) * (h / 2 - 8)}" width="${w / 2 - 9}" height="${h / 2 - 14}" rx="5" fill="${c}" opacity="${pick === undefined || pick === i ? 1 : .35}"/>`).join('');
const anlFinger = (x, y) => `<g transform="translate(${x},${y})"><circle r="11" fill="rgba(255,255,255,.25)"/><circle r="5" fill="#fff"/></g>`;
const anlAv = (x, y, e, c, r = 11) => `<g transform="translate(${x},${y})"><circle r="${r}" fill="${c}" stroke="#fff" stroke-width="2"/><text y="${r * .38}" font-size="${r * 1.1}" text-anchor="middle">${e}</text></g>`;
const anlPin = (x, y, c, e, s = 1) => `<g transform="translate(${x},${y}) scale(${s})"><path d="M0,0 C-6,-11 -13,-16 -13,-25 A13,13 0 1 1 13,-25 C13,-16 6,-11 0,0Z" fill="${c}" stroke="#fff" stroke-width="2"/><text y="-20" font-size="13" text-anchor="middle">${e}</text></g>`;
const anlArrow = id => `<defs><marker id="${id}" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8Z" fill="#f5b014"/></marker></defs>`;
const anlTv = inner => `<rect x="70" y="14" width="160" height="92" rx="8" fill="#2b2360" stroke="#7d77bd" stroke-width="2"/><rect x="140" y="106" width="20" height="10" fill="#7d77bd"/>${inner}`;
const anlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ANL_BILD = {
  start: i => `${anlTv(`<rect x="86" y="26" width="128" height="20" rx="4" fill="#fff"/><text x="150" y="40" font-size="10" fill="#1b1440" text-anchor="middle">Wie hoch ist …?</text>${ANL_C.map((c, k) => `<rect x="${86 + (k % 2) * 66}" y="${52 + Math.floor(k / 2) * 25}" width="62" height="21" rx="4" fill="${c}"/>`).join('')}`)}
    ${[[40, '🦊', 0], [130, '🐼', 1], [220, '🐸', 3]].map(([x, e, k]) => anlPhone(x, 140, 44, 64, anlTiles(44, 64, k)) + anlAv(x + 22, 136, e, ANL_C[k], 9) + `<path d="M${x + 22},126 L150,118" stroke="#f5b014" stroke-width="2" stroke-dasharray="4 3" marker-end="url(#anA)"/>`).join('')}
    <g transform="translate(254,40)"><circle r="20" fill="none" stroke="#f5b014" stroke-width="4"/><text y="6" font-size="15" fill="#fff" text-anchor="middle">${i.zeit}</text></g>${anlArrow('anA')}`,
  pub: i => `${anlTv(`<rect x="86" y="30" width="128" height="22" rx="4" fill="#fff"/><text x="150" y="45" font-size="10" fill="#1b1440" text-anchor="middle">Frage 7 / 20</text>${ANL_C.map((c, k) => `<rect x="${86 + (k % 2) * 66}" y="${58 + Math.floor(k / 2) * 22}" width="62" height="18" rx="4" fill="${c}"/>`).join('')}`)}
    ${anlPhone(18, 120, 70, 84, `<rect x="8" y="10" width="54" height="16" rx="4" fill="rgba(47,179,109,.3)"/><text x="35" y="22" font-size="9" fill="#8ff0b5" text-anchor="middle">Lösung: B</text><rect x="8" y="34" width="54" height="22" rx="6" fill="#f5b014"/><text x="35" y="49" font-size="9" fill="#1b1440" text-anchor="middle">Auflösen</text>`, '#f5b014')}
    <text x="53" y="112" font-size="22" text-anchor="middle">🎤</text>
    ${[[150, '🐼', 1], [222, '🐸', 3]].map(([x, e, k]) => anlPhone(x, 140, 44, 64, anlTiles(44, 64, k)) + anlAv(x + 22, 136, e, ANL_C[k], 9)).join('')}`,
  punkte: i => `<text x="14" y="26" font-size="12" fill="#b9b2e6">Zeit</text><rect x="14" y="34" width="272" height="16" rx="8" fill="url(#anG)"/>
    <defs><linearGradient id="anG"><stop offset="0" stop-color="#2fb36d"/><stop offset="1" stop-color="#e5484d"/></linearGradient></defs>
    <text x="18" y="70" font-size="13" fill="#8ff0b5">sofort: 1000</text><text x="282" y="70" font-size="13" fill="#ff8a8d" text-anchor="end">knapp: 500</text>
    ${[0, 1, 2, 3].map(k => `<g transform="translate(${30 + k * 62},92)"><rect width="50" height="50" rx="10" fill="#2fb36d"/><text x="25" y="33" font-size="22" fill="#fff" text-anchor="middle">✓</text>${k ? `<text x="25" y="66" font-size="11" fill="#f5b014" text-anchor="middle">+${k * 50}</text>` : ''}</g>`).join('')}
    <text x="150" y="182" font-size="13" fill="#f5b014" text-anchor="middle">🔥 Serie: bis +150 je Frage</text>`,
  punkte_level: () => `${[[1, 'leicht', '#2fb36d'], [2, 'mittel', '#f5b014'], [3, 'schwer', '#e5484d']].map(([n, t, c], k) => `<g transform="translate(${20 + k * 92},${118 - k * 34})">
      <rect width="76" height="${60 + k * 34}" rx="10" fill="${c}" opacity=".9"/><text x="38" y="38" font-size="28" fill="#fff" text-anchor="middle">${n}</text>
      <text x="38" y="${-8}" font-size="12" fill="#cfc9f2" text-anchor="middle">${t}</text></g>`).join('')}
    <g transform="translate(150,200)"><text y="0" font-size="12" fill="#cfc9f2" text-anchor="middle">🐢 Langsam richtig = genauso viel wie schnell</text></g>`,
  spezial: i => `${[0, 1, 2, 3, 4, 5].map(k => `<g transform="translate(${28 + (k % 3) * 88},${30 + Math.floor(k / 3) * 74})"><rect width="68" height="54" rx="9" fill="${k === 4 ? 'rgba(245,176,20,.25)' : '#2b2360'}" stroke="${k === 4 ? '#f5b014' : '#4a4580'}" stroke-width="2"/>
      <text x="34" y="35" font-size="${k === 4 ? 22 : 18}" fill="${k === 4 ? '#f5b014' : '#7d77bd'}" text-anchor="middle">${k === 4 ? '⭐' : '?'}</text></g>`).join('')}
    <text x="150" y="190" font-size="16" fill="#f5b014" text-anchor="middle">×${i.spezial || 2} Punkte</text>`,
  quiz: i => `${ANL_C.map((c, k) => `<rect x="${12 + (k % 2) * 82}" y="${28 + Math.floor(k / 2) * 50}" width="76" height="42" rx="7" fill="${c}"/>`).join('')}<text x="90" y="16" font-size="11" fill="#b9b2e6" text-anchor="middle">Fernseher</text>
    <path d="M182,80 L212,80" stroke="#f5b014" stroke-width="3" marker-end="url(#anQ)"/>${anlArrow('anQ')}
    ${anlPhone(222, 22, 66, 120, anlTiles(66, 120))}${anlFinger(270, 60)}<text x="255" y="16" font-size="11" fill="#b9b2e6" text-anchor="middle">Handy</text>
    <g transform="translate(150,178)"><circle r="18" fill="none" stroke="#f5b014" stroke-width="5"/><text y="6" font-size="15" fill="#fff" text-anchor="middle">${i.zeit}</text></g>`,
  bild: () => `<rect x="14" y="20" width="150" height="112" rx="8" fill="#2b5c8a"/><circle cx="130" cy="48" r="14" fill="#f5b014"/><path d="M14,132 L64,70 L100,108 L124,86 L164,132Z" fill="#2fb36d"/>
    <text x="236" y="40" font-size="12" fill="#fff" text-anchor="middle">Welcher Berg</text><text x="236" y="56" font-size="12" fill="#fff" text-anchor="middle">ist das?</text>
    ${ANL_C.map((c, k) => `<rect x="${180 + (k % 2) * 56}" y="${74 + Math.floor(k / 2) * 30}" width="50" height="24" rx="5" fill="${c}"/>`).join('')}
    <text x="150" y="180" font-size="26" text-anchor="middle">🔍</text>`,
  merkbild: () => `<g><rect x="14" y="30" width="120" height="96" rx="8" fill="#2b5c8a"/>${[[44, 62, '#e5484d'], [84, 90, '#f5b014'], [104, 56, '#2fb36d']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="13" fill="${c}"/>`).join('')}
    <text x="74" y="146" font-size="12" fill="#cfc9f2" text-anchor="middle">3 Sekunden</text></g>
    <path d="M144,78 L170,78" stroke="#f5b014" stroke-width="3" marker-end="url(#anM)"/>${anlArrow('anM')}
    <rect x="180" y="30" width="106" height="96" rx="8" fill="#2b2360" stroke="#4a4580" stroke-width="2"/><text x="233" y="70" font-size="13" fill="#fff" text-anchor="middle">Wie viele</text><text x="233" y="88" font-size="13" fill="#fff" text-anchor="middle">Kreise?</text>
    <text x="150" y="190" font-size="24" text-anchor="middle">🧠</text>`,
  schaetzen: i => `${anlPhone(14, 18, 74, 128, `<rect x="7" y="8" width="60" height="22" rx="4" fill="#14102b"/><text x="37" y="24" font-size="13" fill="#fff" text-anchor="middle">330 m</text>${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => `<rect x="${7 + (k % 3) * 20}" y="${36 + Math.floor(k / 3) * 22}" width="17" height="18" rx="3" fill="rgba(255,255,255,.12)"/>`).join('')}`)}
    <line x1="104" y1="150" x2="290" y2="150" stroke="#7d77bd" stroke-width="3"/>
    ${[[120, '🐸', '#2fb36d', .55], [175, '🦊', '#e5484d', 1], [262, '🐼', '#3e8ef7', .55]].map(([x, e, c, o]) => `<g opacity="${o}">${anlPin(x, 150, c, e)}</g>`).join('')}
    <line x1="196" y1="96" x2="196" y2="160" stroke="#fff" stroke-width="3"/><rect x="172" y="76" width="48" height="20" rx="6" fill="#fff"/><text x="196" y="91" font-size="12" fill="#1b1440" text-anchor="middle">330</text>
    <text x="185" y="184" font-size="12" fill="#8ff0b5" text-anchor="middle">${i.scoring === 'level' ? 'am nächsten: Punkte' : 'am nächsten: +200'}</text>`,
  pin: i => `<rect width="300" height="210" fill="#1d2c55"/><path d="M40,30 L140,20 L190,50 L230,40 L270,90 L250,160 L170,190 L90,180 L50,130 Z" fill="#3a3570" stroke="#7d77bd" stroke-width="2"/>
    <circle cx="160" cy="110" r="38" fill="rgba(245,176,20,.15)" stroke="#f5b014" stroke-width="2" stroke-dasharray="6 4"/><text x="160" y="164" font-size="11" fill="#f5b014" text-anchor="middle">im Kreis = richtig</text>
    ${anlPin(160, 110, '#f5b014', '', 1.5)}<circle cx="160" cy="72.5" r="6" fill="#fff"/>
    ${anlPin(178, 100, '#e5484d', '🦊')}${anlPin(90, 70, '#3e8ef7', '🐼')}<line x1="90" y1="70" x2="160" y2="110" stroke="#3e8ef7" stroke-width="2" stroke-dasharray="5 4"/>
    <g transform="translate(250,40)"><circle r="16" fill="rgba(255,255,255,.18)"/><text y="6" font-size="17" text-anchor="middle">🤏</text></g>`,
  land: () => `<rect width="300" height="210" fill="#1d2c55"/><path d="M30,60 L100,40 L120,90 L80,130 L30,120Z" fill="#3a3570" stroke="#7d77bd" stroke-width="2"/><path d="M100,40 L180,30 L200,80 L120,90Z" fill="#3a3570" stroke="#7d77bd" stroke-width="2"/>
    <path d="M120,90 L200,80 L230,130 L160,160 L80,130Z" fill="rgba(0,0,0,.45)" transform="translate(0,4)"/><path d="M120,90 L200,80 L230,130 L160,160 L80,130Z" fill="#e5484d" stroke="#fff" stroke-width="3" transform="translate(0,-5)"/>
    <path d="M200,80 L270,70 L280,140 L230,130Z" fill="#3a3570" stroke="#7d77bd" stroke-width="2"/>${anlFinger(160, 118)}
    <circle cx="262" cy="170" r="12" fill="rgba(245,176,20,.15)" stroke="#f5b014" stroke-dasharray="3 2"/><text x="262" y="195" font-size="10" fill="#f5b014" text-anchor="middle">kleines Land</text>
    <text x="80" y="190" font-size="12" fill="#cfc9f2" text-anchor="middle">kein Name sichtbar</text>`,
  zuordnen: () => `${['Bayern', 'Dortmund', 'Schalke'].map((t, k) => `<g transform="translate(14,${24 + k * 56})"><rect width="120" height="40" rx="8" fill="#2b2360" stroke="#7d77bd"/><circle cx="20" cy="20" r="12" fill="#f5b014"/><text x="20" y="25" font-size="13" fill="#1b1440" text-anchor="middle">${k + 1}</text><text x="40" y="25" font-size="12" fill="#fff">${t}</text></g>`).join('')}
    ${['Allianz Arena', 'Veltins-Arena', 'Signal Iduna'].map((t, k) => `<g transform="translate(168,${24 + k * 56})"><rect width="120" height="40" rx="8" fill="${k === 0 ? '#2fb36d' : 'rgba(255,255,255,.1)'}"/><text x="60" y="25" font-size="11" fill="#fff" text-anchor="middle">${t}</text></g>`).join('')}
    <path d="M136,44 L166,44" stroke="#2fb36d" stroke-width="3"/><path d="M136,100 L166,156" stroke="#7d77bd" stroke-width="2" stroke-dasharray="4 3"/><path d="M136,156 L166,100" stroke="#7d77bd" stroke-width="2" stroke-dasharray="4 3"/>`,
  rf: () => `${[['Ein Marathon hat 42,195 km', 1], ['Golf war nie olympisch', 0], ['Ein Korb hängt 3,05 m hoch', 1]].map(([t, ok], k) => `<g transform="translate(12,${18 + k * 62})"><rect width="276" height="48" rx="8" fill="#2b2360"/><text x="12" y="29" font-size="11" fill="#fff">${t}</text>
    <g transform="translate(236,24) rotate(-8)"><rect x="-34" y="-13" width="68" height="26" rx="5" fill="none" stroke="${ok ? '#2fb36d' : '#e5484d'}" stroke-width="2.5"/><text y="5" font-size="11" fill="${ok ? '#8ff0b5' : '#ff8a8d'}" text-anchor="middle">${ok ? 'RICHTIG' : 'FALSCH'}</text></g></g>`).join('')}`,
  ton: () => `${anlTv(`${Array.from({ length: 15 }, (_, k) => { const h = 8 + Math.abs(Math.sin(k * 1.7)) * 54; return `<rect x="${88 + k * 8.5}" y="${60 - h / 2}" width="5" height="${h}" rx="2.5" fill="#f5b014"/>`; }).join('')}`)}
    <text x="40" y="170" font-size="30" text-anchor="middle">🔊</text><text x="150" y="170" font-size="30" text-anchor="middle">👂</text><text x="260" y="170" font-size="30" text-anchor="middle">🤫</text>
    <text x="150" y="200" font-size="12" fill="#cfc9f2" text-anchor="middle">Erst hören – dann antworten</text>`,
  video: () => `${anlTv(`<rect x="80" y="24" width="140" height="72" rx="4" fill="#2b5c8a"/><path d="M140,44 L166,60 L140,76Z" fill="#fff"/>`)}
    <text x="150" y="170" font-size="30" text-anchor="middle">👀</text><text x="150" y="200" font-size="12" fill="#cfc9f2" text-anchor="middle">Läuft nur einmal – genau hinschauen</text>`,
  spotify: () => `${anlTv(`<circle cx="150" cy="60" r="30" fill="#1DB954"/><path d="M134,52 Q150,46 168,54 M136,62 Q150,57 164,64 M138,71 Q150,67 161,73" stroke="#14102b" stroke-width="4" fill="none" stroke-linecap="round"/>`)}
    <text x="60" y="172" font-size="28" text-anchor="middle">🎶</text><text x="150" y="172" font-size="28" text-anchor="middle">⏸️</text><text x="240" y="172" font-size="28" text-anchor="middle">▶️</text>
    <text x="150" y="200" font-size="12" fill="#cfc9f2" text-anchor="middle">Song – Frage – Musik läuft weiter</text>`,
  los: i => {
    const steps = [];
    for (let b = 1; b <= Math.min(i.bloecke, 3); b++) {
      if (b > 1 && i.pause != null) steps.push(['🍺', 'Pause', '#f5b014']);
      steps.push(['📦', i.bloecke > 1 ? 'Block ' + b : 'Fragen', '#3e8ef7'], ['📊', 'Rangliste', '#b58cff']);
    }
    steps.push(['🏆', 'Sieger', '#2fb36d']);
    const n = steps.length, gap = Math.min(64, 260 / Math.max(1, n - 1)), x0 = 150 - gap * (n - 1) / 2;
    return steps.map(([e, t, c], k) => `<g transform="translate(${x0 + k * gap},${70 + (k % 2) * 50})"><circle r="${Math.min(24, gap * .4)}" fill="${c}"/><text y="7" font-size="${Math.min(20, gap * .32)}" text-anchor="middle">${e}</text><text y="44" font-size="10.5" fill="#fff" text-anchor="middle">${t}</text></g>`
      + (k < n - 1 ? `<line x1="${x0 + k * gap + gap * .4}" y1="${70 + (k % 2) * 50}" x2="${x0 + (k + 1) * gap - gap * .4}" y2="${70 + ((k + 1) % 2) * 50}" stroke="#7d77bd" stroke-width="2"/>` : '')).join('')
      + `<text x="150" y="200" font-size="11" fill="#cfc9f2" text-anchor="middle">Handy weg? Einfach wieder öffnen – die Punkte bleiben.</text>`;
  },
};
// Grafik zu einer Folie (Varianten wie „schaetzen_level“ nutzen die Grafik der Grundfolie, wenn sie keine eigene haben)
function anlBild(id, info) {
  const f = ANL_BILD[id] || ANL_BILD[String(id).replace(/_\w+$/, '')];
  return f ? `<svg viewBox="0 0 300 210" xmlns="http://www.w3.org/2000/svg">${f(info || {})}</svg>` : '';
}
// **fett** in Folientexten (vorher escapen)
const anlText = s => anlEsc(s || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
