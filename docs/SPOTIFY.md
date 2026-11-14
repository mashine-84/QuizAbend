# 🎵 Spotify

QuizAbend kann **deine Spotify-Musik** während des Spiels laufen lassen – auf einem Spotify-Connect-Gerät im Heimnetz, z. B. dem **Yamaha-Receiver**. Das Quiz spielt dabei selbst keine Spotify-Musik ab, es sagt Spotify nur, wann **Pause** und wann **Weiter** ist.

Code: [`spotify.js`](../spotify.js) (Anmeldung, Geräte, Pause/Weiter), Server-Teil in [`server.js`](../server.js) (`spotifyUpdate`, `/api/spotify`, `/spotify/login`, `/spotify/callback`), Einstellungen in [`public/play.html`](../public/play.html) (`spotifySection`).

---

## Was passiert im Spiel?

| Phase | Spotify |
|---|---|
| Lobby | wird nicht angefasst – du kannst vorher hören, was du willst |
| **Opener** und **Intro** („So wird gefragt“) | ⏸ Pause – das Quiz spielt seinen Opener-Jingle |
| **Blockseite** (Block 1, Block 2 …) | ⏸ Pause – das Quiz spielt den Block-Jingle; danach geht es weiter |
| Fragen, Auflösung, Rangliste | ▶️ läuft (zum ersten Mal: deine Playlist, sonst das, was zuletzt lief) |
| **Musikfrage** (Soundcheck) / **Filmfrage** (Seh-Test), solange Ton oder Video läuft | ⏸ Pause – danach, wenn die Antworten kommen, geht es weiter |
| Merkbild (stilles Bild) | ▶️ läuft weiter |
| **Blockpause** | ⏸ Pause – die Pausenmusik des Quiz läuft |
| **Siegerehrung** | ⏸ Pause |

Regeln dahinter:
- **Nur fortsetzen, was das Quiz selbst angehalten hat.** Hast du Spotify zwischendurch selbst pausiert, bleibt es aus.
- **Läuft Spotify gerade auf einem anderen Gerät** (z. B. deinem Handy), greift das Quiz nicht ein.
- Schnelles Weiterklicken schickt nur den letzten Stand (Befehle werden kurz gebündelt).
- Der Quiz-Ton kommt weiter aus den **TV-Lautsprechern**, Spotify aus dem Receiver – beides läuft getrennt.

## Warum so – die Vorteile

- **Eure eigene Musik** statt Dauerschleife: Playlist der Party, keine Lizenzfragen, keine Dateien auf dem Pi.
- **Kein Ton-Chaos:** Bei Musik- und Filmfragen ist Spotify automatisch still, die Quiz-Musik in Opener und Pause hat ihren Auftritt.
- **Der Pi bleibt entlastet:** Er spielt die Musik nicht selbst ab (der Pi 3B könnte über HDMI nur einen Tonstrom gleichzeitig) – das macht der Receiver.

## Abhängigkeiten

| Was | Wofür | Wenn es fehlt / ausfällt |
|---|---|---|
| **Spotify Premium** | Wiedergabe fernsteuern geht bei Spotify nur mit Premium – und seit 2026 brauchen auch eigene Entwickler-Apps ein Premium-Konto beim Besitzer | Steuerung geht nicht; die Einstellungen sagen das |
| **Eigene Spotify-App** (kostenlos, [developer.spotify.com](https://developer.spotify.com/dashboard)) | Spotify erlaubt Fernsteuerung nur über eine registrierte App. Im „Development Mode“ darf sie bis zu 5 Konten nutzen – für uns reicht eins | ohne App keine Anmeldung |
| **Sichere Adresse (https)** – siehe [SICHERE-ADRESSE.md](SICHERE-ADRESSE.md) | Nach dem Login leitet Spotify nur an `https://`-Adressen zurück | ohne https lässt sich Spotify nicht verbinden (die Einstellungen führen dorthin) |
| **Internet** (Heim-WLAN) | Befehle gehen über die Spotify-Server | im **eigenen WLAN des Pi** ist Spotify abgeschaltet |
| **Gerät erreichbar** | Receiver an (oder im Netzwerk-Standby), bei Spotify angemeldet | Protokoll: „Gerät nicht gefunden“ – das Spiel läuft trotzdem normal weiter |

Keine neuen Node-Pakete: alles über Bordmittel von Node.

## Einrichten (einmalig, am Handy des 👑)

Voraussetzung: Die sichere Adresse ist eingerichtet und aktiv (⚙️ › 🔒 Sichere Adresse, drei grüne Haken).

1. Unter ⚙️ › 🧩 **Integrationen** › 🎵 Spotify steht die Anleitung mit der **Redirect URI** (z. B. `https://meinquiz.duckdns.org/spotify/callback`) – kopieren.
2. **developer.spotify.com/dashboard** öffnen, mit deinem Spotify-Konto anmelden, **Create app**:
   - Name z. B. „QuizAbend“, Beschreibung beliebig
   - **Redirect URIs:** die kopierte Adresse einfügen (genau so)
   - Schnittstelle: **Web API** ankreuzen, speichern
3. In der App unter **Settings** die **Client ID** kopieren und im Quiz eintragen.
4. **Mit Spotify verbinden** tippen → bei Spotify anmelden (dasselbe Konto wie beim Anlegen der App) → „Zustimmen“ → „Spotify verbunden“ → **Zurück zum Quiz**.
5. **Gerät wählen** → den Yamaha antippen. Findet der Pi ihn nicht: Receiver einschalten oder kurz etwas aus der Spotify-App darauf abspielen, dann erneut suchen.
6. Optional eine **Playlist** für den Spielstart: In Spotify bei der Playlist *Teilen › Link kopieren* und einfügen.
7. Mit **Test: Abspielen / Test: Pause** prüfen. Der Schalter **Spotify im Spiel steuern** schaltet alles an/aus.

## Datenschutz & Sicherheit

- Anmeldung über das offizielle Verfahren von Spotify (*Authorization Code mit PKCE*): Dein Passwort sieht das Quiz nie, es gibt keinen geheimen App-Schlüssel auf dem Pi.
- Das Quiz fragt nur zwei Rechte an: **Wiedergabestatus lesen** und **Wiedergabe steuern**. Keine Playlists, keine Hörhistorie, keine Kontodaten außer dem Anzeigenamen.
- Die Anmeldung (Refresh-Token) liegt in `spotify.json` auf dem Pi (nur für den Dienst lesbar, nicht im Git). **Spotify trennen** löscht sie; zusätzlich kann man den Zugriff unter spotify.com › Konto › Apps entziehen.

## Wo liegt was? (nicht im Git)

| Datei | Inhalt |
|---|---|
| `spotify.json` | Client ID, Anmeldung (Token), gewähltes Gerät, Playlist, an/aus |

Das Protokoll (letzte Befehle, Fehler) steht in den Einstellungen unter „Protokoll anzeigen“ und im Protokoll des Dienstes.

## Fehlersuche

| Meldung | Ursache / Lösung |
|---|---|
| „Für die Anmeldung braucht es die sichere Adresse“ | https zuerst einrichten |
| Spotify zeigt *INVALID_CLIENT: Invalid redirect URI* | Redirect URI im Dashboard stimmt nicht exakt (Port, Schrägstrich) – aus den Einstellungen kopieren |
| „Die Anmeldung ist abgelaufen“ | Zwischen „Verbinden“ und Rückkehr mehr als 15 Minuten oder Pi neu gestartet – erneut verbinden |
| „Dafür braucht es Spotify Premium“ | Konto ohne Premium |
| „Gerät nicht gefunden“ | Receiver aus/schläft ohne Netzwerk-Standby – einschalten, in der Spotify-App einmal auswählen |
| „Anmeldung abgelaufen – bitte neu verbinden“ | Zugriff wurde bei Spotify entzogen oder Passwort geändert |

## Für Entwickler: testen

Spotify ist im Test nicht erreichbar; `SPOTIFY_ACCOUNTS` und `SPOTIFY_API` zeigen auf einen Fake-Server (Anmeldung, Geräte, Play/Pause). Zusammen mit dem https-Fake (siehe SICHERE-ADRESSE.md) lässt sich der ganze Ablauf im Browser durchspielen. `HOTSPOT=1` prüft die Sperre im eigenen WLAN.
