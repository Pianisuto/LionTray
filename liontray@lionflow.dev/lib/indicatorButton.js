/* LionTray - ator de um indicador no painel
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {DBusMenuClient} from './dbusMenu.js';
import * as IconResolver from './iconResolver.js';

export const IndicatorButton = GObject.registerClass(
class LionTrayIndicatorButton extends St.Button {
    _init(key, sni, tray) {
        super._init({
            style_class: 'liontray-item',
            reactive: true,
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO | St.ButtonMask.THREE,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });

        // marcador usado pelos alvos de drop para reconhecer a origem
        this.isLionTrayItem = true;
        this._delegate = this;

        this.key = key;
        this.sni = sni;
        this._tray = tray;
        this._menu = null;
        this._menuClient = null;
        this._destroyed = false;

        this._icon = new St.Icon({style_class: 'liontray-icon'});
        this.set_child(this._icon);

        this.connect('clicked', (_a, button) => this._onClicked(button));
        this.connect('scroll-event', (_a, event) => this._onScroll(event));
        this.connect('destroy', () => this._onDestroy());

        this._sniChangedId = sni.connect('changed', () => this.sync());
        this._sniMenuId = sni.connect('menu-changed', () => this._resetMenu());

        this._draggable = DND.makeDraggable(this, {
            restoreOnSuccess: false,
            dragActorOpacity: 170,
        });
        this._dragBeginId = this._draggable.connect('drag-begin',
            () => this._tray.onDragBegin(this));
        this._dragEndId = this._draggable.connect('drag-end',
            () => this._tray.onDragEnd(this));

        this.sync();
        // O menu e criado adiantado: PopupMenu.open() ignora menus vazios,
        // entao o layout DBusMenu precisa ja estar carregado no 1o clique.
        this._resetMenu();
    }

    /* -------------------------------------------------------------- */
    /* aparencia                                                       */
    /* -------------------------------------------------------------- */

    sync() {
        if (this._destroyed)
            return;

        const size = this._tray.iconSize;
        this._icon.icon_size = size;
        this._icon.gicon = IconResolver.resolve(this.sni.props, size);

        this.accessible_name = this.sni.title;

        if (this.sni.status === 'NeedsAttention')
            this.add_style_class_name('liontray-attention');
        else
            this.remove_style_class_name('liontray-attention');
    }

    /* -------------------------------------------------------------- */
    /* interacao                                                       */
    /* -------------------------------------------------------------- */

    _pointerPosition() {
        const [x, y] = this.get_transformed_position();
        const [w, h] = this.get_transformed_size();
        return [Math.round(x + w / 2), Math.round(y + h)];
    }

    _onClicked(button) {
        // um arraste em andamento nao deve virar clique ao terminar
        if (this._tray.dragInProgress)
            return Clutter.EVENT_STOP;

        const [x, y] = this._pointerPosition();

        if (button === Clutter.BUTTON_SECONDARY) {
            if (!this._openMenu())
                this.sni.contextMenu(x, y);
            return Clutter.EVENT_STOP;
        }

        if (button === Clutter.BUTTON_MIDDLE) {
            this.sni.secondaryActivate(x, y);
            return Clutter.EVENT_STOP;
        }

        // primario
        if (this.sni.itemIsMenu) {
            if (!this._openMenu())
                this.sni.contextMenu(x, y);
            return Clutter.EVENT_STOP;
        }

        this.sni.tryActivate(x, y).then(ok => {
            if (!ok && !this._destroyed && !this._openMenu())
                this.sni.contextMenu(x, y);
        });
        return Clutter.EVENT_STOP;
    }

    _onScroll(event) {
        const direction = event.get_scroll_direction();
        switch (direction) {
        case Clutter.ScrollDirection.UP:
            this.sni.scroll(-1, 'vertical');
            break;
        case Clutter.ScrollDirection.DOWN:
            this.sni.scroll(1, 'vertical');
            break;
        case Clutter.ScrollDirection.LEFT:
            this.sni.scroll(-1, 'horizontal');
            break;
        case Clutter.ScrollDirection.RIGHT:
            this.sni.scroll(1, 'horizontal');
            break;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_STOP;
    }

    /* -------------------------------------------------------------- */
    /* menu do indicador                                               */
    /* -------------------------------------------------------------- */

    _ensureMenu() {
        if (this._menu || !this.sni.menuPath)
            return this._menu;

        this._menu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
        this._menu.actor.add_style_class_name('liontray-indicator-menu');
        Main.layoutManager.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();
        Main.panel.menuManager.addMenu(this._menu);

        this._menuClient = new DBusMenuClient(
            this.sni.busName, this.sni.menuPath, this._menu);

        return this._menu;
    }

    closeMenu() {
        this._menu?.close();
    }

    _resetMenu() {
        this._destroyMenu();
        if (this.sni.menuPath)
            this._ensureMenu();
    }

    _destroyMenu() {
        this._menuClient?.destroy();
        this._menuClient = null;
        if (this._menu) {
            const menu = this._menu;
            this._menu = null;
            try {
                Main.panel.menuManager.removeMenu(menu);
                menu.destroy();
            } catch (e) {
                console.warn(`[LionTray] falha ao destruir menu: ${e}`);
            }
        }
    }

    /** Abre o menu DBusMenu. Retorna false se o indicador nao tem menu. */
    _openMenu() {
        const menu = this._ensureMenu();
        if (!menu || menu.isEmpty())
            return false;

        // Itens ocultos vivem dentro do popup de overflow; nesse caso o
        // menu precisa se ancorar no botao de overflow, que esta no painel.
        menu.sourceActor = this._tray.anchorFor(this);
        this._tray.closeOverflow();
        menu.open(true);
        return true;
    }

    /* -------------------------------------------------------------- */
    /* ciclo de vida                                                   */
    /* -------------------------------------------------------------- */

    /**
     * Desfaz o que o dnd.js aplica no ator durante o arraste: ele forca
     * set_size(), escala e opacidade e so restaura tudo no caminho de
     * cancelamento. Depois de um drop aceito precisamos limpar na mao.
     */
    resetTransform() {
        this.opacity = 255;
        this.set_scale(1, 1);
        this.set_width(-1);
        this.set_height(-1);
        this.translation_x = 0;
        this.translation_y = 0;
        this.set_fixed_position_set(false);
    }

    _onDestroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        if (this._draggable) {
            this._draggable.disconnect(this._dragBeginId);
            this._draggable.disconnect(this._dragEndId);
            this._draggable = null;
        }
        if (this._sniChangedId) {
            this.sni.disconnect(this._sniChangedId);
            this._sniChangedId = 0;
        }
        if (this._sniMenuId) {
            this.sni.disconnect(this._sniMenuId);
            this._sniMenuId = 0;
        }
        this._destroyMenu();
    }
});
