#!/usr/bin/env python3
"""Erzeugt die Avatar-Bilder (public/avatare/<codepoint>.png) aus Noto Color Emoji.

Damit sehen die Spieler-Avatare auf Fernseher und Handy gleich aus (sonst zeichnet jedes Gerät Emojis
in seinem eigenen Stil: Samsung, Apple, Google …). Schrift: Noto Color Emoji (SIL Open Font License 1.1).
Aufruf: python3 public/avatare/erzeugen.py [Pfad zu NotoColorEmoji.ttf]
Die Liste muss zu AVATARS in server.js passen.
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🐵', '🦄', '🐧', '🐶', '🐱', '🐯', '🐨', '🐷', '🐮', '🐰', '🐻', '🐲', '🦉', '🐝', '🦖', '🐢', '🦀', '🐳', '🦩']
FONT = sys.argv[1] if len(sys.argv) > 1 else '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf'
OUT = os.path.dirname(os.path.abspath(__file__))
font = ImageFont.truetype(FONT, 109)   # Noto Color Emoji hat nur diese Bitmap-Größe
for e in AVATARS:
    im = Image.new('RGBA', (160, 160), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((80, 80), e, font=font, embedded_color=True, anchor='mm')
    im = im.crop(im.getbbox())
    s = max(im.size); q = Image.new('RGBA', (s, s), (0, 0, 0, 0)); q.paste(im, ((s - im.size[0]) // 2, (s - im.size[1]) // 2))
    q.resize((96, 96), Image.LANCZOS).save(os.path.join(OUT, '%x.png' % ord(e)), optimize=True)
print(len(AVATARS), 'Avatare erzeugt in', OUT)
