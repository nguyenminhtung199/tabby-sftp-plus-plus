const path=require('path').posix,policy=require('../../transfer-policy.json');
module.exports=async function remoteMetadata(session,file){
    if(!session?.sftp?.inner)return session.stat(file);
    // Native russh.stat spreads a N-API metadata object. readdir explicitly
    // copies its properties into plain objects and retains permission bits.
    let target=path.resolve('/',file);const seen=new Set();
    for(let depth=0;depth<policy.symlinkDepthLimit&&!seen.has(target);depth++){
        seen.add(target);const entries=await session.readdir(path.dirname(target));
        const entry=entries.find(e=>e.name===path.basename(target)||(target==='/'&&e.name==='.'));
        if(!entry)throw Object.assign(Error('Remote file not found: '+file),{code:'ENOENT'});
        if(entry.isSymlink){target=path.resolve(path.dirname(target),await session.readlink(target));continue;}
        return {name:path.basename(file),fullPath:file,isDirectory:entry.isDirectory,isSymlink:false,mode:entry.mode,size:entry.size,modified:entry.modified};
    }
    throw Error('Remote symlink loop or depth exceeded: '+file);
};
