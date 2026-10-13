const assert = require('assert/strict');
const install = require('./tests/helpers/feature-fixture.cjs')(require('./src/features/recent-folders.cjs'));
let now = 0, nextId = 0;
const timers = new Map();
const clock = { now: () => now, setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, time: now + delay }); return id; }, clearTimeout(id) { timers.delete(id); } };
function advance(ms) {
    const target = now + ms;
    while (true) {
        const next = [...timers.entries()].filter(([,t]) => t.time <= target).sort((a,b) => a[1].time - b[1].time)[0];
        if (!next) break;
        now = next[1].time; timers.delete(next[0]); next[1].fn();
    }
    now = target;
}
class Panel {
    async refreshRemote() { this._remoteError = this.remotePath === '/denied'; if (this._remoteError) return false; this._customLastRemoteFolder = this.remotePath; return true; }
    async refreshLocal() { this._customLastLocalFolder = this.localPath; }
    trackTransfer() { return 'tracked'; }
    async _activateEntry(side, entry) { if (entry.isDirectory) { this[side + 'Path'] = entry.fullPath; await this[side === 'remote' ? 'refreshRemote' : 'refreshLocal'](); } }
    isDirByMode(mode) { return (mode & 0xf000) === 0x4000; }
    confirmInputDialog() {} confirmPermDialog() {} confirmDelete() {}
    disconnect() { this.connected = false; }
    ngOnDestroy() { this._destroyed = true; }
}
class Settings {}
class Bookmark {}
install({ Panel, Settings, Bookmark, clock });
const defaults = { recentFolderLimit: 5, recentFolderDwellSeconds: 10, recentFolderEntries: [] };
const { proxy, backing } = require('./tests/helpers/config-proxy-fixture.cjs')(defaults);
let saves = 0;
const configService = { store: { 'tabby-sftp-plus-plus': proxy }, save() { proxy.__cleanup(); saves++; } };
const make = (host = 'one', user = 'user') => Object.assign(new Panel(), { connected: true, sftpSession: {}, profile: { options: { host, username: user } }, configService, bookmarkPane: 'remote', localPath: 'C:\\work', remotePath: '/' });
const go = async (panel, folder) => { panel.remotePath = folder; await panel.refreshRemote(); };
const transfer = panel => panel.trackTransfer({}, 'download', panel.remotePath + '/file.py', 'D:\\other\\file.py');
(async () => {
    const p = make(); await go(p, '/a'); advance(9000); await go(p, '/b'); advance(10000);
    assert.equal(p.customRecentFolders().length, 0, 'quick visit and exactly threshold are excluded');
    advance(1); assert.equal(p.customRecentFolders()[0].path, '/b'); assert.equal(backing.recentFolderEntries[0].path, '/b', 'actual ConfigProxy backing stores entries');
    await go(p, '/c'); advance(6000); await p.refreshRemote(); advance(4001);
    assert.equal(p.customRecentFolders()[0].path, '/c', 'refresh does not reset dwell');
    await go(p, '/file'); assert.equal(transfer(p), 'tracked'); assert.equal(p.customRecentFolders()[0].path, '/file', 'file operation bypasses dwell');
    advance(350);
    const savedCount = saves, stableItems = p.customRecentFolders();
    for (let i = 0; i < 1000; i++) { transfer(p); assert.equal(p.customRecentFolders(), stableItems, 'idle renders retain array and row identity'); }
    advance(20000); assert.equal(saves, savedCount, '1000 same-folder file actions do not save config or reset UI');
    await go(p, '/denied'); advance(20000); assert.ok(!p.customRecentFolders().some(row => row.path === '/denied'), 'failed folder is excluded');
    await go(p, '/disconnect'); p.disconnect(); advance(20000); assert.ok(!p.customRecentFolders().some(row => row.path === '/disconnect'));
    p.connected = true; await go(p, '/destroy'); p.ngOnDestroy(); advance(20000); assert.ok(!p.customRecentFolders().some(row => row.path === '/destroy'));
    const restored = make(); assert.equal(restored.customRecentFolders()[0].path, '/file', 'reopened panel restores config history');
    assert.equal(make('two').customRecentFolders().length, 0, 'other server isolated'); assert.equal(make('one', 'other').customRecentFolders().length, 0, 'other account isolated');
    for (let i = 0; i < 12; i++) { await go(restored, '/folder' + i); transfer(restored); }
    const beforeBatchFlush = saves; advance(350); assert.equal(saves, beforeBatchFlush + 1, 'rapid folder changes share one config save');
    assert.equal(restored.customRecentFolders().length, 5);
    const settings = Object.assign(new Settings(), { configService });
    settings.setCustomRecentFolderLimit(20); assert.equal(settings.customRecentFolderLimit, 10); assert.equal(restored.customRecentFolders().length, 10);
    await go(restored, '/folder5'); transfer(restored); assert.equal(restored.customRecentFolders()[0].path, '/folder5'); assert.equal(restored.customRecentFolders().filter(row => row.path === '/folder5').length, 1, 'MRU deduplicates');
    await go(restored, '/changed-setting'); advance(1000); settings.setCustomRecentFolderDwellSeconds(2); advance(1001); assert.equal(restored.customRecentFolders()[0].path, '/changed-setting', 'dwell setting applies to current visit');
    await restored.refreshLocal(); await restored._activateEntry('local', { fullPath: 'C:\\work\\file.py', mode: 0x8000 });
    assert.equal(make('two').customRecentFolders('local')[0].path, 'C:\\work', 'local recent is separate and shared');
    settings.setCustomRecentFolderLimit(1); assert.equal(restored.customRecentFolders().length, 1);
    restored.ngOnDestroy(); assert.equal(timers.size, 0, 'no lifecycle timers left');
    console.log('PASS: Recent dwell, file operations, MRU limit, persistence through actual ConfigProxy, server/account isolation, refresh and lifecycle cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
