/* LionTray - dica de nome ao passar o mouse
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * O problema que originou o projeto foi um icone que ninguem sabia de que
 * aplicativo era. `accessible_name` resolve isso para leitores de tela;
 * esta dica resolve para quem enxerga.
 *
 * Reusa `dash-label`, a classe que o proprio Shell usa nas dicas do dash,
 * entao o balao sai identico ao nativo em qualquer tema.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/* Longo o bastante para nao aparecer quando o ponteiro so esta de
 * passagem - inclusive a caminho de pegar um icone para arrastar. */
const SHOW_DELAY_MS = 600;
const FADE_MS = 120;
const GAP = 6;

/** Prende `value` ao intervalo. Se a dica for maior que o monitor, o
 * comeco vence: melhor ver o inicio do nome do que o fim. */
function clamp(value, min, max) {
    return Math.max(min, Math.min(value, Math.max(min, max)));
}

export class Tooltip {
    constructor() {
        this._label = new St.Label({
            style_class: 'dash-label liontray-tooltip',
            opacity: 0,
            visible: false,
        });
        Main.layoutManager.uiGroup.add_child(this._label);

        this._timeoutId = 0;
        this._destroyed = false;
    }

    /** Agenda a dica de `actor`. Chamar de novo reinicia a contagem. */
    scheduleFor(actor, text) {
        this.hide();
        if (this._destroyed || !text || !actor)
            return;

        this._timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, SHOW_DELAY_MS, () => {
                this._timeoutId = 0;
                this._show(actor, text);
                return GLib.SOURCE_REMOVE;
            });
    }

    hide() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._destroyed || !this._label.visible)
            return;

        this._label.remove_all_transitions();
        this._label.opacity = 0;
        this._label.hide();
    }

    _show(actor, text) {
        // o ponteiro pode ter saido, o item pode ter sumido, um menu pode
        // ter aberto por cima - qualquer um desses invalida a dica
        if (this._destroyed || !actor.mapped)
            return;

        this._label.text = text;
        // Sem o estilo resolvido, o padding da classe `dash-label` nao
        // entra na medida: a dica seria posicionada como se fosse bem mais
        // estreita do que e, e escaparia da borda da tela.
        this._label.ensure_style();
        this._label.show();

        // PopupMenu.open() eleva o menu ao topo do uiGroup, entao um
        // popup aberto depois da dica ficaria na frente dela. Subir aqui,
        // na hora de mostrar, resolve para os itens dentro do overflow.
        Main.layoutManager.uiGroup.set_child_above_sibling(this._label, null);

        // A largura alocada ainda e a do texto anterior neste ponto; a
        // preferida ja considera o texto novo.
        const [, width] = this._label.get_preferred_width(-1);
        const [, height] = this._label.get_preferred_height(width);

        const [ax, ay] = actor.get_transformed_position();
        const [aw, ah] = actor.get_transformed_size();

        const monitor = Main.layoutManager.findMonitorForActor(actor) ??
            Main.layoutManager.primaryMonitor;

        const x = clamp(
            ax + aw / 2 - width / 2,
            monitor.x + GAP,
            monitor.x + monitor.width - width - GAP);

        // Abaixo do ator; se nao couber (painel embaixo, dica alta), acima.
        let y = ay + ah + GAP;
        if (y + height > monitor.y + monitor.height - GAP)
            y = ay - height - GAP;
        y = clamp(y, monitor.y + GAP, monitor.y + monitor.height - height - GAP);

        this._label.set_position(Math.round(x), Math.round(y));

        this._label.ease({
            opacity: 255,
            duration: FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    destroy() {
        this.hide();
        this._destroyed = true;
        this._label?.destroy();
        this._label = null;
    }
}
