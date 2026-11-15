#!/usr/bin/env python3
"""Erzeugt public/icons.js aus Font Awesome Free (Icons: CC BY 4.0).

Aufruf: python3 public/icons-erzeugen.py <Ordner mit solid/ und brands/>
Der Ordner kommt z. B. aus dem npm-Paket @fortawesome/fontawesome-free (svgs/)
oder aus mkdocs-material (templates/.icons/fontawesome/).
Neue Symbole: unten in EMOJI eintragen (Emoji -> Font-Awesome-Name, Farbe) oder in EXTRA.
"""
import json, re, sys, os

# Emoji -> (Font-Awesome-Name, Farbe). Farbe None = Schriftfarbe.
# Nicht eingetragene Emojis (Spieler-Avatare, Gesichter wie 🤫 🤷 🎉) bleiben Emojis.
EMOJI = {
    '👑': ('solid/crown', '#f5b014'), '⭐': ('solid/star', '#f5b014'), '⚠️': ('solid/triangle-exclamation', '#ffcf66'),
    '⚔️': ('solid/hand-fist', '#ff6b5e'), '❓': ('solid/circle-question', '#f5b014'), '🍺': ('solid/beer-mug-empty', '#f5b014'),
    '🍻': ('solid/beer-mug-empty', '#f5b014'), '🎤': ('solid/microphone', '#ff7a9c'), '💤': ('solid/moon', '#b9b2e6'),
    '☕': ('solid/mug-hot', '#e0a878'), '⏸': ('solid/pause', None), '🔇': ('solid/volume-xmark', None), '🔊': ('solid/volume-high', None),
    '⚙️': ('solid/gear', None), '🧠': ('solid/brain', '#ff7a9c'), '⚡': ('solid/bolt', '#f5b014'), '🍀': ('solid/clover', '#3ecf6e'),
    '🚻': ('solid/restroom', '#5ab0ff'), '🍕': ('solid/pizza-slice', '#ff9f43'), '🥤': ('solid/bottle-water', '#5ab0ff'),
    '🍿': ('solid/ice-cream', '#ff7a9c'), '🥨': ('solid/cookie', '#e0a878'), '📸': ('solid/camera', '#4fd1c5'),
    '🎧': ('solid/headphones', '#1DB954'), '⏪': ('solid/backward', None), '🎵': ('solid/music', '#1DB954'),
    '📅': ('solid/calendar', '#5ab0ff'), '🔢': ('solid/bullseye', '#ff7a59'), '🎯': ('solid/bullseye', '#ff7a59'),
    '🏆': ('solid/trophy', '#f5b014'), '👀': ('solid/eye', '#b9b2e6'), '⏭': ('solid/forward', None), '⏩': ('solid/forward-fast', None),
    '📶': ('solid/wifi', '#4fd1c5'), '🔒': ('solid/lock', '#8ff0b5'), '📋': ('solid/clipboard-list', '#b9b2e6'),
    '🔁': ('solid/repeat', '#5ab0ff'), '🔗': ('solid/link', '#5ab0ff'), '💡': ('solid/lightbulb', '#ffd84d'),
    '🎲': ('solid/dice', '#f5b014'), '⚖️': ('solid/scale-balanced', '#b58cff'), '⏹': ('solid/stop', None),
    '🎬': ('solid/film', '#ff7a9c'), '🔄': ('solid/rotate', None), '🔌': ('solid/plug', None), '✅': ('solid/circle-check', '#3ecf6e'),
    '❌': ('solid/circle-xmark', '#e5484d'), '🔑': ('solid/key', '#f5b014'), '🔍': ('solid/magnifying-glass', None),
    '🖼️': ('solid/image', '#4fd1c5'), '➕': ('solid/plus', None), '🎮': ('solid/gamepad', '#ff7a9c'),
    '🛠️': ('solid/screwdriver-wrench', '#b58cff'), '📊': ('solid/chart-simple', '#5ab0ff'), '✏️': ('solid/pen', None),
    '📦': ('solid/box-open', '#e0a878'), '🧪': ('solid/flask', '#4fd1c5'), '✨': ('solid/wand-magic-sparkles', None),
    '🏅': ('solid/medal', '#f5b014'), '👥': ('solid/users', '#ff7a9c'), '⏰': ('solid/clock', '#b9b2e6'),
    '🔥': ('solid/fire', '#ff5a3c'), '📚': ('solid/book-open', '#5ab0ff'), '📺': ('solid/tv', None), '📱': ('solid/mobile-screen', None),
    '🍓': ('brands/raspberry-pi', '#e5484d'), '📍': ('solid/location-dot', '#e5484d'), '🗺️': ('solid/map', '#4fd1c5'), '🎰': ('solid/hourglass-half', '#f5b014'), '▶️': ('solid/play', None),
}
# Symbole, die nur per ic('name') im Code benutzt werden
EXTRA = {'spotify': 'brands/spotify', 'chevron-right': 'solid/chevron-right', 'chevron-left': 'solid/chevron-left'}

src = sys.argv[1] if len(sys.argv) > 1 else '/usr/local/lib/python3.13/dist-packages/material/templates/.icons/fontawesome'
def load(n):
    s = open(os.path.join(src, n + '.svg')).read()
    vb = re.search(r'viewBox="([^"]+)"', s).group(1)
    d = re.search(r'<path d="([^"]+)"', s).group(1)
    ver = re.search(r'Font Awesome Free ([\d.]+)', s)
    return vb, d, ver.group(1) if ver else '?'
svgs, ver = {}, '?'
for n in sorted({v[0] for v in EMOJI.values()} | set(EXTRA.values())):
    vb, d, ver = load(n)
    svgs[n.split('/')[1]] = [vb, d]
emoji = {k.replace('️', ''): [v[0].split('/')[1], v[1]] for k, v in EMOJI.items()}
alias = {k: v.split('/')[1] for k, v in EXTRA.items()}
out = f'''// Symbole: Font Awesome Free {ver} – https://fontawesome.com – Icons: CC BY 4.0 (https://fontawesome.com/license/free)
// ERZEUGT von public/icons-erzeugen.py – nicht von Hand ändern.
// Im Code weiter Emojis schreiben: Text-Emojis aus FA_EMOJI werden beim Anzeigen gegen diese Symbole getauscht.
// Spieler-Avatare und Gesichter (🤫 🤷 🎉) bleiben Emojis. Direkt einsetzen: ic('spotify').
const FA_SVG = {json.dumps(svgs, separators=(',', ':'))};
const FA_EMOJI = {json.dumps(emoji, ensure_ascii=False, separators=(',', ':'))};
const FA_ALIAS = {json.dumps(alias, separators=(',', ':'))};
function ic(name, color) {{
  const s = FA_SVG[FA_ALIAS[name] || name]; if (!s) return '';
  return `<svg class="fa" viewBox="${{s[0]}}" aria-hidden="true"${{color ? ` style="--fc:${{color}}"` : ''}}><path fill="currentColor" d="${{s[1]}}"/></svg>`;
}}
// Emojis in neu eingefügtem Text gegen Symbole tauschen (nur Textknoten, Attribute bleiben unberührt)
(function () {{
  const keys = Object.keys(FA_EMOJI).sort((a, b) => b.length - a.length).map(k => k.replace(/[.*+?^${{}}()|[\\]\\\\]/g, '\\\\$&'));
  const RE = new RegExp('(' + keys.join('|') + ')\\uFE0F?', 'g'), TEST = new RegExp(RE.source);
  const SKIP = {{ SCRIPT: 1, STYLE: 1, TEXTAREA: 1, OPTION: 1, TITLE: 1, INPUT: 1, svg: 1, path: 1, text: 1, g: 1 }};
  function swap(t) {{
    if (!TEST.test(t.nodeValue) || !t.parentNode || SKIP[t.parentNode.nodeName]) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = t.nodeValue.replace(/[&<>]/g, c => ({{ '&': '&amp;', '<': '&lt;', '>': '&gt;' }})[c]).replace(RE, (m, e) => ic(FA_EMOJI[e][0], FA_EMOJI[e][1]));
    t.parentNode.replaceChild(tpl.content, t);
  }}
  function walk(n) {{
    if (n.nodeType === 3) return swap(n);
    if (n.nodeType !== 1 || SKIP[n.nodeName]) return;
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT), list = [];
    while (w.nextNode()) list.push(w.currentNode);
    list.forEach(swap);
  }}
  const run = () => {{
    walk(document.body);
    new MutationObserver(ms => ms.forEach(m => m.type === 'characterData' ? swap(m.target) : m.addedNodes.forEach(walk)))
      .observe(document.body, {{ childList: true, subtree: true, characterData: true }});
  }};
  document.body ? run() : document.addEventListener('DOMContentLoaded', run);
}})();
'''
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons.js'), 'w').write(out)
print(f'icons.js: {len(svgs)} Symbole, {len(emoji)} Emojis, Font Awesome {ver}')
