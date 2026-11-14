# QuizAbend – Hinweise für Claude

Deutsches Party-Quiz: Der Fernseher (`public/tv.html`) zeigt das Spiel, die Handys (`public/play.html`) sind die Controller, für 2–8 Spieler. Server: `server.js` (Node.js ohne Abhängigkeiten, SSE). Philips Hue: `hue.js`. Läuft auf einem **Raspberry Pi 3B im Kiosk-Modus mit 720p**. Bedienungsanleitung für Menschen: `LIESMICH.md`.

## Zusammenarbeit
- **Alles auf Deutsch**: Oberfläche, Kommentare, Commits, PR-Texte.
- **Jede Änderung als eigener PR.** Der Besitzer merged selbst. Ist ein PR noch offen, weitere Commits dorthin; ist er gemerged, neuen Branch von `origin/main` und neuen PR – nie auf einen gemergten Branch pushen.
- Vor dem Coden bei Design-Fragen erst einen Vorschlag zeigen, wenn darum gebeten wird („zeig es mir erst“).
- Der Besitzer hat **kein SSH** auf den Pi. Updates kommen über „Update holen“ am Handy (git pull + Neustart). Alles, was am Pi passieren muss, muss automatisch laufen und im Protokoll/Einstellungen sichtbar sein.

## Pi-Grenzen (wichtig für jede UI-Änderung)
- **Lite-Modus** (`html.lite`, auf dem Pi aktiv, im Browser mit `/tv?lite=1`): `html.lite *` schaltet alle Animationen und Transitions ab. Was trotzdem animiert sein soll, braucht eine Ausnahme mit höherer Spezifität und `!important` (Muster: `--an`-Variable mit `.anim`, oder Longhands mit `!important`; Verzögerungen per Inline-Style mit `!important`).
- **Nur `transform` und `opacity` animieren** (GPU). Layout-Animationen (width, grid) nur sparsam und kurz.
- **Ein AudioContext** für alles (HDMI am Pi kann nur einen Stream). Musik über `makeTrack(name)`, Einzeltöne über `shot(track, gain)`. Sich überlagernde Jingles übersteuern → vorher ausblenden.
- **Hue-Bridge**: höchstens ~1 Befehl pro Sekunde für die Gruppe (`groupSend`-Warteschlange).
- OLED-Fernseher: feste, helle Elemente vermeiden, wo es geht.

## Spielablauf (Phasen in `server.js`)
`lobby → ident (Opener) → opening (Intro) → block → intro → [media | preview] → question → [special] → votes → reveal → … → scores → pause → ident → block … → scores → [tiebreak] → end`. Pub-Quiz-Modus: Host steuert „Frage auflösen“/„Nächste Frage“ (`locked`). `setPhase(phase, ms, next)`, `advance()` = überspringen.

## Musik & Sounds
Selbst erzeugt mit numpy/scipy (A-Dur/a-Moll, 128 BPM, gleiche Klangbausteine), Skripte in `sounds/standard/erzeugen*.py`, MP3 per ffmpeg. Eigene Dateien `sounds/<name>.*` ersetzen die Standards (gitignored). Neue Musik in die `MUSIC`-Liste in `server.js` eintragen.

## Fragen
Die Fragenpakete liegen in einem **eigenen Fragen-Repo** (`mashine-84/QuizAbend-Fragen`, privat), das der Pi nach `fragen/_repo/` klont (`fragenrepo.js`, Einstellung am Handy unter ⚙️ › 📚 Fragen). Hier liegen nur die Testpakete Soundcheck/Seh-Test. Neue Fragen also im Fragen-Repo anlegen – dort stehen `REGELN.md` (vor dem Schreiben lesen) und `pruefen.js` (0 Fehler nötig). Format: `LIESMICH.md`.

## Testen
- Playwright mit `google-chrome`: Fernseher 1280×720 (`/tv?lite=1`), Handys 390×844.
- Server auf eigenem Port starten (`PORT=3456 node server.js`), danach beenden. Kurze Fragezeit zum Testen: `SEKUNDEN=8`.
- Zustände lassen sich am TV nachstellen: `S` setzen, `lastKey = ''; render();` (vorher `EventSource` abklemmen, sonst überschreibt der Server).
- Spiele lassen sich auch ohne Browser per API + SSE (`/api/join`, `/events?id=…`, `/api/answer`, `/api/advance`) durchspielen.
- `einstellungen.json` vor Tests sichern und danach zurückspielen; `einstellungen.json`, `verlauf.json`, `hue.json`, `hotspot*` nie committen.
- Ehrlich berichten, was getestet wurde – was nur am Pi/Fernseher/Handy prüfbar ist, so benennen.
