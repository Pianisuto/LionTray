/* LionTray - utilidades comuns
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export const ITEM_IFACE = 'org.kde.StatusNotifierItem';
export const MENU_IFACE = 'com.canonical.dbusmenu';
export const PROPS_IFACE = 'org.freedesktop.DBus.Properties';

export function log(msg) {
    console.log(`[LionTray] ${msg}`);
}

export function warn(msg) {
    console.warn(`[LionTray] ${msg}`);
}

/**
 * Chamada D-Bus assincrona que resolve com o GLib.Variant de resposta.
 */
export function dbusCall(busName, objectPath, iface, method, params, cancellable = null) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            busName, objectPath, iface, method, params, null,
            Gio.DBusCallFlags.NONE, 3000, cancellable,
            (conn, res) => {
                try {
                    resolve(conn.call_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
    });
}

/** Dispara uma chamada e ignora falhas (fire-and-forget). */
export function dbusCallSafe(busName, objectPath, iface, method, params) {
    dbusCall(busName, objectPath, iface, method, params).catch(() => {});
}

export async function getAllProperties(busName, objectPath, iface, cancellable = null) {
    const reply = await dbusCall(busName, objectPath, PROPS_IFACE, 'GetAll',
        new GLib.Variant('(s)', [iface]), cancellable);
    return reply.get_child_value(0).recursiveUnpack();
}

export async function getProperty(busName, objectPath, iface, name, cancellable = null) {
    const reply = await dbusCall(busName, objectPath, PROPS_IFACE, 'Get',
        new GLib.Variant('(ss)', [iface, name]), cancellable);
    return reply.get_child_value(0).recursiveUnpack();
}

/**
 * Identidade persistida de um indicador.
 *
 * Nao pode depender do nome D-Bus efemero (`:1.102`), que muda a cada
 * execucao do aplicativo. Usamos o campo `Id` do StatusNotifierItem
 * (ex.: "bitwarden", "dropbox-client", "chrome_status_icon_1"), caindo
 * para o `Title` e, por ultimo, para o object path.
 */
export function makeStableKey(props, busName, objectPath) {
    let base = String(props?.Id ?? '').trim();
    if (!base || /^\d+$/.test(base))
        base = String(props?.Title ?? '').trim();
    if (!base)
        base = objectPath && objectPath !== '/StatusNotifierItem' ? objectPath : busName;

    base = base.toLowerCase().replace(/[^a-z0-9_.:@-]+/g, '-').replace(/^-+|-+$/g, '');

    if (objectPath && objectPath !== '/StatusNotifierItem')
        base += `@${objectPath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;

    return base || 'liontray-unknown';
}

/** Remove mnemonicos ("_Abrir" -> "Abrir") de rotulos de menu. */
export function cleanLabel(label) {
    return String(label ?? '')
        .replace(/_([^_])/g, '$1')
        .replace(/__/g, '_')
        .trim();
}
