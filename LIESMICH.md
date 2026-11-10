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
