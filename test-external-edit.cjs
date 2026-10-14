const assert = require('assert/strict');
const fs = require('fs/promises');
const path = require('path');
const editPolicy = require('./transfer-policy.json').externalEdit;
const install = require('./tests/helpers/feature-fixture.cjs')(require('./src/features/external-edit.cjs'));
const root = path.join(__dirname, 'test-fixtures');
let counter = 0, opened = [], confirmations = 0, originalCalls = 0;
global.window = { confirm: () => { confirmations++; return false; } };
class Settings {}
class Panel {
    constructor() {
        this.connected = true; this.configService = { store: { 'tabby-sftp-plus-plus': { fileOpenAction: 'external-edit' } } };
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
    if(session.failDownload)throw new Error('fixture download failed');
    const dir = path.join(root, String(++counter)); await fs.mkdir(dir, { recursive: true });
    const local = path.join(dir, path.basename(name)); await fs.writeFile(local, session.bytes?.get(name) || Buffer.from([0xff, 0xfe, 0x41, 0x00])); return local;
} });
const save = async (state, bytes) => { await fs.writeFile(state.localPath, bytes); await fs.utimes(state.localPath, new Date(0), new Date(0)); };
(async () => {
    const p = new Panel();
    p.remote.set('/a.conf', { size: 4, mtime: 1700000000 });
    p.remote.set('/b.txt', { size: 4, mtime: 1700000000 });
    await Promise.all([p._activateEntry('remote', { name: 'a.conf', fullPath: '/a.conf' }), p._activateEntry('remote', { name: 'a.conf', fullPath: '/a.conf' })]);
    assert.equal(opened.length, 2, 'every open downloads a fresh local copy, including concurrent requests');assert.notEqual(opened[0],opened[1]);
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
    assert.equal(confirmations, 0, 'default automatic sync never prompts for earlier remote changes');
    assert.equal(p.uploads.length, 5, 'local save automatically replaces changed remote, including an empty file');
    assert.equal(p.uploads[4].data.toString(), 'conflict');assert.equal(a.status, 'Synced');assert.equal(a.blockedHash, null);
    await p._customSyncExternal(a);assert.equal(p.uploads.length,5,'automatic overwrite updates the baseline without duplicate uploads');
    p.failUpload = true; await save(b, Buffer.from('failed')); await p._customSyncExternal(b);
    assert.equal((await fs.readFile(b.localPath)).toString(), 'failed', 'failed upload preserves local edits');
    assert.ok(p.messages.some(m => m.includes('Local copy retained')));
    p.failUpload = false; await p.customRetryEdit(b); clearInterval(b.timer);
    assert.equal(p.uploads.length, 6, 'explicit Retry preserves the failed local save');
    await p._activateEntry('remote', { isDirectory: true, fullPath: '/dir' });
    await p._activateEntry('remote', { isSymlink: true, fullPath: '/link' }); assert.equal(originalCalls, 2, 'directory and directory symlink keep navigation');
    const s = new Settings(); s.configService = { store: { 'tabby-sftp-plus-plus': { fileOpenAction: 'external-edit' } }, save() {} }; s.notifyPanels = () => {};
    assert.equal(s.toggleExternalEditOnOpen, undefined, 'local app editing is fixed, without a config toggle');
    p.configService.store['tabby-sftp-plus-plus'].fileOpenAction = 'preview'; await p._activateEntry('remote', { fullPath: '/a.conf' }); assert.equal(originalCalls, 2, 'legacy preview preference cannot activate internal viewer');
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
    assert.notEqual(customPaths[1],customPaths[0],'Open with downloads a fresh local copy');
    const second=custom._customExternalSessions.get('/custom.conf');clearInterval(second.timer);assert.equal(customState.stopped,true);
    custom.sftpSession.bytes=new Map([['/custom.conf',Buffer.from('git pull version')]]);custom.remote.set('/custom.conf',{size:16,mtime:1700999999});
    await save(second,Buffer.from('old unsaved local'));await custom._customExternalEdit({name:'custom.conf',fullPath:'/custom.conf',size:4});
    const fresh=custom._customExternalSessions.get('/custom.conf');clearInterval(fresh.timer);
    assert.equal((await fs.readFile(fresh.localPath)).toString(),'git pull version','reopen downloads latest server content with fresh metadata');
    assert.equal((await fs.readFile(second.localPath)).toString(),'old unsaved local','previous local copy is preserved');
    await custom.customRetryEdit(second);await custom._customSyncExternal(second);assert.equal(second.stopped,true);assert.equal(custom.uploads.length,1,'old watcher cannot overwrite the newer server copy');
    await save(fresh,Buffer.from('new save'));await custom._customSyncExternal(fresh);assert.equal(custom.uploads.at(-1).data.toString(),'new save');custom.ngOnDestroy();

    // Reopening waits for an in-flight save and then downloads; stale copies are never reused on failure.
    const inflight=new Panel();inflight.remote.set('/inflight.conf',{size:4,mtime:1700000000});
    await inflight._customExternalEdit({name:'inflight.conf',fullPath:'/inflight.conf'});
    const old=inflight._customExternalSessions.get('/inflight.conf');clearInterval(old.timer);
    let release,started;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
    inflight.duringUpload=async()=>{started();await gate;};await save(old,Buffer.from('in-flight save'));
    const sync=inflight._customSyncExternal(old);await entered;const beforeDownloads=counter;
    const reopen=inflight._customExternalEdit({name:'inflight.conf',fullPath:'/inflight.conf'});
    await new Promise(resolve=>setImmediate(resolve));assert.equal(old.stopped,true);assert.equal(counter,beforeDownloads,'new download waits for current upload');
    release();await sync;await reopen;assert.equal(counter,beforeDownloads+1);
    const replacement=inflight._customExternalSessions.get('/inflight.conf');clearInterval(replacement.timer);
    assert.notEqual(replacement.localPath,old.localPath);inflight.sftpSession.failDownload=true;const beforeOpen=opened.length;
    await inflight._customExternalEdit({name:'inflight.conf',fullPath:'/inflight.conf'});
    assert.equal(opened.length,beforeOpen,'failed fresh download cannot fall back to a stale local file');assert.ok(await fs.stat(replacement.localPath));inflight.ngOnDestroy();

    // An explicitly selected confirm policy retains the original conflict workflow.
    const originalAction=editPolicy.remoteChangeAction,manual=new Panel();
    try{
        editPolicy.remoteChangeAction='confirm';manual.remote.set('/manual.conf',{size:4,mtime:1700000000});
        await manual._customExternalEdit({name:'manual.conf',fullPath:'/manual.conf'});
        const state=manual._customExternalSessions.get('/manual.conf');clearInterval(state.timer);
        manual.remote.set('/manual.conf',{size:0,mtime:1700000900});await save(state,Buffer.from('manual save'));
        window.confirm=()=>{confirmations++;return false;};await manual._customSyncExternal(state);await manual._customSyncExternal(state);
        assert.equal(manual.uploads.length,0);assert.equal(confirmations,1);assert.equal(state.status,'Conflict');
        editPolicy.remoteChangeAction=originalAction;await manual._customSyncExternal(state);
        assert.equal(manual.uploads.length,1,'old prompt-rejected edits resume under automatic policy');assert.equal(confirmations,1);
        editPolicy.remoteChangeAction='confirm';manual.remote.set('/manual.conf',{size:0,mtime:1700009999});await save(state,Buffer.from('confirmed save'));
        window.confirm=()=>true;await manual._customSyncExternal(state);assert.equal(manual.uploads.length,2);
    }finally{editPolicy.remoteChangeAction=originalAction;manual.ngOnDestroy();}

    console.log('PASS: fresh downloads on every open, latest git-pull version, old watcher retirement, byte preservation, repeat saves, save during upload, multiple files, automatic remote overwrite without prompts, explicit confirm policy, failed-upload recovery, directories, settings, disconnect, cleanup.');
})().catch(error => { console.error(error); process.exitCode = 1; });
