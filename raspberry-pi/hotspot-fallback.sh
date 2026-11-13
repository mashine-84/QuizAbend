#!/bin/bash
# Startet das eigene WLAN des Quiz, wenn der Pi nach dem Hochfahren kein bekanntes WLAN gefunden hat.
# Zu Hause verbindet sich der Pi also wie gewohnt mit deinem WLAN (Updates möglich),
# unterwegs macht er nach ca. 45 Sekunden ein eigenes WLAN auf (ohne Internet).
#
# Läuft als Dienst (root) beim Start. Schreibt ein Protokoll nach hotspot.log und den letzten Stand
# nach hotspot-status.json – beides zeigt das Handy des 👑 unter Systemeinstellungen › Eigenes WLAN.
# Liegt die Datei hotspot-test im Quiz-Ordner (Knopf „Testen“ am Handy), wird das eigene WLAN
# sofort für 3 Minuten gestartet, danach verbindet sich der Pi wieder mit dem Heim-WLAN.
#
# Das eigene WLAN läuft bevorzugt über hostapd (sauberes WPA2, klappt mit dem WLAN-Chip des Pi 3 zuverlässig).
# Fehlt hostapd, installiert das Skript es selbst, sobald der Pi zu Hause mit Internet verbunden ist.
# Notlösung ohne hostapd: Hotspot des NetworkManagers.

DIR="$(cd "$(dirname "$0")/.." && pwd)"
CON=QuizAbend-Hotspot
LOG="$DIR/hotspot.log"
STATUS="$DIR/hotspot-status.json"
TEST_FLAG="$DIR/hotspot-test"
TEST_SECONDS=${TEST_SECONDS:-180}
WAIT_SECONDS=${WAIT_SECONDS:-45}
RUN=${RUN_DIR:-/run}
HAP_CONF="$RUN/quizabend-hostapd.conf"
HAP_PID="$RUN/quizabend-hostapd.pid"
HAP_LOG="$RUN/quizabend-hostapd.log"
DNS_PID="$RUN/quizabend-dnsmasq.pid"
IF=wlan0

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

# hostapd nachinstallieren (nur zu Hause mit Internet; danach läuft das eigene WLAN darüber)
install_hostapd() {
  [ -n "$HOSTAPD" ] && return
  command -v apt-get >/dev/null || return
  log "Installiere hostapd für ein zuverlässigeres eigenes WLAN …"
  export DEBIAN_FRONTEND=noninteractive
  if out=$(timeout 900 sh -c 'apt-get update -q && apt-get install -y -q --no-install-recommends hostapd' 2>&1); then
    systemctl disable --now hostapd >/dev/null 2>&1   # wir starten hostapd selbst, nur wenn nötig
    HOSTAPD=$(command -v hostapd || ls /usr/sbin/hostapd 2>/dev/null)
    log "hostapd installiert – das eigene WLAN läuft ab jetzt darüber"
    status heim "Mit WLAN verbunden · hostapd frisch installiert"
  else
    log "hostapd-Installation fehlgeschlagen: $(echo "$out" | tail -n 2 | tr '\n' ' ')"
  fi
}

# Eigenes WLAN über hostapd + dnsmasq (Handys bekommen Adressen 10.42.0.x, quizabend.local → Pi)
stop_hostapd() {
  [ -f "$HAP_PID" ] && kill "$(cat "$HAP_PID")" 2>/dev/null
  [ -f "$DNS_PID" ] && kill "$(cat "$DNS_PID")" 2>/dev/null
  [ -n "$WATCH_PID" ] && kill "$WATCH_PID" 2>/dev/null
  rm -f "$HAP_PID" "$DNS_PID"
  ip addr flush dev $IF 2>/dev/null
}
start_hostapd() {
  [ -z "$HOSTAPD" ] && return 1
  if [ -z "$DNSMASQ" ]; then log "hostapd: dnsmasq fehlt – nehme Notlösung"; return 1; fi
  local cc
  cc=$(iw reg get 2>/dev/null | awk '/^country/{sub(":","",$2); print $2; exit}')
  [ -z "$cc" ] || [ "$cc" = 00 ] && cc=DE
  local host
  host=$(hostname 2>/dev/null || echo quizabend)
  umask 077
  cat > "$HAP_CONF" <<CONF
interface=$IF
driver=nl80211
ssid=$SSID
country_code=$cc
ieee80211d=1
hw_mode=g
channel=6
ieee80211n=1
wmm_enabled=1
auth_algs=1
wpa=2
wpa_key_mgmt=WPA-PSK
wpa_pairwise=CCMP
rsn_pairwise=CCMP
wpa_passphrase=$PW
CONF
  umask 022
  nmcli dev disconnect $IF >/dev/null 2>&1
  nmcli dev set $IF managed no >/dev/null 2>&1   # NetworkManager lässt das WLAN-Modul los (nur bis zum Neustart)
  rfkill unblock wifi 2>/dev/null
  local t
  for t in 1 2; do
    sleep 2
    : > "$HAP_LOG"
    "$HOSTAPD" -B -P "$HAP_PID" -f "$HAP_LOG" "$HAP_CONF" >/dev/null 2>&1
    for _ in $(seq 1 10); do grep -q "AP-ENABLED" "$HAP_LOG" 2>/dev/null && break; sleep 1; done
    grep -q "AP-ENABLED" "$HAP_LOG" 2>/dev/null && break
    log "hostapd Versuch $t fehlgeschlagen: $(grep -v '^$' "$HAP_LOG" 2>/dev/null | tail -n 3 | tr '\n' ' ')"
    [ -f "$HAP_PID" ] && kill "$(cat "$HAP_PID")" 2>/dev/null
    # Hält wpa_supplicant das Modul noch fest? Dann kurz anhalten (nach dem Test wieder starten).
    [ "$t" = 1 ] && systemctl stop wpa_supplicant >/dev/null 2>&1 && STOPPED_SUPP=1
  done
  if ! grep -q "AP-ENABLED" "$HAP_LOG" 2>/dev/null; then
    stop_hostapd; nmcli dev set $IF managed yes >/dev/null 2>&1
    [ "$STOPPED_SUPP" = 1 ] && systemctl start wpa_supplicant >/dev/null 2>&1
    return 1
  fi
  ip addr flush dev $IF 2>/dev/null
  ip addr add 10.42.0.1/24 dev $IF
  ip link set $IF up
  if ! out=$("$DNSMASQ" --interface=$IF --bind-interfaces --except-interface=lo --listen-address=10.42.0.1 \
      --dhcp-range=10.42.0.10,10.42.0.100,255.255.255.0,12h --dhcp-authoritative \
      --address=/quizabend.local/10.42.0.1 $([ "$host" != quizabend ] && echo "--address=/$host.local/10.42.0.1") --no-resolv --no-hosts \
      --pid-file="$DNS_PID" 2>&1); then
    log "dnsmasq startet nicht: $out"
  fi
  # Handys, die sich verbinden (oder scheitern), ins Protokoll schreiben (endet mit hostapd)
  ( tail --pid="$(cat "$HAP_PID")" -n 0 -F "$HAP_LOG" 2>/dev/null | grep --line-buffered -E 'AP-STA-CONNECTED|AP-STA-DISCONNECTED|4-Way Handshake failed|pre-shared key may be incorrect|deauthenticated due to' \
      | while read -r l; do log "Handy: ${l#*$IF: }"; done ) >/dev/null 2>&1 &
  WATCH_PID=$!
  return 0
}

# Infos fürs Protokoll
log "WLAN-Gerät: $(nmcli -t -f DEVICE,TYPE,STATE dev 2>/dev/null | grep ':wifi:' | tr '\n' ' ')"
log "Ländercode: $(iw reg get 2>/dev/null | grep -m1 country | cut -d: -f1 | tr -d '\t')"
command -v dnsmasq >/dev/null || [ -x /usr/sbin/dnsmasq ] || log "Hinweis: dnsmasq nicht gefunden (wird für das eigene WLAN gebraucht)"
rfkill list wifi 2>/dev/null | grep -qi 'blocked: yes' && log "Hinweis: WLAN ist per rfkill blockiert" && rfkill unblock wifi

# WLAN-Name und Passwort (stehen auch auf dem Fernseher)
HS="$DIR/hotspot.json"
if [ ! -f "$HS" ]; then
  PW=$(tr -dc 'abcdefghjkmnpqrstuvwxyz23456789' </dev/urandom | head -c 10)
  printf '{ "ssid": "QuizAbend", "password": "%s" }\n' "$PW" > "$HS"
fi
SSID=$(python3 -c "import json;print(json.load(open('$HS'))['ssid'])")
PW=$(python3 -c "import json;print(json.load(open('$HS'))['password'])")

HOSTAPD=$(command -v hostapd || ls /usr/sbin/hostapd 2>/dev/null)
DNSMASQ=$(command -v dnsmasq || ls /usr/sbin/dnsmasq 2>/dev/null)
log "hostapd: ${HOSTAPD:-nicht installiert}"

# Hotspot-Verbindung des NetworkManagers anlegen, falls sie fehlt (Notlösung ohne hostapd)
if ! nmcli -t -f NAME con show | grep -qx "$CON"; then
  log "Hotspot-Verbindung fehlt – lege sie an (WLAN-Name $SSID)"
  if ! out=$(nmcli con add type wifi ifname $IF con-name "$CON" autoconnect no ssid "$SSID" \
      mode ap 802-11-wireless.band bg 802-11-wireless.channel 6 ipv4.method shared \
      wifi-sec.key-mgmt wpa-psk wifi-sec.proto rsn wifi-sec.pairwise ccmp wifi-sec.group ccmp wifi-sec.pmf disable wifi-sec.psk "$PW" 2>&1); then
    log "Anlegen fehlgeschlagen: $out"
  fi
fi

# Der WLAN-Chip des Pi kann im Hotspot-Betrieb kein PMF ("802.1X supplicant took too long to authenticate"),
# außerdem hilft ein fester Kanal. Gilt auch für Verbindungen, die eine ältere Version angelegt hat
# (und setzt die „Variante 2“ einer älteren Version zurück auf sauberes WPA2).
nmcli con modify "$CON" 802-11-wireless-security.pmf disable 802-11-wireless.band bg 802-11-wireless.channel 6 \
  802-11-wireless-security.proto rsn 802-11-wireless-security.pairwise ccmp 802-11-wireless-security.group ccmp >/dev/null 2>&1 \
  || log "Hinweis: Hotspot-Einstellungen ließen sich nicht anpassen"

# Ist ein bekanntes WLAN in Reichweite? (bis zu 45 s warten)
if [ "$TEST" = 0 ]; then
  for i in $(seq 1 "$WAIT_SECONDS"); do
    state=$(nmcli -t -f DEVICE,TYPE,STATE dev 2>/dev/null | grep ':wifi:' | head -1 | cut -d: -f3)
    if [ "$state" = "connected" ]; then
      net=$(nmcli -t -f NAME,DEVICE con show --active 2>/dev/null | grep ':wlan0$' | cut -d: -f1)
      log "Mit WLAN „$net“ verbunden – kein eigenes WLAN nötig"; status heim "Mit WLAN „$net“ verbunden"
      install_hostapd; exit 0
    fi
    [ $((i % 15)) = 0 ] && log "Noch kein WLAN (Status: ${state:-unbekannt}) …"
    sleep 1
  done
  log "Kein bekanntes WLAN gefunden – starte eigenes WLAN"
fi

METHOD=""
if start_hostapd; then
  METHOD=hostapd; try=1
else
  [ -n "$HOSTAPD" ] && log "hostapd ging nicht – nehme Notlösung über NetworkManager"
  [ -z "$HOSTAPD" ] && log "Notlösung über NetworkManager (hostapd wird zu Hause automatisch installiert)"
  # Mehrere Versuche – das WLAN-Modul kann noch mit der Suche beschäftigt sein.
  ok=0
  for try in 1 2 3 4; do
    nmcli dev disconnect $IF >/dev/null 2>&1   # laufende Suche nach dem Heim-WLAN abbrechen
    sleep 2
    if out=$(nmcli con up "$CON" 2>&1); then ok=1; break; fi
    log "Versuch $try fehlgeschlagen: $(echo "$out" | head -1)"
    sleep 3
  done
  if [ "$ok" = 0 ]; then status fehler "Eigenes WLAN ließ sich nicht starten: $out"; exit 1; fi
  METHOD=NetworkManager
fi
log "Eigenes WLAN „$SSID“ läuft über $METHOD (Adresse 10.42.0.1, Versuch $try)"
status hotspot "Eigenes WLAN läuft über $METHOD$([ "$TEST" = 1 ] && echo ' (Test)')"

if [ "$TEST" = 1 ]; then
  sleep "$TEST_SECONDS"
  PHONES=""
  if [ "$METHOD" = hostapd ]; then
    n=$(grep -c "AP-STA-CONNECTED" "$HAP_LOG" 2>/dev/null)
    PHONES=" · ${n:-0}× hat sich ein Handy verbunden"
    stop_hostapd
    [ "$STOPPED_SUPP" = 1 ] && systemctl start wpa_supplicant >/dev/null 2>&1
    nmcli dev set $IF managed yes >/dev/null 2>&1
  else
    nmcli con down "$CON" >/dev/null 2>&1
  fi
  log "Test beendet – verbinde wieder mit dem Heim-WLAN"
  status test "Test erfolgreich: Eigenes WLAN lief $((TEST_SECONDS / 60)) Minuten über $METHOD$PHONES"
  # Wieder zu Hause: hostapd nachinstallieren, falls es noch fehlt
  if [ -z "$HOSTAPD" ]; then
    for _ in $(seq 1 60); do nmcli -t -f DEVICE,STATE dev 2>/dev/null | grep -q "^$IF:connected" && break; sleep 1; done
    install_hostapd
  fi
fi
exit 0
