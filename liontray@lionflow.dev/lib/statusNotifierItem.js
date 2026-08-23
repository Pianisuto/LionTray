/* LionTray - representacao de um StatusNotifierItem
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Deliberadamente NAO usa Gio.DBusProxy com cache de propriedades:
 * varias implementacoes (Electron/Chromium, alguns apps Qt e Flatpak)
 * emitem apenas os sinais NewIcon/NewStatus/... sem PropertiesChanged,
 * o que deixaria o cache do proxy defasado. Fazemos GetAll explicito.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

import {ITEM_IFACE, PROPS_IFACE, dbusCall, dbusCallSafe, getAllProperties, warn} from './util.js';

const REFRESH_DEBOUNCE_MS = 60;

const CHANGE_SIGNALS = new Set([
    'NewIcon', 'NewAttentionIcon', 'NewOverlayIcon',
    'NewToolTip', 'NewTitle', 'NewStatus', 'NewMenu',
]);

export class StatusNotifierItem extends EventEmitter {
    constructor(busName, objectPath) {
        super();
        this.busName = busName;
        this.objectPath = objectPath;
        this.props = {};

        this._cancellable = new Gio.Cancellable();
        this._subIds = [];
        this._refreshId = 0;
        this._destroyed = false;
    }

    /** Carrega as propriedades iniciais. Lanca se o item nao responder. */
    async load() {
        await this._fetchProps();
        if (this._destroyed)
            return;
        this._subscribe();
    }

    /* -------------------------------------------------------------- */
    /* acessores                                                       */
    /* -------------------------------------------------------------- */

    get id() {
        return this.props.Id ?? '';
    }

    get title() {
        return this.props.Title || this.props.Id || this.busName;
    }

    get status() {
        return this.props.Status ?? 'Active';
    }

    get category() {
        return this.props.Category ?? 'ApplicationStatus';
    }

    get itemIsMenu() {
        return this.props.ItemIsMenu === true;
    }

    get menuPath() {
        const path = this.props.Menu;
        return typeof path === 'string' && path.startsWith('/') ? path : null;
    }

    get tooltipText() {
        const tip = this.props.ToolTip;
        // ToolTip = (s a(iiay) s s): iconName, iconPixmap, title, body
        if (Array.isArray(tip)) {
            const title = tip[2] ?? '';
            const body = tip[3] ?? '';
            const text = [title, body].filter(t => t).join('\n');
            if (text)
                return text;
        }
        return this.title;
    }

    /* -------------------------------------------------------------- */
    /* metodos do protocolo                                            */
    /* -------------------------------------------------------------- */

    activate(x, y) {
        dbusCallSafe(this.busName, this.objectPath, ITEM_IFACE, 'Activate',
            new GLib.Variant('(ii)', [x, y]));
    }

    secondaryActivate(x, y) {
        dbusCallSafe(this.busName, this.objectPath, ITEM_IFACE, 'SecondaryActivate',
            new GLib.Variant('(ii)', [x, y]));
    }

    contextMenu(x, y) {
        dbusCallSafe(this.busName, this.objectPath, ITEM_IFACE, 'ContextMenu',
            new GLib.Variant('(ii)', [x, y]));
    }

    scroll(delta, orientation) {
        dbusCallSafe(this.busName, this.objectPath, ITEM_IFACE, 'Scroll',
            new GLib.Variant('(is)', [delta, orientation]));
    }

    /**
     * Activate com fallback: se o app nao implementa Activate (comum em
     * indicadores puramente de menu), avisa o chamador para abrir o menu.
     */
    async tryActivate(x, y) {
        try {
            await dbusCall(this.busName, this.objectPath, ITEM_IFACE, 'Activate',
                new GLib.Variant('(ii)', [x, y]), this._cancellable);
            return true;
        } catch {
            return false;
        }
    }

    /* -------------------------------------------------------------- */
    /* propriedades e sinais                                           */
    /* -------------------------------------------------------------- */

    async _fetchProps() {
        const props = await getAllProperties(
            this.busName, this.objectPath, ITEM_IFACE, this._cancellable);
        if (this._destroyed)
            return;
        this.props = props ?? {};
    }

    _subscribe() {
        const conn = Gio.DBus.session;

        // Todos os sinais da interface do item, no object path dele.
        this._subIds.push(conn.signal_subscribe(
            this.busName, ITEM_IFACE, null, this.objectPath, null,
            Gio.DBusSignalFlags.NONE,
            (_c, _sender, _path, _iface, signal) => {
                if (CHANGE_SIGNALS.has(signal))
                    this._queueRefresh();
            }));

        // Implementacoes bem comportadas tambem emitem PropertiesChanged.
        this._subIds.push(conn.signal_subscribe(
            this.busName, PROPS_IFACE, 'PropertiesChanged', this.objectPath, null,
            Gio.DBusSignalFlags.NONE,
            () => this._queueRefresh()));
    }

    _queueRefresh() {
        if (this._destroyed || this._refreshId)
            return;
        this._refreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, REFRESH_DEBOUNCE_MS, () => {
            this._refreshId = 0;
            this._refresh().catch(() => {});
            return GLib.SOURCE_REMOVE;
        });
    }

    async _refresh() {
        const oldMenu = this.menuPath;
        try {
            await this._fetchProps();
        } catch (e) {
            if (!this._destroyed)
                warn(`falha ao atualizar ${this.busName}${this.objectPath}: ${e.message}`);
            return;
        }
        if (this._destroyed)
            return;
        this.emit('changed');
        if (this.menuPath !== oldMenu)
            this.emit('menu-changed');
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        this._cancellable.cancel();
        if (this._refreshId) {
            GLib.source_remove(this._refreshId);
            this._refreshId = 0;
        }
        for (const id of this._subIds)
            Gio.DBus.session.signal_unsubscribe(id);
        this._subIds = [];
        this.disconnectAll();
    }
}
