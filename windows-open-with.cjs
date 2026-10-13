module.exports=function openWith(file){
 const path=require('path'),cfg=require('./transfer-policy.json').windowsOpenWith;
 return new Promise((resolve,reject)=>{
  const executable=path.join(process.env.SystemRoot,cfg.executable),script=path.join(__dirname,cfg.script);
  const child=require('child_process').spawn(executable,[...cfg.arguments,script,'-Target',file],{shell:false,windowsHide:true,stdio:'ignore'});
  child.once('error',reject);child.once('close',code=>{if(code===0||code===cfg.cancelExitCode)resolve('');else reject(Error('Windows Open with failed ('+code+')'));});
 });
};
