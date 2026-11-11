#!/bin/bash
# Ohne Desktop: zeigt das Quiz mit "cage" im Vollbild (gestartet beim Auto-Login auf dem Fernseher).
# Stürzt der Browser ab, startet er neu. Nach 5 Abstürzen in Folge bleibt die Konsole offen.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG=/tmp/quizabend-kiosk.log

# Unsichtbarer Mauszeiger: sonst zeichnet cage den Standard-Pfeil dauerhaft ins Bild
[ -d "$HOME/.icons/quizabend-blank" ] || python3 "$DIR/raspberry-pi/blank-cursor.py" >>"$LOG" 2>&1
export XCURSOR_THEME=quizabend-blank XCURSOR_SIZE=24 XCURSOR_PATH="$HOME/.icons:/usr/share/icons"

# Ton über HDMI zum Fernseher: Der Pi wählt sonst oft die Klinkenbuchse.
# HDMI-Ausgang als Standard setzen, laut stellen und Stummschaltung aufheben (PipeWire/wpctl).
hdmi_sink_id() {
  wpctl status 2>/dev/null | sed -n '/Sinks:/,/Sources:/p' | grep -i 'hdmi' | grep -oE '[0-9]+\.' | head -1 | tr -d .
}
hdmi_audio() {
  # HDMI-Soundkarte des Pi suchen (z. B. "vc4hdmi" oder "vc4hdmi0")
  local card
  card=$(aplay -l 2>/dev/null | grep -i 'hdmi' | sed -n 's/^card [0-9]*: \([^ ]*\) .*/\1/p' | head -1)
  echo "Ton: HDMI-Karte laut ALSA: ${card:-keine}" >>"$LOG"
  command -v wpctl >/dev/null || { echo "Ton: wpctl fehlt" >>"$LOG"; return; }
  for _ in $(seq 1 15); do wpctl status >/dev/null 2>&1 && break; sleep 1; done
  local id
  id=$(hdmi_sink_id)
  # 1) Kennt PipeWire den HDMI-Ausgang nicht, legen wir ihn selbst an
  if [ -z "$id" ] && [ -n "$card" ] && command -v pactl >/dev/null; then
    pactl load-module module-alsa-sink device="hdmi:CARD=$card,DEV=0" sink_name=quizabend_hdmi \
      sink_properties=device.description=HDMI-Fernseher >>"$LOG" 2>&1
    sleep 1; id=$(hdmi_sink_id)
  fi
  if [ -n "$id" ]; then
    wpctl set-default "$id"; wpctl set-mute "$id" 0; wpctl set-volume "$id" 1.0
    echo "Ton: HDMI-Ausgang $id als Standard gesetzt" >>"$LOG"
  elif [ -n "$card" ]; then
    # 2) Notlösung: Chromium spielt direkt auf die HDMI-Hardware (wie speaker-test)
    export QUIZ_ALSA_DEVICE="hdmi:CARD=$card,DEV=0"
    echo "Ton: Chromium nutzt direkt $QUIZ_ALSA_DEVICE" >>"$LOG"
  else
    echo "Ton: kein HDMI-Ausgang gefunden" >>"$LOG"; wpctl status >>"$LOG" 2>&1
  fi
}
hdmi_audio
fails=0
while [ $fails -lt 5 ]; do
  start=$(date +%s)
  echo "--- $(date) cage-Start" >>"$LOG"
  cage -- "$DIR/raspberry-pi/kiosk.sh" >>"$LOG" 2>&1
  # lief es länger als eine Minute, zählt es nicht als Fehlstart
  if [ $(( $(date +%s) - start )) -gt 60 ]; then fails=0; else fails=$((fails + 1)); fi
  sleep 2
done
echo
echo "QuizAbend konnte nicht starten. Details:  tail $LOG"
echo "Neu versuchen:  $DIR/raspberry-pi/kiosk-cage.sh"
