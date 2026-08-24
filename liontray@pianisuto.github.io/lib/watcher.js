/* LionTray - implementacao de org.kde.StatusNotifierWatcher
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * O watcher e a metade "protocolo" da extensao: ele possui o nome
 * org.kde.StatusNotifierWatcher no barramento de sessao, aceita
 * registros de StatusNotifierItems e avisa a UI. Nao conhece nada
 * de St/Clutter.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

import {ITEM_IFACE, dbusCall, getProperty, warn} from './util.js';

const WATCHER_NAME = 'org.kde.StatusNotifierWatcher';
const WATCHER_PATH = '/StatusNotifierWatcher';
const PROTOCOL_VERSION = 0;

const WATCHER_IFACE_XML = `
<node>
  <interface name="org.kde.StatusNotifierWatcher">
    <method name="RegisterStatusNotifierItem">
      <arg type="s" direction="in" name="service"/>
    </method>
    <method name="RegisterStatusNotifierHost">
      <arg type="s" direction="in" name="service"/>
    </method>
    <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
    <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
    <property name="ProtocolVersion" type="i" access="read"/>
    <signal name="StatusNotifierItemRegistered">
      <arg type="s" name="service"/>
    </signal>
    <signal name="StatusNotifierItemUnregistered">
      <arg type="s" name="service"/>
    </signal>
    <signal name="StatusNotifierHostRegistered"/>
    <signal name="StatusNotifierHostUnregistered"/>
  </interface>
</node>`;

/* Nomes bem conhecidos usados por libappindicator, libayatana-appindicator,
 * Qt/KStatusNotifierItem e Electron/Chromium. Sao varridos na inicializacao
 * para reencontrar indicadores que ja estavam rodando. */
const SEED_NAME_PREFIXES = [
    'org.kde.StatusNotifierItem-',
    'org.ayatana.NotificationItem',
];
const SEED_PATHS = [
    '/StatusNotifierItem',
    '/org/ayatana/NotificationItem',
];

export class StatusNotifierWatcher extends EventEmitter {
    constructor() {
        super();
        this._items = new Map();      // "busName+path" -> {busName, objectPath, watchId}
        this._hosts = new Set();
        this._ownerId = 0;
        this._exported = false;
        this._ownsName = false;
        this._cancellable = new Gio.Cancellable();
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(WATCHER_IFACE_XML, this);
    }

    start() {
        try {
            this._dbusImpl.export(Gio.DBus.session, WATCHER_PATH);
            this._exported = true;
        } catch (e) {
            warn(`nao foi possivel exportar ${WATCHER_PATH}: ${e}`);
            return;
        }

        // ALLOW_REPLACEMENT | REPLACE: LionTray assume o lugar de outra
        // implementacao (zorin-appindicator, ubuntu-appindicator...) e
        // permite que outra assuma o lugar dele depois.
        this._ownerId = Gio.bus_own_name(
            Gio.BusType.SESSION, WATCHER_NAME,
            Gio.BusNameOwnerFlags.ALLOW_REPLACEMENT | Gio.BusNameOwnerFlags.REPLACE,
            null,
            () => this._onNameAcquired(),
            () => this._onNameLost());
    }

    destroy() {
        this._cancellable.cancel();

        for (const entry of this._items.values()) {
            if (entry.watchId)
                Gio.bus_unwatch_name(entry.watchId);
        }
        this._items.clear();
        this._hosts.clear();

        if (this._ownerId) {
            Gio.bus_unown_name(this._ownerId);
            this._ownerId = 0;
        }
        if (this._exported) {
            try {
                this._dbusImpl.emit_signal('StatusNotifierHostUnregistered', null);
            } catch {
                // barramento ja pode ter sumido
            }
            this._dbusImpl.unexport();
            this._exported = false;
        }
        this.disconnectAll();
    }

    /* -------------------------------------------------------------- */
    /* propriedades D-Bus                                              */
    /* -------------------------------------------------------------- */

    get RegisteredStatusNotifierItems() {
        return [...this._items.values()].map(i => `${i.busName}${i.objectPath}`);
    }

    // A extensao e o proprio host: sempre verdadeiro enquanto estiver ativa.
    get IsStatusNotifierHostRegistered() {
        return true;
    }

    get ProtocolVersion() {
        return PROTOCOL_VERSION;
    }

    /* -------------------------------------------------------------- */
    /* metodos D-Bus                                                   */
    /* -------------------------------------------------------------- */

    RegisterStatusNotifierItemAsync([service], invocation) {
        const sender = invocation.get_sender();
        let busName, objectPath;

        if (typeof service === 'string' && service.startsWith('/')) {
            busName = sender;
            objectPath = service;
        } else if (service) {
            busName = service;
            objectPath = '/StatusNotifierItem';
        } else {
            busName = sender;
            objectPath = '/StatusNotifierItem';
        }

        this._addItem(busName, objectPath);
        invocation.return_value(null);
    }

    RegisterStatusNotifierHostAsync([service], invocation) {
        this._hosts.add(service || invocation.get_sender());
        this._dbusImpl.emit_signal('StatusNotifierHostRegistered', null);
        invocation.return_value(null);
    }

    /* -------------------------------------------------------------- */
    /* gerenciamento de itens                                          */
    /* -------------------------------------------------------------- */

    _addItem(busName, objectPath) {
        const id = `${busName}${objectPath}`;
        if (this._items.has(id))
            return;

        const entry = {busName, objectPath, watchId: 0};
        this._items.set(id, entry);

        entry.watchId = Gio.bus_watch_name(
            Gio.BusType.SESSION, busName, Gio.BusNameWatcherFlags.NONE,
            null,
            () => this._removeItem(id));

        this._dbusImpl.emit_signal('StatusNotifierItemRegistered',
            new GLib.Variant('(s)', [id]));
        this._notifyItemsChanged();
        this.emit('item-added', busName, objectPath);
    }

    _removeItem(id) {
        const entry = this._items.get(id);
        if (!entry)
            return;

        this._items.delete(id);
        if (entry.watchId)
            Gio.bus_unwatch_name(entry.watchId);

        try {
            this._dbusImpl.emit_signal('StatusNotifierItemUnregistered',
                new GLib.Variant('(s)', [id]));
            this._notifyItemsChanged();
        } catch {
            // barramento indisponivel
        }
        this.emit('item-removed', entry.busName, entry.objectPath);
    }

    _notifyItemsChanged() {
        try {
            this._dbusImpl.emit_property_changed('RegisteredStatusNotifierItems',
                new GLib.Variant('as', this.RegisteredStatusNotifierItems));
        } catch {
            // ignorado
        }
    }

    /* -------------------------------------------------------------- */
    /* ciclo de vida do nome                                           */
    /* -------------------------------------------------------------- */

    _onNameAcquired() {
        this._ownsName = true;
        this.emit('name-acquired');

        // Avisa aplicativos que um host esta disponivel. A maioria dos
        // toolkits re-registra seus itens ao ver este sinal ou ao ver o
        // nome do watcher trocar de dono.
        try {
            this._dbusImpl.emit_signal('StatusNotifierHostRegistered', null);
        } catch {
            // ignorado
        }
        this._seedExistingItems().catch(() => {});
    }

    /**
     * Chamado quando o nome e perdido e tambem quando ele nunca chega a
     * ser adquirido - o caso de outra implementacao ja estar segurando
     * org.kde.StatusNotifierWatcher sem permitir substituicao.
     *
     * So um processo pode possuir o nome, entao sem ele o LionTray nao
     * recebe indicador nenhum e a bandeja fica vazia sem explicacao.
     * Descobrimos quem esta com o nome e repassamos para o bootstrap,
     * que decide como avisar o usuario.
     */
    _onNameLost() {
        const hadName = this._ownsName;
        this._ownsName = false;

        this._describeNameOwner().then(info => {
            if (this._cancellable.is_cancelled())
                return;
            this.emit('name-conflict', {hadName, ...info});
        });
    }

    /** Identifica o processo que esta com o nome do watcher. */
    async _describeNameOwner() {
        try {
            const ownerReply = await dbusCall(
                'org.freedesktop.DBus', '/org/freedesktop/DBus',
                'org.freedesktop.DBus', 'GetNameOwner',
                new GLib.Variant('(s)', [WATCHER_NAME]), this._cancellable);
            const [owner] = ownerReply.deep_unpack();

            const pidReply = await dbusCall(
                'org.freedesktop.DBus', '/org/freedesktop/DBus',
                'org.freedesktop.DBus', 'GetConnectionUnixProcessID',
                new GLib.Variant('(s)', [owner]), this._cancellable);
            const [pid] = pidReply.deep_unpack();

            let command = '';
            try {
                const file = Gio.File.new_for_path(`/proc/${pid}/comm`);
                const [, bytes] = await new Promise((resolve, reject) => {
                    file.load_contents_async(this._cancellable, (source, result) => {
                        try {
                            resolve(source.load_contents_finish(result));
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
                command = new TextDecoder().decode(bytes).trim();
            } catch {
                // processo pode ter saido nesse meio tempo
            }

            return {owner, pid, command};
        } catch {
            return {};
        }
    }

    /**
     * Ao assumir o nome do watcher, itens ja registrados na implementacao
     * anterior sao perdidos. Varremos o barramento em busca dos nomes bem
     * conhecidos usados pelas bibliotecas de indicador e reconectamos.
     */
    async _seedExistingItems() {
        let names;
        try {
            const reply = await dbusCall(
                'org.freedesktop.DBus', '/org/freedesktop/DBus',
                'org.freedesktop.DBus', 'ListNames', null, this._cancellable);
            [names] = reply.deep_unpack();
        } catch (e) {
            warn(`ListNames falhou: ${e}`);
            return;
        }

        for (const name of names) {
            if (!SEED_NAME_PREFIXES.some(p => name.startsWith(p)))
                continue;
            for (const path of SEED_PATHS) {
                try {
                    await getProperty(name, path, ITEM_IFACE, 'Id', this._cancellable);
                    this._addItem(name, path);
                    break;
                } catch {
                    // caminho nao existe neste nome; tenta o proximo
                }
            }
        }
    }
}
