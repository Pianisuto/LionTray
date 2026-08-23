/* LionTray - resolucao de icones de StatusNotifierItem
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Cobre os tres caminhos que o ecossistema atual usa:
 *   - IconName resolvido no tema de icones do sistema;
 *   - IconName resolvido dentro de um IconThemePath proprio do app
 *     (Dropbox, Electron/Chromium, Flatpak com tema empacotado);
 *   - IconPixmap (ARGB32 em ordem de rede) embutido no proprio D-Bus.
 *
 * Pixmaps sao convertidos para PNG e gravados em um cache temporario,
 * porque St.Icon so aceita GIcon carregavel de forma estavel via arquivo.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import St from 'gi://St';

const IMAGE_EXTS = ['', '.png', '.svg', '.symbolic.png', '.xpm'];
const MAX_THEME_DEPTH = 4;

/* Ultimo recurso quando nem IconName, nem IconThemePath, nem IconPixmap
 * levam a lugar nenhum. Vale tambem como `fallback-icon-name` do St.Icon,
 * que cobre o caso de o GIcon existir mas falhar ao carregar - a diferenca
 * entre um icone generico honesto e o quadradinho de "image-missing". */
export const GENERIC_ICON = 'application-x-executable-symbolic';

let _cacheDir = null;
const _written = new Set();

export function init(uuid) {
    _cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), uuid]);
    GLib.mkdir_with_parents(_cacheDir, 0o700);
}

export function shutdown() {
    for (const path of _written) {
        try {
            GLib.unlink(path);
        } catch {
            // arquivo ja removido; nada a fazer
        }
    }
    _written.clear();
    _cacheDir = null;
}

/* ------------------------------------------------------------------ */
/* cache de arquivos                                                    */
/* ------------------------------------------------------------------ */

/** Grava bytes de imagem no cache e devolve um Gio.FileIcon. */
export function fileIconFromImageBytes(bytes) {
    if (!_cacheDir || !bytes || bytes.length === 0)
        return null;

    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const sum = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, data);
    const path = GLib.build_filenamev([_cacheDir, `${sum}.png`]);

    if (!_written.has(path)) {
        try {
            GLib.file_set_contents(path, data);
            _written.add(path);
        } catch (e) {
            console.warn(`[LionTray] falha ao gravar cache de icone: ${e}`);
            return null;
        }
    }
    return new Gio.FileIcon({file: Gio.File.new_for_path(path)});
}

/* ------------------------------------------------------------------ */
/* pixmaps                                                              */
/* ------------------------------------------------------------------ */

function pickPixmap(pixmaps, size) {
    const valid = (pixmaps || []).filter(e =>
        Array.isArray(e) && e.length >= 3 &&
        e[0] > 0 && e[1] > 0 && e[2] && e[2].length >= e[0] * e[1] * 4);
    if (valid.length === 0)
        return null;

    // menor pixmap com largura suficiente; senao o maior disponivel
    const bigEnough = valid.filter(e => e[0] >= size).sort((a, b) => a[0] - b[0]);
    return bigEnough.length > 0 ? bigEnough[0] : valid.sort((a, b) => b[0] - a[0])[0];
}

function pixmapToPngBytes(width, height, argb) {
    const n = width * height * 4;
    const rgba = new Uint8Array(n);
    for (let i = 0; i < n; i += 4) {
        rgba[i] = argb[i + 1];
        rgba[i + 1] = argb[i + 2];
        rgba[i + 2] = argb[i + 3];
        rgba[i + 3] = argb[i];
    }
    const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(
        GLib.Bytes.new(rgba), GdkPixbuf.Colorspace.RGB, true, 8,
        width, height, width * 4);
    const [ok, buf] = pixbuf.save_to_bufferv('png', [], []);
    return ok ? buf : null;
}

function iconFromPixmaps(pixmaps, size) {
    const entry = pickPixmap(pixmaps, size);
    if (!entry)
        return null;
    try {
        const png = pixmapToPngBytes(entry[0], entry[1], entry[2]);
        return png ? fileIconFromImageBytes(png) : null;
    } catch (e) {
        console.warn(`[LionTray] falha ao converter IconPixmap: ${e}`);
        return null;
    }
}

/* ------------------------------------------------------------------ */
/* nomes de icone                                                       */
/* ------------------------------------------------------------------ */

function fileIfExists(path) {
    return GLib.file_test(path, GLib.FileTest.EXISTS) && !GLib.file_test(path, GLib.FileTest.IS_DIR)
        ? new Gio.FileIcon({file: Gio.File.new_for_path(path)})
        : null;
}

/** Procura `name` dentro de um diretorio de tema arbitrario. */
function searchThemePath(dir, name, depth = 0) {
    for (const ext of IMAGE_EXTS) {
        const icon = fileIfExists(GLib.build_filenamev([dir, name + ext]));
        if (icon)
            return icon;
    }
    if (depth >= MAX_THEME_DEPTH)
        return null;

    let enumerator;
    try {
        enumerator = Gio.File.new_for_path(dir).enumerate_children(
            'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
    } catch {
        return null;
    }

    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        if (info.get_file_type() !== Gio.FileType.DIRECTORY)
            continue;
        const icon = searchThemePath(
            GLib.build_filenamev([dir, info.get_name()]), name, depth + 1);
        if (icon) {
            enumerator.close(null);
            return icon;
        }
    }
    enumerator.close(null);
    return null;
}

function nameFallbacks(name) {
    const out = [name];
    const lower = name.toLowerCase();
    if (lower !== name)
        out.push(lower);
    if (!name.endsWith('-symbolic'))
        out.push(`${name}-symbolic`);
    const stripped = name.replace(/-(panel|tray|indicator|symbolic)$/, '');
    if (stripped !== name)
        out.push(stripped);
    return out;
}

function themeHasIcon(names) {
    try {
        const theme = new St.IconTheme();
        return names.some(n => theme.has_icon(n));
    } catch {
        return true; // sem como checar: deixa o St.Icon tentar
    }
}

function iconFromName(name, themePath, size) {
    if (!name)
        return null;

    if (GLib.path_is_absolute(name)) {
        const icon = fileIfExists(name);
        if (icon)
            return icon;
    }

    if (themePath) {
        for (const dir of themePath.split(':').filter(d => d)) {
            const icon = searchThemePath(dir, name);
            if (icon)
                return icon;
        }
        try {
            const theme = new St.IconTheme();
            for (const dir of themePath.split(':').filter(d => d))
                theme.append_search_path(dir);
            const info = theme.lookup_icon(name, size, 0);
            const file = info?.get_filename();
            if (file) {
                const icon = fileIfExists(file);
                if (icon)
                    return icon;
            }
        } catch {
            // St.IconTheme indisponivel nesta versao; segue adiante
        }
    }

    const names = nameFallbacks(name);
    return themeHasIcon(names) ? new Gio.ThemedIcon({names}) : null;
}

/* ------------------------------------------------------------------ */
/* API principal                                                        */
/* ------------------------------------------------------------------ */

/**
 * Igual a `resolve`, mas informa tambem se o icone devolvido e o generico
 * de ultimo recurso. Quem chama usa isso para reforcar a identificacao por
 * outros meios (dica de nome, log), ja que o desenho em si nao diz mais
 * de que aplicativo se trata.
 *
 * @param {object} props propriedades do StatusNotifierItem
 * @param {number} size tamanho desejado, em pixels
 * @returns {{gicon: Gio.Icon, fallback: boolean}}
 */
export function resolveDetailed(props, size) {
    const attention = props?.Status === 'NeedsAttention';

    const name = (attention ? props?.AttentionIconName : '') || props?.IconName || '';
    const pixmaps = (attention && props?.AttentionIconPixmap?.length
        ? props.AttentionIconPixmap
        : props?.IconPixmap) || [];
    const themePath = props?.IconThemePath || '';

    const named = iconFromName(name, themePath, size);
    if (named)
        return {gicon: named, fallback: false};

    const pixmap = iconFromPixmaps(pixmaps, size);
    if (pixmap)
        return {gicon: pixmap, fallback: false};

    // Nome desconhecido e sem pixmap: ainda vale deixar a cadeia de
    // fallback do tema tentar.
    //
    // O generico NAO entra nesta lista. O Gio.ThemedIcon reordena os nomes
    // que recebe - ele mesmo gera as variantes `-symbolic` e as intercala -
    // e o generico acabaria sendo tentado antes da variante simbolica do
    // proprio app. O ultimo recurso fica com o `fallback-icon-name` do
    // St.Icon, que so entra em acao quando a cadeia inteira falhou.
    return {
        gicon: name
            ? new Gio.ThemedIcon({names: nameFallbacks(name)})
            : new Gio.ThemedIcon({name: GENERIC_ICON}),
        fallback: true,
    };
}

/**
 * Devolve o melhor GIcon possivel para as propriedades de um
 * StatusNotifierItem. Nunca retorna null.
 */
export function resolve(props, size) {
    return resolveDetailed(props, size).gicon;
}

/** Icone para uma entrada de DBusMenu (icon-name ou icon-data). */
export function resolveMenuIcon(props, size) {
    const name = props?.['icon-name'];
    if (name) {
        const icon = iconFromName(name, '', size);
        if (icon)
            return icon;
    }
    const data = props?.['icon-data'];
    if (data?.length)
        return fileIconFromImageBytes(data);
    return null;
}
