/* LionTray - bootstrap da extensao
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Liga as duas metades: o backend de protocolo (StatusNotifierWatcher)
 * e a UI (LionTray). disable() precisa desfazer tudo: nome D-Bus,
 * objetos exportados, assinaturas de sinal, atores e timeouts.
 */

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {StatusNotifierWatcher} from './lib/watcher.js';
import {LionTray} from './lib/tray.js';
import * as IconResolver from './lib/iconResolver.js';

/* Espera antes de notificar um conflito de watcher. Na inicializacao da
 * sessao a disputa pelo nome pode se resolver sozinha em poucos segundos;
 * notificar de imediato geraria alarme falso. */
const CONFLICT_NOTIFY_DELAY = 3;

export default class LionTrayExtension extends Extension {
    enable() {
        IconResolver.init(this.uuid);

        this._conflictTimeoutId = 0;
        this._conflictNotified = false;

        this._settings = this.getSettings();
        this._tray = new LionTray(this._settings);
        this._watcher = new StatusNotifierWatcher();

        this._watcherIds = [
            this._watcher.connect('item-added', (_w, busName, objectPath) => {
                this._tray?.addItem(busName, objectPath);
            }),
            this._watcher.connect('item-removed', (_w, busName, objectPath) => {
                this._tray?.removeItem(busName, objectPath);
            }),
            this._watcher.connect('name-conflict', (_w, info) => {
                this._onWatcherConflict(info);
            }),
            this._watcher.connect('name-acquired', () => {
                this._clearConflict();
            }),
        ];

        this._watcher.start();
    }

    disable() {
        this._clearConflict();
        this._conflictNotified = false;

        for (const id of this._watcherIds ?? [])
            this._watcher?.disconnect(id);
        this._watcherIds = null;

        this._watcher?.destroy();
        this._watcher = null;

        this._tray?.destroy();
        this._tray = null;

        this._settings = null;

        IconResolver.shutdown();
    }

    /**
     * Sem a posse de org.kde.StatusNotifierWatcher o LionTray nao recebe
     * indicador nenhum, e a bandeja fica vazia sem dar nenhuma pista do
     * porque. Aqui o motivo vira log e notificacao.
     */
    _onWatcherConflict(info) {
        const owner = info?.command
            ? `${info.command} (pid ${info.pid})`
            : 'outro processo';

        console.warn(
            `[LionTray] org.kde.StatusNotifierWatcher pertence a ${owner}; ` +
            'o LionTray nao vai receber indicadores enquanto isso durar.');

        if (this._conflictNotified || this._conflictTimeoutId)
            return;

        this._conflictTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, CONFLICT_NOTIFY_DELAY, () => {
                this._conflictTimeoutId = 0;
                this._conflictNotified = true;
                Main.notify('Outro AppIndicator esta ativo', this._conflictHint(info));
                return GLib.SOURCE_REMOVE;
            });
    }

    _conflictHint(info) {
        // dono sendo o proprio Shell significa outra extensao de tray
        if (info?.command === 'gnome-shell') {
            return 'Outra extensao esta controlando a bandeja do sistema. ' +
                'Desative-a (por exemplo zorin-appindicator@zorinos.com) e ' +
                'reinicie o GNOME Shell para o LionTray assumir.';
        }

        const owner = info?.command ? `"${info.command}"` : 'Outro programa';
        return `${owner} esta controlando a bandeja do sistema. ` +
            'Feche-o e reinicie o GNOME Shell para o LionTray assumir.';
    }

    _clearConflict() {
        if (this._conflictTimeoutId) {
            GLib.source_remove(this._conflictTimeoutId);
            this._conflictTimeoutId = 0;
        }
    }
}
