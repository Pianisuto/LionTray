/* Indicador falso: exercita IconPixmap, IconThemePath e DBusMenu. */
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const ITEM_XML = `
<node><interface name="org.kde.StatusNotifierItem">
  <property name="Id" type="s" access="read"/>
  <property name="Category" type="s" access="read"/>
  <property name="Title" type="s" access="read"/>
  <property name="Status" type="s" access="read"/>
  <property name="IconName" type="s" access="read"/>
  <property name="IconThemePath" type="s" access="read"/>
  <property name="IconPixmap" type="a(iiay)" access="read"/>
  <property name="ItemIsMenu" type="b" access="read"/>
  <property name="Menu" type="o" access="read"/>
  <property name="ToolTip" type="(sa(iiay)ss)" access="read"/>
  <method name="Activate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
  <method name="SecondaryActivate"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
  <method name="ContextMenu"><arg type="i" direction="in"/><arg type="i" direction="in"/></method>
  <method name="Scroll"><arg type="i" direction="in"/><arg type="s" direction="in"/></method>
  <signal name="NewIcon"/><signal name="NewStatus"><arg type="s"/></signal>
</interface></node>`;

const MENU_XML = `
<node><interface name="com.canonical.dbusmenu">
  <method name="GetLayout">
    <arg type="i" direction="in"/><arg type="i" direction="in"/><arg type="as" direction="in"/>
    <arg type="u" direction="out"/><arg type="(ia{sv}av)" direction="out"/>
  </method>
  <method name="Event">
    <arg type="i" direction="in"/><arg type="s" direction="in"/>
    <arg type="v" direction="in"/><arg type="u" direction="in"/>
  </method>
  <method name="AboutToShow"><arg type="i" direction="in"/><arg type="b" direction="out"/></method>
  <signal name="LayoutUpdated"><arg type="u"/><arg type="i"/></signal>
</interface></node>`;

function makePixmap(w, h) {
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = 255; data[i + 1] = 200; data[i + 2] = 100; data[i + 3] = 50;
    }
    return [w, h, data];
}

function node(id, props, children = []) {
    const entries = Object.entries(props).map(([k, v]) =>
        GLib.Variant.new_dict_entry(GLib.Variant.new_string(k), GLib.Variant.new_variant(v)));
    const dict = entries.length
        ? GLib.Variant.new_array(null, entries)
        : GLib.Variant.new_array(new GLib.VariantType('{sv}'), []);
    const kids = children.length
        ? GLib.Variant.new_array(null, children.map(c => GLib.Variant.new_variant(c)))
        : GLib.Variant.new_array(new GLib.VariantType('v'), []);
    return GLib.Variant.new_tuple([GLib.Variant.new_int32(id), dict, kids]);
}

export class FakeItem {
    constructor(withIconName) {
        this._withIconName = withIconName;
        this.activated = [];
        this.events = [];
        this._item = Gio.DBusExportedObject.wrapJSObject(ITEM_XML, this);
        this._item.export(Gio.DBus.session, '/StatusNotifierItem');
        this._menu = Gio.DBusExportedObject.wrapJSObject(MENU_XML, this);
        this._menu.export(Gio.DBus.session, '/MenuBar');
    }

    get Id() { return 'fakeindicator'; }
    get Category() { return 'ApplicationStatus'; }
    get Title() { return 'Fake Indicator'; }
    get Status() { return 'Active'; }
    get IconName() { return this._withIconName ? 'folder' : ''; }
    get IconThemePath() { return ''; }
    get IconPixmap() { return [makePixmap(22, 22), makePixmap(16, 16)]; }
    get ItemIsMenu() { return false; }
    get Menu() { return '/MenuBar'; }
    get ToolTip() { return ['', [], 'Fake Indicator', 'corpo da dica']; }

    Activate(x, y) { this.activated.push(['Activate', x, y]); }
    SecondaryActivate(x, y) { this.activated.push(['SecondaryActivate', x, y]); }
    ContextMenu(x, y) { this.activated.push(['ContextMenu', x, y]); }
    Scroll(delta, orientation) { this.activated.push(['Scroll', delta, orientation]); }

    GetLayoutAsync(_params, invocation) {
        const S = s => GLib.Variant.new_string(s);
        const B = b => GLib.Variant.new_boolean(b);
        const I = i => GLib.Variant.new_int32(i);
        const root = node(0, {'children-display': S('submenu')}, [
            node(1, {label: S('_Abrir janela'), enabled: B(true), visible: B(true)}),
            node(2, {type: S('separator')}),
            node(3, {label: S('Sincronizar'), 'toggle-type': S('checkmark'), 'toggle-state': I(1)}),
            node(4, {label: S('Preferencias'), 'children-display': S('submenu')}, [
                node(5, {label: S('Conta')}),
                node(6, {label: S('Oculto'), visible: B(false)}),
            ]),
            node(7, {label: S('Sair'), 'icon-name': S('application-exit')}),
        ]);
        invocation.return_value(GLib.Variant.new_tuple([GLib.Variant.new_uint32(1), root]));
    }

    EventAsync([id, eventId, data, ts], invocation) {
        this.events.push([id, eventId]);
        invocation.return_value(null);
    }

    AboutToShowAsync(_p, invocation) {
        invocation.return_value(new GLib.Variant('(b)', [false]));
    }

    emitNewIcon() { this._item.emit_signal('NewIcon', null); }
}
