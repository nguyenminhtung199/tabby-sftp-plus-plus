module.exports = function createRecoveryStore(directory) {
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');
    const root = directory || path.join(process.env.APPDATA || require('os').homedir(), 'tabby', 'sftp-plus-plus', 'recovery');
    const journal = path.join(root, 'state.json');
    const owners = new Map();
    let loaded = false, state = { version: 1, edits: {}, transfers: {} };
    function read() {
        if (!fs.existsSync(journal)) return { version: 1, edits: {}, transfers: {} };
        const saved=JSON.parse(fs.readFileSync(journal,'utf8'));
        if(saved.version!==1 || !saved.edits || !saved.transfers)throw new Error('Unsupported recovery journal');
        return saved;
    }
    function load() {
        if (loaded) return;
        if (fs.existsSync(journal)) {
            state = read();
            for (const row of Object.values(state.transfers)) {
                if (['Running','Queued'].includes(row.status)) { row.status = 'Interrupted'; row.error = 'Previous session ended before completion'; }
            }
        }
        loaded = true;
    }
    function update(kind,id,row) {
        load();fs.mkdirSync(root,{recursive:true});
        const lock=path.join(root,'state.lock');
        let fd;
        try { fd=fs.openSync(lock,'wx'); }
        catch(e) {
            if(e.code!=='EEXIST')throw e;
            let pid;try{pid=Number(fs.readFileSync(lock,'utf8'));}catch{}
            if(!pid)throw new Error('Recovery journal is busy');
            try{process.kill(pid,0);throw new Error('Recovery journal is busy');}
            catch(error){if(error.code!=='ESRCH')throw error;}
            fs.unlinkSync(lock);fd=fs.openSync(lock,'wx');
        }
        try {
            fs.writeFileSync(fd,String(process.pid));
            // Merge on each write so a stale panel/store cannot erase other saved jobs.
            state=read();
            if(row)state[kind][id]={...Object.fromEntries(Object.entries(row).filter(([key])=>!key.startsWith('_'))),updatedAt:Date.now()};
            else delete state[kind][id];
            save();
        }finally {fs.closeSync(fd);try{fs.unlinkSync(lock);}catch{}}
    }
    function save() {
        fs.mkdirSync(root, { recursive: true });
        const temporary = journal + '.' + crypto.randomUUID() + '.tmp';
        try { fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { flag: 'wx' }); fs.renameSync(temporary, journal); }
        finally { try { fs.unlinkSync(temporary); } catch {} }
    }
    const server = panel => {
        const profile = panel.profile || panel.terminalRef?.profile;
        if (!profile?.options?.host) return null;
        return JSON.stringify([profile.options.host, profile.options.port || 22, profile.options.username || profile.options.user || '']);
    };
    return {
        root, server,
        editId: (host, remote) => crypto.createHash('sha256').update(JSON.stringify([host, remote])).digest('hex'),
        rows(kind, host) { load(); return Object.values(state[kind]).filter(row => row.server === host); },
        put(kind, row) { update(kind,row.id,row); },
        remove(kind, id) { update(kind,id,null); },
        claim(id, panel) { const owner = owners.get(id); if (owner && owner !== panel && !owner._destroyed) return false; owners.set(id, panel); return true; },
        owner(id) { return owners.get(id); },
        release(id, panel) { if (owners.get(id) === panel) owners.delete(id); },
    };
};
