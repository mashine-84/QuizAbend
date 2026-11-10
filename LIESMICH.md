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
- **Fragen ändern:** Dateien im Ordner `fragen/` bearbeiten oder neue dazulegen. Ein Neustart ist nicht nötig, neue Pakete erscheinen beim nächsten Öffnen der Paketauswahl.
- **Updates holen:** `cd QuizAbend && git pull && sudo systemctl restart quizabend`
- **Autostart abschalten:** `sudo systemctl disable quizabend` und `rm ~/.config/autostart/quizabend-kiosk.desktop`

## Ablauf und Punkte
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
- **Zuordnung:** Erst erscheinen nur die Begriffe, dann die Frage. Am Handy ordnest du die Partner den Zahlen zu. Aufgelöst wird Paar für Paar, Punkte gibt es pro richtigem Paar.
- Wer mehrere Fragen in Folge richtig hat, bekommt bis zu +150 Serienbonus.
- Ist die Zeit um, zeigt der Fernseher erst, wer was gewählt hat. Danach kommt die Auflösung.
- Die Rangliste erscheint nach jeder 5. Frage, am Ende jedes Blocks und am Spielende, jeweils mit den Punkten seit der letzten Rangliste.
- Handy-Akku leer oder Seite neu geladen? Einfach wieder öffnen, der Spielstand bleibt erhalten.

## Einstellungen am Handy (👑)
Der 👑-Spieler tippt in der Lobby auf **⚙️ Einstellungen**:
- **Anzahl Blöcke** (1 bis 6). Antippen eines Blocks öffnet seine Einstellungen: wie viele Fragen er hat und welche Pakete er nutzt. Pakete lassen sich einzeln oder als ganze Hauptkategorie an- und abhaken. Neben jedem Paket steht, wie viele leichte, mittlere und schwere Fragen es enthält.
- **Spezialfrage:** an/aus und der Multiplikator ×2, ×3 oder ×4.
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
     "zuordnen": {"Bayern München": "Allianz Arena", "Borussia Dortmund": "Signal Iduna Park", "Schalke 04": "Veltins-Arena", "1. FC Köln": "RheinEnergieStadion"}}
  ]
}
```
| Frageart | So schreibst du sie |
|---|---|
| Auswahl | `"antworten": [...]` mit 2 bis 4 Antworten. **Die erste ist immer die richtige**, im Spiel wird gemischt. |
| Bilderrätsel | zusätzlich `"bild": "datei.jpg"`. Das Bild in den Ordner `bilder` neben der Datei legen (jpg, png, webp, gif oder svg). |
| Schätzfrage | `"schaetzen": 330` statt Antworten, optional mit `"einheit": "m"`. Geht mit oder ohne Bild. |
| Zuordnung | `"zuordnen": {"Begriff": "Partner", ...}` mit 2 bis 6 Paaren. Die Reihenfolge wird im Spiel gemischt. |

Optional bei jeder Frage:
- `"schwierigkeit": 1`, `2` oder `3` für leicht, mittel oder schwer (ohne Angabe gilt 1). Gilt sie für ein ganzes Paket, kannst du `"schwierigkeit": 2` auch oben neben `"paket"` schreiben.
- `"kategorie": "Flaggen"`, sonst gilt der Paketname.
- `"zeit": 30` in Sekunden.
Achte auf die Kommas zwischen den Einträgen. Neue oder geänderte Dateien erscheinen beim nächsten Öffnen der Paketauswahl.

## Einstellungen (optional, beim Start setzen)
| Variable | Bedeutung | Standard |
|---|---|---|
| `FRAGEN` | Fragen pro Runde | 10 |
| `SEKUNDEN` | Zeit pro Frage | 20 |
| `RANGLISTE` | Rangliste nach jeder X. Frage | 5 |
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
- `fragen/`: Fragenpakete (ein Ordner pro Hauptkategorie, eine Datei pro Paket)
- `einstellungen.json`: gewählte Pakete (legt das Spiel selbst an)
