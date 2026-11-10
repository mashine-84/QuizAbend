#!/bin/bash
# QuizAbend auf dem Raspberry Pi einrichten:
#  - installiert Node.js und Chromium
#  - startet den Quiz-Server automatisch beim Hochfahren (systemd)
#  - öffnet nach dem Login die TV-Ansicht im Vollbild (Kiosk)
# Aufruf (ohne sudo):  ./raspberry-pi/setup.sh
set -e

DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="$(whoami)"

if [ "$EUID" -eq 0 ]; then
  echo "Bitte ohne sudo starten:  ./raspberry-pi/setup.sh"
  exit 1
fi

echo "==> Pakete installieren (dauert ein paar Minuten) …"
sudo apt-get update
sudo apt-get install -y nodejs curl
if apt-cache show chromium >/dev/null 2>&1; then CHR=chromium; else CHR=chromium-browser; fi
sudo apt-get install -y "$CHR"
sudo apt-get install -y unclutter >/dev/null 2>&1 || true   # versteckt den Mauszeiger (optional)

NODE_BIN="$(command -v node || command -v nodejs)"
if [ -z "$NODE_BIN" ]; then echo "Node.js konnte nicht installiert werden."; exit 1; fi
echo "    Node.js: $($NODE_BIN -v)"

echo "==> Server als Dienst einrichten …"
sudo tee /etc/systemd/system/quizabend.service >/dev/null <<UNIT
[Unit]
Description=QuizAbend Server
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$DIR
Environment=NO_BROWSER=1
ExecStart=$NODE_BIN $DIR/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now quizabend.service

echo "==> Vollbild-Browser beim Login starten …"
chmod +x "$DIR/raspberry-pi/kiosk.sh"
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/quizabend-kiosk.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=QuizAbend Kiosk
Exec=$DIR/raspberry-pi/kiosk.sh
X-GNOME-Autostart-enabled=true
DESKTOP

if command -v raspi-config >/dev/null; then
  echo "==> Automatisch in den Desktop einloggen, Bildschirmschoner aus …"
  sudo raspi-config nonint do_boot_behaviour B4 || true
  sudo raspi-config nonint do_blanking 1 || true
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "Fertig! Nach einem Neustart (sudo reboot) zeigt der Fernseher das Quiz."
echo "Handys verbinden sich über den QR-Code oder http://${IP:-<IP-des-Pi>}:3000/"
