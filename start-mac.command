#!/bin/bash
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js fehlt - bitte von https://nodejs.org installieren."; read; exit 1; }
node server.js
