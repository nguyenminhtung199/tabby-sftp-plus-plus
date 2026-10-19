module.exports = function installFileIcons({apis,FilePane,theme={names:{},extensions:{}}}) {
    const path=require('path');
    const original=apis.FilePane.iconSrc;
    const suffixes=Object.keys(theme.extensions).sort((a,b)=>b.length-a.length);
    // Use the approved centered image of SFTP+'s native yellow folder.
    const folderIcon=Object.getOwnPropertyDescriptor(apis.FilePane,'folderIcon');
    Object.defineProperty(apis.FilePane,'folderIcon',{configurable:true,get(){if(!this.folderIconSvg||this.folderIconSvg==='folder.svg')return this.bundledIconDir?'file://'+path.join(this.bundledIconDir,'folder.svg'):null;return folderIcon?.get?.call(this)||null;}});
    apis.FilePane.iconSrc=function(entry){
        if(!entry||entry.isDirectory||!this.bundledIconDir)return original.call(this,entry);
        const name=path.basename(entry.linkTarget&&!entry.isSymlink?entry.linkTarget:entry.name||'').toLowerCase();
        // Text files use their extension icon, including requirements.txt and named theme overrides.
        if(name.endsWith('.txt'))return original.call(this,entry);
        let icon=null;
        if(/^(?:dockerfile|containerfile)(?:[.-].*)?$/.test(name)||/\.dockerfile$/.test(name))icon='docker.svg';
        else if(/^(?:docker-compose|compose)(?:[.-].*)?\.ya?ml$/.test(name))icon='docker-compose.svg';
        else if(/^\.env(?:\..*)?$/.test(name))icon='env.svg';
        else if(['.gitignore','.gitattributes','.gitmodules'].includes(name))icon='git.svg';
        else if(/^nginx(?:\..*)?\.conf$/.test(name)||name==='nginx.conf')icon='nginx.svg';
        else if(['pipfile','pipfile.lock','pyproject.toml','poetry.lock'].includes(name))icon='python.svg';
        icon=theme.names[name]||icon;
        if(!icon){const ext=suffixes.find(ext=>name.endsWith('.'+ext));if(ext)icon=theme.extensions[ext];}
        if(!icon||(this.disabledIconSvgs||[]).includes(icon))return original.call(this,entry);
        const dot=name.lastIndexOf('.'),ext=dot>0?name.slice(dot):'';
        const rule=(this.fileTypeIcons||[]).find(r=>(r.ext||'').toLowerCase()===ext);
        if(rule?.svg&&!(this.disabledIconSvgs||[]).includes(rule.svg)&&this._refreshValidIconFiles().has(rule.svg))return original.call(this,entry);
        return 'file://'+path.join(this.bundledIconDir,icon);
    };
    apis.FilePane.customSetiPython=function(entry){
        if(!entry || entry.isDirectory)return false;
        return /(?:^|[\\/])(?:python|vscode_python)\.svg$/.test(this.iconSrc(entry)||'');
    };
};
