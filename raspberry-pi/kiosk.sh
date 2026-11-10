#!/bin/bash
# Öffnet die TV-Ansicht im Vollbild. Wird von setup.sh beim Login gestartet.

# Nur einmal starten (mehrere Autostart-Wege sind eingetragen) und mitprotokollieren
exec 9>/tmp/quizabend-kiosk.lock
flock -n 9 || exit 0
exec >>/tmp/quizabend-kiosk.log 2>&1
echo "--- $(date) Kiosk-Start (Sitzung: ${XDG_SESSION_TYPE:-?} ${XDG_CURRENT_DESKTOP:-?})"

# LITE=1: schonende Grafik (ohne Konfetti und Animationen), empfohlen für Pi 3.
# Auf Pi 4/5 kannst du LITE=0 probieren.
LITE=1

URL="http://localhost:3000/tv"
[ "$LITE" = "1" ] && URL="$URL?lite=1"

# Warten, bis der Server läuft
for _ in $(seq 1 60); do
  curl -s -o /dev/null "http://localhost:3000/tv" && break
  sleep 1
done

xset s off -dpms 2>/dev/null || true
command -v unclutter >/dev/null && unclutter -idle 1 -root &

BROWSER="$(command -v chromium || command -v chromium-browser)"
[ -z "$BROWSER" ] && { echo "Chromium nicht gefunden"; exit 1; }
echo "Starte $BROWSER $URL"
EXTRA=""
[ -n "$WAYLAND_DISPLAY" ] && EXTRA="--ozone-platform=wayland"
# shellcheck disable=SC2086
exec "$BROWSER" $EXTRA --kiosk --noerrdialogs --disable-infobars --no-first-run \
  --password-store=basic --disable-session-crashed-bubble \
  --check-for-update-interval=31536000 --disk-cache-dir=/tmp/quizabend-cache "$URL"
