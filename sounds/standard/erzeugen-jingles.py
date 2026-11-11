# Erzeugt die kurzen Jingles (selbst komponiert, frei nutzbar), passend zu Intro und Pausenmusik:
#   block-start.mp3   Ansage eines neuen Frageblocks (4,5 s)
#   aufloesung.mp3    Auflösung einer Frage (ersetzt den alten Gong)
#   siegerehrung.mp3  Siegerpodest (ersetzt die alte Fanfare)
#   rangliste.mp3     Rangliste am Blockende (passt zum Balken-Aufbau und Einsortieren)
#   spezialfrage.mp3  Alarm, wenn die Spezialfrage eingeblendet wird
# Aufruf: python3 erzeugen-jingles.py /tmp/out  (schreibt WAVs), dann z. B.
#   for f in block-start aufloesung siegerehrung rangliste spezialfrage; do ffmpeg -i /tmp/out/$f.wav -b:a 128k $f.mp3; done
import numpy as np, scipy.signal as sg, scipy.io.wavfile as wf, sys, os
SR = 44100; BPM = 128; BAR = 240 / BPM; E8 = BAR / 8; S16 = BAR / 16
note = lambda m: 440 * 2 ** ((m - 69) / 12)

def lp(x, fc, o=2): b, a = sg.butter(o, min(fc, SR/2 - 100) / (SR/2)); return sg.lfilter(b, a, x)
def hp(x, fc, o=2): b, a = sg.butter(o, fc / (SR/2), 'high'); return sg.lfilter(b, a, x)
def env(n, a=0.005, k=6.0, d=None):
    tt = np.arange(n) / SR; e = np.minimum(1, tt / a) if a else np.ones(n)
    return e * np.exp(-k * tt) if d is None else e * np.clip(1 - tt / d, 0, 1)
def saw(f, n, detune=(0,)):
    tt = np.arange(n) / SR
    return sum(2 * ((tt * f * (1 + d)) % 1) - 1 for d in detune) / len(detune)

class Track:
    def __init__(self, dur, seed):
        self.N = int(dur * SR); self.L = np.zeros(self.N); self.R = np.zeros(self.N); self.rng = np.random.default_rng(seed)
    def add(self, sig, start, pan=0.0, gain=1.0):
        i = int(round(start * SR)); n = min(len(sig), self.N - i)
        if n <= 0: return
        self.L[i:i+n] += sig[:n] * gain * (1 - max(0, pan)); self.R[i:i+n] += sig[:n] * gain * (1 + min(0, pan))
    def noise(self, n): return self.rng.standard_normal(n)
    # --- Klangbausteine (gleich wie Intro/Pause) ---
    def tick(self, hi):
        n = int(0.03 * SR); s = hp(self.noise(n), 3500) * env(n, 0.0005, 180)
        return s * 0.5 + np.sin(2*np.pi*(2400 if hi else 1900)*np.arange(n)/SR) * env(n, 0.0005, 120) * 0.5
    def kick(self):
        n = int(0.35 * SR); tt = np.arange(n) / SR
        f = 50 + 110 * np.exp(-tt * 35); return np.tanh(np.sin(2*np.pi*np.cumsum(f)/SR) * env(n, 0.001, 8) * 1.8)
    def hat(self, open_=False):
        n = int((0.12 if open_ else 0.05) * SR); return hp(self.noise(n), 7000) * env(n, 0.0005, 30 if open_ else 90)
    def snare(self):
        n = int(0.2 * SR); tt = np.arange(n) / SR
        return np.sin(2*np.pi*190*tt) * env(n, 0.001, 30) * 0.5 + hp(self.noise(n), 1500) * env(n, 0.001, 18) * 0.7
    def clap(self):
        n = int(0.25 * SR); x = hp(lp(self.noise(n), 6000), 900); e = np.zeros(n)
        for o in (0, 0.011, 0.022): i = int(o * SR); e[i:] += env(n - i, 0.0005, 25 if o else 60)
        return x * e * 0.6
    def boom(self, gain, notes, length=2.0, k=3.0):
        n = int(length * SR); tt = np.arange(n) / SR
        f = 42 + 120 * np.exp(-tt * 18); low = np.tanh(np.sin(2*np.pi*np.cumsum(f)/SR) * 2) * env(n, 0.001, k)
        met = sum(np.sin(2*np.pi*note(m)*tt) for m in notes) / len(notes) * env(n, 0.002, k + 0.5)
        return (low * 0.9 + met * 0.3 + hp(self.noise(n), 2000) * env(n, 0.0005, 40) * 0.25) * gain
    def stab(self, notes, length, cutoff=3500, k=1.4):
        n = int(length * SR); s = sum(saw(note(m), n, (-0.005, 0, 0.005)) for m in notes) / len(notes)
        return lp(s, cutoff) * env(n, 0.004, k)
    def pad(self, notes, length, cutoff):
        n = int(length * SR); tt = np.arange(n) / SR
        s = sum(saw(note(m), n, (-0.006, 0.006)) for m in notes) / len(notes)
        return lp(s, cutoff) * np.minimum(1, tt / 0.08) * np.minimum(1, (length - tt) / 0.08)
    def arp_note(self, m, length):
        n = int(length * SR); return lp(saw(note(m), n, (-0.003, 0.003)), 3200) * env(n, 0.004, d=length)
    def bass(self, m, length):
        n = int(length * SR); e = env(n, 0.003, d=length)
        return lp(saw(note(m), n, (0, 0.004)), 700) * e + np.sin(2*np.pi*note(m - 12)*np.arange(n)/SR) * e * 0.7
    def lead(self, m, length):
        n = int(length * SR); tt = np.arange(n) / SR
        vib = 1 + 0.004 * np.sin(2*np.pi*5.5*tt) * np.minimum(1, tt / 0.15)
        s = lp(2 * ((np.cumsum(note(m) * vib) / SR) % 1) - 1, 5000) * env(n, 0.01, d=length * 1.05)
        return s + np.sin(2*np.pi*np.cumsum(note(m + 12) * vib)/SR) * env(n, 0.01, d=length) * 0.3
    def riser(self, length, top=8000):
        n = int(length * SR); tt = np.arange(n) / SR; x = self.noise(n); out = np.zeros(n)
        for a in range(0, n, 1024): out[a:a+1024] = hp(x[a:a+1024], 500 + top * (a / n) ** 2, 1)
        return out * (tt / tt[-1]) ** 2 + np.sin(2*np.pi*np.cumsum(300 + 1500 * (tt / tt[-1]) ** 2)/SR) * (tt / tt[-1]) ** 2 * 0.3
    def write(self, path, fade=0.3, peak=0.89):
        rng = np.random.default_rng(3); ir_n = int(1.3 * SR)
        ir = lp(rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR * 4.8), 5000) * 0.02
        L = self.L + sg.fftconvolve(self.L, ir)[:self.N] * 0.8; R = self.R + sg.fftconvolve(self.R, ir[::-1].copy())[:self.N] * 0.8
        mix = np.tanh(np.stack([L, R], 1) * 1.1)
        f = int(fade * SR); mix[-f:] *= np.linspace(1, 0, f)[:, None]
        mix *= peak / np.abs(mix).max()
        wf.write(path, SR, (mix * 32767).astype(np.int16))

A, D, E_ = (57, 61, 64), (57, 62, 66), (56, 59, 64)
ARP = [0, 2, 1, 2, 3, 2, 1, 2]
def arp(T, t0, tri, steps=16, gain=0.075):
    for k in range(steps):
        m = (tri + (tri[0] + 12,))[ARP[k % 8]]; T.add(T.arp_note(m, S16 * 0.95), t0 + k * S16, pan=-0.3 if k % 2 else 0.3, gain=gain)

out = sys.argv[1]; os.makedirs(out, exist_ok=True)

# ---------- Block-Start: 1 Takt Groove in A, 1 Takt Aufbau D -> E, Schlag auf A ----------
T = Track(4.5, 21)
for k in range(8): T.add(T.tick(k % 2 == 0), k * E8, pan=0.35 if k % 2 else -0.35, gain=0.13)
for q in range(4): T.add(T.kick(), q * BAR / 4, gain=0.5); T.add(T.hat(q % 2 == 1), q * BAR / 4 + E8, pan=0.25, gain=0.09)
for q in (1, 3, 5, 7): T.add(T.bass(45, E8 * 0.9), q * E8, gain=0.3)
T.add(T.pad(A, BAR, 2000), 0, gain=0.09); arp(T, 0, A)
t0 = BAR
T.add(T.pad(D, BAR / 2, 2600), t0, gain=0.1); T.add(T.pad(E_, BAR / 2, 3200), t0 + BAR / 2, gain=0.11)
arp(T, t0, D, steps=8, gain=0.08); arp(T, t0 + BAR / 2, E_, steps=8, gain=0.085)
for q in (1, 3): T.add(T.bass(38, E8 * 0.9), t0 + q * E8, gain=0.3)
for q in (5, 7): T.add(T.bass(40, E8 * 0.9), t0 + q * E8, gain=0.3)
for k in range(4): T.add(T.snare(), t0 + k * E8, gain=0.12 + 0.02 * k)
for k in range(4): T.add(T.snare(), t0 + BAR / 2 + k * S16, gain=0.18 + 0.03 * k)
for k in range(8): T.add(T.snare(), t0 + BAR * 0.75 + k * S16 / 2, gain=0.25 + 0.03 * k)
T.add(T.riser(BAR), t0, gain=0.18)
T.add(T.boom(0.8, (57, 64, 69, 73, 76), 0.75 + 0.05, 4), 2 * BAR)
T.add(T.stab((45, 57, 61, 64, 69, 73), 0.8, 4000, 3), 2 * BAR, gain=0.33)
T.write(f'{out}/block-start.wav', fade=0.35)

# ---------- Auflösung: kurzer, satter Treffer + aufsteigendes Glitzern (Schlag sitzt bei 0) ----------
T = Track(1.6, 22)
T.add(T.boom(0.75, (69, 73, 76), 1.6, 4.5), 0)
T.add(T.stab((57, 61, 64, 69, 71, 76), 1.2, 4500, 3.2), 0, gain=0.38)
T.add(T.clap(), 0, gain=0.3)
for k, m in enumerate((76, 81, 85, 88)):
    n = int(0.6 * SR); s = np.sin(2*np.pi*note(m)*np.arange(n)/SR) * env(n, 0.003, 6)
    T.add(s, 0.06 + k * S16 * 0.8, pan=-0.45 + 0.3 * k, gain=0.1)
T.write(f'{out}/aufloesung.wav', fade=0.25, peak=0.8)

# ---------- Siegerehrung: Schlag, 3 Takte Fanfare (A - D - E) mit Groove, Wirbel, Schlussakkord ----------
T = Track(4 * BAR + 2.4, 23)
T.add(T.boom(0.85, (57, 64, 69, 73, 76), 2.0, 3), 0)
T.add(T.stab((45, 57, 61, 64, 69), 1.0, 4000, 3), 0, gain=0.3)
MEL = [[(0, 69, 1), (1, 69, 1), (2, 69, 1), (3, 76, 4), (7, 73, 1)],
       [(0, 74, 2), (2, 78, 2), (4, 81, 3), (7, 78, 1)],
       [(0, 80, 1), (1, 80, 1), (2, 80, 1), (3, 83, 3), (6, 80, 1), (7, 83, 1)]]
for b, (tri, root) in enumerate([(A, 45), (D, 38), (E_, 40)]):
    t0 = b * BAR
    T.add(T.pad(tri, BAR, 2600), t0, gain=0.1)
    for q in range(4): T.add(T.kick(), t0 + q * BAR / 4, gain=0.48); T.add(T.hat(q % 2 == 1), t0 + q * BAR / 4 + E8, pan=0.25, gain=0.09)
    for q in (1, 3): T.add(T.clap(), t0 + q * BAR / 4, gain=0.33)
    for q in (1, 3, 5, 7): T.add(T.bass(root, E8 * 0.9), t0 + q * E8, gain=0.3)
    arp(T, t0, tri, gain=0.06)
    for st, m, ln in MEL[b]:
        T.add(T.lead(m, ln * E8), t0 + st * E8, gain=0.16)
        T.add(T.lead(m - 12, ln * E8), t0 + st * E8, gain=0.07)       # Oktave drunter = "Blech"
t0 = 2 * BAR
for k in range(8): T.add(T.snare(), t0 + BAR * 0.75 + k * S16 / 2, gain=0.2 + 0.035 * k)
T.add(T.riser(BAR / 2), t0 + BAR / 2, gain=0.15)
t0 = 3 * BAR
T.add(T.boom(1.0, (57, 64, 69, 73, 76), 3.5, 2.2), t0)
T.add(T.stab((45, 57, 61, 64, 69, 73, 76), 4.0, 4200, 1.0), t0, gain=0.36)
T.add(T.lead(81, 2.2), t0, gain=0.14); T.add(T.lead(69, 2.2), t0, gain=0.07)
for k, m in enumerate((69, 73, 76, 81, 85)):
    n = int(0.7 * SR); T.add(np.sin(2*np.pi*note(m + 12)*np.arange(n)/SR) * env(n, 0.003, 5), t0 + 0.07 * k, pan=-0.4 + 0.2 * k, gain=0.08)
T.write(f'{out}/siegerehrung.wav', fade=0.6)

# ---------- Rangliste: Spannung (a-Moll, wie die Pausenmusik) solange die Balken wachsen,
# Schlag wenn der längste fertig ist (8,5 s), Whoosh beim Einsortieren, Auflösung in A-Dur (10,3 s) ----------
T = Track(13.0, 24)
GROW_END, SORT_START, SORT_END = 8.5, 9.0, 10.3
x = 0.0; i = 0
while x < GROW_END - 0.05:                                   # Achtel-Raster
    T.add(T.tick(i % 2 == 0), x, pan=0.35 if i % 2 else -0.35, gain=0.11 + 0.07 * x / GROW_END)
    m = 33 + (1 if x >= 6.0 else 0) + (1 if i % 8 == 6 else 0)          # Bass-Puls mit Halbton-Reibung, ab 6 s einen Halbton höher
    nn = int(0.22 * SR); s = lp(saw(note(m), nn, (0, 0.004)), 400 + 600 * x / GROW_END) * env(nn, 0.004, 11)
    s += np.sin(2*np.pi*note(m)*np.arange(nn)/SR) * env(nn, 0.004, 9) * 0.6
    T.add(s, x, gain=0.28 + 0.08 * x / GROW_END)
    if x >= 1.8 and i % 4 in (0, 1) and (i % 4 == 0 or x >= 4.5):        # Herzschlag
        T.add(T.kick(), x, gain=(0.35 + 0.15 * x / GROW_END) * (1 if i % 4 == 0 else 0.6))
    if x >= 3.6:                                             # Streicher-Ostinato (Moll), wie in der Pause
        for j in range(2):
            xx = x + j * S16; k = (2 * i + j) % 8
            mm = 57 + (1 if xx >= 6.0 else 0) + [0, 3, 7, 3, 12, 7, 3, 7][k]
            T.add(T.arp_note(mm, S16 * 0.95), xx, pan=-0.3 if k % 2 else 0.3, gain=0.05 + 0.04 * (xx - 3.6) / (GROW_END - 3.6))
    x += E8; i += 1
n = int(GROW_END * SR); tt = np.arange(n) / SR                      # dunkle Fläche, schwillt an
dr = sum(lp(saw(note(m), n, (-0.006, 0, 0.006)), 900) for m in (45, 52, 57)) / 3
T.add(dr * np.interp(tt, [0, 1, GROW_END - 0.3, GROW_END], [0, 0.08, 0.14, 0]), 0)
T.add(T.riser(2.5), GROW_END - 2.5, gain=0.16)
for k in range(8): T.add(T.snare(), GROW_END - 1.0 + k * 0.0625, gain=0.12 + 0.03 * k)
for k in range(16): T.add(T.snare(), GROW_END - 0.5 + k * 0.03125, gain=0.2 + 0.015 * k)
# Schlag: längster Balken fertig
T.add(T.boom(0.7, (57, 64, 69), 1.2, 4), GROW_END)
# Innehalten: hoher Tremolo-Ton
n = int((SORT_END - GROW_END) * SR); tt = np.arange(n) / SR
trem = lp(saw(note(76), n, (-0.003, 0.003)), 4000) * (0.6 + 0.4 * np.sin(2 * np.pi * 12 * tt))
T.add(trem * np.interp(tt, [0, 0.2, tt[-1] - 0.05, tt[-1]], [0, 0.08, 0.12, 0]), GROW_END)
# Whoosh beim Einsortieren
T.add(T.riser(SORT_END - SORT_START, 9000), SORT_START, gain=0.2)
# Auflösung in A-Dur
T.add(T.boom(0.9, (57, 64, 69, 73, 76), 2.6, 2.6), SORT_END)
T.add(T.stab((45, 57, 61, 64, 69, 73, 76), 2.7, 4200, 1.4), SORT_END, gain=0.34)
T.add(T.clap(), SORT_END, gain=0.3)
for k, m in enumerate((76, 81, 85, 88)):
    nn = int(0.7 * SR); T.add(np.sin(2*np.pi*note(m)*np.arange(nn)/SR) * env(nn, 0.003, 5), SORT_END + 0.06 + k * S16 * 0.8, pan=-0.45 + 0.3 * k, gain=0.1)
T.write(f'{out}/rangliste.wav', fade=0.5)

# ---------- Spezialfrage: Alarm im Stil der anderen Stücke (3,5 s, läuft mit der Einblendung) ----------
T = Track(3.5, 25)
T.add(T.boom(0.75, (57, 64, 69, 76), 1.4, 3.5), 0); T.add(T.clap(), 0, gain=0.35)
def alarm(m, length):                                   # heller „Klaxon“-Ton: Säge + Rechteck, schnelles Vibrato
    n = int(length * SR); tt = np.arange(n) / SR; f = note(m) * (1 + 0.012 * np.sin(2*np.pi*14*tt))
    ph_ = np.cumsum(f) / SR
    s = (2 * (ph_ % 1) - 1) * 0.6 + np.sign(np.sin(2*np.pi*ph_)) * 0.4
    return lp(s, 5500) * env(n, 0.004, d=length)
for k in range(16):                                     # 2 Takte lang: A5 / E5 im Wechsel, Sechzehntel
    t = k * S16 * 1.0
    if t >= 1.75: break
    T.add(alarm(81 if k % 2 == 0 else 76, S16 * 0.9), t, pan=-0.25 if k % 2 else 0.25, gain=0.11 + 0.05 * (k % 4 == 0))
for q in range(4): T.add(T.kick(), q * BAR / 4, gain=0.5)
for q in (1, 3): T.add(T.clap(), q * BAR / 4, gain=0.3)
for q in (1, 3, 5, 7): T.add(T.bass(45, E8 * 0.9), q * E8, gain=0.3)
n = int(1.8 * SR); tt = np.arange(n) / SR                # Sirene im Hintergrund (zweimal hoch und runter)
T.add(np.sin(2*np.pi*np.cumsum(700 + 500 * (0.5 - 0.5 * np.cos(2*np.pi*tt / 0.9))) / SR) * np.interp(tt, [0, .1, 1.6, 1.8], [0, .5, .5, 0]), 0, gain=0.07)
T.add(T.pad((57, 61, 64), BAR, 2600), 0, gain=0.08)
for k in range(8): T.add(T.snare(), BAR + k * S16 / 2, gain=0.15 + 0.03 * k)   # Wirbel
T.add(T.riser(0.5, 9000), BAR - 0.05, gain=0.15)
t0 = BAR + 0.47                                         # Schlussakkord
T.add(T.boom(0.85, (57, 64, 69, 73, 76), 1.2, 3), t0)
T.add(T.stab((45, 57, 61, 64, 69, 73, 76), 1.2, 4500, 2.5), t0, gain=0.33)
for k, m in enumerate((81, 85, 88, 93)):
    nn = int(0.5 * SR); T.add(np.sin(2*np.pi*note(m)*np.arange(nn)/SR) * env(nn, 0.003, 6), t0 + 0.05 + k * 0.06, pan=-0.45 + 0.3 * k, gain=0.09)
T.write(f'{out}/spezialfrage.wav', fade=0.35)
