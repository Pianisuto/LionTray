/* LionTray - preferencias minimas
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A organizacao do dia a dia acontece por drag-and-drop no proprio
 * painel. Aqui ficam apenas as opcoes que nao cabem em um gesto.
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PANEL_BOXES = ['left', 'center', 'right'];
const PANEL_BOX_LABELS = ['Esquerda', 'Centro', 'Direita'];

const HOME_URL = 'https://github.com/Pianisuto/LionTray';

export default class LionTrayPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'LionTray',
            icon_name: 'view-grid-symbolic',
        });
        window.add(page);

        this._addAppearance(page, settings);
        this._addBehavior(page, settings);
        this._addOrganization(page, settings, window);
        this._addAbout(page);
    }

    /* ---------------------------------------------------------------- */

    _addAppearance(page, settings) {
        const group = new Adw.PreferencesGroup({title: 'Aparência'});
        page.add(group);

        const sizeRow = new Adw.SpinRow({
            title: 'Tamanho dos ícones',
            subtitle: 'Altura dos indicadores no painel, em pixels',
            adjustment: new Gtk.Adjustment({
                lower: 12,
                upper: 32,
                step_increment: 1,
                page_increment: 2,
            }),
        });
        group.add(sizeRow);
        settings.bind('icon-size', sizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const desaturateRow = new Adw.SwitchRow({
            title: 'Dessaturar os ícones',
            subtitle: 'Exibe os ícones dos aplicativos em tons de cinza',
        });
        group.add(desaturateRow);
        settings.bind('desaturate-icons', desaturateRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const boxRow = new Adw.ComboRow({
            title: 'Área do painel',
            subtitle: 'Em qual das três caixas do painel a bandeja vive',
            model: Gtk.StringList.new(PANEL_BOX_LABELS),
        });
        group.add(boxRow);
        boxRow.selected = Math.max(0,
            PANEL_BOXES.indexOf(settings.get_string('panel-box')));
        boxRow.connect('notify::selected', () =>
            settings.set_string('panel-box', PANEL_BOXES[boxRow.selected]));

        const positionRow = new Adw.SpinRow({
            title: 'Posição na área',
            subtitle: 'Índice entre os outros elementos da caixa; 0 é o primeiro',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 20,
                step_increment: 1,
                page_increment: 1,
            }),
        });
        group.add(positionRow);
        settings.bind('panel-position', positionRow, 'value',
            Gio.SettingsBindFlags.DEFAULT);
    }

    _addBehavior(page, settings) {
        const group = new Adw.PreferencesGroup({title: 'Comportamento'});
        page.add(group);

        const overflowRow = new Adw.SwitchRow({
            title: 'Ocultar o botão de overflow quando vazio',
            subtitle: 'Ele reaparece automaticamente durante um arraste',
        });
        group.add(overflowRow);
        settings.bind('hide-overflow-when-empty', overflowRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const countRow = new Adw.SwitchRow({
            title: 'Mostrar a contagem de ocultos',
            subtitle: 'Um número ao lado do botão a partir de dois indicadores',
        });
        group.add(countRow);
        settings.bind('show-overflow-count', countRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const passiveRow = new Adw.SwitchRow({
            title: 'Ocultar indicadores passivos',
            subtitle: 'Indicadores com Status=Passive vão para o overflow e ' +
                'voltam sozinhos ao ficarem ativos. Arrastar um deles para o ' +
                'painel fixa-o lá.',
        });
        group.add(passiveRow);
        settings.bind('hide-passive', passiveRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
    }

    _addOrganization(page, settings, window) {
        const group = new Adw.PreferencesGroup({
            title: 'Organização',
            description: 'Reordene e oculte indicadores arrastando-os direto no painel.',
        });
        page.add(group);

        const resetButton = new Gtk.Button({
            label: 'Resetar organização',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        const resetRow = new Adw.ActionRow({
            title: 'Resetar organização',
            subtitle: 'Limpa a ordem salva e mostra todos os indicadores',
            activatable_widget: resetButton,
        });
        resetRow.add_suffix(resetButton);
        group.add(resetRow);

        resetButton.connect('clicked', () => this._confirmReset(settings, window));
    }

    /**
     * Resetar joga fora `order`, `hidden` e `pinned` de uma vez, e nao ha
     * como desfazer. Um clique sem querer nao pode custar a organizacao
     * inteira.
     */
    _confirmReset(settings, window) {
        const doReset = () => {
            settings.reset('order');
            settings.reset('hidden');
            settings.reset('pinned');
        };

        const heading = 'Resetar a organização?';
        const body = 'A ordem dos indicadores e a lista de ocultos voltam ao ' +
            'padrão. Não dá para desfazer.';

        // Adw.AlertDialog existe a partir do libadwaita 1.5 (GNOME 46) e
        // substitui Adw.MessageDialog, depreciado no 1.6.
        if (Adw.AlertDialog) {
            const dialog = new Adw.AlertDialog({heading, body});
            dialog.add_response('cancel', 'Cancelar');
            dialog.add_response('reset', 'Resetar');
            dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
            dialog.set_default_response('cancel');
            dialog.set_close_response('cancel');
            dialog.connect('response', (_d, response) => {
                if (response === 'reset')
                    doReset();
            });
            dialog.present(window);
            return;
        }

        const dialog = new Adw.MessageDialog({
            transient_for: window,
            modal: true,
            heading,
            body,
        });
        dialog.add_response('cancel', 'Cancelar');
        dialog.add_response('reset', 'Resetar');
        dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_d, response) => {
            if (response === 'reset')
                doReset();
        });
        dialog.present();
    }

    _addAbout(page) {
        const group = new Adw.PreferencesGroup({title: 'Sobre'});
        page.add(group);

        group.add(new Adw.ActionRow({
            title: 'Versão',
            subtitle: String(this.metadata.version ?? 'desenvolvimento'),
        }));

        group.add(new Adw.ActionRow({
            title: 'GNOME Shell detectado',
            subtitle: this._shellVersion(),
        }));

        const watcher = new Adw.ActionRow({
            title: 'Bandeja do sistema',
            subtitle: this._watcherOwner(),
        });
        group.add(watcher);

        const link = new Gtk.LinkButton({
            label: 'Abrir',
            uri: HOME_URL,
            valign: Gtk.Align.CENTER,
        });
        const linkRow = new Adw.ActionRow({
            title: 'Código e relatos de problema',
            subtitle: HOME_URL,
            activatable_widget: link,
        });
        linkRow.add_suffix(link);
        group.add(linkRow);
    }

    /**
     * prefs.js roda fora do gnome-shell, entao a versao vem pelo D-Bus.
     */
    _shellVersion() {
        try {
            const reply = Gio.DBus.session.call_sync(
                'org.gnome.Shell', '/org/gnome/Shell',
                'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', ['org.gnome.Shell', 'ShellVersion']),
                null, Gio.DBusCallFlags.NONE, 1000, null);
            return reply.get_child_value(0).recursiveUnpack() || 'desconhecida';
        } catch {
            return 'desconhecida';
        }
    }

    /**
     * Quem esta com org.kde.StatusNotifierWatcher agora. Se nao for o
     * proprio gnome-shell, o LionTray nao vai receber indicador nenhum -
     * e este e o lugar mais provavel de o usuario procurar o porque.
     */
    _watcherOwner() {
        try {
            const owner = Gio.DBus.session.call_sync(
                'org.freedesktop.DBus', '/org/freedesktop/DBus',
                'org.freedesktop.DBus', 'GetNameOwner',
                new GLib.Variant('(s)', ['org.kde.StatusNotifierWatcher']),
                null, Gio.DBusCallFlags.NONE, 1000, null).deep_unpack()[0];

            const pid = Gio.DBus.session.call_sync(
                'org.freedesktop.DBus', '/org/freedesktop/DBus',
                'org.freedesktop.DBus', 'GetConnectionUnixProcessID',
                new GLib.Variant('(s)', [owner]),
                null, Gio.DBusCallFlags.NONE, 1000, null).deep_unpack()[0];

            const [, bytes] = GLib.file_get_contents(`/proc/${pid}/comm`);
            const command = new TextDecoder().decode(bytes).trim();

            return command === 'gnome-shell'
                ? `Controlada pelo GNOME Shell (pid ${pid})`
                : `Controlada por "${command}" (pid ${pid}) — o LionTray não ` +
                  'recebe indicadores enquanto isso durar';
        } catch {
            return 'Ninguém registrou org.kde.StatusNotifierWatcher';
        }
    }
}
