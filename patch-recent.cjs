const fs = require('fs');
const ts = require('typescript');
module.exports = function patchRecent(source) {
    const ast = ts.createSourceFile('bundle.js', source, ts.ScriptTarget.Latest, true), edits = [];
    function visit(node) {
        if (ts.isStringLiteral(node) && !node.text.includes('msgid')) {
            let text = node.text;
            if (text.includes('<sftp-bookmark-popup')) text = text.replace('[allBookmarks]="getAllBookmarksForPane()"', '[allBookmarks]="getAllBookmarksForPane()"\n        [customRecentItems]="customRecentFolders()"');
            if (text.includes('class="bookmark-list" #bookmarkList')) text = text.replace('<!-- 分组模式：', `<div class="bookmark-scope-label">Recent</div>
        <div class="bookmark-item" *ngFor="let b of customRecentItems; trackBy: customTrackRecent" [class.current]="isCurrent(b)" (click)="gotoBookmark.emit(b)" [title]="b.path">
          <span class="bm-drag-handle" aria-hidden="true"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="8" cy="8" r="5.5"/><path d="M8 4.5V8l2.5 1.5"/></svg></span>
          <div class="bm-info"><span class="bm-name">{{ b.name }}</span><span class="bm-path">{{ b.path }}</span></div>
        </div>
        <div class="bookmark-scope-label" *ngIf="!customRecentItems?.length" style="font-weight:normal">No recent folders yet</div>
        <!-- 分组模式：`);
            if (text.includes('title="A sidebar for each SSH pane.')) text = text.replace('<label class="ss-toggle-row" title="A sidebar', `<div class="ss-toggle-row"><span class="ss-toggle-label">Recent folders (1–10)</span><input class="ss-concurrency-input" type="number" min="1" max="10" step="1" [ngModel]="customRecentFolderLimit" (ngModelChange)="setCustomRecentFolderLimit($event)" /></div>
          <div class="ss-toggle-row" title="A file operation adds the folder immediately."><span class="ss-toggle-label">Recent folder dwell time (seconds)</span><input class="ss-concurrency-input" type="number" min="1" max="86400" step="1" [ngModel]="customRecentFolderDwellSeconds" (ngModelChange)="setCustomRecentFolderDwellSeconds($event)" /></div>
          <label class="ss-toggle-row" title="A sidebar`);
            if (text !== node.text) edits.push({ start: node.getStart(ast), end: node.end, text: JSON.stringify(text) });
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    if (edits.length !== 3) throw new Error('Recent template anchors changed: ' + edits.length);
    for (const edit of edits.sort((a,b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    source = source.replace('function je(){return{', 'function je(){return{recentFolderLimit:5,recentFolderDwellSeconds:10,recentFolderEntries:[],');
    const runtime = fs.readFileSync(require('path').join(__dirname, 'recent-folders.cjs'), 'utf8').trim().replace(/^module\.exports = /, '').replace(/;$/, '');
    return source.replace('const so=to;', `/* RECENT_FOLDERS_V1 */(${runtime})({Panel:Xi,Settings:Wt,Bookmark:Tr,Angular:o});const so=to;`);
};
