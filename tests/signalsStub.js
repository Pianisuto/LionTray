export class EventEmitter {
    constructor() { this._handlers = new Map(); this._next = 1; }
    connect(name, cb) { const id = this._next++; this._handlers.set(id, [name, cb]); return id; }
    disconnect(id) { this._handlers.delete(id); }
    disconnectAll() { this._handlers.clear(); }
    emit(name, ...args) {
        for (const [n, cb] of [...this._handlers.values()])
            if (n === name) cb(this, ...args);
    }
}
