const fs=require('fs'),path=require('path'),ts=require('../plugins/node_modules/typescript');
module.exports=function patchContextMenu(source){
 const ast=ts.createSourceFile('bundle.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),edits=[];let templates=0;
 function visit(node){
  if(ts.isStringLiteral(node)&&node.text.includes('#menuEl *ngIf="menuVisible"')){
   let html=node.text;
   html=html.replaceAll('<div class="context-menu"','<div class="context-menu" (mousedown)="$event.stopPropagation()" (mouseup)="$event.stopPropagation()" (click)="$event.stopPropagation()" (contextmenu)="$event.preventDefault(); $event.stopPropagation()"');
   // Stop at the item BEFORE emitting: its handler can remove the menu DOM.
   html=html.replace(/\(click\)="([^"]*)"/g,(match,handler)=>handler.includes('.emit(')?'(click)="$event.preventDefault(); $event.stopPropagation(); '+handler+'"':match);
   edits.push({start:node.getStart(ast),end:node.end,text:JSON.stringify(html)});templates++;return;
  }
  ts.forEachChild(node,visit);
 }
 visit(ast);if(templates!==1)throw Error('Context menu template anchor changed: '+templates);
 for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
 const anchor='const so=to;';if(source.split(anchor).length!==2)throw Error('Context menu runtime anchor changed');
 const runtime=fs.readFileSync(path.join(__dirname,'context-menu.cjs'),'utf8').trim().replace(/^module\.exports = /,'').replace(/;$/,'');
 return source.replace(anchor,`/* CONTEXT_MENU_EVENTS_V1 */(${runtime})({Panel:Xi,Angular:o});${anchor}`);
};
