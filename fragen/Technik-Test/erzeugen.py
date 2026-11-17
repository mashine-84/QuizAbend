# Erzeugt die Testbilder für den Technik-Test (selbst gemacht, keine fremden Rechte).
# Aufruf: python3 fragen/Technik-Test/erzeugen.py
import math, os, random
from PIL import Image, ImageDraw, ImageFont

ORDNER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'bilder')
os.makedirs(ORDNER, exist_ok=True)
W, H, BG = 1280, 720, (24, 28, 40)

def schrift(gr):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf'):
        if os.path.exists(f): return ImageFont.truetype(f, gr)
    return ImageFont.load_default()

def titel(d, text):
    d.text((W // 2, 40), text, font=schrift(36), fill=(200, 200, 210), anchor='mt')

def stern(d, cx, cy, r, farbe):
    p = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rr = r if i % 2 == 0 else r * 0.42
        p.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    d.polygon(p, fill=farbe)

# Formen: 3 rote Kreise, 2 blaue Quadrate, 1 gelber Stern, 4 grüne Dreiecke
im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im); titel(d, 'TESTBILD · FORMEN')
for x in (180, 330, 480): d.ellipse((x - 55, 170, x + 55, 280), fill=(230, 70, 60))
for x in (760, 930): d.rectangle((x - 60, 160, x + 60, 280), fill=(60, 140, 240))
stern(d, 1120, 225, 80, (250, 205, 40))
for x in (240, 480, 720, 960):
    d.polygon([(x, 420), (x - 75, 560), (x + 75, 560)], fill=(80, 190, 80))
im.save(os.path.join(ORDNER, 'formen.png'))

# Punkte zum Schätzen (fester Zufall, damit die Zahl stimmt)
def punkte(name, n, seed, farbe):
    rnd = random.Random(seed)
    im = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(im); titel(d, 'TESTBILD · PUNKTE')
    pos = []
    while len(pos) < n:
        x, y = rnd.randint(90, W - 90), rnd.randint(120, H - 60)
        if all((x - a) ** 2 + (y - b) ** 2 > 70 ** 2 for a, b in pos): pos.append((x, y))
    for x, y in pos: d.ellipse((x - 18, y - 18, x + 18, y + 18), fill=farbe)
    im.save(os.path.join(ORDNER, name))
punkte('punkte-47.png', 47, 47, (240, 240, 240))
punkte('punkte-23.png', 23, 23, (250, 160, 40))

# Flagge Rot-Weiß-Rot (Österreich), selbst gezeichnet
im = Image.new('RGB', (900, 600), (237, 41, 57)); d = ImageDraw.Draw(im)
d.rectangle((0, 200, 900, 400), fill=(255, 255, 255))
im.save(os.path.join(ORDNER, 'flagge.png'))
print('Testbilder erzeugt in', ORDNER)
