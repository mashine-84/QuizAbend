# Erzeugt sounds/standard/pause-finale.mp3 (selbst komponiert, frei nutzbar):
#   python3 erzeugen.py /tmp/pf.wav && ffmpeg -i /tmp/pf.wav -b:a 128k pause-finale.mp3
import numpy as np, scipy.signal as sg, scipy.io.wavfile as wf, sys
SR = 44100; DUR = 60.0; N = int(SR * DUR)
t = np.arange(N) / SR
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)

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

# Tempo 112 -> 148 BPM, Achtel-Raster durch Integration
bpm = lambda x: 112 + 36 * (x / DUR) ** 1.4
grid = []; x = 0.0
while x < 55.0:
    grid.append(x); x += 60 / bpm(x) / 2
# Tonart steigt: a-Moll, ab 34 s b-Moll, ab 46 s h-Moll
shift = lambda x: 0 if x < 34 else (1 if x < 46 else 2)

# 1) Uhrticken (jede Achtel, betonte Viertel)
for i, x in enumerate(grid):
    n = int(0.03 * SR); s = hp(rng.standard_normal(n), 3500) * env(n, 0.0005, k=180)
    tone = np.sin(2*np.pi*(2400 if i % 2 == 0 else 1900)*np.arange(n)/SR) * env(n, 0.0005, k=120)
    add((s * 0.5 + tone * 0.5), x, pan=0.35 if i % 2 else -0.35, gain=lin(x, 0, 55, 0.10, 0.17) * (1.25 if i % 2 == 0 else 0.8))

# 2) Bass-Puls (Achtel), Muster mit Halbton-Reibung
pat = [0, 0, 0, 0, 0, 0, 1, 0]
for i, x in enumerate(grid):
    if x < 0.5: continue
    m = 33 + shift(x) + pat[i % 8]
    n = int(0.22 * SR); s = lp(saw(note(m), n, (0, 0.004)), lin(x, 0, 55, 350, 900)) * env(n, 0.004, k=11)
    s += np.sin(2*np.pi*note(m)*np.arange(n)/SR) * env(n, 0.004, k=9) * 0.6
    add(s, x, gain=lin(x, 0, 5, 0.15, 0.34))

# 3) Herzschlag-Kick (ab 14 s, auf 1 und kurz danach)
for i, x in enumerate(grid):
    if x < 14 or i % 4 not in (0, 1) or (i % 4 == 1 and x < 30): continue
    n = int(0.4 * SR); tt = np.arange(n) / SR
    f = 48 + 90 * np.exp(-tt * 30); s = np.sin(2*np.pi*np.cumsum(f)/SR) * env(n, 0.001, k=9)
    add(np.tanh(s * 1.6), x, gain=lin(x, 14, 50, 0.35, 0.55) * (1 if i % 4 == 0 else 0.6))

# 4) Streicher-Ostinato (Sechzehntel) ab 22 s
arp = [0, 3, 7, 3, 12, 7, 3, 7]
for i, x in enumerate(grid):
    if x < 22: continue
    step = 60 / bpm(x) / 4
    for j in range(2):
        xx = x + j * step; k = (2 * i + j) % 8
        m = 57 + shift(xx) + arp[k]
        n = int(step * 0.95 * SR); s = lp(saw(note(m), n, (-0.003, 0.003)), lin(xx, 22, 55, 1400, 3200)) * env(n, 0.006, d=step * 0.95)
        add(s, xx, pan=-0.3 if k % 2 else 0.3, gain=lin(xx, 22, 30, 0.0, 0.11) * (1.2 if k == 0 else 1))

# 5) Flächen-Drone (Grundton + Quinte, schwellend)
for start, end, sh in ((0, 34, 0), (34, 46, 1), (46, 60, 2)):
    n = int((end - start) * SR); tt = np.arange(n) / SR
    s = sum(lp(saw(note(m + sh), n, (-0.006, 0, 0.006)), 900) for m in (45, 52, 57)) / 3
    e = np.minimum(1, tt / 1.5) * np.minimum(1, (n / SR - tt) / 0.3 + 0.0)
    trem = 0.75 + 0.25 * np.sin(2 * np.pi * 0.25 * (tt + start))
    lv = np.interp(tt + start, [0, 10, 40, 55, 60], [0.1, 0.12, 0.13, 0.16, 0.0])
    add(s * e * trem * lv, start)

# 6) Hohe Violine (Tremolo-Ton, ab 40 s, steigt)
n = int(15 * SR); tt = np.arange(n) / SR
f = note(81) * 2 ** (np.clip(tt - 3, 0, None) / 12 * 1.0)
s = lp(2 * ((np.cumsum(f) / SR) % 1) - 1, 4000) * (0.6 + 0.4 * np.sin(2 * np.pi * 9 * tt)) * np.minimum(1, tt / 3)
add(s * np.interp(tt, [0, 12, 15], [0.0, 0.09, 0.0]), 40)

# 7) Riser (Rauschen + Sinus-Sweep) 49 - 55 s
n = int(6 * SR); tt = np.arange(n) / SR
noise = rng.standard_normal(n); ns = np.zeros(n)
for a in range(0, n, 2048):
    fc = 400 + 7000 * (a / n) ** 2; ns[a:a+2048] = hp(noise[a:a+2048], fc, 1)
sw = np.sin(2 * np.pi * np.cumsum(200 + 1400 * (tt / 6) ** 2) / SR)
add((ns * 0.6 + sw * 0.4) * (tt / 6) ** 2, 49, gain=0.22)

# 8) Letzte 5 Sekunden: ein Schlag pro Sekunde (passt zum Countdown), dann Final-Schlag
def boom(gain, high):
    n = int(1.6 * SR); tt = np.arange(n) / SR
    f = 42 + 120 * np.exp(-tt * 18); low = np.tanh(np.sin(2*np.pi*np.cumsum(f)/SR) * 2) * env(n, 0.001, k=3.2)
    met = sum(np.sin(2*np.pi*note(m)*tt) for m in high) / len(high) * env(n, 0.002, k=4.5)
    hit = hp(rng.standard_normal(n), 2000) * env(n, 0.0005, k=40)
    return (low * 0.9 + met * 0.35 + hit * 0.25) * gain
for k, sec in enumerate(range(55, 59)):
    add(boom(0.42 + k * 0.06, (69 + 2 + k, 76 + 2 + k)), sec)
add(boom(0.85, (59, 66, 71, 74)), 59.0)

# Hall
ir_n = int(1.4 * SR); ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR * 4.5); ir = lp(ir, 5000) * 0.02
L = L + sg.fftconvolve(L, ir)[:N] * 0.9; R = R + sg.fftconvolve(R, ir[::-1].copy())[:N] * 0.9
mix = np.stack([L, R], 1); mix = np.tanh(mix * 1.15)
mix[-int(0.25 * SR):] *= np.linspace(1, 0, int(0.25 * SR))[:, None]
mix *= 0.89 / np.abs(mix).max()
wf.write(sys.argv[1], SR, (mix * 32767).astype(np.int16))
