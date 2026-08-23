/* LionTray - acompanhamento da variante clara/escura do Shell
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Quase toda a aparencia da bandeja e herdada do tema: os botoes carregam
 * a classe `panel-button` e, dentro do painel, pegam hover/active/focus
 * prontos de qualquer tema instalado.
 *
 * Sobra o que nao vive dentro de `#panel` - o popup de overflow - e as
 * poucas cores que nenhum tema expoe (marcador de insercao, atencao). Para
 * essas, o CSS traz dois conjuntos de regras e este modulo diz qual vale,
 * marcando os atores com `liontray-light` ou `liontray-dark`.
 */

import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const CLASSES = ['liontray-light', 'liontray-dark'];

export class ThemeVariant {
    constructor() {
        this._actors = new Set();
        this._settings = St.Settings.get();
        this._notifyId = this._settings.connect('notify::color-scheme',
            () => this._applyAll());
    }

    /**
     * 'light' ou 'dark'. Main.getStyleVariant() ja cruza a preferencia do
     * usuario com o modo de sessao; ele devolve '' quando o modo nao
     * exprime preferencia nenhuma, e nesse caso o Shell carrega a folha
     * escura.
     */
    get variant() {
        return Main.getStyleVariant?.() || 'dark';
    }

    /** Passa a manter a classe de variante em `actor`. */
    track(actor) {
        this._actors.add(actor);
        this._applyTo(actor);
    }

    untrack(actor) {
        this._actors.delete(actor);
    }

    _applyAll() {
        for (const actor of this._actors)
            this._applyTo(actor);
    }

    _applyTo(actor) {
        const wanted = `liontray-${this.variant}`;
        for (const name of CLASSES) {
            if (name === wanted)
                actor.add_style_class_name(name);
            else
                actor.remove_style_class_name(name);
        }
    }

    destroy() {
        if (this._notifyId) {
            this._settings.disconnect(this._notifyId);
            this._notifyId = 0;
        }
        this._actors.clear();
    }
}
