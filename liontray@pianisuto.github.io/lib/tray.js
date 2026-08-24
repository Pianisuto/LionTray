/* LionTray - tray visivel, overflow e organizacao por arrastar
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Modelo de dados:
 *   _order   array de chaves estaveis, na ordem de exibicao. Contem
 *            tambem chaves de apps que nao estao rodando agora, para que
 *            a organizacao sobreviva a fechar/reabrir o aplicativo.
 *   _hidden  subconjunto de _order que vive no popup de overflow por
 *            escolha explicita do usuario.
 *   _pinned  subconjunto de _order que o usuario arrastou para o painel.
 *            Serve para o item ficar imune a ocultacao automatica de
 *            indicadores passivos.
 *
 * Os atores sao sempre derivados do modelo (_sync), nunca o contrario.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {IndicatorButton} from './indicatorButton.js';
import {ThemeVariant} from './theming.js';
import {Tooltip} from './tooltip.js';
import {StatusNotifierItem} from './statusNotifierItem.js';
import {OverflowWindow} from './overflowWindow.js';
import {makeStableKey, warn} from './util.js';

const MAX_REMEMBERED_KEYS = 200;

/* Um numero solto ao lado do ▲ so ajuda quando ha mais de um item la
 * dentro; com um so, o proprio ▲ ja diz tudo. */
const MIN_COUNT_BADGE = 2;

/* Quanto tempo o ponteiro precisa ficar parado sobre o ▲, durante um
 * arraste, para o overflow abrir sozinho. */
const OVERFLOW_PEEK_MS = 500;

/* Duracao do deslizamento dos vizinhos quando a ordem muda. */
const REORDER_MS = 130;

const PANEL_BOXES = {
    left: () => Main.panel._leftBox,
    center: () => Main.panel._centerBox,
    right: () => Main.panel._rightBox,
};

/**
 * Gerenciador de menus proprio da bandeja.
 *
 * O PopupMenuManager do Shell troca de menu assim que o ponteiro entra no
 * sourceActor de outro menu que ele gerencia (popupMenu.js,
 * _onCapturedEvent -> _changeMenu). Entre os botoes do painel isso e util,
 * mas numa bandeja significa que, com qualquer menu aberto, passar o mouse
 * sobre os icones abre o menu de cada app do caminho - inclusive quando o
 * usuario so esta indo pegar um icone para arrastar.
 *
 * Aqui a troca por hover e por foco fica desligada: menu de indicador so
 * abre por clique. Ficar fora do Main.panel.menuManager tambem impede que
 * um menu do proprio GNOME (Quick Settings, calendario) puxe os nossos.
 */
class TrayMenuManager extends PopupMenu.PopupMenuManager {
    _changeMenu() {
    }
}

export class LionTray {
    /**
     * @param {Gio.Settings} settings
     * @param {object} [callbacks]
     * @param {Function} [callbacks.openPreferences] abre a janela de preferencias
     */
    constructor(settings, callbacks = {}) {
        this._settings = settings;
        this._openPreferences = callbacks.openPreferences ?? null;

        this._items = new Map();     // key -> {key, sni, button}
        this._byBus = new Map();     // "busName+path" -> key
        this._pending = new Set();   // "busName+path" em carregamento
        this._draggingKey = null;
        this._dragActive = false;
        this._keepOverflowOpenAfterDrag = false;
        this._writingSettings = false;
        this._syncLaterId = 0;
        this._peekId = 0;
        this._conflict = null;
        this._destroyed = false;

        this._order = settings.get_strv('order');
        this._hidden = new Set(settings.get_strv('hidden'));
        this._pinned = new Set(settings.get_strv('pinned'));

        this.menuManager = new TrayMenuManager(this);
        this.theme = new ThemeVariant();
        this.tooltip = new Tooltip();

        this._buildUI();

        this._settingsIds = [
            settings.connect('changed::icon-size', () => this._onIconSizeChanged()),
            settings.connect('changed::hide-overflow-when-empty', () => this._sync()),
            settings.connect('changed::show-overflow-count', () => this._sync()),
            settings.connect('changed::hide-passive', () => this._sync()),
            settings.connect('changed::panel-box', () => this._placeInPanel()),
            settings.connect('changed::panel-position', () => this._placeInPanel()),
            settings.connect('changed::order', () => this._reloadFromSettings()),
            settings.connect('changed::hidden', () => this._reloadFromSettings()),
            settings.connect('changed::pinned', () => this._reloadFromSettings()),
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
        this.theme.track(this._container);

        this._trayBox = new St.BoxLayout({
            style_class: 'liontray-box',
            reactive: true,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._trayBox._delegate = {
            handleDragOver: (source, actor, x) => this._onDragOverBox(this._trayBox, source, x),
            acceptDrop: (source, actor, x) => this._onDropInTray(source, x),
        };

        this._buildOverflowButton();

        this._container.add_child(this._trayBox);
        this._container.add_child(this._overflowButton);

        this._placeInPanel();

        this._buildOverflowWindow();
        this._buildOverflowContextMenu();
        this._updateIconSize();
        this._sync();
    }

    _buildOverflowButton() {
        this._overflowIcon = new St.Icon({
            icon_name: 'pan-up-symbolic',
            style_class: 'liontray-icon',
        });
        this._overflowCount = new St.Label({
            style_class: 'liontray-overflow-count',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });

        const content = new St.BoxLayout({
            style_class: 'liontray-overflow-content',
            y_align: Clutter.ActorAlign.CENTER,
        });
        content.add_child(this._overflowIcon);
        content.add_child(this._overflowCount);

        this._overflowButton = new St.Button({
            style_class: 'panel-button liontray-item liontray-overflow-button',
            reactive: true,
            can_focus: true,
            track_hover: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
            y_align: Clutter.ActorAlign.CENTER,
            child: content,
        });
        this._overflowButton._delegate = {
            handleDragOver: source => this._onDragOverOverflowButton(source),
            acceptDrop: source => this._onDropInOverflow(source, -1),
        };

        this._overflowButton.connect('button-press-event', (_a, event) => {
            // o ponteiro nao se move ao clicar, entao a dica ja agendada
            // ainda apareceria - por cima do popup que esta abrindo
            this.tooltip?.hide();
            if (event.get_button() === Clutter.BUTTON_SECONDARY) {
                this._overflowWindow.close();
                this._overflowContextMenu.toggle();
            } else {
                this._overflowContextMenu.close();
                this._overflowWindow.toggle();
            }
            return Clutter.EVENT_STOP;
        });
        // o caminho acima consome o clique do mouse; `clicked` so sobra
        // para Enter/espaco, que e como o teclado chega aqui
        this._overflowButton.connect('clicked', () => {
            this._overflowContextMenu.close();
            this._overflowWindow.toggle();
        });
        this._overflowButton.connect('notify::hover', () => {
            if (this._overflowButton.hover && !this._dragActive)
                this.tooltip?.scheduleFor(this._overflowButton, this._overflowTooltip());
            else
                this.tooltip?.hide();
        });
    }

    _overflowTooltip() {
        const count = this._hiddenKeys().length;
        if (count === 0)
            return 'Indicadores ocultos (vazio)';
        return count === 1
            ? '1 indicador oculto'
            : `${count} indicadores ocultos`;
    }

    _buildOverflowWindow() {
        this._overflowWindow = new OverflowWindow(this._overflowButton);
        this._overflowWindow.actor.add_style_class_name('liontray-overflow-menu');
        this.theme.track(this._overflowWindow.actor);

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
            text: 'Arraste ícones aqui para ocultá-los',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._overflowBox.add_child(this._emptyLabel);

        this._overflowItem.add_child(this._overflowBox);
        this._overflowWindow.add_child(this._overflowItem);
    }

    /**
     * Menu de contexto do ▲: um lugar para as preferencias que nao exija
     * decorar `gnome-extensions prefs liontray@lionflow.dev`. Fica no
     * botao direito de proposito - o popup normal continua sendo so a
     * lista de indicadores ocultos.
     */
    _buildOverflowContextMenu() {
        this._overflowContextMenu =
            new PopupMenu.PopupMenu(this._overflowButton, 0.5, St.Side.TOP);
        this._overflowContextMenu.actor.add_style_class_name('liontray-context-menu');
        this.theme.track(this._overflowContextMenu.actor);

        const prefs = new PopupMenu.PopupImageMenuItem(
            'Preferências do LionTray', 'emblem-system-symbolic');
        prefs.connect('activate', () => {
            this._overflowContextMenu.close();
            this._openPreferences?.();
        });
        this._overflowContextMenu.addMenuItem(prefs);

        Main.layoutManager.uiGroup.add_child(this._overflowContextMenu.actor);
        this._overflowContextMenu.actor.hide();
        this.menuManager.addMenu(this._overflowContextMenu);
    }

    /**
     * Coloca a bandeja na caixa e no indice escolhidos. O painel tem tres
     * caixas (esquerda, centro, direita); dentro delas a posicao e um
     * indice simples, e a ordem dos indicadores continua sendo assunto do
     * arrastar.
     */
    _placeInPanel() {
        if (this._destroyed || !this._container)
            return;

        const name = this._settings.get_string('panel-box');
        const box = (PANEL_BOXES[name] ?? PANEL_BOXES.right)();
        if (!box)
            return;

        const parent = this._container.get_parent();
        if (parent === box) {
            // ja estamos na caixa: o proprio container conta no total
            const index = Math.min(this._settings.get_int('panel-position'),
                box.get_n_children() - 1);
            box.set_child_at_index(this._container, Math.max(index, 0));
            return;
        }

        parent?.remove_child(this._container);
        const index = Math.min(this._settings.get_int('panel-position'),
            box.get_n_children());
        box.insert_child_at_index(this._container, index);
    }

    closeOverflow() {
        this._overflowWindow?.close();
        this._overflowContextMenu?.close();
    }

    get dragInProgress() {
        return this._dragActive;
    }

    /**
     * Fecha o overflow, os menus dos indicadores e o menu do painel que
     * porventura esteja aberto.
     *
     * Comecar um arraste com a bandeja limpa evita que menus de indicadores
     * ou o menu de contexto concorram com os alvos de drop.
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

    /** Um indicador mudou de Status; Passive muda onde ele deve aparecer. */
    onItemStatusChanged(_button) {
        this._syncLater();
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

    /**
     * Ocultacao automatica de indicadores passivos.
     *
     * `Passive` no protocolo StatusNotifierItem quer dizer "estou
     * registrado, mas nao tenho nada a dizer agora" - o caso do
     * update-notifier do Zorin, que fica no barramento o tempo todo e so
     * interessa quando ha atualizacao. Some do painel e volta sozinho ao
     * mudar para Active ou NeedsAttention.
     *
     * Nao mexe em `_hidden`: o estado do usuario continua intacto por
     * baixo. E arrastar o item para o painel fixa-o (`_pinned`), o que da
     * a ultima palavra a quem esta na frente da tela.
     */
    _autoHidden(key) {
        if (!this._settings.get_boolean('hide-passive'))
            return false;
        if (this._hidden.has(key) || this._pinned.has(key))
            return false;
        return this._items.get(key)?.sni.status === 'Passive';
    }

    _visibleKeys() {
        return this._orderedKeys().filter(k =>
            this._items.has(k) && !this._hidden.has(k) && !this._autoHidden(k));
    }

    _hiddenKeys() {
        return this._orderedKeys().filter(k =>
            this._items.has(k) && (this._hidden.has(k) || this._autoHidden(k)));
    }

    _sync() {
        if (this._destroyed)
            return;

        const visible = this._visibleKeys();
        const hidden = this._hiddenKeys();

        this._reparent(this._trayBox, visible.map(k => this._items.get(k).button));
        this._reparent(this._overflowBox, hidden.map(k => this._items.get(k).button));

        this._emptyLabel.visible = hidden.length === 0;
        this._overflowBox.set_child_at_index(this._emptyLabel, hidden.length);

        const showCount = this._settings.get_boolean('show-overflow-count') &&
            hidden.length >= MIN_COUNT_BADGE;
        this._overflowCount.visible = showCount;
        if (showCount)
            this._overflowCount.text = String(hidden.length);

        const showOverflow = hidden.length > 0 || this._dragActive ||
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

    /**
     * Poe `actors` em `box`, nessa ordem, e desliza quem mudou de lugar.
     *
     * A animacao dispensa medir alocacoes: todos os botoes tem a mesma
     * largura (icone quadrado + padding uniforme), entao a distancia
     * percorrida e a diferenca de indice vezes a largura de um item. Sai
     * exata e sincrona, sem esperar o proximo layout.
     */
    _reparent(box, actors) {
        // posicoes de antes da reordenacao: nada foi realocado ainda, entao
        // `x` ainda e o valor do frame anterior
        const before = box.get_children()
            .filter(c => c.isLionTrayItem)
            .map(actor => ({actor, x: actor.x}));

        actors.forEach((actor, index) => {
            const parent = actor.get_parent();
            if (parent !== box) {
                parent?.remove_child(actor);
                box.add_child(actor);
            }
            box.set_child_at_index(actor, index);
        });

        this._animateReorder(box, before);
    }

    /**
     * Desliza os indicadores que mudaram de lugar.
     *
     * Comeca zerando `translation_x` de todos. Sem isso, um item que sai da
     * caixa no meio da animacao - ou que e desmapeado junto com o popup de
     * overflow ao fechar - fica com o deslocamento congelado e passa a ser
     * desenhado por cima do vizinho.
     */
    _animateReorder(box, before) {
        const items = box.get_children().filter(c => c.isLionTrayItem);

        for (const item of items) {
            item.remove_transition('translation-x');
            item.translation_x = 0;
        }

        // dentro de um popup fechado nao ha alocacao valida para medir, e
        // animar o que ninguem ve so cria estado para dar errado
        if (!box.mapped)
            return;

        // Passo real entre dois itens, ja incluindo o `spacing` da caixa -
        // a bandeja usa 0 e o overflow usa 2px. Com menos de dois itens
        // antes, nenhum deles pode ter trocado de posicao.
        if (before.length < 2)
            return;

        // Medido, nao calculado: em RTL a caixa cresce para a esquerda e o
        // passo ja sai negativo sozinho, sem precisar de correcao de sinal.
        const step = before[1].x - before[0].x;
        if (step === 0)
            return;

        const previousItems = before.map(entry => entry.actor);

        items.forEach((child, index) => {
            const previous = previousItems.indexOf(child);
            if (previous < 0 || previous === index)
                return;

            child.translation_x = (previous - index) * step;
            child.ease({
                translation_x: 0,
                duration: REORDER_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
    }

    _onIconSizeChanged() {
        this._updateIconSize();
        for (const {button} of this._items.values())
            button.sync();
    }

    _updateIconSize() {
        const size = this.iconSize;
        this._overflowIcon.icon_size = size;
        this._conflictButton?.get_child().set({icon_size: size});
        this._dropIndicatorWidth = Math.max(2, Math.round(size / 8));
    }

    /* ---------------------------------------------------------------- */
    /* drag-and-drop                                                     */
    /* ---------------------------------------------------------------- */

    onDragBegin(button) {
        this._draggingKey = button.key;
        this._dragActive = true;
        this._keepOverflowOpenAfterDrag = false;
        this.tooltip?.hide();
        // o botao de overflow precisa existir para receber o drop mesmo
        // quando nenhum indicador esta oculto
        this._overflowButton.visible = true;

        // Pegar um item que vive no overflow: a janela precisa continuar
        // aberta, senao nao ha onde reordenar la dentro.
        const fromOverflow = button.get_parent() === this._overflowBox;
        if (fromOverflow)
            this._overflowWindow.setDismissalSuspended(true);
        this.closeAllMenus();
        if (fromOverflow)
            this._overflowWindow.open(BoxPointer.PopupAnimation.NONE);
    }

    onDragEnd() {
        this._draggingKey = null;
        this._dragActive = false;
        this._cancelOverflowPeek();
        this._removeIndicator();
        this._clearDropTarget();
        if (this._keepOverflowOpenAfterDrag)
            this._overflowWindow.resumeDismissalAfterDrag();
        else {
            this._overflowWindow.setDismissalSuspended(false);
            this.closeOverflow();
        }
        this._keepOverflowOpenAfterDrag = false;
        this._syncLater();
    }

    _draggingActor() {
        return this._draggingKey
            ? this._items.get(this._draggingKey)?.button ?? null
            : null;
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
        this._indicatorBox = null;
        this._indicatorIndex = -1;
    }

    /**
     * Poe o marcador antes do `index`-esimo indicador de `box`.
     *
     * O indice vem de `_indexForX`, que conta so os indicadores. A caixa
     * tem tambem o proprio marcador, a etiqueta de "vazio" e o item sendo
     * arrastado, entao ele nao serve como indice bruto de filho - traduzir
     * os dois e o que mantem o marcador no lugar que o usuario ve.
     */
    _showIndicator(box, index) {
        if (this._indicatorBox === box && this._indicatorIndex === index)
            return;

        const indicator = this._indicator();
        // sair da caixa antes de recalcular: assim o indice bruto nao
        // depende de onde o marcador estava
        indicator.get_parent()?.remove_child(indicator);
        box.insert_child_at_index(indicator, this._rawIndex(box, index));

        this._indicatorBox = box;
        this._indicatorIndex = index;
    }

    /** Indice de filho correspondente ao `index`-esimo indicador. */
    _rawIndex(box, index) {
        const dragging = this._draggingActor();
        const children = box.get_children();
        let seen = 0;

        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child === this._dropIndicator || child === this._emptyLabel ||
                child === dragging)
                continue;
            if (seen === index)
                return i;
            seen++;
        }
        return children.length;
    }

    /**
     * Indice de insercao a partir da coordenada X local da caixa.
     *
     * O item arrastado continua na caixa (apagado) durante o arraste, mas
     * nao conta: `_place` calcula a posicao contra a lista de irmaos, ja
     * sem ele.
     */
    _indexForX(box, x) {
        const dragging = this._draggingActor();
        let index = 0;
        for (const child of box.get_children()) {
            if (child === this._dropIndicator || child === this._emptyLabel ||
                child === dragging)
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
        this._cancelOverflowPeek();
        this._clearDropTarget();
        this._showIndicator(box, this._indexForX(box, x));
        return DND.DragMotionResult.MOVE_DROP;
    }

    _onDragOverOverflowButton(source) {
        if (!source?.isLionTrayItem)
            return DND.DragMotionResult.NO_DROP;
        this._removeIndicator();
        this._overflowButton.add_style_class_name('liontray-drop-target');
        this._scheduleOverflowPeek();
        return DND.DragMotionResult.MOVE_DROP;
    }

    _clearDropTarget() {
        this._overflowButton?.remove_style_class_name('liontray-drop-target');
    }

    /**
     * Segurar o item sobre o ▲ abre o overflow. Sem isso, reposicionar um
     * indicador ja oculto exigiria soltar, clicar e arrastar de novo.
     */
    _scheduleOverflowPeek() {
        if (this._peekId || this._overflowWindow.isOpen)
            return;
        this._peekId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, OVERFLOW_PEEK_MS, () => {
                this._peekId = 0;
                if (this._dragActive && !this._destroyed) {
                    this._overflowWindow.setDismissalSuspended(true);
                    this._overflowWindow.open(BoxPointer.PopupAnimation.NONE);
                }
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelOverflowPeek() {
        if (this._peekId) {
            GLib.source_remove(this._peekId);
            this._peekId = 0;
        }
    }

    _onDropInTray(source, x) {
        if (!source?.isLionTrayItem)
            return false;
        this._keepOverflowOpenAfterDrag = false;
        const index = this._indexForX(this._trayBox, x);
        this._removeIndicator();
        this._clearDropTarget();
        this._place(source.key, index, false);
        return true;
    }

    _onDropInOverflow(source, index) {
        if (!source?.isLionTrayItem)
            return false;
        this._keepOverflowOpenAfterDrag = true;
        this._removeIndicator();
        this._clearDropTarget();
        this._place(source.key, index, true);
        return true;
    }

    /**
     * Move `key` para a posicao `index` da lista visivel ou oculta.
     * index < 0 significa "no fim".
     */
    _place(key, index, hidden) {
        this._draggingKey = null;

        if (hidden) {
            this._hidden.add(key);
            this._pinned.delete(key);
        } else {
            this._hidden.delete(key);
            // Fixar so quando o item esta Passive neste momento, ou seja,
            // quando o gesto contraria a ocultacao automatica. Reordenar um
            // indicador ativo nao pode desligar a regra em silencio para
            // ele; contrariar a regra explicitamente, sim.
            if (this._items.get(key)?.sni.status === 'Passive')
                this._pinned.add(key);
        }

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
    /* teclado                                                           */
    /* ---------------------------------------------------------------- */

    _isHidden(key) {
        return this._hidden.has(key) || this._autoHidden(key);
    }

    /** Ctrl+seta: move o indicador focado uma casa na lista em que esta. */
    moveByKey(button, delta) {
        const hidden = this._isHidden(button.key);
        const siblings = hidden ? this._hiddenKeys() : this._visibleKeys();
        const from = siblings.indexOf(button.key);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= siblings.length)
            return false;

        this._place(button.key, to, hidden);
        button.grab_key_focus();
        return true;
    }

    /**
     * Ctrl+baixo manda para o overflow, Ctrl+cima traz de volta.
     *
     * Ao ocultar, o foco vai para o ▲ - e para onde o item foi, e deixar o
     * foco em um ator que agora vive dentro de um popup fechado tiraria a
     * navegacao por teclado do painel.
     */
    setHiddenByKey(button, hidden) {
        if (this._isHidden(button.key) === hidden)
            return false;

        this._place(button.key, -1, hidden);
        if (hidden)
            this._overflowButton.grab_key_focus();
        else
            button.grab_key_focus();
        return true;
    }

    /* ---------------------------------------------------------------- */
    /* conflito de watcher                                               */
    /* ---------------------------------------------------------------- */

    /**
     * Sem a posse de org.kde.StatusNotifierWatcher a bandeja fica vazia. A
     * notificacao do bootstrap avisa uma vez; este botao fica no painel
     * enquanto o problema durar, para o motivo continuar a um clique de
     * distancia.
     *
     * @param {?{title: string, body: string}} info null limpa o aviso
     */
    setWatcherConflict(info) {
        if (this._destroyed)
            return;

        this._conflict = info;

        if (!info) {
            this._conflictButton?.destroy();
            this._conflictButton = null;
            this._conflictMenu = null;
            return;
        }

        if (!this._conflictButton)
            this._buildConflictButton();

        this._conflictLabel.text = info.body;
        this._conflictButton.accessible_name = info.title;
    }

    _buildConflictButton() {
        this._conflictButton = new St.Button({
            style_class: 'panel-button liontray-item liontray-conflict',
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
            child: new St.Icon({
                icon_name: 'dialog-warning-symbolic',
                style_class: 'liontray-icon',
                icon_size: this.iconSize,
            }),
        });
        this._container.insert_child_at_index(this._conflictButton, 0);

        this._conflictMenu =
            new PopupMenu.PopupMenu(this._conflictButton, 0.5, St.Side.TOP);
        this._conflictMenu.actor.add_style_class_name('liontray-context-menu');
        this.theme.track(this._conflictMenu.actor);

        const textItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'liontray-conflict-item',
        });
        this._conflictLabel = new St.Label({style_class: 'liontray-conflict-text'});
        this._conflictLabel.clutter_text.line_wrap = true;
        textItem.add_child(this._conflictLabel);
        this._conflictMenu.addMenuItem(textItem);

        this._conflictMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const prefs = new PopupMenu.PopupImageMenuItem(
            'Preferências do LionTray', 'emblem-system-symbolic');
        prefs.connect('activate', () => {
            this._conflictMenu.close();
            this._openPreferences?.();
        });
        this._conflictMenu.addMenuItem(prefs);

        Main.layoutManager.uiGroup.add_child(this._conflictMenu.actor);
        this._conflictMenu.actor.hide();
        this.menuManager.addMenu(this._conflictMenu);

        this._conflictButton.connect('clicked', () => this._conflictMenu.toggle());
        this._conflictButton.connect('notify::hover', () => {
            if (this._conflictButton.hover)
                this.tooltip?.scheduleFor(this._conflictButton, this._conflict?.title);
            else
                this.tooltip?.hide();
        });
        this._conflictButton.connect('destroy', () => {
            this.theme?.untrack(this._conflictMenu.actor);
            this.menuManager.removeMenu(this._conflictMenu);
            this._conflictMenu.destroy();
        });
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
            for (const k of drop) {
                this._hidden.delete(k);
                this._pinned.delete(k);
            }
        }

        const known = new Set(this._order);
        const hidden = [...this._hidden].filter(k => known.has(k));
        const pinned = [...this._pinned].filter(k => known.has(k));

        this._writingSettings = true;
        try {
            this._settings.set_strv('order', this._order);
            this._settings.set_strv('hidden', hidden);
            this._settings.set_strv('pinned', pinned);
        } finally {
            this._writingSettings = false;
        }
    }

    _reloadFromSettings() {
        if (this._writingSettings || this._destroyed)
            return;
        this._order = this._settings.get_strv('order');
        this._hidden = new Set(this._settings.get_strv('hidden'));
        this._pinned = new Set(this._settings.get_strv('pinned'));
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
        this._cancelOverflowPeek();

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

        this.tooltip.destroy();
        this.tooltip = null;

        this._overflowWindow?.destroy();
        this._overflowWindow = null;

        const contextMenu = this._overflowContextMenu;
        this._overflowContextMenu = null;
        if (contextMenu) {
            this.menuManager.removeMenu(contextMenu);
            contextMenu.destroy();
        }

        // o handler de destroy do botao cuida do menu de conflito
        this._conflictButton?.destroy();
        this._conflictButton = null;
        this._conflictMenu = null;

        this.theme.destroy();
        this.theme = null;

        this._container?.destroy();
        this._container = null;
        this._trayBox = null;
        this._overflowBox = null;
        this._overflowButton = null;
        this._overflowIcon = null;
        this._overflowCount = null;
        this._emptyLabel = null;
    }
}
