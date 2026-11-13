# QuizAbend – Quiz am Fernseher, Antworten per Handy

2 bis 8 Spieler · der Fernseher zeigt Fragen, Timer und Punkte · jedes Handy ist ein Controller (keine App nötig).

## Einmalig: Node.js installieren
Lade Node.js (LTS-Version) von https://nodejs.org herunter und installiere es.

## Spielen
1. Ordner entpacken.
2. Starten:
   - **Windows:** Doppelklick auf `start-windows.bat`
     (Fragt die Windows-Firewall nach, bei „Private Netzwerke“ **Zugriff zulassen**.)
   - **Mac:** Rechtsklick auf `start-mac.command` → Öffnen
   - Oder im Terminal im Ordner: `node server.js`
3. Der Browser öffnet die TV-Ansicht. Laptop per HDMI an den Fernseher, **F** drücken für Vollbild.
4. Alle scannen den QR-Code mit dem Handy (selbes WLAN wie der Laptop!), geben ihren Namen ein und wählen ein Emoji. Namen und Emojis gibt es nur einmal.
5. Wer zuerst beigetreten ist (👑), startet das Spiel am Handy, oder du drückst die **Leertaste** am Laptop.

**Steuerung am Laptop:** Leertaste/Enter = weiter (überspringt Wartezeiten) · F = Vollbild

## Raspberry Pi (z. B. Pi 3 Model B) als feste Quiz-Box
Der Pi hängt per HDMI am Fernseher. Nach dem Einschalten startet das Quiz von selbst im Vollbild, einen Laptop brauchst du dann nicht mehr.

Du brauchst **Raspberry Pi OS mit Desktop** (nicht „Lite“), und der Pi muss im WLAN oder per Kabel im Netz sein. Dann im Terminal des Pi:
```bash
git clone https://github.com/mashine-84/QuizAbend
cd QuizAbend
./raspberry-pi/setup.sh
sudo reboot
```
Das Skript installiert Node.js und Chromium, richtet den Server als Dienst ein, öffnet nach dem Login die TV-Ansicht im Vollbild und schaltet den Bildschirmschoner ab.

**Ohne Desktop (empfohlen für Pi 3):** Statt dem Setup oben `./raspberry-pi/setup.sh --ohne-desktop` ausführen. Der Pi startet dann keinen Desktop mehr, sondern bootet direkt ins Quiz. Das spart Leistung und ist zuverlässiger. Änderungen machst du dann per SSH vom Laptop aus (`ssh <benutzer>@<hostname>.local`). Zurück zum Desktop: `./raspberry-pi/setup.sh` ohne Option ausführen und neu starten.

**Noch flüssiger (Pi 3):** `./raspberry-pi/setup.sh --ohne-desktop --720p` steuert den Fernseher mit 1280×720 an. Der Pi muss dann nur noch etwa halb so viele Bildpunkte berechnen, die Ansicht skaliert automatisch mit. Zurück zu voller Auflösung: Setup ohne `--720p` erneut ausführen.

**Startet es nicht?** `./raspberry-pi/check.sh` ausführen, die Ausgabe zeigt, wo es hängt.

- **Grafik:** Auf dem Pi läuft die TV-Ansicht im schonenden Modus (ohne Konfetti und Animationen), damit nichts ruckelt. Auf einem Pi 4/5 kannst du in `raspberry-pi/kiosk.sh` `LITE=0` setzen.
- **Steuern ohne Tastatur:** Der 👑-Spieler startet und überspringt alles am Handy.
- **Feste Adresse:** Das Setup nennt den Pi `quizabend`. Die Handys erreichen das Quiz dann auch über **http://quizabend.local**. Der QR-Code nutzt weiterhin die IP, das klappt auf jedem Handy. Mit `--name NAME` wählst du einen anderen Namen.
- **Eigenes WLAN für unterwegs:** Findet der Pi beim Start kein bekanntes WLAN, macht er nach etwa 45 Sekunden ein eigenes WLAN „QuizAbend“ auf. Name und Passwort stehen mit WLAN-QR-Code auf dem Fernseher. Zu Hause verbindet er sich wie gewohnt mit deinem WLAN, dort funktionieren dann auch Updates. Mit Netzwerkkabel geht beides gleichzeitig. Abschalten mit `--ohne-hotspot`.
  - **Prüfen ohne SSH:** Am Handy des 👑 unter ⚙️ Einstellungen › Systemeinstellungen › **📶 Eigenes WLAN** steht, ob es eingerichtet ist, WLAN-Name und Passwort, was beim letzten Start passiert ist und das Protokoll.
  - **🧪 Eigenes WLAN testen:** Der Pi startet neu und öffnet 3 Minuten lang sein eigenes WLAN, auch wenn dein WLAN da ist. Handy damit verbinden, `http://quizabend.local` oder `http://10.42.0.1` öffnen. Danach verbindet er sich wieder mit deinem WLAN, das Ergebnis steht in den Systemeinstellungen.
  - Das eigene WLAN läuft über `hostapd` (sauberes WPA2, funktioniert mit dem WLAN-Chip des Pi 3). Fehlt `hostapd`, installiert der Pi es beim nächsten Start zu Hause selbst (steht im Protokoll). Bis dahin dient der Hotspot des NetworkManagers als Notlösung. Verbundene Handys stehen ebenfalls im Protokoll. Nach jedem WLAN-Wechsel startet der Pi avahi neu, damit `quizabend.local` erreichbar bleibt (avahi weicht sonst gern auf `quizabend-2.local` aus).
  - Das Startskript legt die Hotspot-Verbindung selbst an, falls sie fehlt. Nur der Startdienst selbst braucht einmalig `setup.sh` (steht sonst als Hinweis am Handy).
- **Update, Neustart, Ausschalten:** Unter ⚙️ Einstellungen am Handy des 👑-Spielers. Bitte den Pi so ausschalten statt einfach den Stecker zu ziehen, das schont die SD-Karte.
- **Fragen ändern:** Dateien im Ordner `fragen/` bearbeiten oder neue dazulegen. Ein Neustart ist nicht nötig, neue Pakete erscheinen beim nächsten Öffnen der Paketauswahl.
- **Updates holen:** `cd QuizAbend && git pull && sudo systemctl restart quizabend`
- **Autostart abschalten:** `sudo systemctl disable quizabend` und `rm ~/.config/autostart/quizabend-kiosk.desktop`

## Ablauf und Punkte
- **🎬 Intro beim Spielstart (22 Sekunden, mit Musik):** Der Fernseher zeigt, was die Runde bringt: Anzahl Blöcke und Fragen, die Kategorien (gemischt, die Reihenfolge wird nicht verraten), die Fragearten, ob es eine Spezialfrage gibt und wer mitspielt. Der 👑-Spieler kann das Intro am Handy überspringen.
- Ein Spiel besteht aus einem oder mehreren **Frageblöcken**, jeder mit eigener Paketauswahl und Fragenanzahl.
- **Schwierigkeit:** Am Anfang kommen fast nur leichte Fragen, schwere werden mit jeder Frage wahrscheinlicher, über alle Blöcke hinweg:

  | Spielfortschritt | ★ leicht | ★★ mittel | ★★★ schwer |
  |---|---|---|---|
  | erste Frage | 94 % | 5 % | 1 % |
  | Mitte | 50 % | 35 % | 15 % |
  | letzte Frage | 15 % | 35 % | 50 % |

  Dazwischen wird gleichmäßig übergeblendet. Fehlt in einem Block eine Stufe, verteilen sich ihre Prozente auf die anderen Stufen.
- **⭐ Spezialfrage** (an- und abschaltbar): Genau einmal pro Spiel zählt eine zufällige Frage doppelt, dreifach oder vierfach. Verraten wird das erst nach dem Antworten. Die Chance liegt bei der ersten Frage bei 1 % und steigt dann gleichmäßig bis 100 % bei der letzten Frage.
- **Auswahlfrage:** Richtig = 500 bis 1000 Punkte, je schneller, desto mehr.
- **Bilderrätsel und Schätzfragen** werden mit einem Countdown angekündigt. Erst danach erscheinen Bild und Frage.
- **Schätzfrage:** Je näher dran, desto mehr Punkte (bis 800). Wer am nächsten dran ist, bekommt +200 dazu.
- **Jahreszahlen** („In welchem Jahr …“): Punkte gibt es nur bei höchstens ±2 Jahren Abweichung. Exakt bringt 800, ±1 Jahr 530 und ±2 Jahre 270 Punkte, dazu +200 für den Nächsten. Wer weiter danebenliegt, bekommt 0 Punkte.
- **Zuordnung:** Erst erscheinen nur die Begriffe, dann die Frage. Am Handy ordnest du die Partner den Zahlen zu. Aufgelöst wird Paar für Paar, Punkte gibt es pro richtigem Paar.
- **⚖️ Richtig oder falsch:** Mehrere Behauptungen (meist 3). Am Handy tippst du bei jeder auf *Richtig* oder *Falsch* und schickst ab. Auf dem Fernseher wird Aussage für Aussage aufgedeckt, danach erscheinen die Avatare derer, die richtig lagen. Punkte gibt es pro richtig eingeschätzter Aussage. Beispiele: Paket „Richtig oder falsch“ in `fragen/Allgemein`.
- Wer mehrere Fragen in Folge richtig hat, bekommt bis zu +150 Serienbonus.
- Ist die Zeit um, zeigt der Fernseher erst, wer was gewählt hat. Danach kommt die Auflösung.
- **Punkte bleiben bis zum Blockende geheim.** Bei der Auflösung sieht man nur richtig (✓), knapp daneben (≈) oder falsch (✗), am Handy steht „Punkte und Platz gibt's am Ende des Blocks“.
- **Rangliste am Ende jedes Blocks:** Alle stehen erst in der Reihenfolge, in der sie beigetreten sind (wie in der Lobby). Alle Balken wachsen gleich schnell von links nach rechts, die Punkte zählen mit. Wer weniger Punkte hat, bleibt früher stehen; der längste Balken braucht 8 Sekunden. Erst wenn alle Balken fertig sind, schieben sich die Spieler animiert auf ihre Plätze. Die Handys zeigen den eigenen Platz erst danach.
- **🍺 Pause nach jedem Block** (abschaltbar): Pausen-Bildschirm mit Countdown, standardmäßig 10 Minuten. Der 👑-Spieler kann die Pause beenden oder um 5 Minuten verlängern. Bei „∞“ läuft sie, bis er weiter drückt. In der **letzten Minute** läuft auf dem Fernseher Spannungsmusik, die genau mit dem Ende der Pause aufhört (siehe „Eigene Pausenmusik“).
- **🔊 Sounds** (abschaltbar): Ticken in den letzten 5 Sekunden, Gong bei der Auflösung, Fanfare bei der Siegerehrung. Am Laptop braucht der Browser für Ton einmal einen Klick auf den Fernseher-Bildschirm.
- Handy-Akku leer oder Seite neu geladen? Einfach wieder öffnen, der Spielstand bleibt erhalten.

## Host-Steuerung während des Spiels (👑)
Oben rechts am Handy des 👑-Spielers öffnet **🎛️** das Host-Menü:
- **Spiel anhalten / fortsetzen:** Timer, Video und Ton stoppen, alle Bildschirme zeigen „Spiel angehalten“.
- **Weiter / überspringen**
- **Spieler umbenennen (✏️) oder entfernen (✖)**

## Einstellungen am Handy (👑)
Der 👑-Spieler tippt in der Lobby auf **⚙️ Einstellungen**. Über das Menü (☰ oben links) wechselt er zwischen drei Bereichen, geöffnet wird immer **Spieleinstellungen**:

**Spieleinstellungen**
- **Anzahl Blöcke** (1 bis 6). Antippen eines Blocks öffnet seine Einstellungen: wie viele Fragen er hat und welche Pakete er nutzt. Pakete lassen sich einzeln oder als ganze Hauptkategorie an- und abhaken. Neben jedem Paket steht, wie viele leichte, mittlere und schwere Fragen es enthält.
- **🏅 Punkte:** *Schnelligkeit* (Standard): bis zu 1000 Punkte je Frage, schnellere richtige Antworten bringen mehr, dazu Serienbonus; Schätz- und Zuordnungsfragen geben Teilpunkte. *Schwierigkeit*: eine richtige Antwort bringt so viele Punkte wie die Schwierigkeit der Frage (1–3), Tempo zählt nicht. Ausnahmen: Bei Zuordnungsfragen gibt jedes richtige Paar 1 Punkt (3 von 4 richtig = 3 Punkte), bei „Richtig oder falsch“ jede richtig eingeschätzte Aussage 1 Punkt, bei Schätzfragen bekommt, wer am nächsten dran ist, die Punkte der Schwierigkeit (bei Jahreszahlen nur innerhalb von ±2 Jahren). Die Spezialfrage vervielfacht in beiden Fällen.
- **🥇 Plätze bei Gleichstand:** Wer gleich viele Punkte hat, steht auf demselben Platz, der nächste Platz wird übersprungen (zweimal Platz 1, dann Platz 3).
- **⚔️ Stechen:** Sind am Spielende mehrere punktgleich auf Platz 1, gibt es vor der Siegerehrung eine Extra-Schätzfrage. Nur die Punktgleichen dürfen antworten, die anderen schauen zu. Die Frage kommt aus allen Schätzfragen und ist möglichst eine der schwersten, die in diesem Spiel noch nicht dran war. Wer am nächsten dran ist, bekommt 1 Punkt und gewinnt. Sind mehrere gleich nah dran, gewinnt, wer schneller geantwortet hat. Hat niemand geantwortet, wird mit einer neuen Frage erneut gestochen. Erst danach kommen Rangliste und Siegerehrung – auf dem Podest gibt es also immer nur einen Ersten. (Sind keine Schätzfragen mehr übrig, entscheidet das Los.)
- **Spezialfrage:** an/aus und der Multiplikator ×2, ×3 oder ×4.
- **Pause nach jedem Block** an/aus mit Dauer.

- **🍻 Pub-Quiz-Modus:** Der 👑-Spieler spielt nicht mit, sondern ist Gamemaster und moderiert (siehe unten).

**Integrationen**
- **Philips Hue** (siehe unten).

**Systemeinstellungen**
- **Sound:** Musik und Sounds am Fernseher an/aus.
- **System:** Update holen, Pi neu starten, Pi ausschalten.

- Fehler in Fragendateien, zum Beispiel ein fehlendes Komma, erscheinen dort mit Dateiname und Zeile.

Die Einstellungen bleiben gespeichert (`einstellungen.json`).

## Eigene Fragen und Pakete
Jede Datei ist ein **Paket**, jeder Ordner darüber eine **Hauptkategorie**:
```
fragen/
  Allgemein/
    Grundwissen.json
    Bilderraetsel.json
    bilder/            ← Bilder für die Fragen
      fische.webp
  Sport/               ← neuer Ordner = neue Hauptkategorie
    Fussball.json
```
Eine Paketdatei sieht so aus, und die Frageart ergibt sich aus den Feldern:
```json
{
  "paket": "Fußball",
  "fragen": [
    {"frage": "Wie viele Spieler hat ein Team auf dem Feld?", "antworten": ["11", "10", "12", "9"], "schwierigkeit": 1},

    {"bild": "trikot.jpg", "frage": "Welcher Verein trägt dieses Trikot?", "antworten": ["Schalke", "Dortmund", "Bayern", "Köln"]},

    {"bild": "stadion.jpg", "frage": "Wie viele Zuschauer passen in dieses Stadion?", "schaetzen": 81365},
    {"frage": "Wie lang ist ein Fußballfeld höchstens?", "schaetzen": 120, "einheit": "m"},

    {"frage": "Welcher Verein spielt in welchem Stadion?",
     "zuordnen": {"Bayern München": "Allianz Arena", "Borussia Dortmund": "Signal Iduna Park", "Schalke 04": "Veltins-Arena", "1. FC Köln": "RheinEnergieStadion"}},

    {"frage": "Welche Behauptungen sind richtig, welche falsch?",
     "behauptungen": [["Ein Marathon ist 42,195 km lang.", true], ["Golf war noch nie olympisch.", false], ["Ein Basketballkorb hängt 3,05 m hoch.", true]]}
  ]
}
```
| Frageart | So schreibst du sie |
|---|---|
| Auswahl | `"antworten": [...]` mit 2 bis 4 Antworten. **Die erste ist immer die richtige**, im Spiel wird gemischt. |
| Bilderrätsel | zusätzlich `"bild": "datei.jpg"`. Das Bild in den Ordner `bilder` neben der Datei legen (jpg, png, webp, gif oder svg). |
| Schätzfrage | `"schaetzen": 330` statt Antworten, optional mit `"einheit": "m"`. Geht mit oder ohne Bild. Fragen mit „Jahr“ im Text werden automatisch als Jahreszahl erkannt (±2 Jahre). Mit `"toleranz": 5` stellst du die erlaubte Abweichung selbst ein, auch bei normalen Schätzfragen. `"jahr": false` schaltet die Erkennung ab. |
| 👀 Seh-Test | zusätzlich `"video": "clip.mp4"`. Das Video in den Ordner `videos` neben der Datei legen. Es läuft nach der Ankündigung im Vollbild auf dem Fernseher, danach kommt die Frage. Geht mit jeder Frageart. |
| 🎧 Soundcheck | zusätzlich `"audio": "lied.mp3"`. Die Datei in den Ordner `audio` neben der Datei legen (mp3, m4a, ogg oder wav). Optional: `"start": 30` und `"dauer": 10` (Sekunden) spielen nur einen Ausschnitt, `"rueckwaerts": true` spielt ihn rückwärts. Geht mit jeder Frageart. |
| Zuordnung | `"zuordnen": {"Begriff": "Partner", ...}` mit 2 bis 6 Paaren. Die Reihenfolge wird im Spiel gemischt. |
| ⚖️ Richtig oder falsch | `"behauptungen": [["Aussage", true], ["Aussage", false], ...]` mit 2 bis 5 Aussagen, `true` = stimmt, `false` = stimmt nicht. Die Reihenfolge wird im Spiel gemischt. Standardzeit 30 Sekunden. |

Optional bei jeder Frage:
- `"schwierigkeit": 1`, `2` oder `3` für leicht, mittel oder schwer (ohne Angabe gilt 1). Gilt sie für ein ganzes Paket, kannst du `"schwierigkeit": 2` auch oben neben `"paket"` schreiben.
- `"kategorie": "Flaggen"`, sonst gilt der Paketname.
- `"zeit": 30` in Sekunden.
Achte auf die Kommas zwischen den Einträgen. Neue oder geänderte Dateien erscheinen beim nächsten Öffnen der Paketauswahl.

## Videos und Audio für Seh-Test und Soundcheck
- **Format:** MP4 mit H.264-Video und AAC-Ton, am besten 720p und 10 bis 60 Sekunden lang. Auf dem Raspberry Pi 3 kann 1080p ruckeln.
- **Umwandeln** geht mit dem kostenlosen Programm [ffmpeg](https://ffmpeg.org):
  ```bash
  ffmpeg -i mein-video.mov -vf scale=-2:720 -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart clip.mp4
  ```
- **Ton am Laptop:** Browser blockieren Videos mit Ton, solange niemand auf die Seite geklickt hat. Dann läuft das Video stumm mit dem Hinweis „Ton blockiert“, ein Klick oder die Taste **M** schaltet den Ton ein. Am Raspberry Pi ist das schon freigeschaltet.
- **Soundcheck-Beispiel:**
  ```json
  {"audio": "song.mp3", "start": 45, "dauer": 12, "rueckwaerts": true, "frage": "Welcher Song lief rückwärts?", "antworten": ["…", "…", "…", "…"]}
  ```
  Das Quiz schneidet den Ausschnitt selbst zu und dreht ihn um, die Datei bleibt unverändert. Verwende nur Musik, die du privat nutzen darfst.
- **Testen:** Die Pakete **Allgemein → Seh-Test (Testvideo)** und **Allgemein → Soundcheck (Test)** enthalten selbst erzeugte Testclips (Zahlen-Video, zwei Volkslied-Melodien, eine davon rückwärts). Damit siehst bzw. hörst du sofort, ob Bild und Ton laufen. Für normale Spiele kannst du sie abwählen.

## Eigene Musik und Jingles
Alle Stücke sind selbst erzeugt, frei nutzbar und klingen einheitlich (A-Dur, 128 BPM, gleiche Klänge). Sie liegen in `sounds/standard/`:
| Datei | Wann | Länge |
|---|---|---|
| `quiz-intro.mp3` | Intro beim Spielstart, Folien wechseln im Takt | 22,5 s |
| `block-start.mp3` | Ansage eines neuen Frageblocks | 4,5 s |
| `aufloesung.mp3` | Auflösung jeder Frage | 1,6 s |
| `rangliste.mp3` | Rangliste am Blockende: Spannung, solange die Balken wachsen, Auflösung beim Einsortieren | 13 s |
| `spezialfrage.mp3` | Alarm, wenn die Spezialfrage eingeblendet wird | 3,5 s |
| `countdown.mp3` | letzte 10 Sekunden einer Frage: startet leise, baut Spannung auf (wie die Pausenmusik, nur dezenter); bei Sekunde 10 ist die Zeit um, danach klingt ein Schlussakkord aus | 11,8 s |
| `pause-finale.mp3` | letzte Minute der Pause, ein Schlag pro Sekunde zum Countdown | 60 s |
| `siegerehrung.mp3` | Siegerpodest | 10 s |

Die Erzeuger-Skripte liegen daneben. Jede Datei lässt sich ersetzen, hier am Beispiel der Pausenmusik. Intro und Block-Start werden zum Ende ihrer Ansage ausgeblendet, wenn dein Song deutlich länger ist.

**Eigenen Song verwenden:** Leg ihn als `sounds/pause-finale.mp3` in den Quiz-Ordner, also neben den Ordner `standard`. Erlaubt sind auch `.m4a`, `.ogg` und `.wav`. Diese Datei hat Vorrang. Sie wird von Updates nicht angefasst, weil Git sie ignoriert. Löschst du sie, ist wieder die Standardmusik dran.
- **Vom Laptop auf den Pi kopieren:** `scp mein-song.mp3 <benutzer>@quizabend.local:QuizAbend/sounds/pause-finale.mp3`. Ein Neustart ist nicht nötig, die nächste Pause lädt die neue Datei.
- **Länge:** Ideal sind genau 60 Sekunden. Ein längerer Song startet bei 1:00 von vorn und wird zum Pausenende ausgeblendet. Ein kürzerer startet so, dass er genau zum Pausenende aufhört.
- Wird die Pause verlängert oder übersprungen, blendet die Musik aus. Ist „Sounds“ in den Einstellungen aus, bleibt es still.

## 🍻 Pub-Quiz-Modus
Einschalten unter ⚙️ Einstellungen › Spieleinstellungen › **Pub-Quiz-Modus**. Der 👑-Spieler wird zum **Gamemaster**: Er steht nicht in der Spielerliste, beantwortet keine Fragen und taucht nicht in der Rangliste auf. Auf dem Fernseher steht er in der Lobby als „🎤 Gamemaster“. Nach jedem Neustart des Pi ist er wieder aus, Standard ist der normale Modus.

**Vor dem Spiel – „📋 Fragen planen“** (in der Lobby oder in den Spieleinstellungen): Das Quiz zieht die Fragen wie gewohnt, der Gamemaster kann sie danach bearbeiten:
- **↑ / ↓** ändern die Reihenfolge, auch über Blockgrenzen hinweg (die oberste Frage eines Blocks rutscht mit ↑ ans Ende des vorherigen Blocks).
- **🎲** zieht eine andere Frage aus demselben Block, möglichst mit gleicher Schwierigkeit.
- **📋** zeigt alle Fragen der Pakete des Blocks zum gezielten Auswählen.
- **⭐** legt die Spezialfrage fest (nur wenn die Spezialfrage eingeschaltet ist). Ohne ⭐ wird sie wie gewohnt zufällig gewählt.
- **🎲 Neu** zieht alle Fragen neu. Ändern sich Blöcke oder Pakete, wird der Plan ebenfalls neu gezogen.

**Im Spiel** zeigt das Handy des Gamemasters die Frage **mit Lösung**, wie viele schon geantwortet haben, und unten immer einen großen Knopf mit dem nächsten Schritt:
- Während die Spieler antworten: „⏹ Antworten jetzt schließen“ (optional, sonst läuft die Zeit ab).
- Wenn die Zeit um ist oder alle geantwortet haben, wartet das Spiel: „🔍 Frage auflösen“.
- Nach der Auflösung wartet das Spiel wieder: „➡ Nächste Frage“, am Blockende „📊 Zur Rangliste“, nach der letzten Frage „🏆 Zur Siegerehrung“.
- Intro, Block-Ansage, Rangliste und Pause laufen weiter automatisch, lassen sich aber überspringen.

## 💡 Philips Hue (Test)
Das Quiz kann das Licht im Raum mitsteuern. Es braucht dafür nur die Hue Bridge im selben Netz, keine Zusatzsoftware.

**Einrichten (einmalig, am Handy des 👑 unter ⚙️ Einstellungen › Philips Hue):**
1. „Bridge suchen“ tippen. Das braucht Internet; ohne Internet die IP der Bridge eintippen (Hue-App › Einstellungen › Bridges › ⓘ).
2. Den runden Knopf oben auf der Bridge drücken und innerhalb von 30 Sekunden „Verbinden“ tippen.
3. Den Bereich wählen: einen Entertainment-Bereich (z. B. „TV“), einen Raum oder eine Zone.
4. Mit „Testen“ prüfen: Die Lampen pulsieren 3 Sekunden gold (mit „Test stoppen“ abbrechbar), danach ist alles wie vorher.

**Was im Spiel passiert:**
| Moment | Licht |
|---|---|
| Intro, Block-Ansage, Rangliste | Lila, gedimmt |
| Frage | Dunkles Blau-Lila, stark gedimmt (bei Video/Audio fast aus) |
| Auflösung | Farbe der richtigen Antwort (rot, blau, gelb, grün); bei Schätz- und Zuordnungsfragen grün |
| Spezialfrage | Gold, volle Helligkeit, pulsiert, solange der Spezialfrage-Screen zu sehen ist |
| Pause zwischen den Blöcken | Hell und warmweiß; in der letzten Minute dimmt es langsam (über die ganze Minute) auf das Lila der nächsten Block-Ansage. Wird die Pause verlängert, wird es wieder hell |
| Spiel angehalten | Warmweiß, halbe Helligkeit |
| Siegerehrung | Farbe des Gewinners, pulsiert |
| Zurück in der Lobby | Licht wie vor dem Spiel |

- Lampen ohne Farbe werden nur gedimmt.
- Das Quiz schickt jeden Lichtwechsel als einen Gruppenbefehl an den ganzen Bereich, so schalten alle Lampen gleichzeitig. Die Bridge erlaubt etwa einen Gruppenbefehl pro Sekunde; schnellere Effekte gehen erst mit dem Entertainment-Streaming (Variante 2).
- Läuft gleichzeitig Hue Sync (App oder Sync Box) für denselben Bereich, ignoriert die Bridge die Befehle des Quiz. Hue Sync also vorher ausschalten.
- Die Zugangsdaten liegen in `hue.json` im Quiz-Ordner (nicht in Git). „Verbindung trennen“ löscht sie.

## Einstellungen (optional, beim Start setzen)
| Variable | Bedeutung | Standard |
|---|---|---|
| `FRAGEN` | Fragen pro Runde | 10 |
| `SEKUNDEN` | Zeit pro Frage | 20 |
| `RANGLISTE` | zusätzlich eine Rangliste nach jeder X. Frage (0 = nur am Blockende) | 0 |
| `PORT` | Port des Servers | 3000 |
| `HOST_IP` | Adresse im QR-Code erzwingen | automatisch |

Beispiel (Mac/Linux): `FRAGEN=15 SEKUNDEN=15 node server.js`
Beispiel (Windows, Eingabeaufforderung): `set FRAGEN=15 && node server.js`

## Probleme?
- **Handy lädt die Seite nicht:** Handy und Laptop müssen im selben WLAN sein (kein Gäste-WLAN). Unter Windows die Firewall-Freigabe prüfen. Wenn der QR-Code eine falsche Adresse zeigt (z. B. wegen VPN), starte mit `HOST_IP=<deine-IP>`.
- **„Port 3000 ist schon belegt“:** Das Quiz läuft schon in einem anderen Fenster. Schließe es oder nutze `PORT=3001`.

## Aufbau (zum Weiterentwickeln)
- `server.js`: Spiellogik und Webserver (nur Node.js, keine Zusatzpakete). Echtzeit per Server-Sent Events.
- `public/tv.html`: Fernseher-Ansicht (Lobby, Frage, Auflösung, Rangliste, Siegerpodest)
- `public/play.html`: Handy-Controller
- `public/qr.js`: QR-Code-Generator (funktioniert offline)
- `hue.js`: Philips-Hue-Steuerung (Kopplung, Bereich, Licht je Spielphase)
- `sounds/`: Pausenmusik (`standard/` mit Erzeuger-Skript, eigene Datei daneben)
- `fragen/`: Fragenpakete (ein Ordner pro Hauptkategorie, eine Datei pro Paket)
- `einstellungen.json`: gewählte Pakete (legt das Spiel selbst an)
