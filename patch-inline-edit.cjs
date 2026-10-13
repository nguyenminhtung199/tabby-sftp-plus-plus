const fs=require('fs'),ts=require('typescript');
module.exports=function patchInlineEdit(source){
 const ast=ts.createSourceFile('bundle.js',source,99,true,ts.ScriptKind.JS),edits=[];let panels=0,panes=0,confirms=0;
 const input=()=>'<input class="custom-inline-name" [ngModel]="customInlineEdit.value" (ngModelChange)="customInlineOwner.customInlineValue($event)" [disabled]="customInlineEdit.busy" [attr.aria-label]="customInlineEdit.title" (keydown)="customInlineKey($event)" (blur)="customInlineOwner.customInlineCommit()" (mousedown)="$event.stopPropagation()" (click)="$event.stopPropagation()" (dblclick)="$event.stopPropagation()" (contextmenu)="$event.stopPropagation()" /><span class="custom-inline-error" *ngIf="customInlineEdit.error" role="alert">{{ customInlineEdit.error }}</span>';
 function visit(node){
  if(ts.isMethodDeclaration(node)&&node.name?.getText(ast)==='confirmInputDialog'){
   const text=node.getText(ast);if(!text.includes('!this.inputDialogVisible'))throw Error('Inline confirmation guard anchor');edits.push({start:node.getStart(ast),end:node.end,text:text.replace('!this.inputDialogVisible','(!this.inputDialogVisible&&!this._customInlineEdit)')});confirms++;return;
  }
  if(ts.isStringLiteral(node)){
   let html=node.text;
   if(html.includes('<sftp-file-pane')&&html.includes('class="sftp-root"')){
    for(const pane of ['local','remote']){const anchor='listClass="'+pane+'-pane"';if(html.split(anchor).length!==2)throw Error('Inline pane binding '+pane);html=html.replace(anchor,anchor+' [customInlineOwner]="customInlineOwner" [customInlineEdit]="_customInlineEdit?.pane === \''+pane+'\' && _customInlineEdit.folder === '+pane+'Path ? _customInlineEdit : null"');}panels++;
   }else if(html.includes('class="pane-list-wrap"')&&html.includes('inaccessiblePrefix(e)')){
    for(const entry of ['e','row.entry']){
     const anchor='<span class="name" [attr.title]="'+entry+'.name">{{ inaccessiblePrefix('+entry+') }}{{ displayName('+entry+') }}</span>';
     if(html.split(anchor).length!==2)throw Error('Inline name anchor '+entry);
     html=html.replace(anchor,'<span class="name custom-inline-cell" *ngIf="customInlineRename('+entry+')">'+input()+'</span>'+anchor.replace('<span class="name"','<span *ngIf="!customInlineRename('+entry+')" class="name"'));
    }
    const anchor='          <!-- 分组模式关闭';const pos=html.indexOf(anchor);if(pos<0)throw Error('Inline draft anchor');
    html=html.slice(0,pos)+'<div class="entry custom-inline-draft" *ngIf="customInlineEdit && !customInlineEdit.originalPath" [style.gridTemplateColumns]="colWidths"><span class="icon">{{ customInlineEdit.isDirectory ? \'📁\' : \'📄\' }}</span><span class="name custom-inline-cell">'+input()+'</span></div>'+html.slice(pos);
    html=html.replace('*ngIf="showEmpty"','*ngIf="showEmpty && !customInlineEdit"');panes++;
   }
   if(html.includes('.sftp-root .icon .custom-file-icon'))html+='\n'+fs.readFileSync('inline-edit.css','utf8');
   if(html!==node.text)edits.push({start:node.getStart(ast),end:node.end,text:JSON.stringify(html)});
  }
  ts.forEachChild(node,visit);
 }
 visit(ast);if(panels!==1||panes!==1||confirms!==1)throw Error('Inline anchors '+[panels,panes,confirms]);
 for(const e of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,e.start)+e.text+source.slice(e.end);
 const runtime=fs.readFileSync('inline-edit.cjs','utf8').trim().replace(/^module.exports = /,'').replace(/;$/,'');
 return source.replace('const so=to;','/* INLINE_NAME_EDIT_V1 */('+runtime+')({Panel:Xi,FilePane:wr,Angular:o});const so=to;');
};
