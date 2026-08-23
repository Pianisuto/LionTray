/* LionTray - preferencias minimas
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * A organizacao do dia a dia acontece por drag-and-drop no proprio
 * painel. Aqui ficam apenas as opcoes que nao cabem em um gesto.
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class LionTrayPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'LionTray',
            icon_name: 'view-grid-symbolic',
        });
        window.add(page);

        const appearance = new Adw.PreferencesGroup({title: 'Aparencia'});
        page.add(appearance);

        const sizeRow = new Adw.SpinRow({
            title: 'Tamanho dos icones',
            subtitle: 'Altura dos indicadores no painel, em pixels',
            adjustment: new Gtk.Adjustment({
                lower: 12,
                upper: 32,
                step_increment: 1,
                page_increment: 2,
            }),
        });
        appearance.add(sizeRow);
        settings.bind('icon-size', sizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);

        const overflowRow = new Adw.SwitchRow({
            title: 'Ocultar o botao de overflow quando vazio',
            subtitle: 'Ele reaparece automaticamente durante um arraste',
        });
        appearance.add(overflowRow);
        settings.bind('hide-overflow-when-empty', overflowRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        const organization = new Adw.PreferencesGroup({
            title: 'Organizacao',
            description: 'Reordene e oculte indicadores arrastando-os direto no painel.',
        });
        page.add(organization);

        const resetButton = new Gtk.Button({
            label: 'Resetar organizacao',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        const resetRow = new Adw.ActionRow({
            title: 'Resetar organizacao',
            subtitle: 'Limpa a ordem salva e mostra todos os indicadores',
            activatable_widget: resetButton,
        });
        resetRow.add_suffix(resetButton);
        organization.add(resetRow);

        resetButton.connect('clicked', () => {
            settings.reset('order');
            settings.reset('hidden');
        });
    }
}
