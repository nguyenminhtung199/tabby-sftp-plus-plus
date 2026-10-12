const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const install = require('./external-edit.cjs');
const root = path.join(__dirname, 'test-fixtures');
let counter = 0, opened = [], confirmations = 0, originalCalls = 0;
global.window = { confirm: () => { confirmations++; return false; } };
class Settings {}
class Panel {
    constructor() {
        this.connected = true; this.configService = { store: { 'tabby-sftp-plus': { fileOpenAction: 'external-edit' } } };
        this.zone = { run: fn => fn() }; this.messages = []; this.uploads = []; this.remote = new Map();
        this.sftpSession = { stat: async name => ({ ...this.remote.get(name) }) };
    }
    async _activateEntry() { originalCalls++; }
    ngOnDestroy() { this._destroyed = true; }
    isDirByMode(mode) { return (mode & 0xf000) === 0x4000; }
    async _resolveRemoteSymlinkIsDir() { return true; }
    _openPathInSystem(p) { opened.push(p); }
    showToast(m) { this.messages.push(m); }
    refreshRemote() {}
    async _doUpload(name, local) {
        if (this.failUpload) return false;
        const data = await fs.readFile(local); this.uploads.push({ name, data });
        if (this.duringUpload) await this.duringUpload();
        this.remote.set(name, { size: data.length, mtime: 1700000000 + this.uploads.length });
        return true;
    }
}
install({ Panel, Settings, shell: { openPath: async p => { opened.push(p); return ''; } }, download: async (session, name, size, mode, opts) => {
    assert.equal(opts.requireExactSize, true);
    const dir = path.join(root, String(++counter)); await fs.mkdir(dir, { recursive: true });
    const local = path.join(dir, path.basename(name)); await fs.writeFile(local, Buffer.from([0xff, 0xfe, 0x41, 0x00])); return local;
} });
const save = async (state, bytes) => { await fs.writeFile(state.localPath, bytes); await fs.utimes(state.localPath, new Date(0), new Date(0)); };
(async () => {
    const p = new Panel();
    p.remote.set('/a.conf', { size: 4, mtime: 1700000000 });
    p.remote.set('/b.txt', { size: 4, mtime: 1700000000 });
    await Promise.all([p._activateEntry('remote', { name: 'a.conf', fullPath: '/a.conf' }), p._activateEntry('remote', { name: 'a.conf', fullPath: '/a.conf' })]);
    assert.equal(opened.length, 1, 'double opens share the download');
    const a = p._customExternalSessions.get('/a.conf');
    clearInterval(a.timer);
    await p._customSyncExternal(a); assert.equal(p.uploads.length, 0, 'opening does not upload');
    const bytes = Buffer.from([0xff, 0xfe, 0x42, 0x00, 0x0d, 0x00, 0x0a, 0x00]);
    await save(a, bytes); await p._customSyncExternal(a);
    assert.deepEqual(p.uploads[0].data, bytes, 'encoding and line endings preserved');
    await p._customSyncExternal(a); assert.equal(p.uploads.length, 1, 'unchanged file is not reuploaded');
    await save(a, Buffer.from('second'));
    p.duringUpload = async () => { p.duringUpload = null; await save(a, Buffer.from('third')); };
    await p._customSyncExternal(a); await p._customSyncExternal(a);
    assert.equal(p.uploads[1].data.toString(), 'second'); assert.equal(p.uploads[2].data.toString(), 'third', 'save during upload is queued for next poll');
    await p._activateEntry('remote', { name: 'b.txt', fullPath: '/b.txt' });
    const b = p._customExternalSessions.get('/b.txt'); clearInterval(b.timer);
    await save(b, Buffer.from('other')); await p._customSyncExternal(b);
    assert.equal(p.uploads[3].name, '/b.txt', 'multiple files use correct destination');
    p.remote.set('/a.conf', { size: 0, mtime: 1700000900 }); await save(a, Buffer.from('conflict'));
    await p._customSyncExternal(a); await p._customSyncExternal(a);
    assert.equal(confirmations, 1); assert.equal(p.uploads.length, 4, 'rejected conflict does not overwrite, including empty remote');
    window.confirm = () => true; a.blockedHash = null; await p._customSyncExternal(a); assert.equal(p.uploads.length, 5);
    p.failUpload = true; await save(b, Buffer.from('failed')); await p._customSyncExternal(b);
    assert.equal((await fs.readFile(b.localPath)).toString(), 'failed', 'failed upload preserves local edits');
    assert.ok(p.messages.some(m => m.includes('Local copy retained')));
    p.failUpload = false; await p._customExternalEdit({ name: 'b.txt', fullPath: '/b.txt' }); await p._customSyncExternal(b);
    assert.equal(p.uploads.length, 6, 'reopening retries a failed upload');
    await p._activateEntry('remote', { isDirectory: true, fullPath: '/dir' });
    await p._activateEntry('remote', { isSymlink: true, fullPath: '/link' }); assert.equal(originalCalls, 2, 'directory and directory symlink keep navigation');
    const s = new Settings(); s.configService = { store: { 'tabby-sftp-plus': { fileOpenAction: 'external-edit' } }, save() {} }; s.notifyPanels = () => {};
    assert.equal(s.toggleExternalEditOnOpen, undefined, 'local app editing is fixed, without a config toggle');
    p.configService.store['tabby-sftp-plus'].fileOpenAction = 'preview'; await p._activateEntry('remote', { fullPath: '/a.conf' }); assert.equal(originalCalls, 2, 'legacy preview preference cannot activate internal viewer');
    p.connected = false; await save(a, Buffer.from('disconnected')); await p._customSyncExternal(a);
    assert.equal(a.stopped, true); assert.equal(p.uploads.length, 6);
    p.ngOnDestroy(); assert.equal(b.stopped, true); assert.ok(await fs.stat(b.localPath));

    // Choosing another app retains the exact same edit session and save-upload.
    const custom = new Panel();custom.remote.set('/custom.conf',{size:4,mtime:1700000000});
    const customPaths=[];const defaultCount=opened.length;
    await custom._customExternalEdit({name:'custom.conf',fullPath:'/custom.conf'},async file=>{customPaths.push(file);return '';});
    const customState=custom._customExternalSessions.get('/custom.conf');clearInterval(customState.timer);
    assert.equal(customPaths.length,1);assert.equal(opened.length,defaultCount,'chosen app replaces default opener');
    await save(customState,Buffer.from('save from chosen app'));await custom._customSyncExternal(customState);
    assert.equal(custom.uploads[0].name,'/custom.conf');assert.equal(custom.uploads[0].data.toString(),'save from chosen app');
    await custom._customExternalEdit({name:'custom.conf',fullPath:'/custom.conf'},async file=>{customPaths.push(file);return '';});
    assert.equal(customPaths[1],customPaths[0],'opening with another app reuses verified local copy');custom.ngOnDestroy();

    console.log('PASS: deduplicated open, byte preservation, repeat saves, save during upload, multiple files, conflicts, failed-upload recovery, directories, settings, disconnect, cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
