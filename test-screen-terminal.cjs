const assert=require('assert/strict'),fs=require('fs/promises'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const policy=require('./tests/test-policy.json'),cfg=policy.terminalScreen,base=policy.terminalNative,send=require('./src/runtime/terminal-command.cjs');
const pty=require(path.join(process.env.LOCALAPPDATA,base.ptyRelative));
(async()=>{let child,transcript='',waiters=[];
 const dir=await fs.mkdtemp(path.join(__dirname,base.scratchRelative)+'-screen-'),session=cfg.sessionPrefix+crypto.randomUUID();
 const winDump=path.join(dir,base.dumpFile),winSeed=path.join(dir,base.seedFile),winConfig=path.join(dir,cfg.configFile);
 const wsl=args=>cp.execFileSync(cfg.executable,['-d',cfg.distribution,'--exec',...args],{encoding:'utf8',windowsHide:true});
 const unix=file=>wsl(['wslpath','-u',file]).trim();
 const wait=(pattern,offset)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiters=waiters.filter(w=>w!==check);reject(Error('screen PTY timeout '+pattern+' '+JSON.stringify(transcript.slice(-1400))));},cfg.timeoutMs);const check=()=>{const match=transcript.slice(offset).match(pattern);if(match){clearTimeout(timer);waiters=waiters.filter(w=>w!==check);resolve(match);}};waiters.push(check);check();});
 try{
  await fs.writeFile(winConfig,cfg.config.join('\n')+'\n');
  const args=['-d',cfg.distribution,'--exec','env','TERM='+base.terminal,'PS1='+base.prompt,'INPUTRC='+base.inputrc,'HISTFILE='+base.historyFile,'LANG='+cfg.locale,'LC_ALL='+cfg.locale,'SFTP_TEST_SEED='+unix(winSeed),'SFTP_TEST_DUMP='+unix(winDump),cfg.screen,'-c',unix(winConfig),'-S',session,cfg.shell,...base.args];
  child=pty.spawn(cfg.executable,args,{name:base.terminal,cols:base.columns,rows:base.rows,cwd:dir,env:{...process.env},useConpty:true});
  child.onData(data=>{transcript+=data;for(const fn of [...waiters])fn();});await wait(/SFTP_COMMAND_TEST>/,0);
  child.write(String.raw`set -o emacs; __sftp_emit() { printf '\033P\033]777;%s\007\033\\' "$1"; }; __sftp_load() { READLINE_LINE=$(cat "$SFTP_TEST_SEED"); READLINE_POINT=$(printf '%s' "$READLINE_LINE" | wc -m); }; bind -x '"\C-x\C-l":__sftp_load'; __sftp_dump() { printf '%s\0%s' "$READLINE_LINE" "$PWD" > "$SFTP_TEST_DUMP"; __sftp_emit DUMPED; }; bind -x '"\C-x\C-b":__sftp_dump'; test -n "$STY" && __sftp_emit INSIDE_SCREEN`+'\r');await wait(/\x1b\]777;INSIDE_SCREEN\x07/,0);
  const terminal={alternateScreenActive:true,frontend:{isAlternateScreenActive:()=>true},sendInput:text=>child.write(text)};
  const drafts=['',"echo unfinished 'quote",'printf tiếng-Việt \u65e5\u672c\u8a9e','echo '+'long'.repeat(65),'echo one\necho two'];
  for(const [index,draft]of drafts.entries()){
   let offset=transcript.length;child.write('\x03');await wait(/SFTP_COMMAND_TEST>/,offset);
   if(index===0)child.write('old deleted draft\x05\x15');
   await fs.writeFile(winSeed,draft,'utf8');child.write('\x18\x0c');if(index===2)child.write('\x02\x02');
   offset=transcript.length;child.write('\x18\x02');await wait(/\x1b\]777;DUMPED\x07/,offset);assert.equal((await fs.readFile(winDump,'utf8')).split('\0')[0],draft,'initial screen draft');
   const done=crypto.randomUUID();offset=transcript.length;assert.equal(send(terminal,"cd -- /tmp; __sftp_emit 'DONE="+done+"'"),true);
   await wait(new RegExp('\\x1b\\]777;DONE='+done+'\\x07'),offset);
   offset=transcript.length;child.write('\x18\x02');await wait(/\x1b\]777;DUMPED\x07/,offset);const [saved,cwd]=(await fs.readFile(winDump,'utf8')).split('\0');assert.equal(saved,draft,'restored screen draft '+index);assert.equal(cwd,'/tmp');
   offset=transcript.length;child.write('x\x18\x02');await wait(/\x1b\]777;DUMPED\x07/,offset);assert.equal((await fs.readFile(winDump,'utf8')).split('\0')[0],draft+'x','screen cursor restored at end');
  }
  const offset=transcript.length;send(terminal,require('./src/runtime/screen-reporter.cjs').session);await wait(/\x1b\]1337;CurrentDir=\/tmp\x07/,offset);
  const done=crypto.randomUUID();send(terminal,"__sftp_emit 'DONE="+done+"'");await wait(new RegExp('\\x1b\\]777;DONE='+done+'\\x07'),offset);
  const dumpOffset=transcript.length;child.write('\x18\x02');await wait(/\x1b\]777;DUMPED\x07/,dumpOffset);assert.equal((await fs.readFile(winDump,'utf8')).split('\0')[0],drafts.at(-1)+'x','CWD setup preserves screen draft');
  console.log('PASS: actual GNU Screen shell accepts cd/CWD setup with alternate-screen flags, passes CWD OSC to outer terminal, and preserves empty/quoted/Unicode/wrapped/multiline drafts and cursor.');
 }finally{
  assert.ok(session.startsWith(cfg.sessionPrefix));try{wsl([cfg.screen,'-S',session,'-X','quit']);}catch{}child?.kill();
 }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
