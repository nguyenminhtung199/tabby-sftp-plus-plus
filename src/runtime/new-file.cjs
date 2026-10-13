const policy=require('../../transfer-policy.json');
module.exports=async function createRemoteFile(session,file,setPermissions){
 if(typeof session.open!=='function')throw Error('SFTP adapter does not support exclusive file creation');
 const handle=await session.open(file,policy.newFileOpenFlags);let closed=false;
 try{await handle.close();closed=true;await setPermissions(file);}finally{if(!closed)await Promise.resolve(handle.close()).catch(()=>{});}
};
