const fs=require('fs'),ts=require('typescript');
module.exports=function patchKeyboardEvents(source){
 const ast=ts.createSourceFile('bundle.js',source,99,true,ts.ScriptKind.JS),edits=[];
 const methods=new Set(['onWindowKeyDown','onGlobalKeyDown','onTypeAheadCompositionEnd']);
 function visit(n){
  if(ts.isCallExpression(n)&&methods.has(n.arguments[2]?.text)&&n.arguments[1]?.getText(ast)==='Xi.prototype'&&ts.isArrayLiteralExpression(n.arguments[0])){
   for(const decorator of n.arguments[0].elements)if(ts.isCallExpression(decorator)&&decorator.expression.getText(ast).includes('.HostListener'))edits.push({start:decorator.getStart(ast),end:decorator.end,text:'()=>{}'});
  }
  ts.forEachChild(n,visit);
 }
 visit(ast);if(edits.length!==3)throw Error('Global keyboard decorator anchors '+edits.length);
 for(const e of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,e.start)+e.text+source.slice(e.end);
 const runtime=fs.readFileSync('keyboard-events.cjs','utf8').trim().replace(/^module.exports = /,'').replace(/;$/,'');
 return source.replace('const so=to;','/* OUTSIDE_ANGULAR_KEYBOARD_V1 */('+runtime+')({Panel:Xi});const so=to;');
};
