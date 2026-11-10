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
4. Alle scannen den QR-Code mit dem Handy (selbes WLAN wie der Laptop!) und geben ihren Namen ein.
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

- **Grafik:** Auf dem Pi läuft die TV-Ansicht im schonenden Modus (ohne Konfetti und Animationen), damit nichts ruckelt. Auf einem Pi 4/5 kannst du in `raspberry-pi/kiosk.sh` `LITE=0` setzen.
- **Steuern ohne Tastatur:** Der 👑-Spieler startet und überspringt alles am Handy.
- **Fragen ändern:** `fragen.json` bearbeiten und danach `sudo systemctl restart quizabend` ausführen.
- **Updates holen:** `cd QuizAbend && git pull && sudo systemctl restart quizabend`
- **Autostart abschalten:** `sudo systemctl disable quizabend` und `rm ~/.config/autostart/quizabend-kiosk.desktop`

## Ablauf und Punkte
- 10 zufällige Fragen pro Runde, je 20 Sekunden.
- Richtig = 500 bis 1000 Punkte (je schneller, desto mehr), dazu bis zu +150 Bonus für Serien.
- Sobald alle geantwortet haben, geht es sofort zur Auflösung.
- Handy-Akku leer oder Seite neu geladen? Einfach wieder öffnen, der Spielstand bleibt erhalten.

## Eigene Fragen
Öffne `fragen.json` mit einem Texteditor. **Die erste Antwort ist immer die richtige**, die Reihenfolge wird im Spiel gemischt:

```json
{"kategorie": "Familie", "frage": "Wo war unser Urlaub 2024?", "antworten": ["Kroatien", "Italien", "Spanien", "Dänemark"]}
```
Achte auf die Kommas zwischen den Einträgen. Neu starten, dann sind die Fragen drin.

## Einstellungen (optional, beim Start setzen)
| Variable | Bedeutung | Standard |
|---|---|---|
| `FRAGEN` | Fragen pro Runde | 10 |
| `SEKUNDEN` | Zeit pro Frage | 20 |
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
- `fragen.json`: Fragensammlung
