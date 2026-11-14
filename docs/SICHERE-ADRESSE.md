# 🔒 Sichere Adresse (https)

Im Heim-WLAN kann QuizAbend statt über `http://172.23.58.131` über eine echte, verschlüsselte Adresse laufen, z. B. **`https://meinquiz.duckdns.org`**. Die Einrichtung dauert am Handy wenige Minuten, danach kümmert sich der Pi um alles selbst.

Code: [`zertifikat.js`](../zertifikat.js) (Ablauf), Server-Teil in [`server.js`](../server.js) (`httpsReady`, `/api/https`), Einstellungen in [`public/play.html`](../public/play.html) (`httpsSection`).

---

## Warum? – Die Vorteile

| | ohne https (`http://…`) | mit https (`https://….duckdns.org`) |
|---|---|---|
| **Bildschirm am Handy bleibt an** | nur per Trick (unsichtbares Video) – Chrome auf Android hält sich nicht immer daran | zuverlässig über die Wake-Lock-Funktion des Browsers (Chrome erlaubt sie nur bei https) |
| **Spotify-Anmeldung** | nicht möglich – Spotify leitet nach dem Login nur an https-Adressen zurück | möglich |
| **Verschlüsselung** | Antworten und Einstellungen gehen offen durchs WLAN | verschlüsselt |
| **Adresse** | IP-Adresse, ändert sich ggf. | fester Name, auch wenn sich die IP des Pi ändert |
| **Weitere Browser-Funktionen** | eingeschränkt (z. B. Zwischenablage, Vibration in manchen Browsern) | voll verfügbar |
| **Warnungen im Browser** | „Nicht sicher“ in der Adresszeile | keine – echtes Zertifikat, kein Wegklicken nötig |

## Wie funktioniert das?

Ein Browser vertraut einer https-Adresse nur, wenn es ein **Zertifikat** von einer anerkannten Stelle gibt, und das gibt es nur für einen **Namen im Internet** – nicht für eine IP im Heimnetz. Deshalb drei Bausteine:

```
 Handy ──► „meinquiz.duckdns.org?“ ──► Router/DNS ──► 172.23.58.131 (der Pi, im Heimnetz)
                                                         │
 Handy ◄══════════ https, Zertifikat von Let's Encrypt ══╛
```

1. **DuckDNS** (kostenloser Namensdienst): Der Name `meinquiz.duckdns.org` zeigt auf die **Heimnetz-IP** des Pi. Der Name ist öffentlich, die IP dahinter aber nur im eigenen WLAN erreichbar – von außen kommt niemand an den Pi. Ändert sich die IP, trägt der Pi sie selbst nach (Prüfung alle 5 Minuten).
2. **Let's Encrypt** (kostenlose Zertifizierungsstelle) stellt das Zertifikat aus. Den Nachweis, dass uns der Name gehört, erbringt der Pi über einen kurzzeitigen Eintrag bei DuckDNS (*DNS-Nachweis*). Deshalb muss **kein Port im Router geöffnet** werden. Das erledigt das Programm **acme.sh**. Gültig 90 Tage, der Pi erneuert 30 Tage vor Ablauf.
3. **Prüfung im Heimnetz:** Der Pi fragt den Router, ob der Name wirklich auf ihn zeigt. Erst dann schaltet er um.

Ist alles grün, zeigt der Fernseher die https-Adresse im QR-Code, und Handys, die noch die alte Adresse öffnen, werden umgeleitet. Fehlt etwas, bleibt einfach alles bei http – **das Quiz funktioniert immer**, https ist nur ein Zusatz.

## Abhängigkeiten

| Was | Wofür | Wenn es fehlt / ausfällt |
|---|---|---|
| **Internet** (Heim-WLAN) | DuckDNS aktualisieren, Zertifikat holen/erneuern | Vorhandenes Zertifikat gilt weiter (bis zu 90 Tage); im eigenen WLAN des Pi ruht https ganz |
| **DuckDNS-Konto** (kostenlos, Anmeldung z. B. mit Google) | Name + Token | ohne Konto keine https-Adresse |
| **Let's Encrypt** | Zertifikat | bei Störung: neuer Versuch nach 1 Stunde, bis dahin http |
| **acme.sh** (Open Source, [github.com/acmesh-official/acme.sh](https://github.com/acmesh-official/acme.sh)) | spricht mit Let's Encrypt | wird beim ersten Einrichten automatisch nach `.https/acme.sh-src` geklont; Meldung im Protokoll, wenn GitHub nicht erreichbar ist |
| **bash, curl, openssl, git** am Pi | braucht acme.sh | sind auf Raspberry Pi OS vorhanden |
| **Port 443** | https-Server | der QuizAbend-Dienst darf niedrige Ports nutzen (`CAP_NET_BIND_SERVICE` aus `setup.sh`, wie schon für Port 80) |
| **Router löst den Namen auf** | Handys finden den Pi | viele Router blockieren das („DNS-Rebind-Schutz“) → Name einmalig freigeben, siehe unten |

Keine neuen Node-Pakete: Der Server nutzt nur das, was Node mitbringt.

## Einrichten

1. Am Handy **duckdns.org** öffnen und anmelden (z. B. mit Google).
2. Bei *sub domain* einen Namen ausdenken (z. B. `meinquiz`) und **add domain** tippen.
3. Den **token** oben auf der Seite kopieren.
4. Im Quiz unter ⚙️ Einstellungen › 🔒 **Sichere Adresse** Name und Token eintragen, **Einrichten** tippen.
5. Nach 1–3 Minuten erscheinen drei grüne Haken: *Zeigt auf …* · *Zertifikat gültig bis …* · *Im Heimnetz erreichbar*.

### Fritz!Box: DNS-Rebind-Schutz

Steht bei Schritt 5 „Der Router löst die Adresse nicht auf“: Die Fritz!Box blockiert Namen, die auf ein Gerät im Heimnetz zeigen (Schutz gegen eine bestimmte Angriffsart). Für unseren Namen gezielt erlauben:

**Heimnetz › Netzwerk › Netzwerkeinstellungen › DNS-Rebind-Schutz** → `meinquiz.duckdns.org` eintragen → Übernehmen → in den Quiz-Einstellungen **Jetzt prüfen**.

Andere Router haben eine ähnliche Einstellung (oft „DNS Rebinding Protection“ mit Ausnahmeliste).

## Was ist öffentlich?

- Der **Name** (`meinquiz.duckdns.org`) und die **Heimnetz-IP** dahinter sind im Internet abfragbar. Die IP ist eine private Adresse (z. B. `172.23.…` oder `192.168.…`) – von außen ist sie nicht erreichbar.
- Ausgestellte Zertifikate stehen in öffentlichen Verzeichnissen (*Certificate Transparency*) – also ebenfalls nur der Name.
- Der **Token** bleibt auf dem Pi (`https.json`, nur für den Dienst lesbar) und wird am Handy nie wieder angezeigt. Wer ihn kennt, kann den DuckDNS-Namen umleiten – also nicht weitergeben. Neuer Token: bei DuckDNS „recreate token“, dann hier neu eintragen.

## Wo liegt was? (nicht im Git)

| Datei / Ordner | Inhalt |
|---|---|
| `https.json` | Name, Token, zuletzt eingetragene IP, letzter Fehler |
| `.https/acme.sh-src/` | acme.sh (von GitHub geklont) |
| `.https/acme/` | Zertifikat und Schlüssel (`<name>.duckdns.org_ecc/`) |
| `.https/https.log` | Protokoll (auch am Handy unter „Protokoll anzeigen“) |

## Eigenes WLAN des Pi

Startet der Pi sein eigenes WLAN (kein Heim-WLAN in Reichweite), gibt es dort kein Internet und keinen Router. https ruht dann, das Quiz läuft wie gewohnt über `http://10.42.0.1`. Philips Hue ist dort ebenfalls abgeschaltet (die Bridge ist nicht erreichbar).

## Entfernen

⚙️ › 🔒 Sichere Adresse › **Sichere Adresse entfernen**: löscht Name, Token und Zertifikat vom Pi, der https-Server stoppt, alles läuft wieder über http. Den Namen bei DuckDNS kann man dort zusätzlich löschen.

## Für Entwickler: testen

Let's Encrypt und DuckDNS sind im Test nicht erreichbar. Deshalb lassen sich die Dienste ersetzen:

| Variable | Wirkung |
|---|---|
| `HOST_IP=192.0.2.2` | feste „Heimnetz-IP“ |
| `DUCKDNS_URL=http://127.0.0.1:3499/update` | Fake-DuckDNS (antwortet `OK`) |
| `ACME_REPO=/pfad/zum/fake-acme` | Git-Repo mit einem `acme.sh`, das ein selbst signiertes Zertifikat ausstellt |
| `HTTPS_PORT=3443` | https auf einem freien Port |
| `HOTSPOT=1` | eigenes WLAN simulieren |

Den Namen in `/etc/hosts` auf `HOST_IP` zeigen lassen, damit die Heimnetz-Prüfung grün wird.
