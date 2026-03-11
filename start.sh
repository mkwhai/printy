#!/bin/bash
# Uruchomienie demona CUPS w tle
/usr/sbin/cupsd -f &

# Odczekaj chwilę, aż CUPS wstanie
sleep 2

# Uruchom serwer Node.js
node server.js
