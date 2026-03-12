#!/bin/bash
set -e

# Konfiguracja CUPS: nasłuchuj na localhost, zezwalaj na zdalne drukarki
if [ -f /etc/cups/cupsd.conf ]; then
    # Pozwól na zarządzanie przez localhost
    sed -i 's/Listen localhost:631/Listen 0.0.0.0:631/' /etc/cups/cupsd.conf 2>/dev/null || true
    # Włącz zdalny dostęp do administracji (opcjonalnie)
    if ! grep -q "ServerAlias \*" /etc/cups/cupsd.conf; then
        echo "ServerAlias *" >> /etc/cups/cupsd.conf
    fi
fi

# Uruchomienie Avahi w tle (potrzebne do IPP/driverless discovery)
if command -v avahi-daemon &>/dev/null; then
    # Tryb bez D-Bus (w kontenerze)
    mkdir -p /var/run/avahi-daemon
    avahi-daemon --no-rlimits --daemonize 2>/dev/null || echo "Avahi: uruchomienie nie powiodło się (opcjonalne)"
fi

# Uruchomienie demona CUPS w tle
/usr/sbin/cupsd

# Odczekaj aż CUPS wstanie
echo "Czekam na CUPS..."
for i in $(seq 1 10); do
    if lpstat -r 2>/dev/null | grep -q "running"; then
        echo "CUPS uruchomiony."
        break
    fi
    sleep 1
done

# Automatycznie dodaj drukarkę z .env jeśli jeszcze nie istnieje
PRINTER_NAME="${DEFAULT_PRINTER:-domowa}"
PRINTER_IP="${PRINTER_IP:-}"

if [ -n "$PRINTER_IP" ]; then
    if ! lpstat -e 2>/dev/null | grep -q "^${PRINTER_NAME}$"; then
        echo "Dodawanie drukarki: ${PRINTER_NAME} @ ${PRINTER_IP}"
        # Spróbuj IPP Everywhere (driverless - najlepsza kompatybilność z inkjet)
        lpadmin -p "$PRINTER_NAME" -E \
            -v "ipp://${PRINTER_IP}/ipp/print" \
            -m everywhere 2>/dev/null \
        || lpadmin -p "$PRINTER_NAME" -E \
            -v "socket://${PRINTER_IP}:9100" \
            -m everywhere 2>/dev/null \
        || echo "UWAGA: Nie udało się automatycznie dodać drukarki. Dodaj ją ręcznie przez panel admina."

        # Ustaw jako domyślną
        lpadmin -d "$PRINTER_NAME" 2>/dev/null || true
        echo "Drukarka ${PRINTER_NAME} skonfigurowana."
    else
        echo "Drukarka ${PRINTER_NAME} już istnieje w CUPS."
    fi
fi

# Wylistuj dostępne drukarki
echo "Dostępne drukarki:"
lpstat -e 2>/dev/null || echo "(brak)"

# Uruchom serwer Node.js
exec node server.js
