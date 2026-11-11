# Erzeugt sounds/standard/quiz-intro.mp3 (selbst komponiert, frei nutzbar):
#   python3 erzeugen-intro.py /tmp/qi.wav && ffmpeg -i /tmp/qi.wav -b:a 128k quiz-intro.mp3
# 128 BPM, 12 Takte = 22,5 s (so lang ist das Intro im Spiel) + Ausklang.
# Gleiche Klangfarben wie die Pausenmusik (Uhrticken, Säge-Streicher, Schläge), aber in A-Dur und aufbauend.
import numpy as np, scipy.signal as sg, scipy.io.wavfile as wf, sys
SR = 44100; BPM = 128; BAR = 240 / BPM; E8 = BAR / 8; S16 = BAR / 16
DUR = 12 * BAR + 2.2; N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(11)

def add(sig, start, pan=0.0, gain=1.0):
    i = int(round(start * SR)); n = min(len(sig), N - i)
    if n <= 0: return
    L[i:i+n] += sig[:n] * gain * (1 - max(0, pan)); R[i:i+n] += sig[:n] * gain * (1 + min(0, pan))
def saw(f, n, detune=(0,)):
    tt = np.arange(n) / SR
    return sum(2 * ((tt * f * (1 + d)) % 1) - 1 for d in detune) / len(detune)
def lp(x, fc, o=2): b, a = sg.butter(o, min(fc, SR/2 - 100) / (SR/2)); return sg.lfilter(b, a, x)
def hp(x, fc, o=2): b, a = sg.butter(o, fc / (SR/2), 'high'); return sg.lfilter(b, a, x)
def env(n, a=0.005, k=6.0, d=None):
    tt = np.arange(n) / SR; e = np.minimum(1, tt / a) if a else np.ones(n)
    return e * np.exp(-k * tt) if d is None else e * np.clip(1 - tt / d, 0, 1)
note = lambda m: 440 * 2 ** ((m - 69) / 12)
bar = lambda b: b * BAR

CH = [(57, 61, 64), (56, 59, 64), (57, 61, 66), (57, 62, 66)]   # A  E/G#  F#m  D
ROOT = [45, 40, 42, 38]
def chord_of(b): return (b - 2) % 4

# --- Bausteine ---
def tick(hi):
    n = int(0.03 * SR); s = hp(rng.standard_normal(n), 3500) * env(n, 0.0005, 180)
    return s * 0.5 + np.sin(2*np.pi*(2400 if hi else 1900)*np.arange(n)/SR) * env(n, 0.0005, 120) * 0.5
def kick():
    n = int(0.35 * SR); tt = np.arange(n) / SR
    f = 50 + 110 * np.exp(-tt * 35); return np.tanh(np.sin(2*np.pi*np.cumsum(f)/SR) * env(n, 0.001, 8) * 1.8)
def hat(open_=False):
    n = int((0.12 if open_ else 0.05) * SR); return hp(rng.standard_normal(n), 7000) * env(n, 0.0005, 30 if open_ else 90)
def snare():
    n = int(0.2 * SR); tt = np.arange(n) / SR
    body = np.sin(2*np.pi*190*tt) * env(n, 0.001, 30)
    return body * 0.5 + hp(rng.standard_normal(n), 1500) * env(n, 0.001, 18) * 0.7
def clap():
    n = int(0.25 * SR); x = hp(lp(rng.standard_normal(n), 6000), 900); e = np.zeros(n)
    for o in (0, 0.011, 0.022): i = int(o * SR); e[i:] += env(n - i, 0.0005, 25 if o else 60)
    return x * e * 0.6
def boom(gain, notes):
    n = int(2.0 * SR); tt = np.arange(n) / SR
    f = 42 + 120 * np.exp(-tt * 18); low = np.tanh(np.sin(2*np.pi*np.cumsum(f)/SR) * 2) * env(n, 0.001, 3)
    met = sum(np.sin(2*np.pi*note(m)*tt) for m in notes) / len(notes) * env(n, 0.002, 3.5)
    return (low * 0.9 + met * 0.3 + hp(rng.standard_normal(n), 2000) * env(n, 0.0005, 40) * 0.25) * gain
def stab(notes, length, cutoff=3500):
    n = int(length * SR); s = sum(saw(note(m), n, (-0.005, 0, 0.005)) for m in notes) / len(notes)
    return lp(s, cutoff) * env(n, 0.004, 1.4)
def pad(notes, length, cutoff):
    n = int(length * SR); tt = np.arange(n) / SR
    s = sum(saw(note(m), n, (-0.006, 0.006)) for m in notes) / len(notes)
    return lp(s, cutoff) * np.minimum(1, tt / 0.08) * np.minimum(1, (length - tt) / 0.08)

# --- Takt 1-2: Uhrticken (wie in der Pause), Fläche öffnet sich, Riser ---
for k in range(16):
    t = k * E8; add(tick(k % 2 == 0), t, pan=0.35 if k % 2 else -0.35, gain=0.14 + 0.06 * k / 16)
n = int(2 * BAR * SR); tt = np.arange(n) / SR
sw = np.zeros(n); src = sum(saw(note(m), n, (-0.006, 0.006)) for m in (45, 57, 61, 64)) / 4
for a in range(0, n, 2048): sw[a:a+2048] = lp(src[a:a+2048], 300 + 3500 * (a / n) ** 2)
add(sw * np.minimum(1, tt / 0.5), 0, gain=0.2)
noise = rng.standard_normal(n); ns = np.zeros(n)
for a in range(0, n, 2048): ns[a:a+2048] = hp(noise[a:a+2048], 300 + 6000 * (a / n) ** 2, 1)
add(ns * (tt / tt[-1]) ** 3, 0, gain=0.12)
for k in range(8): add(snare(), bar(1.5) + k * S16, gain=0.12 + 0.05 * k)   # Auftakt-Wirbel

# --- Haupt-Groove Takt 3-10 ---
LEAD = {0: [(0, 76, 2), (2, 73, 1), (3, 76, 1), (4, 81, 2), (6, 76, 2)],
        1: [(0, 80, 2), (2, 76, 1), (3, 80, 1), (4, 83, 3), (7, 80, 1)],
        2: [(0, 81, 2), (2, 78, 1), (3, 81, 1), (4, 85, 2), (6, 81, 2)],
        3: [(0, 78, 2), (2, 81, 2), (4, 86, 3), (7, 85, 1)]}
ARP = [0, 2, 1, 2, 3, 2, 1, 2]
for b in range(2, 10):
    c = chord_of(b); t0 = bar(b); tri = CH[c]
    add(pad(tri, BAR, 1800 if b < 6 else 2600), t0, gain=0.09)
    for q in range(4): add(kick(), t0 + q * BAR / 4, gain=0.5)
    for q in range(4): add(hat(q % 2 == 1), t0 + q * BAR / 4 + E8, pan=0.25, gain=0.09)
    for q in range(8):                                  # Bass auf den Offbeats
        if q % 2 == 1:
            nn = int(E8 * 0.9 * SR); s = lp(saw(note(ROOT[c]), nn, (0, 0.004)), 700) * env(nn, 0.003, d=E8 * 0.9)
            s += np.sin(2*np.pi*note(ROOT[c] - 12)*np.arange(nn)/SR) * env(nn, 0.003, d=E8 * 0.9) * 0.7
            add(s, t0 + q * E8, gain=0.3)
    for k in range(16):                                 # Streicher-Arpeggio (wie Pause, jetzt Dur)
        i = ARP[k % 8]; m = (tri + (tri[0] + 12,))[i]
        nn = int(S16 * 0.95 * SR); s = lp(saw(note(m), nn, (-0.003, 0.003)), 3200) * env(nn, 0.004, d=S16 * 0.95)
        add(s, t0 + k * S16, pan=-0.3 if k % 2 else 0.3, gain=0.075)
    if b >= 6:
        for q in (1, 3): add(clap(), t0 + q * BAR / 4, gain=0.35)
        for st, m, ln in LEAD[c]:
            nn = int(ln * E8 * SR); tt2 = np.arange(nn) / SR
            vib = 1 + 0.004 * np.sin(2*np.pi*5.5*tt2) * np.minimum(1, tt2 / 0.15)
            s = lp(2 * ((np.cumsum(note(m) * vib) / SR) % 1) - 1, 5000) * env(nn, 0.01, d=ln * E8 * 1.05)
            s += np.sin(2*np.pi*np.cumsum(note(m + 12) * vib)/SR) * env(nn, 0.01, d=ln * E8) * 0.3
            add(s, t0 + st * E8, gain=0.13)
# Schläge an den Folienwechseln (Takt 3 und 7)
add(boom(0.55, (69, 73, 76)), bar(2)); add(boom(0.45, (69, 73, 76, 81)), bar(6))

# --- Takt 11: Aufbau (D -> E), Wirbel wird schneller, Riser ---
t0 = bar(10)
add(pad((57, 62, 66), BAR / 2, 3000), t0, gain=0.11); add(pad((59, 64, 68), BAR / 2, 3500), t0 + BAR / 2, gain=0.12)
for k in range(4): add(snare(), t0 + k * E8, gain=0.12 + 0.02 * k)                    # Achtel
for k in range(4): add(snare(), t0 + BAR / 2 + k * S16, gain=0.18 + 0.03 * k)        # Sechzehntel
for k in range(8): add(snare(), t0 + BAR * 0.75 + k * S16 / 2, gain=0.25 + 0.03 * k) # Zweiunddreißigstel
for k in range(4): add(kick(), t0 + k * BAR / 4, gain=0.45)
n = int(BAR * SR); tt = np.arange(n) / SR; noise = rng.standard_normal(n); ns = np.zeros(n)
for a in range(0, n, 1024): ns[a:a+1024] = hp(noise[a:a+1024], 500 + 8000 * (a / n) ** 2, 1)
add(ns * (tt / tt[-1]) ** 2 + np.sin(2*np.pi*np.cumsum(300 + 1500 * (tt / tt[-1]) ** 2)/SR) * (tt / tt[-1]) ** 2 * 0.3, t0, gain=0.2)

# --- Takt 12: großer Schlussakkord (A-Dur) mit Ausklang ---
t0 = bar(11)
add(boom(0.9, (57, 64, 69, 73, 76)), t0)
add(stab((45, 57, 61, 64, 69, 73, 76), 3.6, 4000), t0, gain=0.35)
n = int(3.6 * SR); tt = np.arange(n) / SR
add(np.sin(2*np.pi*note(88)*tt) * np.exp(-tt * 1.5) * np.minimum(1, tt / 0.01), t0, gain=0.06)  # Glitzer
for k, m in enumerate((69, 73, 76, 81)):                                                     # Aufwärts-Lauf
    nn = int(0.5 * SR); add(np.sin(2*np.pi*note(m + 12)*np.arange(nn)/SR) * env(nn, 0.003, 6), t0 + 0.08 * k, pan=-0.4 + 0.27 * k, gain=0.08)

# Hall + Master
ir_n = int(1.3 * SR); ir = lp(rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR * 4.8), 5000) * 0.02
L = L + sg.fftconvolve(L, ir)[:N] * 0.8; R = R + sg.fftconvolve(R, ir[::-1].copy())[:N] * 0.8
mix = np.tanh(np.stack([L, R], 1) * 1.1)
mix[-int(0.4 * SR):] *= np.linspace(1, 0, int(0.4 * SR))[:, None]
mix *= 0.89 / np.abs(mix).max()
wf.write(sys.argv[1], SR, (mix * 32767).astype(np.int16))
