/* LionTray - janela visual do overflow
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * O overflow parece um popup, mas nao e um PopupMenu: atores do Shell nao
 * precisam virar janelas nativas para ficar acima do painel. Manter este
 * ator fora do PopupMenuManager e o que evita Main.pushModal e seus grabs.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

export class OverflowWindow {
    constructor(sourceActor) {
        this._sourceActor = sourceActor;
        this._destroyed = false;
        this._isOpen = false;
        this._dismissalSuspended = false;
        this._resumeDismissalId = 0;
        this._focusWindow = null;

        this.actor = new BoxPointer.BoxPointer(St.Side.TOP);
        this.actor.style_class = 'popup-menu-boxpointer';
        this.actor.add_style_class_name('popup-menu');
        this.actor.reactive = true;
        this.actor.can_focus = true;

        this.content = new St.BoxLayout({
            vertical: true,
            style_class: 'popup-menu-content',
            x_expand: true,
            y_expand: true,
        });
        this.actor.bin.set_child(this.content);

        // Mantem a navegacao de foco dos atores filhos sem criar um grab.
        global.focus_manager.add_group(this.actor);

        Main.layoutManager.uiGroup.add_child(this.actor);
        this.actor.hide();

        this._actorCapturedEventId = this.actor.connect(
            'captured-event', (_actor, event) => this._onActorEvent(event));
        this._stageCapturedEventId = global.stage.connect(
            'captured-event', (_stage, event) => this._onStageEvent(event));
        this._stageKeyFocusId = global.stage.connect(
            'notify::key-focus', () => this._onKeyFocusChanged());
        this._focusWindowId = global.display.connect(
            'notify::focus-window', () => this._onFocusWindowChanged());
        this._systemModalOpenedId = Main.layoutManager.connect(
            'system-modal-opened', () => this.close(BoxPointer.PopupAnimation.NONE));
        this._sourceMappedId = sourceActor.connect(
            'notify::mapped', () => {
                if (!sourceActor.mapped)
                    this.close(BoxPointer.PopupAnimation.NONE);
            });
        this._sourceDestroyId = sourceActor.connect(
            'destroy', () => this.destroy());
    }

    get isOpen() {
        return this._isOpen;
    }

    /**
     * O DND do Shell pode mover foco e alvo de evento durante o gesto. Isso
     * nao e uma saida real do overflow, entao o dono do arraste suspende o
     * fechamento automatico ate emitir o fim do gesto.
     */
    setDismissalSuspended(suspended) {
        this._dismissalSuspended = suspended;
        if (suspended && this._resumeDismissalId) {
            GLib.source_remove(this._resumeDismissalId);
            this._resumeDismissalId = 0;
        }
    }

    /**
     * O sinal drag-end do Shell e emitido antes de terminar toda a limpeza
     * interna do DND. Reabre o dismiss no proximo ciclo de eventos, sem
     * polling, para que esses sinais de foco nao parecam uma desativacao.
     */
    resumeDismissalAfterDrag() {
        if (this._destroyed || this._resumeDismissalId)
            return;

        this._dismissalSuspended = true;
        this._resumeDismissalId = GLib.idle_add(
            GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._resumeDismissalId = 0;
                if (!this._destroyed)
                    this._dismissalSuspended = false;
                return GLib.SOURCE_REMOVE;
            });
    }

    add_child(child) {
        this.content.add_child(child);
    }

    toggle() {
        if (this._isOpen)
            this.close();
        else
            this.open();
    }

    open(animate = BoxPointer.PopupAnimation.FULL) {
        if (this._destroyed || this._isOpen)
            return;

        this._focusWindow = global.display.focus_window;
        this._isOpen = true;
        this.actor.setPosition(this._sourceActor, 0.5);
        this.actor.open(animate);
        this.actor.get_parent().set_child_above_sibling(this.actor, null);

        // A abertura por teclado deixa o foco dentro do overflow, como um
        // menu comum, mas isso continua sendo apenas foco do Shell, nao um
        // grab exclusivo.
        if (global.stage.get_key_focus() === this._sourceActor)
            this.actor.grab_key_focus();
    }

    close(animate = BoxPointer.PopupAnimation.FULL) {
        if (!this._isOpen && !this.actor.visible)
            return;

        this._isOpen = false;
        this._focusWindow = null;
        this.actor.close(animate);
    }

    _contains(root, actor) {
        return Boolean(root && actor && (root === actor || root.contains(actor)));
    }

    _isInsideOverflowOrSource(actor) {
        return this._contains(this.actor, actor) ||
            this._contains(this._sourceActor, actor);
    }

    _onActorEvent(event) {
        if (!this._isOpen || event.type() !== Clutter.EventType.KEY_PRESS)
            return Clutter.EVENT_PROPAGATE;

        if (event.get_key_symbol() === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }

        if (event.get_key_symbol() === Clutter.KEY_Down &&
            global.stage.get_key_focus() === this.actor) {
            this.actor.navigate_focus(null, St.DirectionType.TAB_FORWARD, false);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onStageEvent(event) {
        if (!this._isOpen || this._dismissalSuspended)
            return Clutter.EVENT_PROPAGATE;

        const type = event.type();
        if (type !== Clutter.EventType.BUTTON_PRESS &&
            type !== Clutter.EventType.TOUCH_BEGIN)
            return Clutter.EVENT_PROPAGATE;

        const target = global.stage.get_event_actor(event);
        if (!this._isInsideOverflowOrSource(target))
            this.close(BoxPointer.PopupAnimation.FADE);

        // Nunca consumir o evento: o clique deve continuar chegando ao
        // aplicativo, ao painel ou a outro menu do Shell.
        return Clutter.EVENT_PROPAGATE;
    }

    _onKeyFocusChanged() {
        if (!this._isOpen || this._dismissalSuspended)
            return;

        const focus = global.stage.get_key_focus();
        // O Shell pode deixar key-focus nulo por um instante ao concluir
        // um DND. Nulo nao identifica uma janela externa; clique fora e
        // focus-window cuidam dos casos reais de desativacao.
        if (focus && !this._isInsideOverflowOrSource(focus))
            this.close(BoxPointer.PopupAnimation.FADE);
    }

    _onFocusWindowChanged() {
        if (!this._isOpen || this._dismissalSuspended)
            return;

        const focusWindow = global.display.focus_window;
        if (focusWindow && focusWindow !== this._focusWindow)
            this.close(BoxPointer.PopupAnimation.FADE);
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._isOpen = false;

        if (this._resumeDismissalId) {
            GLib.source_remove(this._resumeDismissalId);
            this._resumeDismissalId = 0;
        }

        this._sourceActor.disconnect(this._sourceMappedId);
        this._sourceActor.disconnect(this._sourceDestroyId);
        global.stage.disconnect(this._stageCapturedEventId);
        global.stage.disconnect(this._stageKeyFocusId);
        global.display.disconnect(this._focusWindowId);
        Main.layoutManager.disconnect(this._systemModalOpenedId);
        this.actor.disconnect(this._actorCapturedEventId);
        global.focus_manager.remove_group(this.actor);

        this.actor.destroy();
        this.actor = null;
        this.content = null;
        this._sourceActor = null;
    }
}
