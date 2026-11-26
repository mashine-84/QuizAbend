// Spieler-Avatare überall im gleichen Stil: Avatar-Emojis in Textknoten werden gegen Bilder getauscht
// (public/avatare/<codepoint>.png, erzeugt von public/avatare/erzeugen.py aus Noto Color Emoji, SIL OFL 1.1).
// Sonst zeichnet jedes Gerät Emojis in seinem eigenen Stil (Samsung, Apple, Google …) – auf dem Handy sähe
// der Panda anders aus als auf dem Fernseher. Attribute und SVG-Text bleiben unberührt.
(function () {
  const AV = ['🦊', '🐼', '🐸', '🦁', '🐙', '🐵', '🦄', '🐧', '🐶', '🐱', '🐯', '🐨', '🐷', '🐮', '🐰', '🐻', '🐲', '🦉', '🐝', '🦖', '🐢', '🦀', '🐳', '🦩'];
  const RE = new RegExp('(' + AV.join('|') + ')️?', 'gu'), TEST = new RegExp(RE.source, 'u');
  const SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, OPTION: 1, TITLE: 1, INPUT: 1, svg: 1, text: 1, tspan: 1, g: 1 };
  const st = document.createElement('style');
  st.textContent = '.avimg { width: 1.15em; height: 1.15em; vertical-align: -0.2em; display: inline-block; object-fit: contain; pointer-events: none; }';
  document.head.appendChild(st);
  window.avatarBild = e => `<img class="avimg" src="/avatare/${e.codePointAt(0).toString(16)}.png" alt="${e}" draggable="false">`;
  function swap(t) {
    if (!TEST.test(t.nodeValue) || !t.parentNode || SKIP[t.parentNode.nodeName]) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = t.nodeValue.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]).replace(RE, (m, e) => avatarBild(e));
    t.parentNode.replaceChild(tpl.content, t);
  }
  function walk(n) {
    if (n.nodeType === 3) return swap(n);
    if (n.nodeType !== 1 || SKIP[n.nodeName]) return;
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT), list = [];
    while (w.nextNode()) list.push(w.currentNode);
    list.forEach(swap);
  }
  const run = () => {
    walk(document.body);
    new MutationObserver(ms => ms.forEach(m => m.type === 'characterData' ? swap(m.target) : m.addedNodes.forEach(walk)))
      .observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  document.body ? run() : document.addEventListener('DOMContentLoaded', run);
})();
