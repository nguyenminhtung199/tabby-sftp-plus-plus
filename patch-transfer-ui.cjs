const fs = require('fs'), path = require('path');
module.exports = function patchTransferUI(source) {
    const syncStat='try{const e=T.statSync(n);r=e.isDirectory(),o=r?0:e.size||0}catch(n){}';
    if(source.split(syncStat).length!==2||source.split('_streamUploadOne(n,e){').length!==2)throw Error('Upload queue stat anchor changed');
    source=source.replace('_streamUploadOne(n,e){','async _streamUploadOne(n,e){const sourceSession=this.sftpSession,capturedRemoteDir=e||this.remotePath;').replace(syncStat,"try{const e=await T.promises.stat(n);r=e.isDirectory(),o=r?0:e.size||0}catch(error){throw Error('Cannot read upload source: '+error.message)}if(this._destroyed||!this.connected||this.sftpSession!==sourceSession)throw Error('Connection changed before queuing upload');");
    const destination='const a=(null==e?void 0:e.trim())||this.remotePath,l=S.posix.join(a,i)';
    if(source.split(destination).length!==2)throw Error('Upload destination anchor changed');
    source=source.replace(destination,'const a=(null==e?void 0:e.trim())||capturedRemoteDir,l=S.posix.join(a,i)');
    const premature = '||l.percent>=100';
    if (source.split(premature).length !== 2) throw new Error('Transfer completion anchor changed');
    source = source.replace(premature, '||(!m._customStream&&l.percent>=100)');
    const runtime = fs.readFileSync(path.join(__dirname, 'transfer-ui.cjs'), 'utf8').trim().replace(/^module\.exports = /, '').replace(/;$/, '');
    if (source.split('const so=to;').length !== 2) throw new Error('Transfer UI runtime anchor changed');
    return source.replace('const so=to;', `/* TRANSFER_UI_V1 */(${runtime})({Panel:Xi,ProgressRuntime:pi});const so=to;`);
};
