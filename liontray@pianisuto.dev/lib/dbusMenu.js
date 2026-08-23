/* LionTray - cliente com.canonical.dbusmenu
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Converte o layout DBusMenu de um indicador em um PopupMenu do Shell.
 * A V1 reconstroi o menu inteiro quando o layout muda: e mais simples e
 * mais robusto do que aplicar diffs incrementais, e menus de tray sao
 * pequenos.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {MENU_IFACE, cleanLabel, dbusCall, dbusCallSafe, warn} from './util.js';
import * as IconResolver from './iconResolver.js';

const REBUILD_DEBOUNCE_MS = 80;
const MENU_ICON_SIZE = 16;

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

export class DBusMenuClient {
    /**
     * @param {string} busName
     * @param {string} objectPath object path do DBusMenu (propriedade Menu do item)
     * @param {PopupMenu.PopupMenu} menu menu do Shell a ser preenchido
     */
    constructor(busName, objectPath, menu) {
        this.busName = busName;
        this.objectPath = objectPath;
        this._menu = menu;

        this._cancellable = new Gio.Cancellable();
        this._subIds = [];
        this._rebuildId = 0;
        this._destroyed = false;
        this._root = null;

        const conn = Gio.DBus.session;
        this._subIds.push(conn.signal_subscribe(
            busName, MENU_IFACE, 'LayoutUpdated', objectPath, null,
            Gio.DBusSignalFlags.NONE, () => this._queueRebuild()));
        this._subIds.push(conn.signal_subscribe(
            busName, MENU_IFACE, 'ItemsPropertiesUpdated', objectPath, null,
            Gio.DBusSignalFlags.NONE, () => this._queueRebuild()));

        this._openStateId = menu.connect('open-state-changed', (_m, open) => {
            if (open) {
                this.sendEvent(0, 'opened');
                this.aboutToShow(0);
            } else {
                this.sendEvent(0, 'closed');
            }
        });

        this.refresh().catch(() => {});
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        this._cancellable.cancel();
        if (this._rebuildId) {
            GLib.source_remove(this._rebuildId);
            this._rebuildId = 0;
        }
        for (const id of this._subIds)
            Gio.DBus.session.signal_unsubscribe(id);
        this._subIds = [];

        if (this._openStateId) {
            this._menu.disconnect(this._openStateId);
            this._openStateId = 0;
        }
        this._menu = null;
    }

    /* -------------------------------------------------------------- */
    /* protocolo                                                       */
    /* -------------------------------------------------------------- */

    sendEvent(id, eventId, data = null) {
        dbusCallSafe(this.busName, this.objectPath, MENU_IFACE, 'Event',
            new GLib.Variant('(isvu)', [
                id, eventId, data ?? GLib.Variant.new_string(''), nowSeconds(),
            ]));
    }

    async aboutToShow(id) {
        try {
            const reply = await dbusCall(this.busName, this.objectPath, MENU_IFACE,
                'AboutToShow', new GLib.Variant('(i)', [id]), this._cancellable);
            const [needsUpdate] = reply.deep_unpack();
            if (needsUpdate)
                this._queueRebuild();
        } catch {
            // AboutToShow e opcional em varias implementacoes
        }
    }

    async refresh() {
        let root;
        try {
            const reply = await dbusCall(this.busName, this.objectPath, MENU_IFACE,
                'GetLayout', new GLib.Variant('(iias)', [0, -1, []]), this._cancellable);
            const [, layout] = reply.recursiveUnpack();
            root = layout;
        } catch (e) {
            if (!this._destroyed)
                warn(`GetLayout falhou em ${this.busName}${this.objectPath}: ${e.message}`);
            return;
        }
        if (this._destroyed)
            return;
        this._root = root;
        this._rebuild();
    }

    _queueRebuild() {
        if (this._destroyed || this._rebuildId)
            return;
        this._rebuildId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REBUILD_DEBOUNCE_MS, () => {
            this._rebuildId = 0;
            this.refresh().catch(() => {});
            return GLib.SOURCE_REMOVE;
        });
    }

    /* -------------------------------------------------------------- */
    /* construcao da UI                                                */
    /* -------------------------------------------------------------- */

    _rebuild() {
        if (!this._menu || this._destroyed)
            return;
        this._menu.removeAll();
        if (this._root)
            this._populate(this._root[2] ?? [], this._menu);
        if (this._menu.isEmpty?.()) {
            const empty = new PopupMenu.PopupMenuItem('Sem acoes disponiveis');
            empty.setSensitive(false);
            this._menu.addMenuItem(empty);
        }
    }

    _populate(children, target) {
        for (const child of children) {
            if (!Array.isArray(child) || child.length < 3)
                continue;
            const [id, props, subChildren] = child;

            if (props.visible === false)
                continue;

            if (props.type === 'separator') {
                target.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                continue;
            }

            const label = cleanLabel(props.label) || ' ';
            const hasSubmenu = props['children-display'] === 'submenu';

            if (hasSubmenu) {
                const item = new PopupMenu.PopupSubMenuMenuItem(label, false);
                if (props.enabled === false)
                    item.setSensitive(false);
                this._applyIcon(item, props);
                target.addMenuItem(item);
                this._populate(subChildren ?? [], item.menu);
                item.menu.connect('open-state-changed', (_m, open) => {
                    if (open)
                        this.aboutToShow(id);
                });
            } else {
                const item = new PopupMenu.PopupMenuItem(label);
                if (props.enabled === false)
                    item.setSensitive(false);
                this._applyToggle(item, props);
                this._applyIcon(item, props);
                item.connect('activate', () => {
                    this.sendEvent(id, 'clicked');
                });
                target.addMenuItem(item);
            }
        }
    }

    _applyToggle(item, props) {
        const type = props['toggle-type'];
        if (!type)
            return;
        const on = props['toggle-state'] === 1;
        const O = PopupMenu.Ornament;
        if (type === 'checkmark')
            item.setOrnament(on ? (O.CHECK ?? O.DOT) : O.NONE);
        else if (type === 'radio')
            item.setOrnament(on ? O.DOT : O.NONE);
    }

    _applyIcon(item, props) {
        const gicon = IconResolver.resolveMenuIcon(props, MENU_ICON_SIZE);
        if (!gicon)
            return;
        const icon = new St.Icon({
            gicon,
            style_class: 'popup-menu-icon',
            icon_size: MENU_ICON_SIZE,
        });
        item.insert_child_at_index(icon, 1);
    }
}
