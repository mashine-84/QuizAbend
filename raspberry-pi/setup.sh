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
KIOSK="$DIR/raspberry-pi/kiosk.sh"
chmod +x "$KIOSK" "$DIR/raspberry-pi/check.sh"
# Je nach Raspberry-Pi-OS-Version läuft ein anderer Desktop. Wir tragen uns überall ein;
# kiosk.sh sorgt selbst dafür, dass der Browser nur einmal startet.

# 1) Standard-Autostart (XDG)
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/quizabend-kiosk.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=QuizAbend Kiosk
Exec=$KIOSK
X-GNOME-Autostart-enabled=true
DESKTOP

# Hilfsfunktion: eigene Autostart-Datei anlegen (Systemvorlage übernehmen, damit Desktop und Leiste bleiben)
add_line() { # datei vorlage zeile
  mkdir -p "$(dirname "$1")"
  [ -f "$1" ] || { [ -f "$2" ] && cp "$2" "$1"; } || true
  grep -qF "quizabend" "$1" 2>/dev/null || echo "$3" >> "$1"
}

# 2) labwc (aktueller Standard-Desktop)
add_line "$HOME/.config/labwc/autostart" /etc/xdg/labwc/autostart "$KIOSK &"

# 3) LXDE / X11 (ältere Versionen, oft auf Pi 3)
add_line "$HOME/.config/lxsession/LXDE-pi/autostart" /etc/xdg/lxsession/LXDE-pi/autostart "@$KIOSK"

# 4) Wayfire (Bookworm 2023/24)
WF="$HOME/.config/wayfire.ini"
if [ -f "$WF" ] && ! grep -q quizabend "$WF"; then
  if grep -q '^\[autostart\]' "$WF"; then sed -i "/^\[autostart\]/a quizabend = $KIOSK" "$WF"
  else printf '\n[autostart]\nquizabend = %s\n' "$KIOSK" >> "$WF"; fi
fi

if command -v raspi-config >/dev/null; then
  echo "==> Automatisch in den Desktop einloggen, Bildschirmschoner aus …"
  sudo raspi-config nonint do_boot_behaviour B4 || true
  sudo raspi-config nonint do_blanking 1 || true
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "Fertig! Nach einem Neustart (sudo reboot) zeigt der Fernseher das Quiz."
echo "Klappt es nicht:  ./raspberry-pi/check.sh  ausführen und die Ausgabe weitergeben."
echo "Handys verbinden sich über den QR-Code oder http://${IP:-<IP-des-Pi>}:3000/"
