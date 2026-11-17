// Syntax-Prüfung: alle .js-Dateien und die eingebetteten <script>-Blöcke in public/*.html.
// Findet Tippfehler, die sonst erst am Fernseher oder Handy auffallen (weiße Seite).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fehler = 0, anzahl = 0;

function pruefe(code, name) {
  anzahl++;
  try { new vm.Script(code, { filename: name }); }
  catch (e) { fehler++; console.log(`  ✗ ${name}: ${e.message}${e.stack ? '\n    ' + (e.stack.split('\n')[0] || '') : ''}`); }
}

function dateien(dir, endung, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || ['node_modules', 'fragen', 'sounds'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) dateien(p, endung, out); else if (e.name.endsWith(endung)) out.push(p);
  }
  return out;
}

for (const f of dateien(ROOT, '.js')) {
  // Node-Skripte: Shebang entfernen, als Funktionskörper prüfen (erlaubt return auf oberster Ebene)
  const code = fs.readFileSync(f, 'utf8').replace(/^#!.*/, '');
  pruefe('(function(){' + code + '\n})', path.relative(ROOT, f));
}
for (const f of dateien(path.join(ROOT, 'public'), '.html')) {
  const html = fs.readFileSync(f, 'utf8');
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(html))) {
    const attr = m[1] || '';
    if (/\bsrc=/.test(attr) || /type=["']?(application\/json|text\/template)/.test(attr) || !m[2].trim()) continue;
    // Zeilennummern erhalten: vorangestellte Leerzeilen bis zur Fundstelle
    const vorher = html.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length - 1;
    pruefe('\n'.repeat(vorher) + m[2], `${path.relative(ROOT, f)} (Skript ${++i})`);
  }
}
console.log(fehler ? `\n${fehler} von ${anzahl} Skripten mit Syntaxfehler.` : `${anzahl} Skripte ohne Syntaxfehler.`);
process.exit(fehler ? 1 : 0);
