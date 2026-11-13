#!/bin/bash
# Startet das eigene WLAN des Quiz, wenn der Pi nach dem Hochfahren kein bekanntes WLAN gefunden hat.
# Zu Hause verbindet sich der Pi also wie gewohnt mit deinem WLAN (Updates möglich),
# unterwegs macht er nach ca. 45 Sekunden ein eigenes WLAN auf (ohne Internet).
#
# Läuft als Dienst (root) beim Start. Schreibt ein Protokoll nach hotspot.log und den letzten Stand
# nach hotspot-status.json – beides zeigt das Handy des 👑 unter Systemeinstellungen › Eigenes WLAN.
# Liegt die Datei hotspot-test im Quiz-Ordner (Knopf „Testen“ am Handy), wird das eigene WLAN
# sofort für 3 Minuten gestartet, danach verbindet sich der Pi wieder mit dem Heim-WLAN.

DIR="$(cd "$(dirname "$0")/.." && pwd)"
CON=QuizAbend-Hotspot
LOG="$DIR/hotspot.log"
STATUS="$DIR/hotspot-status.json"
TEST_FLAG="$DIR/hotspot-test"
TEST_SECONDS=${TEST_SECONDS:-180}
WAIT_SECONDS=${WAIT_SECONDS:-45}

log() { echo "$*"; echo "$(date '+%d.%m. %H:%M:%S') $*" >> "$LOG"; }
status() {   # status <ergebnis> <text>
  RESULT="$1" DETAIL="$2" python3 -c 'import json,os,datetime
json.dump({"time": datetime.datetime.now().isoformat(timespec="seconds"), "result": os.environ["RESULT"], "detail": os.environ["DETAIL"]}, open(os.environ["OUT"], "w"), ensure_ascii=False)' 2>/dev/null
}
export OUT="$STATUS"
# Protokoll kurz halten
[ -f "$LOG" ] && tail -n 150 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
chmod 644 "$LOG" "$STATUS" 2>/dev/null

log "---- Start (Pi hochgefahren – Uhrzeit bis zur Internet-Verbindung evtl. ungenau) ----"
if ! command -v nmcli >/dev/null; then log "NetworkManager fehlt – kein eigenes WLAN möglich"; status fehler "NetworkManager (nmcli) fehlt"; exit 0; fi

TEST=0
if [ -f "$TEST_FLAG" ]; then TEST=1; rm -f "$TEST_FLAG"; log "Testmodus: eigenes WLAN wird sofort für $((TEST_SECONDS / 60)) Minuten gestartet"; fi

# Auf NetworkManager warten
for _ in $(seq 1 30); do nmcli -t general status >/dev/null 2>&1 && break; sleep 1; done

# Infos fürs Protokoll
log "WLAN-Gerät: $(nmcli -t -f DEVICE,TYPE,STATE dev 2>/dev/null | grep ':wifi:' | tr '\n' ' ')"
log "Ländercode: $(iw reg get 2>/dev/null | grep -m1 country | cut -d: -f1 | tr -d '\t')"
command -v dnsmasq >/dev/null || [ -x /usr/sbin/dnsmasq ] || log "Hinweis: dnsmasq nicht gefunden (wird für das eigene WLAN gebraucht)"
rfkill list wifi 2>/dev/null | grep -qi 'blocked: yes' && log "Hinweis: WLAN ist per rfkill blockiert" && rfkill unblock wifi

# Hotspot-Verbindung anlegen, falls sie fehlt (z. B. Setup nach dem Update nicht erneut ausgeführt)
if ! nmcli -t -f NAME con show | grep -qx "$CON"; then
  HS="$DIR/hotspot.json"
  if [ ! -f "$HS" ]; then
    PW=$(tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' </dev/urandom | head -c 10)
    printf '{ "ssid": "QuizAbend", "password": "%s" }\n' "$PW" > "$HS"
  fi
  SSID=$(python3 -c "import json;print(json.load(open('$HS'))['ssid'])")
  PW=$(python3 -c "import json;print(json.load(open('$HS'))['password'])")
  log "Hotspot-Verbindung fehlt – lege sie an (WLAN-Name $SSID)"
  if ! out=$(nmcli con add type wifi ifname wlan0 con-name "$CON" autoconnect no ssid "$SSID" \
      mode ap 802-11-wireless.band bg 802-11-wireless.channel 6 ipv4.method shared \
      wifi-sec.key-mgmt wpa-psk wifi-sec.proto rsn wifi-sec.pairwise ccmp wifi-sec.group ccmp wifi-sec.pmf disable wifi-sec.psk "$PW" 2>&1); then
    log "Anlegen fehlgeschlagen: $out"; status fehler "Hotspot konnte nicht angelegt werden: $out"; exit 1
  fi
fi

# Der WLAN-Chip des Pi kann im Hotspot-Betrieb kein PMF ("802.1X supplicant took too long to authenticate"),
# außerdem hilft ein fester Kanal. Gilt auch für Verbindungen, die eine ältere Version angelegt hat.
nmcli con modify "$CON" 802-11-wireless-security.pmf disable 802-11-wireless.band bg 802-11-wireless.channel 6 >/dev/null 2>&1 \
  || log "Hinweis: Hotspot-Einstellungen ließen sich nicht anpassen"

# Ist ein bekanntes WLAN in Reichweite? (bis zu 45 s warten)
if [ "$TEST" = 0 ]; then
  for i in $(seq 1 "$WAIT_SECONDS"); do
    state=$(nmcli -t -f DEVICE,TYPE,STATE dev 2>/dev/null | grep ':wifi:' | head -1 | cut -d: -f3)
    if [ "$state" = "connected" ]; then
      net=$(nmcli -t -f NAME,DEVICE con show --active 2>/dev/null | grep ':wlan0$' | cut -d: -f1)
      log "Mit WLAN „$net“ verbunden – kein eigenes WLAN nötig"; status heim "Mit WLAN „$net“ verbunden"; exit 0
    fi
    [ $((i % 15)) = 0 ] && log "Noch kein WLAN (Status: ${state:-unbekannt}) …"
    sleep 1
  done
  log "Kein bekanntes WLAN gefunden – starte eigenes WLAN"
fi

# Eigenes WLAN starten (mehrere Versuche – das WLAN-Modul kann noch mit der Suche beschäftigt sein).
# Versuch 1–2: WPA2/CCMP wie eingerichtet; Versuch 3–4: Verschlüsselungsdetails dem Pi überlassen.
ok=0
for try in 1 2 3 4; do
  if [ "$try" = 3 ]; then
    log "Probiere Variante 2: Verschlüsselungsdetails automatisch"
    nmcli con modify "$CON" 802-11-wireless-security.proto "" 802-11-wireless-security.pairwise "" 802-11-wireless-security.group "" >/dev/null 2>&1
  fi
  nmcli dev disconnect wlan0 >/dev/null 2>&1   # laufende Suche nach dem Heim-WLAN abbrechen
  sleep 2
  if out=$(nmcli con up "$CON" 2>&1); then ok=1; break; fi
  log "Versuch $try fehlgeschlagen: $(echo "$out" | head -1)"
  sleep 3
done
if [ "$ok" = 0 ]; then status fehler "Eigenes WLAN ließ sich nicht starten: $out"; exit 1; fi
log "Eigenes WLAN läuft (Adresse 10.42.0.1, Versuch $try)"
status hotspot "Eigenes WLAN läuft$([ "$TEST" = 1 ] && echo ' (Test)')"

if [ "$TEST" = 1 ]; then
  sleep "$TEST_SECONDS"
  nmcli con down "$CON" >/dev/null 2>&1
  log "Test beendet – verbinde wieder mit dem Heim-WLAN"
  status test "Test erfolgreich: Eigenes WLAN lief $((TEST_SECONDS / 60)) Minuten"
fi
exit 0
