# QuizAbend – Hinweise für Claude

Deutsches Party-Quiz: Der Fernseher (`public/tv.html`) zeigt das Spiel, die Handys (`public/play.html`) sind die Controller, für 2–8 Spieler. Server: `server.js` (Node.js ohne Abhängigkeiten, SSE). Philips Hue: `hue.js`. Sichere Adresse (https über DuckDNS + Let's Encrypt): `zertifikat.js`. Spotify Connect (Pause/Weiter passend zum Spiel): `spotify.js`. Ausführliche Doku zu beidem in `docs/`. Läuft auf einem **Raspberry Pi 3B im Kiosk-Modus mit 720p**. Bedienungsanleitung für Menschen: `LIESMICH.md`.

## Zusammenarbeit
- **Alles auf Deutsch**: Oberfläche, Kommentare, Commits, PR-Texte.
- **Jede Änderung als eigener PR.** Der Besitzer merged selbst. Ist ein PR noch offen, weitere Commits dorthin; ist er gemerged, neuen Branch von `origin/main` und neuen PR – nie auf einen gemergten Branch pushen.
- Vor dem Coden bei Design-Fragen erst einen Vorschlag zeigen, wenn darum gebeten wird („zeig es mir erst“).
- Der Besitzer hat **kein SSH** auf den Pi. Updates kommen über „Update holen“ am Handy (git pull + Neustart). Alles, was am Pi passieren muss, muss automatisch laufen und im Protokoll/Einstellungen sichtbar sein.

## Pi-Grenzen (wichtig für jede UI-Änderung)
- **Lite-Modus** (`html.lite`, auf dem Pi aktiv, im Browser mit `/tv?lite=1`): `html.lite *` schaltet alle Animationen und Transitions ab. Was trotzdem animiert sein soll, braucht eine Ausnahme mit höherer Spezifität und `!important` (Muster: `--an`-Variable mit `.anim`, oder Longhands mit `!important`; Verzögerungen per Inline-Style mit `!important`).
- **Nur `transform` und `opacity` animieren** (GPU). Layout-Animationen (width, grid) nur sparsam und kurz.
- **Ein AudioContext** für alles (HDMI am Pi kann nur einen Stream). Musik über `makeTrack(name)`, Einzeltöne über `shot(track, gain)`. Sich überlagernde Jingles übersteuern → vorher ausblenden.
- **Hue-Bridge**: höchstens ~1 Befehl pro Sekunde für die Gruppe (`groupSend`-Warteschlange). Mit Entertainment-Bereich läuft das Licht vom Opener bis zur Lobby als **Lichtstream** (eigener DTLS-Client `hue-dtls.js`, UDP 2100, 25 Bilder/s, `streamStimmung()` in `hue.js`; Wächter fällt bei Ausfall auf REST zurück; Test `node code-pruefung/hue-dtls.js`). `STREAM_GAMMA = 1` (Bridge korrigiert selbst), Fragelicht `FRAGE_BRI = 40`.
- OLED-Fernseher: feste, helle Elemente vermeiden, wo es geht.
- **Symbole:** Font Awesome Free über `public/icons.js` (erzeugt von `public/icons-erzeugen.py`). Im Code Emojis schreiben – eingetragene Emojis werden beim Anzeigen automatisch getauscht; fehlt eins, in `EMOJI` im Erzeuger eintragen und neu erzeugen. Direkt: `ic('spotify', '#1DB954')`. Avatare sind im Code Emojis, angezeigt als Bilder aus Noto Color Emoji (`public/avatare/<codepoint>.png`, erzeugt mit `public/avatare/erzeugen.py`; `public/avatare.js` tauscht sie auf Fernseher und Handy) – neuer Avatar → dort erzeugen.
- **Karten** (Geografie-Fragen, `kind` `pin`/`land`): `public/karte.js` (Fernseher + Handy), Daten `public/karten/*.json`, erzeugt mit `node karten/erzeugen.js` – nichts davon braucht Internet.
- **Eigenes WLAN (Hotspot) = kein Internet:** Hue, https, Spotify (und alles, was Internet oder das Heimnetz braucht) sind dort abgeschaltet; `hotspot()` im Server.

## Spielablauf (Phasen in `server.js`)
`lobby → ident (Opener) → opening (Intro) → block → [risk] → intro → [media | preview] → question → [special] → votes → reveal → … → scores → pause → ident → block … → scores → [tiebreak] → end`. Rechte: `canLead(id)` (Spiel leiten) und `canTech(id)` (Raum & Technik) in `server.js` – ohne Host-PIN der 👑 (`vipId()`), mit PIN je nach Schutz nur Angemeldete (`/api/pin`, `host.json`). Anleitung (`anleitung.json`, `/api/anleitung`) ist keine eigene Phase, sondern liegt über der Lobby (`anleitung` im Server, `S.anleitung` in den Clients). Start aus der Lobby erst, wenn alle verbundenen Spieler „bereit“ sind (`/api/bereit`, `allReady()`; wird bei jedem Spielstart zurückgesetzt). Risikofrage (`risk`, Einstellung `risk.on`): `pickRisk()` wählt beim Spielstart eine Auswahl-/Länderfrage ab ★★ (exponentiell spät), `applyRisk()` wertet ±, `/api/aussetzen`. Fragen ziehen: `buildGame()` mit `pickNext()` aus `fragenmix.js` (Würze-Art nie doppelt, Einstieg Quizfrage, Finale Schätzfrage; Verlauf (`fresher`) vor Schwierigkeit und Art; Beschreibung LIESMICH.md „Fragen-Mix“, Test `node code-pruefung/fragenmix.js`). Fragen melden: `meldungen.js` (`/api/melden` bei Auflösung/Rangliste, Liste und Textdatei `/api/meldungen[.txt]` für `canLead`, gespeichert in `meldungen.json`), Test `node code-pruefung/meldungen.js`. Antworten heißen A–D (`SHAPES`), Farben je Kachel über `.c0`–`.c3` (`--k`/`--kd`/`--kt`), Lampenfarben in `hue.js` (`ANSWER`). Pub-Quiz-Modus: Host steuert „Frage auflösen“/„Nächste Frage“ (`locked`). Fragenplan (`pubPlan`, `/api/plan`): gilt als verbraucht, sobald eine Frage daraus gespielt wurde (`seit` gegen den Verlauf), Test `node code-pruefung/fragenplan.js`. `setPhase(phase, ms, next)`, `advance()` = überspringen.

## Design-Entscheidungen (mit dem Besitzer abgestimmt – nicht ohne Rückfrage ändern)
- **Farben:** Hintergrund bleibt das dunkle Violett `#14102b`. Statt Reinweiß überall warmes Weiß `--papier`/`--ink` (`#f3ead8`), auch für Schrift, QR-Code und Anleitungsgrafiken.
- **Lobby:** Ticket mit QR links (Schrift TeX Gyre Adventor), rechts Spielerkarten (4 je Zeile) mit Live-Überschrift; freie Plätze als ➕-Kreis, der nächste gelb mit „Mitspielen“. Keine gestrichelten Linien (am Pi unsauber), keine Tabellen mit Trennstrichen. Alle 30 s für 10 s Überblendung zur Bestenliste (Überschrift auf gleicher Höhe), Timer nur bei Beitritt/Abgang/„bereit“ zurücksetzen.
- **Fragen-Screen:** kein Sound-Hinweis. Block-Ansage zeigt nur die gezogenen Hauptkategorien, einmal je Spiel gemischt (`blockKategorien()`, `state.blockKat`).
- **Kartenauflösung:** kein Zoom (ruckelt am Pi), nur Überblenden; der Ausschnitt (`q.rahmen`) enthält immer den gesuchten Ort.
- **Hue-Effekte:** nur der Puls im Sekundentakt im roten Countdown (jede Sekunde heller, endet bei `locked`/`votes`). Lauflicht, Feuerwerk, Antwortfarben und Farbwelle wurden ausprobiert und abgelehnt (zu unruhig bzw. bei wenigen Lampen nicht sichtbar); Siegerehrung, Spezial- und Risikofrage wie vor dem Stream.
- **Stechen** nur bei Gleichstand auf Platz 1, nur bei regulärem Spielende, nie im Technik-Test.

## Musik & Sounds
Selbst erzeugt mit numpy/scipy (A-Dur/a-Moll, 128 BPM, gleiche Klangbausteine), Skripte in `sounds/standard/erzeugen*.py`, MP3 per ffmpeg. Eigene Dateien `sounds/<name>.*` ersetzen die Standards (gitignored). Neue Musik in die `MUSIC`-Liste in `server.js` eintragen.

## Ewige Bestenliste
`bestenliste.js` (gespeichert in `bestenliste.json` – nie committen): `bestenlisteEintragen()` beim Wechsel nach `end` (einmal je Spiel, nicht im Technik-Test, abgebrochen erst ab der Hälfte), Spieler über den Namen (klein geschrieben). Im View `S.bestenliste` (Lobby, Siegerehrung), Zurücksetzen `/api/bestenliste` (`canLead`, Lobby). Test `node code-pruefung/bestenliste.js`.

## Fragen
Die Fragenpakete liegen in einem **eigenen Fragen-Repo** (`mashine-84/QuizAbend-Fragen`, privat), das der Pi nach `fragen/_repo/` klont (`fragenrepo.js`, Einstellung am Handy unter ⚙️ › 🛠️ System › 📚 Fragen-Quelle). Hier liegt nur der **🧪 Technik-Test** (`fragen/Technik-Test/`, je Bereich ein Paket mit einer Testfrage für jede Frageart und Kombination): nie im normalen Spiel (`techPacks`), Start über ⚙️ › 🛠️ System (`/api/techniktest`, `startTechTest()`, `state.tech`), Test `node code-pruefung/techniktest.js`. **Neue Frageart, neues Feld oder neue Kombination → dort eine Testfrage ergänzen.** Neue Fragen also im Fragen-Repo anlegen – dort stehen `FORMAT.md` (vollständige Format-Referenz), `REGELN.md` (vor dem Schreiben lesen) und `pruefen.js` (0 Fehler nötig).
- **Neue Frageart oder neues Feld:** hier umsetzen, die Tabelle in `LIESMICH.md` („Eigene Fragen und Pakete“) ergänzen und die **Anleitung** nachziehen (`anleitung.json`: Folie mit `nurWenn`, ggf. Varianten je `wertung`; Grafik in `public/anleitung.js`; Merkmal in `gameFeatures()` im Server; `node code-pruefung/anleitung.js`) – danach im Fragen-Repo `FORMAT.md`, `REGELN.md` und `pruefen.js` nachziehen (eigener PR dort). Sonst schreibt Claude dort Fragen nach veraltetem Stand.

## Testen
- Playwright mit `google-chrome`: Fernseher 1280×720 (`/tv?lite=1`), Handys 390×844.
- Server auf eigenem Port starten (`PORT=3456 node server.js`), danach beenden. Kurze Fragezeit zum Testen: `SEKUNDEN=8`.
- Zustände lassen sich am TV nachstellen: `S` setzen, `lastKey = ''; render();` (vorher `EventSource` abklemmen, sonst überschreibt der Server).
- Spiele lassen sich auch ohne Browser per API + SSE (`/api/join`, `/events?id=…`, `/api/bereit`, `/api/answer`, `/api/advance`) durchspielen – vor dem Start alle per `/api/bereit` bereit melden.
- `einstellungen.json` vor Tests sichern und danach zurückspielen; `einstellungen.json`, `verlauf.json`, `hue.json`, `https.json`, `.https/`, `spotify.json`, `host.json`, `meldungen.json`, `hotspot*` nie committen.
- Eigenes WLAN simulieren: `HOTSPOT=1`. https testen: `HOST_IP`, `DUCKDNS_URL`, `ACME_REPO` (Fake-acme.sh) und `HTTPS_PORT` setzen – Let's Encrypt ist im Test nicht erreichbar. Spotify: `SPOTIFY_ACCOUNTS`/`SPOTIFY_API` auf einen Fake-Server.
- Ehrlich berichten, was getestet wurde – was nur am Pi/Fernseher/Handy prüfbar ist, so benennen.
