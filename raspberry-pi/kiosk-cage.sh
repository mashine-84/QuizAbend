#!/bin/bash
# Ohne Desktop: zeigt das Quiz mit "cage" im Vollbild (gestartet beim Auto-Login auf dem Fernseher).
# Stürzt der Browser ab, startet er neu. Nach 5 Abstürzen in Folge bleibt die Konsole offen.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG=/tmp/quizabend-kiosk.log
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
