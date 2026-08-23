#!/usr/bin/env bash
# LionTray - testes do backend de protocolo (watcher + SNI + DBusMenu + icones)
#
# Roda em um barramento D-Bus isolado (dbus-run-session), sem tocar na
# sessao do usuario. Os modulos de protocolo nao dependem de St/Clutter
# alem do resolvedor de icones, entao dao para exercitar fora do Shell:
# so o import de EventEmitter do Shell e trocado por um stub.
#
# SPDX-License-Identifier: GPL-3.0-or-later
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT}/liontray@pianisuto.dev/lib"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

mkdir -p "${WORK}/lib"
cp "${SRC}/util.js" "${SRC}/watcher.js" "${SRC}/statusNotifierItem.js" \
   "${SRC}/iconResolver.js" "${WORK}/lib/"
cp "${ROOT}/tests/signalsStub.js" "${WORK}/lib/signals.js"
cp "${ROOT}/tests/fakeItem.js" "${ROOT}/tests/run.js" "${WORK}/"

sed -i 's#resource:///org/gnome/shell/misc/signals.js#./signals.js#' \
    "${WORK}/lib/watcher.js" "${WORK}/lib/statusNotifierItem.js"

MUTTER_DIR="$(dirname "$(find /usr/lib -name 'Clutter-*.typelib' -path '*mutter*' | head -1)")"
SHELL_DIR="$(dirname "$(find /usr/lib -name 'St-*.typelib' | head -1)")"

cd "${WORK}"
GI_TYPELIB_PATH="${SHELL_DIR}:${MUTTER_DIR}" \
LD_LIBRARY_PATH="${MUTTER_DIR}:${SHELL_DIR}" \
dbus-run-session -- gjs -m run.js
