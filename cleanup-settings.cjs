// Edit only the SFTP++ YAML block; preserve Tabby profiles and all other plugins byte-for-byte.
const retired=new Set(['hideAuthorInfo','openUnsupportedInSystem','editableFileExtensions','allowViewEditAllFiles','allowEditAllFiles','allowViewAllAsText','showTextLineNumbers','textCaretShape','fileOpenAction','openInNewTabByDefault','singleWorkspaceInstance','rememberSessionFolders']);
module.exports=function migrate(text){
 const block=text.match(/^tabby-sftp-plus-plus:\r?\n(?:(?:[ \t]+[^\r\n]*|[ \t]*)\r?\n)*/m)?.[0]||'';
 const legacyRemember=/^  rememberSessionFolders:\s*true\s*$/m.test(block);
 const lines=text.split(/(?<=\n)/),out=[];let active=false,skipIndent=null,parent='';
 for(const line of lines){
  if(/^tabby-sftp-plus-plus:\s*(?:\r?\n)?$/.test(line)){active=true;out.push(line);continue;}
  if(active&&/^\S/.test(line)){active=false;skipIndent=null;parent='';}
  if(!active){out.push(line);continue;}
  const indent=line.match(/^ */)[0].length;
  if(skipIndent!==null){if(!line.trim()||indent>skipIndent)continue;skipIndent=null;}
  const field=line.match(/^  ([\w]+):/);
  if(field){parent=field[1];if(retired.has(parent)){skipIndent=2;continue;}}
  if(parent==='panelHotkeys'&&/^    viewFile:/.test(line)){skipIndent=4;continue;}
  if(['contextMenuOrder','contextMenuDisabled'].includes(parent)&&/^\s+-\s+['"]?viewFile['"]?\s*$/.test(line))continue;
  let next=line;
  if(parent==='defaultPathMode'||parent==='pathModes')next=line.replace(/:\s*(['"]?)(off|remember|sync)\1(?=\s*$)/,(_,quote,mode)=>': '+(mode==='remember'||(mode==='off'&&legacyRemember)?'remember':'off'));
  out.push(next);
 }
 return out.join('');
};
