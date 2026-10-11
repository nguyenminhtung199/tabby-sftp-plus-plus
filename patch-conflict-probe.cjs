const ts=require('../plugins/node_modules/typescript');
module.exports=function patchConflictProbe(source){
 const ast=ts.createSourceFile('bundle.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let edit;
 function visit(node){
  if(ts.isMethodDeclaration(node)&&node.name?.getText(ast)==='checkLocalConflict'&&node.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)){
   if(edit)throw Error('Multiple async local conflict checks');
   const original=node.getText(ast),anchor='try{const i=await x.lstat(n);';
   if(original.split(anchor).length!==2)throw Error('Local conflict probe anchor changed');
   // A missing download target needs no conflict check. Avoid creating an
   // asynchronous ENOENT rejection here; existing targets retain all checks.
   const replacement='try{b("[check-local-conflict] probe start:",n);const probe=T.lstatSync(n,{throwIfNoEntry:false});if(!probe)return b("[check-local-conflict] missing target, download allowed:",n),{kind:"no-conflict"};b("[check-local-conflict] existing target:",n);const i=await x.lstat(n);b("[check-local-conflict] async lstat complete:",n);';
   edit={start:node.getStart(ast),end:node.end,text:original.replace(anchor,replacement)};
  }
  ts.forEachChild(node,visit);
 }
 visit(ast);if(!edit)throw Error('Local conflict check not found');
 return source.slice(0,edit.start)+edit.text+source.slice(edit.end);
};
