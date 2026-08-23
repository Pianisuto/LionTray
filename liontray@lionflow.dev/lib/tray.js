/* LionTray - tray visivel, overflow e organizacao por arrastar
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Modelo de dados:
 *   _order   array de chaves estaveis, na ordem de exibicao. Contem
 *            tambem chaves de apps que nao estao rodando agora, para que
 *            a organizacao sobreviva a fechar/reabrir o aplicativo.
 *   _hidden  subconjunto de _order que vive no popup de overflow.
 *
 * Os atores sao sempre derivados do modelo (_sync), nunca o contrario.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {IndicatorButton} from './indicatorButton.js';
import {StatusNotifierItem} from './statusNotifierItem.js';
import {makeStableKey, warn} from './util.js';

const MAX_REMEMBERED_KEYS = 200;

export class LionTray {
    constructor(settings) {
        this._settings = settings;
        this._items = new Map();     // key -> {key, sni, button}
        this._byBus = new Map();     // "busName+path" -> key
        this._pending = new Set();   // "busName+path" em carregamento
        this._draggingKey = null;
        this._dragActive = false;
        this._writingSettings = false;
        this._syncLaterId = 0;
        this._destroyed = false;

        this._order = settings.get_strv('order');
        this._hidden = new Set(settings.get_strv('hidden'));

        this._buildUI();

        this._settingsIds = [
            settings.connect('changed::icon-size', () => this._onIconSizeChanged()),
            settings.connect('changed::hide-overflow-when-empty', () => this._sync()),
            settings.connect('changed::order', () => this._reloadFromSettings()),
            settings.connect('changed::hidden', () => this._reloadFromSettings()),
        ];
    }

    get iconSize() {
        return this._settings.get_int('icon-size');
    }

    /* ---------------------------------------------------------------- */
    /* construcao da UI                                                  */
    /* ---------------------------------------------------------------- */

    _buildUI() {
        this._container = new St.BoxLayout({
            style_class: 'liontray-container',
            reactive: true,
            y_align: Clutter.ActorAlign.FILL,
        });

        this._trayBox = new St.BoxLayout({
            style_class: 'liontray-box',
            reactive: true,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._trayBox._delegate = {
            handleDragOver: (source, actor, x) => this._onDragOverBox(this._trayBox, source, x),
            acceptDrop: (source, actor, x) => this._onDropInTray(source, x),
        };

        this._overflowButton = new St.Button({
            style_class: 'liontray-item liontray-overflow-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'pan-up-symbolic',
                style_class: 'liontray-icon',
            }),
        });
        this._overflowButton._delegate = {
            handleDragOver: source => this._onDragOverOverflowButton(source),
            acceptDrop: source => this._onDropInOverflow(source, -1),
        };
        this._overflowButton.connect('button-press-event', () => {
            this._overflowMenu.toggle();
            return Clutter.EVENT_STOP;
        });

        this._container.add_child(this._trayBox);
        this._container.add_child(this._overflowButton);

        Main.panel._rightBox.insert_child_at_index(this._container, 0);

        this._buildOverflowMenu();
        this._updateIconSize();
        this._sync();
    }

    _buildOverflowMenu() {
        this._overflowMenu = new PopupMenu.PopupMenu(this._overflowButton, 0.5, St.Side.TOP);
        this._overflowMenu.actor.add_style_class_name('liontray-overflow-menu');

        this._overflowItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'liontray-overflow-item',
        });

        this._overflowBox = new St.BoxLayout({
            style_class: 'liontray-overflow-box',
            reactive: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._overflowBox._delegate = {
            handleDragOver: (source, actor, x) => this._onDragOverBox(this._overflowBox, source, x),
            acceptDrop: (source, actor, x) =>
                this._onDropInOverflow(source, this._indexForX(this._overflowBox, x)),
        };

        this._emptyLabel = new St.Label({
            style_class: 'liontray-overflow-empty',
            text: 'Arraste icones aqui para oculta-los',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._overflowBox.add_child(this._emptyLabel);

        this._overflowItem.add_child(this._overflowBox);
        this._overflowMenu.addMenuItem(this._overflowItem);

        Main.layoutManager.uiGroup.add_child(this._overflowMenu.actor);
        this._overflowMenu.actor.hide();
        Main.panel.menuManager.addMenu(this._overflowMenu);
    }

    closeOverflow() {
        this._overflowMenu?.close();
    }

    get dragInProgress() {
        return this._dragActive;
    }

    /**
     * Fecha o overflow, os menus dos indicadores e qualquer outro menu do
     * painel que ainda detenha o grab.
     *
     * Enquanto um menu do Main.panel.menuManager esta aberto ele segura o
     * grab modal, e todo evento ENTER passa pelo manager. Ao sobrevoar o
     * sourceActor de outro menu gerenciado, ele troca de menu sozinho
     * (popupMenu.js, _onCapturedEvent). Arrastando um icone por cima dos
     * outros isso abre o menu de cada um no caminho.
     */
    closeAllMenus() {
        this.closeOverflow();
        for (const {button} of this._items.values())
            button.closeMenu();
        Main.panel.menuManager.activeMenu?.close();
    }

    /** Ator ao qual o menu de um indicador deve se ancorar. */
    anchorFor(button) {
        return button.get_parent() === this._trayBox ? button : this._overflowButton;
    }

    /* ---------------------------------------------------------------- */
    /* entrada e saida de indicadores                                    */
    /* ---------------------------------------------------------------- */

    async addItem(busName, objectPath) {
        const busId = `${busName}${objectPath}`;
        if (this._byBus.has(busId) || this._pending.has(busId) || this._destroyed)
            return;

        this._pending.add(busId);
        const sni = new StatusNotifierItem(busName, objectPath);

        try {
            await sni.load();
        } catch (e) {
            this._pending.delete(busId);
            sni.destroy();
            warn(`indicador ${busId} nao respondeu: ${e.message}`);
            return;
        }

        this._pending.delete(busId);
        if (this._destroyed) {
            sni.destroy();
            return;
        }

        const key = this._uniqueKey(makeStableKey(sni.props, busName, objectPath));
        const button = new IndicatorButton(key, sni, this);

        this._items.set(key, {key, sni, button});
        this._byBus.set(busId, key);

        if (!this._order.includes(key))
            this._order.push(key);

        this._persist();
        this._sync();
    }

    removeItem(busName, objectPath) {
        const busId = `${busName}${objectPath}`;
        this._pending.delete(busId);

        const key = this._byBus.get(busId);
        if (!key)
            return;

        this._byBus.delete(busId);
        const record = this._items.get(key);
        this._items.delete(key);

        if (record) {
            // A chave permanece em _order/_hidden: se o app voltar, ele
            // reaparece exatamente onde estava.
            record.button.destroy();
            record.sni.destroy();
        }
        this._sync();
    }

    /** Evita colisao quando o mesmo app registra dois indicadores iguais. */
    _uniqueKey(base) {
        if (!this._items.has(base))
            return base;
        for (let n = 2; n < 100; n++) {
            const candidate = `${base}#${n}`;
            if (!this._items.has(candidate))
                return candidate;
        }
        return `${base}#${Date.now()}`;
    }

    /* ---------------------------------------------------------------- */
    /* modelo -> atores                                                  */
    /* ---------------------------------------------------------------- */

    _orderedKeys() {
        const known = new Set(this._order);
        for (const key of this._items.keys()) {
            if (!known.has(key)) {
                this._order.push(key);
                known.add(key);
            }
        }
        return this._order;
    }

    _visibleKeys() {
        return this._orderedKeys().filter(k => this._items.has(k) && !this._hidden.has(k));
    }

    _hiddenKeys() {
        return this._orderedKeys().filter(k => this._items.has(k) && this._hidden.has(k));
    }

    _sync() {
        if (this._destroyed)
            return;

        const skip = this._draggingKey;
        const visible = this._visibleKeys().filter(k => k !== skip);
        const hidden = this._hiddenKeys().filter(k => k !== skip);

        this._reparent(this._trayBox, visible.map(k => this._items.get(k).button));
        this._reparent(this._overflowBox, hidden.map(k => this._items.get(k).button));

        this._emptyLabel.visible = hidden.length === 0;
        this._overflowBox.set_child_at_index(this._emptyLabel, hidden.length);

        const hasHidden = this._hiddenKeys().length > 0;
        const showOverflow = hasHidden || this._dragActive ||
            !this._settings.get_boolean('hide-overflow-when-empty');

        this._overflowButton.visible = showOverflow;
        if (!showOverflow)
            this.closeOverflow();
    }

    _syncLater() {
        if (this._syncLaterId || this._destroyed)
            return;
        this._syncLaterId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._syncLaterId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    _reparent(box, actors) {
        actors.forEach((actor, index) => {
            const parent = actor.get_parent();
            if (parent !== box) {
                parent?.remove_child(actor);
                box.add_child(actor);
            }
            // o DND deixa posicao fixa/opacidade alteradas no ator
            actor.resetTransform?.();
            box.set_child_at_index(actor, index);
        });
    }

    _onIconSizeChanged() {
        this._updateIconSize();
        for (const {button} of this._items.values())
            button.sync();
    }

    _updateIconSize() {
        const size = this.iconSize;
        this._overflowButton.get_child().icon_size = size;
        this._dropIndicatorWidth = Math.max(2, Math.round(size / 8));
    }

    /* ---------------------------------------------------------------- */
    /* drag-and-drop                                                     */
    /* ---------------------------------------------------------------- */

    onDragBegin(button) {
        this._draggingKey = button.key;
        this._dragActive = true;
        // o botao de overflow precisa existir para receber o drop mesmo
        // quando nenhum indicador esta oculto
        this._overflowButton.visible = true;
        this.closeAllMenus();
    }

    onDragEnd() {
        this._draggingKey = null;
        this._dragActive = false;
        this._removeIndicator();
        this._syncLater();
    }

    _indicator() {
        if (!this._dropIndicator) {
            this._dropIndicator = new St.Widget({
                style_class: 'liontray-drop-indicator',
                width: this._dropIndicatorWidth ?? 2,
            });
        }
        return this._dropIndicator;
    }

    _removeIndicator() {
        this._dropIndicator?.get_parent()?.remove_child(this._dropIndicator);
    }

    _showIndicator(box, index) {
        const indicator = this._indicator();
        if (indicator.get_parent() !== box) {
            this._removeIndicator();
            box.insert_child_at_index(indicator, index);
        } else {
            box.set_child_at_index(indicator, index);
        }
    }

    /** Indice de insercao a partir da coordenada X local da caixa. */
    _indexForX(box, x) {
        let index = 0;
        for (const child of box.get_children()) {
            if (child === this._dropIndicator || child === this._emptyLabel)
                continue;
            if (x < child.x + child.width / 2)
                return index;
            index++;
        }
        return index;
    }

    _onDragOverBox(box, source, x) {
        if (!source?.isLionTrayItem)
            return DND.DragMotionResult.NO_DROP;
        this._overflowButton.remove_style_pseudo_class('active');
        this._showIndicator(box, this._indexForX(box, x));
        return DND.DragMotionResult.MOVE_DROP;
    }

    _onDragOverOverflowButton(source) {
        if (!source?.isLionTrayItem)
            return DND.DragMotionResult.NO_DROP;
        this._removeIndicator();
        this._overflowButton.add_style_pseudo_class('active');
        return DND.DragMotionResult.MOVE_DROP;
    }

    _onDropInTray(source, x) {
        if (!source?.isLionTrayItem)
            return false;
        const index = this._indexForX(this._trayBox, x);
        this._removeIndicator();
        this._overflowButton.remove_style_pseudo_class('active');
        this._place(source.key, index, false);
        return true;
    }

    _onDropInOverflow(source, index) {
        if (!source?.isLionTrayItem)
            return false;
        this._removeIndicator();
        this._overflowButton.remove_style_pseudo_class('active');
        this._place(source.key, index, true);
        return true;
    }

    /**
     * Move `key` para a posicao `index` da lista visivel ou oculta.
     * index < 0 significa "no fim".
     */
    _place(key, index, hidden) {
        this._draggingKey = null;

        if (hidden)
            this._hidden.add(key);
        else
            this._hidden.delete(key);

        const siblings = (hidden ? this._hiddenKeys() : this._visibleKeys())
            .filter(k => k !== key);
        const before = index >= 0 && index < siblings.length ? siblings[index] : null;

        this._order = this._order.filter(k => k !== key);
        const at = before ? this._order.indexOf(before) : -1;
        if (at >= 0)
            this._order.splice(at, 0, key);
        else
            this._order.push(key);

        this._persist();
        this._sync();
    }

    /* ---------------------------------------------------------------- */
    /* persistencia                                                      */
    /* ---------------------------------------------------------------- */

    _persist() {
        // mantem a lista limitada, descartando chaves antigas de apps que
        // nao estao mais presentes
        if (this._order.length > MAX_REMEMBERED_KEYS) {
            const live = new Set(this._items.keys());
            const stale = this._order.filter(k => !live.has(k));
            const drop = new Set(stale.slice(0, this._order.length - MAX_REMEMBERED_KEYS));
            this._order = this._order.filter(k => !drop.has(k));
            for (const k of drop)
                this._hidden.delete(k);
        }

        const hidden = [...this._hidden].filter(k => this._order.includes(k));

        this._writingSettings = true;
        try {
            this._settings.set_strv('order', this._order);
            this._settings.set_strv('hidden', hidden);
        } finally {
            this._writingSettings = false;
        }
    }

    _reloadFromSettings() {
        if (this._writingSettings || this._destroyed)
            return;
        this._order = this._settings.get_strv('order');
        this._hidden = new Set(this._settings.get_strv('hidden'));
        this._sync();
    }

    /* ---------------------------------------------------------------- */
    /* destruicao                                                        */
    /* ---------------------------------------------------------------- */

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        if (this._syncLaterId) {
            GLib.source_remove(this._syncLaterId);
            this._syncLaterId = 0;
        }

        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        for (const {button, sni} of this._items.values()) {
            button.destroy();
            sni.destroy();
        }
        this._items.clear();
        this._byBus.clear();
        this._pending.clear();

        this._removeIndicator();
        this._dropIndicator?.destroy();
        this._dropIndicator = null;

        if (this._overflowMenu) {
            Main.panel.menuManager.removeMenu(this._overflowMenu);
            this._overflowMenu.destroy();
            this._overflowMenu = null;
        }

        this._container?.destroy();
        this._container = null;
        this._trayBox = null;
        this._overflowBox = null;
        this._overflowButton = null;
        this._emptyLabel = null;
    }
}
