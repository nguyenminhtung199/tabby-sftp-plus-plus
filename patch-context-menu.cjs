const fs=require('fs'),path=require('path'),ts=require('typescript');
module.exports=function patchContextMenu(source){
 const ast=ts.createSourceFile('bundle.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),edits=[];let templates=0,releases=0,doubleClicks=0;
 function visit(node){
  // Preserve the existing double-click logic, returning its edit promise so
  // context-menu callers can await completion and report failures.
  if(ts.isMethodDeclaration(node)&&['onLocalEntryDblClick','onRemoteEntryDblClick'].includes(node.name?.getText(ast))){
   const local=node.name.getText(ast)==='onLocalEntryDblClick';
   const timer=local?'localClickTimer':'remoteClickTimer',pane=local?'local':'remote';
   const text=`${node.name.getText(ast)}(n,e){if(this._openOnClick==='single')return;if(this.${timer}){clearTimeout(this.${timer});this.${timer}=null;}if(e)e.preventDefault();${local?'':'if(!this.connected)return;'}return this._activateEntry('${pane}',n,e);}`;
   edits.push({start:node.getStart(ast),end:node.end,text});doubleClicks++;return;
  }
  // Rubber-band release must reach document before the panel stops bubbling
  // mouseup to the surrounding terminal. Cleanup must use the same capture flag.
  if(ts.isCallExpression(node)){
   const call=node.getText(ast);
   if(call==='document.addEventListener("mouseup",this._rbUpHandler)'||call==='document.removeEventListener("mouseup",this._rbUpHandler)'){
    edits.push({start:node.getStart(ast),end:node.end,text:call.slice(0,-1)+',true)'});releases++;return;
   }
  }

  if(ts.isStringLiteral(node)&&node.text.includes('#menuEl *ngIf="menuVisible"')){
   let html=node.text;
   html=html.replaceAll('<div class="context-menu"','<div class="context-menu" (mousedown)="$event.stopPropagation()" (mouseup)="$event.stopPropagation()" (click)="$event.stopPropagation()" (contextmenu)="$event.preventDefault(); $event.stopPropagation()"');
   // Stop at the item BEFORE emitting: its handler can remove the menu DOM.
   html=html.replace(/\(click\)="([^"]*)"/g,(match,handler)=>handler.includes('.emit(')?'(click)="$event.preventDefault(); $event.stopPropagation(); '+handler+'"':match);
   edits.push({start:node.getStart(ast),end:node.end,text:JSON.stringify(html)});templates++;return;
  }
  ts.forEachChild(node,visit);
 }
 visit(ast);if(doubleClicks!==2)throw Error('Double click anchors changed: '+doubleClicks);if(releases!==2)throw Error('Rubber-band release anchors changed: '+releases);if(templates!==1)throw Error('Context menu template anchor changed: '+templates);
 for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
 const anchor='const so=to;';if(source.split(anchor).length!==2)throw Error('Context menu runtime anchor changed');
 const runtime=fs.readFileSync(path.join(__dirname,'context-menu.cjs'),'utf8').trim().replace(/^module\.exports = /,'').replace(/;$/,'');
 return source.replace(anchor,`/* CONTEXT_MENU_EVENTS_V1 */(${runtime})({Panel:Xi,Angular:o,Platform:a.PlatformService});${anchor}`);
};
