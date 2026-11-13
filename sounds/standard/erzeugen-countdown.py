# Erzeugt sounds/standard/countdown.mp3 (selbst komponiert, frei nutzbar):
# die letzten 10 Sekunden einer Frage (+ 1,8 s Ausklang nach Ablauf der Zeit) – wie die Pausenmusik (Uhrticken, Bass-Puls, Streicher), nur zurückhaltender:
# kein Herzschlag-Kick, keine tiefen Schläge, leiser gemischt (Platz für den Auflösungs-Jingle danach).
#   python3 erzeugen-countdown.py /tmp/cd.wav && ffmpeg -i /tmp/cd.wav -b:a 128k countdown.mp3
import numpy as np, scipy.signal as sg, scipy.io.wavfile as wf, sys
SR = 44100; DUR = 10.0; TAIL = 1.8; N = int(SR * (DUR + TAIL))
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(11)

def add(sig, start, pan=0.0, gain=1.0):
    i = int(start * SR); n = min(len(sig), N - i)
    if n <= 0: return
    L[i:i+n] += sig[:n] * gain * (1 - max(0, pan)); R[i:i+n] += sig[:n] * gain * (1 + min(0, pan))
def saw(f, n, detune=(0,)):
    tt = np.arange(n) / SR; s = 0
    for d in detune: s = s + 2 * ((tt * f * (1 + d)) % 1) - 1
    return s / len(detune)
def lp(x, fc, order=2):
    b, a = sg.butter(order, min(fc, SR/2 - 100) / (SR/2)); return sg.lfilter(b, a, x)
def hp(x, fc, order=2):
    b, a = sg.butter(order, fc / (SR/2), 'high'); return sg.lfilter(b, a, x)
def env(n, a=0.005, d=None, k=6.0):
    tt = np.arange(n) / SR; e = np.minimum(1, tt / a) if a else np.ones(n)
    return e * np.exp(-k * tt) if d is None else e * np.clip(1 - tt / d, 0, 1)
def lin(x, x0, x1, y0, y1): return float(np.clip(y0 + (y1 - y0) * (x - x0) / (x1 - x0), min(y0, y1), max(y0, y1)))
note = lambda m: 440 * 2 ** ((m - 69) / 12)

# Tempo 120 -> 136 BPM, Achtel-Raster
bpm = lambda x: 120 + 16 * (x / DUR)
grid = []; x = 0.0
while x < DUR - 0.05:
    grid.append(x); x += 60 / bpm(x) / 2
# a-Moll, ab 5 s (wenn die Uhr rot wird) einen Halbton höher
shift = lambda x: 0 if x < 5 else 1

# 1) Uhrticken (jede Achtel, betonte Viertel)
for i, x in enumerate(grid):
    n = int(0.03 * SR); s = hp(rng.standard_normal(n), 3500) * env(n, 0.0005, k=180)
    tone = np.sin(2*np.pi*(2400 if i % 2 == 0 else 1900)*np.arange(n)/SR) * env(n, 0.0005, k=120)
    add(s * 0.5 + tone * 0.5, x, pan=0.35 if i % 2 else -0.35, gain=lin(x, 0, DUR, 0.10, 0.15) * (1.25 if i % 2 == 0 else 0.8))

# 2) Bass-Puls (Achtel), weich gefiltert
pat = [0, 0, 0, 0, 0, 0, 1, 0]
for i, x in enumerate(grid):
    m = 33 + shift(x) + pat[i % 8]
    n = int(0.2 * SR); s = lp(saw(note(m), n, (0, 0.004)), lin(x, 0, DUR, 300, 650)) * env(n, 0.004, k=12)
    s += np.sin(2*np.pi*note(m)*np.arange(n)/SR) * env(n, 0.004, k=10) * 0.5
    add(s, x, gain=lin(x, 0, 1.5, 0.08, 0.26))

# 3) Streicher-Ostinato (Sechzehntel) ab 3 s, wird heller
arp = [0, 3, 7, 3, 12, 7, 3, 7]
for i, x in enumerate(grid):
    if x < 3: continue
    step = 60 / bpm(x) / 4
    for j in range(2):
        xx = x + j * step; k = (2 * i + j) % 8
        m = 57 + shift(xx) + arp[k]
        n = int(step * 0.95 * SR); s = lp(saw(note(m), n, (-0.003, 0.003)), lin(xx, 3, DUR, 1200, 2600)) * env(n, 0.006, d=step * 0.95)
        add(s, xx, pan=-0.3 if k % 2 else 0.3, gain=lin(xx, 3, 6, 0.0, 0.08) * (1.2 if k == 0 else 1))

# 4) Fläche (Grundton + Quinte)
for start, end, sh in ((0, 5, 0), (5, DUR, 1)):
    n = int((end - start) * SR); tt = np.arange(n) / SR
    s = sum(lp(saw(note(m + sh), n, (-0.006, 0, 0.006)), 900) for m in (45, 52, 57)) / 3
    e = np.minimum(1, tt / 0.4) * np.minimum(1, (n / SR - tt) / (0.05 if end < DUR else 0.25))
    add(s * e * np.interp(tt + start, [0, 5, DUR], [0.06, 0.08, 0.10]), start)

# 5) Sanfter Riser in den letzten 3 Sekunden
n = int(3 * SR); tt = np.arange(n) / SR
noise = rng.standard_normal(n); ns = np.zeros(n)
for a in range(0, n, 2048):
    fc = 500 + 5000 * (a / n) ** 2; ns[a:a+2048] = hp(noise[a:a+2048], fc, 1)
sw = np.sin(2 * np.pi * np.cumsum(300 + 900 * (tt / 3) ** 2) / SR)
add((ns * 0.6 + sw * 0.4) * (tt / 3) ** 2 * np.minimum(1, (3 - tt) / 0.2), DUR - 3, gain=0.12)

# 6) Zeit vorbei: weicher Schlussakkord (b-Moll, wie die letzte Rückung), klingt aus statt abzubrechen
n = int(TAIL * SR); tt = np.arange(n) / SR
chord = sum(lp(saw(note(m), n, (-0.004, 0.004)), 1800) for m in (46, 58, 61, 65, 70)) / 5
bell = sum(np.sin(2*np.pi*note(m)*tt) for m in (82, 85, 89)) / 3
add(chord * np.minimum(1, tt / 0.01) * np.exp(-tt * 2.2) * 0.22 + bell * np.exp(-tt * 3.0) * 0.05, DUR)

# Lautstärke: leise anfangen und langsam steigern (Fade-in über 2 s, dann bis zum Ende anwachsen)
tt = np.arange(N) / SR
level = np.interp(tt, [0, 2, 5, 8, 9.9, DUR, DUR + TAIL], [0.0, 0.25, 0.45, 0.75, 1.0, 1.0, 1.0])
L *= level; R *= level

# Hall, sanft
ir_n = int(1.0 * SR); ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR * 5); ir = lp(ir, 5000) * 0.02
L = L + sg.fftconvolve(L, ir)[:N] * 0.8; R = R + sg.fftconvolve(R, ir[::-1].copy())[:N] * 0.8
mix = np.stack([L, R], 1)
mix[-int(0.3 * SR):] *= np.linspace(1, 0, int(0.3 * SR))[:, None]
mix *= 0.6 / np.abs(mix).max()          # bewusst leiser als die anderen Jingles: Reserve, kein Übersteuern
wf.write(sys.argv[1], SR, (mix * 32767).astype(np.int16))
