#!/bin/bash
# Diagnose für den QuizAbend-Autostart. Ausgabe einfach kopieren und weitergeben.
echo "== System";   grep PRETTY_NAME /etc/os-release; uname -m
echo "== Server";   systemctl is-active quizabend; curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3000/tv || echo "nicht erreichbar"
journalctl -u quizabend -n 8 --no-pager 2>/dev/null
echo "== Sitzung";  echo "Typ=${XDG_SESSION_TYPE:-?} Desktop=${XDG_CURRENT_DESKTOP:-?}"; pgrep -l 'labwc|wayfire|lxsession|Xorg' || echo "kein Desktop gefunden"
echo "== Autologin"; systemctl get-default; grep -rh '^autologin-user' /etc/lightdm/ 2>/dev/null || echo "kein Desktop-Autologin"
echo "== Autostart"; ls ~/.config/autostart/ 2>/dev/null; grep -l quizabend ~/.config/labwc/autostart ~/.config/lxsession/LXDE-pi/autostart ~/.config/wayfire.ini 2>/dev/null
echo "== Browser";  command -v chromium chromium-browser || echo "Chromium fehlt"
echo "== Kiosk-Log"; tail -n 15 /tmp/quizabend-kiosk.log 2>/dev/null || echo "kein Log – kiosk.sh wurde nicht gestartet"
