#!/usr/bin/env python3
"""Erzeugt ein unsichtbares Mauszeiger-Design ("quizabend-blank") für den Kiosk-Modus.

cage/wlroots zeichnet sonst den Standard-Mauszeiger dauerhaft in die Bildmitte.
Aufruf: python3 blank-cursor.py [Zielordner]   (Standard: ~/.icons)
"""
import os, struct, sys

NAMES = ["default", "left_ptr", "arrow", "top_left_arrow", "pointer", "hand1", "hand2", "text", "xterm",
         "wait", "watch", "progress", "left_ptr_watch", "crosshair", "cross", "grab", "grabbing", "move",
         "fleur", "not-allowed", "help", "question_arrow", "col-resize", "row-resize", "all-scroll"]

def xcursor(size=24):
    # Xcursor-Datei mit einem 1x1-Bild, vollständig transparent
    w = h = 1
    img = struct.pack("<9I", 36, 0xFFFD0002, size, 1, w, h, 0, 0, 0) + b"\x00\x00\x00\x00" * (w * h)
    header = struct.pack("<4sIII", b"Xcur", 16, 0x10000, 1)
    toc = struct.pack("<III", 0xFFFD0002, size, 16 + 12)
    return header + toc + img

def main():
    base = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.icons")
    theme = os.path.join(base, "quizabend-blank")
    cur = os.path.join(theme, "cursors")
    os.makedirs(cur, exist_ok=True)
    with open(os.path.join(theme, "index.theme"), "w") as f:
        f.write("[Icon Theme]\nName=quizabend-blank\nComment=Unsichtbarer Mauszeiger fuer QuizAbend\n")
    data = xcursor()
    for n in NAMES:
        with open(os.path.join(cur, n), "wb") as f:
            f.write(data)
    print("Unsichtbarer Mauszeiger angelegt:", theme)

if __name__ == "__main__":
    main()
