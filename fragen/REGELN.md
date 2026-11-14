# Regeln für gute Quizfragen

Das Format der Dateien (Felder, Fragearten, Bilder, Audio, Video) steht in der **LIESMICH**. Hier steht, woran man eine **gute** Frage für einen QuizAbend erkennt – für alle, die Fragen schreiben, und für Claude.

Nach jeder Änderung prüfen:

```bash
node pruefen.js            # alle Pakete
node pruefen.js Sport      # nur Dateien mit „Sport“ im Pfad
```

✗ = Fehler, muss weg · ⚠ = Hinweis, darf bleiben, wenn es Absicht ist.

---

## 1. Grundregeln für jede Frage

1. **Eindeutig richtig.** Genau eine Antwort stimmt – auch für Besserwisser. Keine Fangfragen über Spitzfindigkeiten („technisch gesehen …“), keine Antworten, über die man streiten kann.
2. **Fakten prüfen.** Jede Antwort mit einer verlässlichen Quelle gegenprüfen. Bei Zahlen lieber runden und „ungefähr“ in die Frage schreiben.
3. **Zeitfest.** Antworten, die sich ändern können (Einwohner, Rekorde, Amtsinhaber, Mitgliederzahlen), bekommen einen Stichtag in die Frage: *„Wie viele Länder gehören zur EU (Stand 2025)?“* – Wörter wie *aktuell, derzeit, momentan, amtierend* sind ein Warnsignal.
4. **Kurz.** Die Frage passt in ein bis zwei Zeilen am Fernseher: **bis 100 Zeichen** (Hinweis), höchstens 160 (Fehler). Keine Nebensätze, die nur Zeit kosten.
5. **Deutsch, locker, ohne Fachjargon.** Du-Ansprache ist nicht nötig, Ausrufezeichen sparsam. Begriffe, die nicht jeder kennt, kurz in der Frage erklären.
6. **Nicht doppelt.** Gleiche Frage nicht in zwei Paketen. Ähnliche Fragen (gleiches Wissen, anders formuliert) auch vermeiden.
7. **Kategorie und Schwierigkeit angeben** – `"kategorie"` steht klein über der Frage, `"schwierigkeit"` steuert den Verlauf und (bei Punkten nach Schwierigkeit) die Punkte.

## 2. Schwierigkeit

| Stufe | Bedeutung | Faustregel | Beispiel |
|---|---|---|---|
| **1** | Allgemeinwissen | Fast jeder am Tisch weiß es | Hauptstadt von Frankreich |
| **2** | Gutes Allgemeinwissen | Etwa die Hälfte weiß es, der Rest kann es herleiten | Wie viele Sterne hat die EU-Flagge? |
| **3** | Für Kenner | Nur wenige wissen es sicher, raten macht Spaß | Wer gewann die erste Fußball-WM 1930? |

Ein Paket sollte alle drei Stufen enthalten, grob **40 % / 40 % / 20 %**. Leichte Fragen kommen im Spiel zuerst, schwere werden später wahrscheinlicher.

## 3. Je Frageart

### ❓ Auswahl (`"antworten"`)
- **Genau 4 Antworten, die richtige zuerst** – die Reihenfolge wird im Spiel gemischt.
- **Falsche Antworten müssen plausibel sein:** gleiche Art, ähnliche Länge, ähnliche Größenordnung. Keine Witzantworten, kein „Alle/Keine der genannten“.
- Antworten **bis 45 Zeichen** (Hinweis), höchstens 80. Lange Erklärungen gehören nicht in die Antwort.

✅ `"Welcher Planet ist der Sonne am nächsten?" → ["Merkur", "Venus", "Mars", "Erde"]`
❌ `"Welcher Planet ist der Sonne am nächsten?" → ["Merkur", "Pluto", "Die Sonne", "Ein Komet"]` (offensichtlich, Witzantwort)

### 🔢 Schätzfrage (`"schaetzen"`)
- Es zählt, wer am nächsten dran ist. Gute Schätzfragen haben eine Antwort, die man **herleiten** kann, aber kaum jemand genau weiß.
- **`"einheit"` angeben** (m, km, kg, €, Jahre …). Bei „Wie viele …“-Fragen ist sie optional.
- Jahreszahlen („In welchem Jahr …“) zählen bis ±2 Jahre als richtig; mit `"toleranz"` anpassbar.
- Runde, belegbare Werte. Bei ungenauen Zahlen „ungefähr“ in die Frage und auf eine sinnvolle Stelle runden.

✅ `"Wie hoch ist der Eiffelturm (mit Antennen)?" → 330, "m"`
❌ `"Wie viele Menschen leben auf der Erde?" → 8123456789` (veraltet, unrund)

### 🔗 Zuordnung (`"zuordnen"`)
- **3 bis 5 Paare** spielen sich am besten (erlaubt 2–6). Jedes Paar richtig = 1 Punkt.
- Alle Begriffe einer Seite von **gleicher Art** (nur Länder, nur Hauptstädte …), damit man nicht über die Wortart zuordnen kann.
- Begriffe kurz halten: **bis 40 Zeichen** (Hinweis), höchstens 70 – sie stehen auf Puzzleteilen.

### ⚖️ Richtig oder falsch (`"behauptungen"`)
- **3 Aussagen** pro Frage (erlaubt 2–5), jede für sich eindeutig wahr oder falsch.
- Über ein Paket **etwa die Hälfte wahr**, einzelne Fragen dürfen auch „alle wahr“ oder „alle falsch“ sein – das sorgt für Überraschung.
- Falsche Aussagen sind am besten **verbreitete Irrtümer** (Wikinger-Hörnerhelme, Napoleon war klein) – da lernt man etwas.
- Aussagen **bis 90 Zeichen**, höchstens 140.

### 🖼️ Bild, 📸 Merkbild, 🎧 Audio, 👀 Video
- Nur Medien verwenden, die ihr nutzen dürft (selbst gemacht, frei lizenziert, z. B. Wikimedia Commons mit passender Lizenz). Keine Fotos von Privatpersonen ohne Einverständnis.
- Bilder klein halten (max. ~1600 px Breite, jpg/webp) – der Pi lädt sie im Spiel.
- **Merkbild** (`"merken"`): 5–10 Sekunden reichen. Die Frage muss sich auf etwas beziehen, das man **sehen** konnte.
- **Audio**: Ausschnitte mit `"start"`/`"dauer"`; sehr kurze Ausschnitte (1–2 s) mit `"wiederholen": 2` oder `3`.

## 4. Pakete über Firmen, Vereine oder Personen
- Nur Wissen, das **öffentlich** ist (Website, Impressum, Pressemitteilungen) – keine internen Zahlen, Kundendaten oder vertraulichen Infos.
- Zahlen (Umsatz, Mitarbeitende, Verträge) **immer mit Jahr** in der Frage und mit Quelle prüfen.
- Werbesprache vermeiden – die Frage soll Spaß machen, nicht wie eine Broschüre klingen.

## 5. Checkliste vor dem Commit
- [ ] `node pruefen.js` zeigt **0 Fehler**, Hinweise sind geprüft
- [ ] Jede Antwort gegen eine Quelle geprüft, veränderliche Fakten mit Stichtag
- [ ] Schwierigkeiten passen zur Tabelle oben
- [ ] Medien liegen im richtigen Ordner (`bilder/`, `audio/`, `videos/`) und dürfen genutzt werden
