module.exports = function installRecentFolders({apis, Panel, Settings, Bookmark, Angular, clock = { now: Date.now, setTimeout, clearTimeout } }) {
    const path = require('path');
    const panels = new Set();
    const saves = new WeakMap();
    const outside = (owner, fn) => owner.zone?.runOutsideAngular ? owner.zone.runOutsideAngular(fn) : fn();
    const flush = owner => {
        const service = owner.configService, pending = service && saves.get(service);
        if (!pending) return;
        clock.clearTimeout(pending); saves.delete(service);
        try { Promise.resolve(service.save()).catch(error => owner.showToast?.('Cannot save recent folders: ' + error.message)); }
        catch (error) { owner.showToast?.('Cannot save recent folders: ' + error.message); }
    };
    const scheduleSave = owner => {
        const service = owner.configService;
        // Share one timer across panels and keep a fixed deadline even during large folder transfers.
        if (!service || saves.has(service)) return;
        saves.set(service, outside(owner, () => clock.setTimeout(() => flush(owner), 350)));
    };
    const config = owner => owner.configService?.store?.['tabby-sftp-plus-plus'];
    const integer = (value, fallback, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(1, Math.round(Number(value)))) : fallback;
    const limit = owner => integer(config(owner)?.recentFolderLimit ?? 5, 5, 10);
    const dwell = owner => integer(config(owner)?.recentFolderDwellSeconds ?? 10, 10, 86400);
    const server = owner => {
        const profile = owner.profile || owner.terminalRef?.profile || owner.host?.profile;
        const options = profile?.options;
        return options?.host ? JSON.stringify([options.host, options.port || 22, options.username || options.user || '']) : null;
    };
    const normalize = (side, folder) => side === 'remote' ? path.posix.normalize(folder) : path.win32.normalize(folder);
    const identity = (side, folder) => side === 'local' ? folder.toLowerCase() : folder;
    const bucket = (owner, side) => side === 'local' ? 'local' : server(owner);
    const rows = owner => Array.isArray(config(owner)?.recentFolderEntries) ? config(owner).recentFolderEntries : [];
    apis.Panel.customRecentFolders = function (side = this.bookmarkPane) {
        const key = bucket(this, side), source = rows(this), count = limit(this);
        const cache = this._customRecentCache ||= {};
        if (cache[side]?.source === source && cache[side].key === key && cache[side].count === count) return cache[side].items;
        const items = source.filter(row => row.side === side && row.server === key).slice(0, count).map(row => ({
            ...row, type: side, id: 'recent:' + row.path, name: (side === 'remote' ? path.posix : path.win32).basename(row.path) || row.path,
        }));
        cache[side] = { source, key, count, items };
        return items;
    };
    apis.Panel._customRecordRecent = function (side, folder) {
        const cfg = config(this), key = bucket(this, side);
        if (!cfg || !key || !folder || this._destroyed || (side === 'remote' && !this.connected)) return;
        folder = normalize(side, folder);
        const previous = rows(this), sameBucket = row => row.side === side && row.server === key;
        const first = previous.find(sameBucket);
        if (first && identity(side, first.path) === identity(side, folder)) return;
        const retained = previous.filter(row => sameBucket(row) && identity(side, row.path) !== identity(side, folder)).slice(0, 9);
        cfg.recentFolderEntries = [{ side, server: key, path: folder, lastVisited: clock.now() }, ...retained, ...previous.filter(row => !sameBucket(row))];
        scheduleSave(this);
        this._safeDetect?.();
    };
    apis.Panel._customStopRecent = function (side) {
        const state = this._customRecentVisits?.[side];
        if (state) clock.clearTimeout(state.timer);
        if (this._customRecentVisits) delete this._customRecentVisits[side];
    };
    apis.Panel._customArmRecent = function (side, state) {
        clock.clearTimeout(state.timer);
        if (state.recorded) return;
        state.timer = outside(this, () => clock.setTimeout(() => {
            if (this._destroyed || this[side + 'Path'] !== state.folder || bucket(this, side) !== state.bucket ||
                (side === 'remote' && (!this.connected || this.sftpSession !== state.session))) return this._customStopRecent(side);
            if (clock.now() - state.started <= dwell(this) * 1000) return this._customArmRecent(side, state);
            state.recorded = true;
            this._customRecordRecent(side, state.folder);
        }, Math.max(1, dwell(this) * 1000 + 1 - (clock.now() - state.started))));
    };
    apis.Panel._customVisitRecent = function (side, folder) {
        if (this._destroyed || !folder || !bucket(this, side) || (side === 'remote' && !this.connected)) return;
        panels.add(this);
        const visits = this._customRecentVisits ||= {}, previous = visits[side], key = bucket(this, side);
        if (previous?.folder === folder && previous.bucket === key && (side === 'local' || previous.session === this.sftpSession)) return;
        this._customStopRecent(side);
        const state = visits[side] = { folder, bucket: key, session: this.sftpSession, started: clock.now(), recorded: false };
        this._customArmRecent(side, state);
    };
    apis.Panel._customRecentFileAction = function (side, folder = this[side + 'Path']) {
        if (!folder || this['_customLast' + (side === 'remote' ? 'Remote' : 'Local') + 'Folder'] !== folder) return;
        const state = this._customRecentVisits?.[side];
        if (state && state.folder === folder) { state.recorded = true; clock.clearTimeout(state.timer); }
        this._customRecordRecent(side, folder);
    };
    for (const side of ['local', 'remote']) {
        const name = side === 'remote' ? 'refreshRemote' : 'refreshLocal', original = apis.Panel[name];
        apis.Panel[name] = async function (...args) {
            const folder = this[side + 'Path'];
            if (this._customRecentVisits?.[side]?.folder !== folder) this._customStopRecent(side);
            const result = await original.apply(this, args);
            if (folder === this[side + 'Path'] && this['_customLast' + (side === 'remote' ? 'Remote' : 'Local') + 'Folder'] === folder &&
                !(side === 'remote' ? this._remoteError || result === false : this._localError)) this._customVisitRecent(side, folder);
            return result;
        };
    }
    const track = apis.Panel.trackTransfer;
    apis.Panel.trackTransfer = function (...args) {
        const result = track.apply(this, args);
        for (const [side, file] of [['remote', args[2]], ['local', args[3]]]) {
            const folder = this[side + 'Path'];
            if (!folder || !file) continue;
            const relative = (side === 'remote' ? path.posix : path.win32).relative(folder, file);
            if (relative && relative !== '..' && !relative.startsWith('../') && !relative.startsWith('..\\') && !(side === 'remote' ? path.posix : path.win32).isAbsolute(relative)) this._customRecentFileAction(side, folder);
        }
        return result;
    };
    const activate = apis.Panel._activateEntry;
    apis.Panel._activateEntry = async function (side, entry, ...args) {
        const folder = this[side + 'Path'];
        const result = await activate.call(this, side, entry, ...args);
        if (entry && !entry.isDirectory && !this.isDirByMode(entry.mode) && this[side + 'Path'] === folder) this._customRecentFileAction(side, folder);
        return result;
    };
    for (const name of ['confirmInputDialog', 'confirmPermDialog', 'confirmDelete']) {
        const original = apis.Panel[name];
        apis.Panel[name] = function (...args) {
            if (name === 'confirmInputDialog' && this.inputDialogVisible && !this._inputBusy && this.inputDialogValue?.trim()) {
                this._customRecentFileAction(this.inputDialogMode?.startsWith('local-') ? 'local' : 'remote');
            } else if (name === 'confirmPermDialog' && this.permTargetPath && this.sftpSession) this._customRecentFileAction('remote');
            else if (name === 'confirmDelete' && !this._deleteBusy) {
                if (this.pendingLocalDelete?.length) this._customRecentFileAction('local');
                if (this.pendingRemoteDelete?.length) this._customRecentFileAction('remote');
            }
            return original.apply(this, args);
        };
    }
    for (const name of ['disconnect', 'ngOnDestroy']) {
        const original = apis.Panel[name];
        apis.Panel[name] = function (...args) {
            this._customStopRecent('remote');
            if (name === 'ngOnDestroy') { this._customStopRecent('local'); panels.delete(this); flush(this); }
            return original.apply(this, args);
        };
    }
    for (const [property, key, fallback, max] of [['customRecentFolderLimit', 'recentFolderLimit', 5, 10], ['customRecentFolderDwellSeconds', 'recentFolderDwellSeconds', 10, 86400]]) {
        Object.defineProperty(apis.Settings, property, { configurable: true, get() { return integer(config(this)?.[key] ?? fallback, fallback, max); } });
        apis.Settings['set' + property[0].toUpperCase() + property.slice(1)] = function (value) {
            const cfg = config(this); if (!cfg) return;
            cfg[key] = integer(value, fallback, max); this.configService.save(); this.notifyPanels?.();
            for (const panel of panels) { for (const [side, state] of Object.entries(panel._customRecentVisits || {})) panel._customArmRecent(side, state); panel._safeDetect?.(); }
        };
    }

    apis.Bookmark.customTrackRecent = (_, row) => row.type + ':' + row.path;
};
