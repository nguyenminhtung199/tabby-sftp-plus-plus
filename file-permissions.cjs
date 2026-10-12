const policy=require('./transfer-policy.json');
const metadata=require('./remote-metadata.cjs');
const newFileMode=Number.parseInt(policy.newFileMode,8);
function mode(stat){
    if(!Number.isInteger(stat.mode)||stat.mode<0)throw Error('Cannot determine remote file permissions; original file retained');
    return stat.mode&0o7777;
}
async function apply(session,file,permissions){
    if(typeof session.chmod!=='function')throw Error('Server cannot set file permissions; original file retained');
    await session.chmod(file,permissions);
    const stat=await metadata(session,file);
    if(mode(stat)!==permissions)throw Error('Remote file permissions could not be preserved; original file retained');
    return stat;
}
module.exports={newFileMode,mode,apply};
