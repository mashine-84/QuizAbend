# Erzeugt sounds/standard/opener.mp3 (selbst komponiert, frei nutzbar): der Opener „Vier Kacheln“,
# 4,9 s, A-Dur, 128 BPM – gleiche Klangbausteine wie die übrigen Jingles (aus erzeugen-jingles.py).
# Erkennungsmotiv: A – Cis – E – A, ein Ton je Kachel. Zeiten passen zur Animation im Fernseher (renderIdent).
#   python3 erzeugen-opener.py /tmp/opener.wav && ffmpeg -i /tmp/opener.wav -b:a 160k opener.mp3
import sys, os, types
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'erzeugen-jingles.py')).read()
head = src[:src.index("out = sys.argv[1]")]          # nur Hilfsfunktionen und Klangbausteine übernehmen
mod = types.ModuleType('j'); exec(head, mod.__dict__)
np, Track, note, E8, S16, BAR, A, D, arp = mod.np, mod.Track, mod.note, mod.E8, mod.S16, mod.BAR, mod.A, mod.D, mod.arp

T = Track(4.9, 41)
# 1) Auftakt: Uhrticken + kurzer Riser (wie Pause/Countdown)
for k in range(2): T.add(T.tick(k == 0), k * E8, gain=0.12)
T.add(T.riser(0.47, top=5000), 0, gain=0.12)
# 2) Das Motiv: vier Kacheln rasten ein – je ein Ton, aufsteigend A – Cis – E – A (die „QuizAbend-Melodie“)
MOTIF = [69, 73, 76, 81]
for i, m in enumerate(MOTIF):
    t = 0.47 + i * E8
    T.add(T.stab((m - 12, m), 0.32, 4200, 5), t, pan=(-0.4, 0.4, -0.2, 0.2)[i], gain=0.26)
    T.add(T.lead(m, E8 * 0.95), t, gain=0.12)
    T.add(T.tick(True), t, gain=0.1)
# 3) „?“ erscheint: satter Treffer auf A
hit = 0.47 + 4 * E8
T.add(T.boom(0.8, (57, 64, 69, 73, 76), 1.2, 3.5), hit)
T.add(T.clap(), hit, gain=0.32)
T.add(T.stab((45, 57, 61, 64, 69, 73), 0.6, 4500, 3), hit, gain=0.3)
# 4) Logo: ein Takt Groove (Kick, Hats, Bass, Arpeggio A -> D), darüber das Motiv als Antwort
g0 = hit + E8 * 2
for q in range(4): T.add(T.kick(), g0 + q * BAR / 4, gain=0.42); T.add(T.hat(q % 2 == 1), g0 + q * BAR / 4 + E8, pan=0.25, gain=0.08)
for q in (1, 3, 5, 7): T.add(T.bass(45 if q < 5 else 50, E8 * 0.9), g0 + q * E8, gain=0.26)
T.add(T.pad(A, BAR / 2, 2400), g0, gain=0.08); T.add(T.pad(D, BAR / 2, 2800), g0 + BAR / 2, gain=0.09)
arp(T, g0, A, steps=8, gain=0.06); arp(T, g0 + BAR / 2, D, steps=8, gain=0.065)
for i, m in enumerate([76, 81, 85, 88]): T.add(T.lead(m, E8 * 0.9), g0 + BAR / 2 + i * S16 * 2, gain=0.1)
# 5) Schluss: Motiv-Akkord + Glitzern, klingt aus
f0 = g0 + BAR
T.add(T.boom(0.7, (57, 64, 69, 73, 76, 81), 1.6, 3), f0)
T.add(T.stab((45, 57, 64, 69, 73, 76), 1.4, 5000, 2), f0, gain=0.3)
for i, m in enumerate([81, 85, 88, 93]):
    n = int(0.9 * mod.SR); tt = np.arange(n) / mod.SR
    T.add(np.sin(2 * np.pi * note(m) * tt) * mod.env(n, 0.002, 4), f0 + 0.06 * i, pan=(-0.5, 0.5, -0.2, 0.2)[i], gain=0.07)
T.write(sys.argv[1], fade=0.5)
print('Treffer bei', round(hit, 2), 's, Groove ab', round(g0, 2), 's, Schluss bei', round(f0, 2), 's')
