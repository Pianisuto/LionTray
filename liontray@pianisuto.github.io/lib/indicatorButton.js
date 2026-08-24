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

/* O clone que segue o ponteiro nasce um pouco maior que o icone parado:
 * e o que da a sensacao de ter pegado o item na mao. */
const DRAG_ACTOR_SCALE = 1.3;
const DRAG_ACTOR_OPACITY = 230;
/* O original fica no lugar, apagado, mostrando de onde o item saiu. */
const DRAGGING_OPACITY = 90;

/* Um pulso curto na entrada em NeedsAttention, e so. Piscar sem parar
 * transforma o painel em arvore de Natal; o estado permanente fica por
 * conta da cor aplicada pela classe `liontray-attention`. */
const ATTENTION_PULSES = 2;
const ATTENTION_PULSE_MS = 140;
const ATTENTION_PULSE_SCALE = 1.3;

export const IndicatorButton = GObject.registerClass(
class LionTrayIndicatorButton extends St.Button {
    _init(key, sni, tray) {
        super._init({
            // `panel-button` faz o hover/active/focus virem do tema do
            // Shell em uso; `liontray-item` corrige so a geometria.
            style_class: 'panel-button liontray-item',
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
        this._lastStatus = null;
        this._destroyed = false;

        this._icon = new St.Icon({
            style_class: 'liontray-icon',
            // se o GIcon resolvido existir mas falhar ao carregar, o St
            // desenha isto no lugar do quadradinho de "image-missing"
            fallback_icon_name: IconResolver.GENERIC_ICON,
        });
        this.set_child(this._icon);

        // Dessaturacao acontece no ator, nao nos bytes da imagem. Assim a
        // mesma opcao cobre IconName, SVG, PNG, IconPixmap e icones symbolic
        // sem criar um segundo pipeline de resolucao/cache.
        this._desaturateEffect = new Clutter.DesaturateEffect({factor: 1.0});
        this._icon.add_effect_with_name('liontray-desaturate', this._desaturateEffect);
        this._desaturateSettingsId = this._tray._settings.connect(
            'changed::desaturate-icons', () => this._syncDesaturation());
        this._syncDesaturation();

        this.connect('clicked', (_a, button) => this._onClicked(button));
        this.connect('scroll-event', (_a, event) => this._onScroll(event));
        this.connect('key-press-event', (_a, event) => this._onKeyPress(event));
        this.connect('notify::hover', () => this._onHover());
        this.connect('destroy', () => this._onDestroy());

        this._sniChangedId = sni.connect('changed', () => this.sync());
        this._sniMenuId = sni.connect('menu-changed', () => this._resetMenu());

        this._draggable = DND.makeDraggable(this, {
            restoreOnSuccess: false,
            dragActorOpacity: DRAG_ACTOR_OPACITY,
        });
        this._dragBeginId = this._draggable.connect('drag-begin',
            () => this._onDragBegin());
        this._dragEndId = this._draggable.connect('drag-end',
            () => this._onDragEnd());

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
        const {gicon, fallback} = IconResolver.resolveDetailed(this.sni.props, size);

        this._icon.icon_size = size;
        this._icon.gicon = gicon;

        this.accessible_name = this.sni.title;
        this._toggleClass('liontray-fallback-icon', fallback);
        this._toggleClass('liontray-attention', this.sni.status === 'NeedsAttention');

        this._syncStatus();
    }

    _syncDesaturation() {
        this._desaturateEffect?.set_enabled(
            this._tray._settings.get_boolean('desaturate-icons'));
    }

    /**
     * NeedsAttention ganha um pulso na entrada; Passive pode mudar a
     * organizacao inteira (a bandeja decide se o item vai para o overflow).
     * Os dois so importam na transicao, nunca a cada refresh.
     */
    _syncStatus() {
        const status = this.sni.status;
        if (status === this._lastStatus)
            return;

        const previous = this._lastStatus;
        this._lastStatus = status;

        if (status === 'NeedsAttention' && previous !== 'NeedsAttention')
            this._pulse();

        this._tray.onItemStatusChanged(this);
    }

    _toggleClass(name, on) {
        if (on)
            this.add_style_class_name(name);
        else
            this.remove_style_class_name(name);
    }

    _pulse(remaining = ATTENTION_PULSES) {
        if (this._destroyed || remaining <= 0)
            return;

        const icon = this._icon;
        icon.remove_all_transitions();
        icon.set_pivot_point(0.5, 0.5);
        icon.set_scale(1, 1);
        icon.ease({
            scale_x: ATTENTION_PULSE_SCALE,
            scale_y: ATTENTION_PULSE_SCALE,
            duration: ATTENTION_PULSE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._destroyed)
                    return;
                icon.ease({
                    scale_x: 1,
                    scale_y: 1,
                    duration: ATTENTION_PULSE_MS,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => this._pulse(remaining - 1),
                });
            },
        });
    }

    /* -------------------------------------------------------------- */
    /* interacao                                                       */
    /* -------------------------------------------------------------- */

    _onHover() {
        if (this.hover && !this._tray.dragInProgress)
            this._tray.tooltip?.scheduleFor(this, this.sni.tooltipText);
        else
            this._tray.tooltip?.hide();
    }

    _pointerPosition() {
        const [x, y] = this.get_transformed_position();
        const [w, h] = this.get_transformed_size();
        return [Math.round(x + w / 2), Math.round(y + h)];
    }

    _onClicked(button) {
        // um arraste em andamento nao deve virar clique ao terminar
        if (this._tray.dragInProgress)
            return Clutter.EVENT_STOP;

        this._tray.tooltip?.hide();

        // A posicao vai junto no Activate/ContextMenu e precisa ser lida
        // agora: um indicador oculto vive dentro do popup, e fechar o
        // popup tira o ator da tela.
        const [x, y] = this._pointerPosition();

        // Fechar o overflow ANTES de falar com o aplicativo. Alem de manter
        // a bandeja consistente, isso evita que o ator do item desapareca
        // enquanto o aplicativo usa a posicao recebida abaixo.
        this._tray.closeOverflow();

        if (button === Clutter.BUTTON_SECONDARY) {
            this._activateMenu(x, y);
            return Clutter.EVENT_STOP;
        }

        if (button === Clutter.BUTTON_MIDDLE) {
            this.sni.secondaryActivate(x, y);
            return Clutter.EVENT_STOP;
        }

        // primario
        if (this.sni.itemIsMenu) {
            this._activateMenu(x, y);
            return Clutter.EVENT_STOP;
        }

        this.sni.tryActivate(x, y).then(ok => {
            if (!ok && !this._destroyed && !this._openMenu())
                this.sni.contextMenu(x, y);
        });
        return Clutter.EVENT_STOP;
    }

    /** Menu proprio se houver DBusMenu; senao devolve a bola para o app. */
    _activateMenu(x, y) {
        if (!this._openMenu())
            this.sni.contextMenu(x, y);
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

    /**
     * Teclado. Enter e espaco ja vem do St.Button; aqui ficam o menu de
     * contexto (Menu / Shift+F10, como em qualquer widget GTK) e a
     * reorganizacao, que sem isso so existiria com o mouse.
     */
    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        const state = event.get_state();
        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;

        if (symbol === Clutter.KEY_Menu || (shift && symbol === Clutter.KEY_F10)) {
            this._activateMenu(...this._pointerPosition());
            return Clutter.EVENT_STOP;
        }

        if (!ctrl)
            return Clutter.EVENT_PROPAGATE;

        // em RTL a caixa cresce para a esquerda, entao as setas invertem
        const step = this.get_text_direction() === Clutter.TextDirection.RTL ? -1 : 1;

        switch (symbol) {
        case Clutter.KEY_Left:
            return this._keyResult(this._tray.moveByKey(this, -step));
        case Clutter.KEY_Right:
            return this._keyResult(this._tray.moveByKey(this, step));
        case Clutter.KEY_Down:
            return this._keyResult(this._tray.setHiddenByKey(this, true));
        case Clutter.KEY_Up:
            return this._keyResult(this._tray.setHiddenByKey(this, false));
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _keyResult(handled) {
        // quem move e a bandeja, e e ela que reposiciona o foco: ocultar
        // manda o foco para o ▲, reordenar mantem aqui
        return handled ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    }

    /* -------------------------------------------------------------- */
    /* arraste                                                         */
    /* -------------------------------------------------------------- */

    /**
     * Clone que segue o ponteiro. Devolver um ator proprio aqui, em vez de
     * deixar o dnd.js sequestrar o botao, e o que mantem o icone no lugar
     * durante o arraste: nada some do painel, e a bandeja pode animar a
     * reorganizacao em volta dele.
     */
    getDragActor() {
        // Mesma classe do botao de proposito: o dnd.js le `dragActor.width`
        // antes da primeira alocacao para decidir se posiciona o clone sobre
        // a origem ou sob o ponteiro, e o valor so bate se o padding for o
        // mesmo. Com o pivo no centro, a escala cresce sem tirar o clone de
        // cima do icone original.
        const dragIcon = new St.Icon({
            style_class: 'liontray-icon',
            gicon: this._icon.gicon,
            fallback_icon_name: IconResolver.GENERIC_ICON,
            icon_size: this._tray.iconSize,
        });
        if (this._tray._settings.get_boolean('desaturate-icons')) {
            dragIcon.add_effect_with_name('liontray-desaturate',
                new Clutter.DesaturateEffect({factor: 1.0}));
        }

        const actor = new St.Bin({
            style_class: 'liontray-item liontray-drag-actor',
            child: dragIcon,
        });
        actor.set_pivot_point(0.5, 0.5);
        actor.set_scale(DRAG_ACTOR_SCALE, DRAG_ACTOR_SCALE);
        return actor;
    }

    /** Para onde o clone volta se o arraste for cancelado. */
    getDragActorSource() {
        return this;
    }

    _onDragBegin() {
        this._tray.tooltip?.hide();
        this.add_style_class_name('liontray-dragging');
        this.opacity = DRAGGING_OPACITY;
        this._tray.onDragBegin(this);
    }

    _onDragEnd() {
        this.remove_style_class_name('liontray-dragging');
        this.opacity = 255;
        this._tray.onDragEnd(this);
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
        this._tray.menuManager.addMenu(this._menu);

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
                this._tray.menuManager.removeMenu(menu);
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
        // gerenciadores diferentes nao se falam: fecha na mao o menu do
        // painel para nao empilhar dois modais
        Main.panel.menuManager.activeMenu?.close();
        menu.open(true);
        return true;
    }

    /* -------------------------------------------------------------- */
    /* ciclo de vida                                                   */
    /* -------------------------------------------------------------- */

    _onDestroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        this._icon?.remove_all_transitions();

        if (this._desaturateSettingsId) {
            this._tray._settings.disconnect(this._desaturateSettingsId);
            this._desaturateSettingsId = 0;
        }

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
