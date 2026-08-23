/* LionTray - bootstrap da extensao
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Liga as duas metades: o backend de protocolo (StatusNotifierWatcher)
 * e a UI (LionTray). disable() precisa desfazer tudo: nome D-Bus,
 * objetos exportados, assinaturas de sinal, atores e timeouts.
 */

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {StatusNotifierWatcher} from './lib/watcher.js';
import {LionTray} from './lib/tray.js';
import * as IconResolver from './lib/iconResolver.js';

export default class LionTrayExtension extends Extension {
    enable() {
        IconResolver.init(this.uuid);

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
        ];

        this._watcher.start();
    }

    disable() {
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
}
