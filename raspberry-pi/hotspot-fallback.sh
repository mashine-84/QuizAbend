#!/bin/bash
# Startet das eigene WLAN des Quiz, wenn der Pi nach dem Hochfahren kein bekanntes WLAN gefunden hat.
# Zu Hause verbindet sich der Pi also wie gewohnt mit deinem WLAN (Updates möglich),
# unterwegs macht er nach ca. 45 Sekunden ein eigenes WLAN auf (ohne Internet).
CON=QuizAbend-Hotspot
command -v nmcli >/dev/null || exit 0
nmcli -t -f NAME con show | grep -qx "$CON" || exit 0
for _ in $(seq 1 45); do
  state=$(nmcli -t -f DEVICE,TYPE,STATE dev 2>/dev/null | grep '^wlan0:wifi:' | cut -d: -f3)
  if [ "$state" = "connected" ]; then echo "WLAN verbunden – kein eigenes WLAN nötig"; exit 0; fi
  sleep 1
done
echo "Kein bekanntes WLAN gefunden – starte eigenes WLAN"
nmcli con up "$CON"
