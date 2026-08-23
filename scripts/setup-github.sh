#!/usr/bin/env bash
# Configura metadados públicos do repositório via GitHub CLI.
# Requer: gh auth login
set -euo pipefail

REPO="Pianisuto/LionTray"

gh repo edit "${REPO}" \
  --description "A customizable StatusNotifierItem/AppIndicator system tray for GNOME Shell with drag-and-drop ordering and overflow." \
  --enable-wiki=false \
  --enable-projects=false \
  --add-topic gnome-shell \
  --add-topic gnome-extension \
  --add-topic appindicator \
  --add-topic statusnotifieritem \
  --add-topic system-tray \
  --add-topic linux \
  --add-topic gjs

echo "Metadados públicos atualizados em ${REPO}."
