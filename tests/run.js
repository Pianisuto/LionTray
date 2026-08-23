import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {StatusNotifierWatcher} from './lib/watcher.js';
import {StatusNotifierItem} from './lib/statusNotifierItem.js';
import * as IconResolver from './lib/iconResolver.js';
import {makeStableKey, dbusCall, MENU_IFACE} from './lib/util.js';
import {FakeItem} from './fakeItem.js';

let failures = 0;
function check(label, cond, extra = '') {
    print(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  -> ' + extra : ''}`);
    if (!cond) failures++;
}

const loop = new GLib.MainLoop(null, false);

async function main() {
    IconResolver.init('liontray-test');

    const watcher = new StatusNotifierWatcher();
    const added = [];
    const removed = [];
    watcher.connect('item-added', (_w, bus, path) => added.push([bus, path]));
    watcher.connect('item-removed', (_w, bus, path) => removed.push([bus, path]));
    watcher.start();

    await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => (r(), GLib.SOURCE_REMOVE)));

    // 1. o watcher e dono do nome e se anuncia como host
    const owner = await dbusCall('org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', 'NameHasOwner',
        new GLib.Variant('(s)', ['org.kde.StatusNotifierWatcher']));
    check('watcher e dono de org.kde.StatusNotifierWatcher', owner.deep_unpack()[0] === true);

    const hostReg = await dbusCall('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher',
        'org.freedesktop.DBus.Properties', 'Get',
        new GLib.Variant('(ss)', ['org.kde.StatusNotifierWatcher', 'IsStatusNotifierHostRegistered']));
    check('IsStatusNotifierHostRegistered = true',
        hostReg.get_child_value(0).recursiveUnpack() === true);

    // 2. um item se registra
    const fake = new FakeItem(false);
    await dbusCall('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher',
        'org.kde.StatusNotifierWatcher', 'RegisterStatusNotifierItem',
        new GLib.Variant('(s)', ['/StatusNotifierItem']));
    await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => (r(), GLib.SOURCE_REMOVE)));

    check('item-added emitido', added.length === 1, JSON.stringify(added));
    const [busName, objectPath] = added[0] ?? [];
    check('path do item correto', objectPath === '/StatusNotifierItem', objectPath);

    const listed = await dbusCall('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher',
        'org.freedesktop.DBus.Properties', 'Get',
        new GLib.Variant('(ss)', ['org.kde.StatusNotifierWatcher', 'RegisteredStatusNotifierItems']));
    check('RegisteredStatusNotifierItems lista o item',
        listed.get_child_value(0).recursiveUnpack().length === 1);

    // 3. leitura das propriedades do item
    const sni = new StatusNotifierItem(busName, objectPath);
    await sni.load();
    check('Id lido', sni.id === 'fakeindicator', sni.id);
    check('Title lido', sni.title === 'Fake Indicator', sni.title);
    check('Menu lido', sni.menuPath === '/MenuBar', String(sni.menuPath));
    check('ToolTip formatado', sni.tooltipText === 'Fake Indicator\ncorpo da dica',
        JSON.stringify(sni.tooltipText));
    check('IconPixmap chegou', (sni.props.IconPixmap ?? []).length === 2);

    // 4. chave estavel nao depende do nome D-Bus efemero
    const key = makeStableKey(sni.props, busName, objectPath);
    check('chave estavel = "fakeindicator"', key === 'fakeindicator', key);
    check('chave ignora o nome :1.x', !key.includes(':'), key);

    // 5. resolucao de icone: sem IconName cai no IconPixmap
    const iconFromPixmap = IconResolver.resolve(sni.props, 16);
    check('IconPixmap -> arquivo PNG no cache',
        iconFromPixmap instanceof Gio.FileIcon &&
        iconFromPixmap.get_file().get_path().endsWith('.png'),
        iconFromPixmap?.get_file?.().get_path());

    const iconFromName = IconResolver.resolve({IconName: 'folder', Status: 'Active'}, 16);
    check('IconName -> tema do sistema', iconFromName instanceof Gio.ThemedIcon,
        iconFromName?.constructor?.name);

    const iconFallback = IconResolver.resolve({IconName: 'nao-existe-em-lugar-nenhum'}, 16);
    check('IconName inexistente ainda devolve um GIcon', iconFallback !== null);

    // 6. metodos do protocolo
    sni.activate(10, 20);
    sni.secondaryActivate(1, 2);
    sni.scroll(-1, 'vertical');
    await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => (r(), GLib.SOURCE_REMOVE)));
    check('Activate/SecondaryActivate/Scroll chegaram no app',
        fake.activated.length === 3, JSON.stringify(fake.activated));

    // 7. sinal NewIcon dispara refresh
    let changed = 0;
    sni.connect('changed', () => changed++);
    fake.emitNewIcon();
    await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => (r(), GLib.SOURCE_REMOVE)));
    check('NewIcon -> evento "changed"', changed >= 1, `changed=${changed}`);

    // 8. parsing do layout DBusMenu
    const reply = await dbusCall(busName, '/MenuBar', MENU_IFACE, 'GetLayout',
        new GLib.Variant('(iias)', [0, -1, []]));
    const [revision, root] = reply.recursiveUnpack();
    check('GetLayout revision', revision === 1, String(revision));
    const children = root[2];
    check('5 entradas de primeiro nivel', children.length === 5, String(children.length));
    check('separador identificado', children[1][1].type === 'separator');
    check('toggle-state lido', children[2][1]['toggle-state'] === 1);
    check('submenu tem filhos', children[3][2].length === 2, String(children[3][2].length));
    check('icon-name lido', children[4][1]['icon-name'] === 'application-exit');
    check('label com mnemonico presente', children[0][1].label === '_Abrir janela');

    // 9. desconexao dinamica
    sni.destroy();
    watcher._removeItem(`${busName}${objectPath}`);
    check('item-removed emitido', removed.length === 1, JSON.stringify(removed));
    const after = await dbusCall('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher',
        'org.freedesktop.DBus.Properties', 'Get',
        new GLib.Variant('(ss)', ['org.kde.StatusNotifierWatcher', 'RegisteredStatusNotifierItems']));
    check('lista de itens ficou vazia',
        after.get_child_value(0).recursiveUnpack().length === 0);

    // 10. limpeza: o nome D-Bus e liberado e o cache de icones some
    const cachedPath = iconFromPixmap.get_file().get_path();
    watcher.destroy();
    IconResolver.shutdown();
    await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => (r(), GLib.SOURCE_REMOVE)));
    const stillOwned = await dbusCall('org.freedesktop.DBus', '/org/freedesktop/DBus',
        'org.freedesktop.DBus', 'NameHasOwner',
        new GLib.Variant('(s)', ['org.kde.StatusNotifierWatcher']));
    check('nome do watcher liberado no destroy', stillOwned.deep_unpack()[0] === false);
    check('cache de icones limpo no shutdown',
        !GLib.file_test(cachedPath, GLib.FileTest.EXISTS), cachedPath);

    print(failures === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${failures} FALHA(S)`);
    loop.quit();
    if (failures > 0) imports.system.exit(1);
}

main().catch(e => { printerr(`ERRO: ${e}\n${e.stack}`); loop.quit(); imports.system.exit(1); });
loop.run();
