#!/bin/bash
# QuizAbend auf dem Raspberry Pi einrichten:
#  - installiert Node.js und Chromium
#  - startet den Quiz-Server automatisch beim Hochfahren (systemd)
#  - öffnet nach dem Login die TV-Ansicht im Vollbild (Kiosk)
#
# Aufruf (ohne sudo):
#   ./raspberry-pi/setup.sh                 mit Desktop: Quiz startet nach dem Desktop-Login
#   ./raspberry-pi/setup.sh --ohne-desktop  ohne Desktop: Pi bootet direkt ins Quiz (empfohlen für Pi 3)
#   zusätzlich --720p                       Fernseher mit 1280x720 ansteuern (deutlich flüssiger auf Pi 3)
# Zurück zum Desktop bzw. zu voller Auflösung: einfach ohne die Option erneut ausführen.
set -e

MODE=desktop
RES=""
for arg in "$@"; do
  case "$arg" in
    --ohne-desktop|--no-desktop) MODE=kiosk ;;
    --mit-desktop) MODE=desktop ;;
    --720p) RES=720 ;;
    *) echo "Unbekannte Option: $arg  (erlaubt: --ohne-desktop, --720p)"; exit 1 ;;
  esac
done

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
sudo apt-get install -y "$CHR" fonts-noto-color-emoji   # Emoji-Schrift für die Spieler-Icons
sudo apt-get install -y unclutter >/dev/null 2>&1 || true   # versteckt den Mauszeiger (optional)
[ "$MODE" = kiosk ] && sudo apt-get install -y cage          # Mini-Anzeige ohne Desktop

# Chromium-Richtlinie: keine Übersetzungs-Leiste, keine Passwort-/Anmelde-Hinweise
sudo mkdir -p /etc/chromium/policies/managed
echo '{ "TranslateEnabled": false, "PasswordManagerEnabled": false, "BrowserSignin": 0, "PromotionsEnabled": false }' | \
  sudo tee /etc/chromium/policies/managed/quizabend.json >/dev/null

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
chmod +x "$KIOSK" "$DIR/raspberry-pi/check.sh" "$DIR/raspberry-pi/kiosk-cage.sh"
python3 "$DIR/raspberry-pi/blank-cursor.py" || true   # unsichtbarer Mauszeiger (nur für den Kiosk)
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

# Start ohne Desktop: Login-Skript der Textkonsole auf dem Fernseher (tty1) startet cage + Browser
PROFILE="$HOME/.profile"; [ -f "$HOME/.bash_profile" ] && PROFILE="$HOME/.bash_profile"
[ -f "$PROFILE" ] && sed -i '/# >>> QuizAbend/,/# <<< QuizAbend/d' "$PROFILE"
if [ "$MODE" = kiosk ]; then
  cat >> "$PROFILE" <<PROF
# >>> QuizAbend (von raspberry-pi/setup.sh, entfernen mit: setup.sh ohne Option)
if [ -z "\$SSH_CONNECTION" ] && [ "\$(tty)" = "/dev/tty1" ]; then
  "$DIR/raspberry-pi/kiosk-cage.sh"
fi
# <<< QuizAbend
PROF
fi

if command -v raspi-config >/dev/null; then
  if [ "$MODE" = kiosk ]; then
    echo "==> Ohne Desktop starten, automatisch in der Konsole anmelden …"
    sudo raspi-config nonint do_boot_behaviour B2 || true
  else
    echo "==> Automatisch in den Desktop einloggen …"
    sudo raspi-config nonint do_boot_behaviour B4 || true
  fi
  sudo raspi-config nonint do_blanking 1 || true   # Bildschirmschoner aus
elif [ "$MODE" = kiosk ]; then
  echo "==> Automatisch in der Konsole anmelden …"
  sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
  printf '[Service]\nExecStart=\nExecStart=-/sbin/agetty --autologin %s --noclear %%I $TERM\n' "$USER_NAME" | \
    sudo tee /etc/systemd/system/getty@tty1.service.d/autologin.conf >/dev/null
  sudo systemctl set-default multi-user.target
fi

# Auflösung: 720p entlastet den Pi 3 stark (die Ansicht skaliert automatisch mit)
CMD=/boot/firmware/cmdline.txt; [ -f "$CMD" ] || CMD=/boot/cmdline.txt
if [ -f "$CMD" ]; then
  [ -f "$CMD.vor-quizabend" ] || sudo cp "$CMD" "$CMD.vor-quizabend"
  sudo sed -i 's/ video=HDMI-A-1:1280x720@60//' "$CMD"
  if [ "$RES" = 720 ]; then
    echo "==> Fernseher auf 1280x720 einstellen …"
    sudo sed -i '1 s/$/ video=HDMI-A-1:1280x720@60/' "$CMD"
  fi
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "Fertig! Nach einem Neustart (sudo reboot) zeigt der Fernseher das Quiz."
[ "$MODE" = kiosk ] && echo "Modus: ohne Desktop. Zurück zum Desktop:  ./raspberry-pi/setup.sh  (ohne Option)"
echo "Klappt es nicht:  ./raspberry-pi/check.sh  ausführen und die Ausgabe weitergeben."
echo "Handys verbinden sich über den QR-Code oder http://${IP:-<IP-des-Pi>}:3000/"
