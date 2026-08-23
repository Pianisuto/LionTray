#!/usr/bin/env bash
# LionTray - instalacao local
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail

UUID="liontray@lionflow.dev"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/${UUID}"
DEST="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

echo ":: compilando schema GSettings"
glib-compile-schemas --strict "${SRC}/schemas"

echo ":: instalando em ${DEST}"
mkdir -p "${DEST}"
rm -rf "${DEST:?}/"*
cp -r "${SRC}/." "${DEST}/"

echo
echo "Instalado. Proximos passos:"
echo "  gnome-extensions disable zorin-appindicator@zorinos.com"
echo "  gnome-extensions enable  ${UUID}"
echo "  # X11: Alt+F2, digite 'r', Enter   |   Wayland: faca logout/login"
