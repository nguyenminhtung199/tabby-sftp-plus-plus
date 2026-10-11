const assert=require('assert/strict'),fs=require('fs'),fsp=fs.promises,path=require('path'),crypto=require('crypto');
const root=path.join(__dirname,'test-fixtures','native-buffer-'+crypto.randomUUID());
const data=crypto.randomBytes(700000),buffer=new Uint8Array(256*1024);
let reads=0,copyChecks=0;
const originalOpen=fsp.open;
fsp.open=async(...args)=>{
    const h=await originalOpen(...args),original=h.write.bind(h);
    if(String(args[0]).includes('.sftp-plus-plus-download-'))h.write=async(chunk,...rest)=>{
        assert.notEqual(chunk.buffer,buffer.buffer,'download writes own their memory');copyChecks++;
        // A borrowed native buffer can be reused/invalidated; the owned bytes must survive.
        buffer.fill(0x5a);
        return original(chunk,...rest);
    };
    return h;
};
class Panel{
    constructor(){this.connected=true;this.transfers=[];this.sftpSession={stat:async()=>({size:data.length,modified:new Date(0)}),open:async()=>{
        let position=0;return {read:async()=>{reads++;const size=Math.min(buffer.length,data.length-position);buffer.set(data.subarray(position,position+size));position+=size;return buffer.subarray(0,size);},close:async()=>{}};
    }};}
    _doDownload(){return false;}_doUpload(){return false;}trackTransfer(){}showToast(message){throw Error(message);}ngOnDestroy(){}
}
require('./transfer-engine.cjs')({Panel});
(async()=>{
    await fsp.mkdir(root,{recursive:true});const file=path.join(root,'out.bin');
    assert.equal(await new Panel()._doDownload('/file.bin',file,420,data.length),true);
    assert.deepEqual(await fsp.readFile(file),data);assert.equal(copyChecks,3);assert.equal(reads,4);
    console.log('PASS: download copies borrowed native backing memory; buffer invalidation cannot alter disk output; empty native EOF is handled.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
    fsp.open=originalOpen;
    if(path.dirname(root)!==path.resolve(__dirname,'test-fixtures')||!path.basename(root).startsWith('native-buffer-'))throw Error('Unsafe fixture path');
    await fsp.rm(root,{recursive:true,force:true});
});
