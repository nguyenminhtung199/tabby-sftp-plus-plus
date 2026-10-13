const path=require('path'),webpack=require('webpack'),{builtinModules}=require('module');
module.exports={target:'node',mode:'development',devtool:'source-map',entry:'./src/index.ts',context:__dirname,
 output:{path:path.join(__dirname,'dist'),filename:'index.js',libraryTarget:'commonjs2',devtoolModuleFilenameTemplate:'webpack-sftp-plus-plus:///[resource-path]'},
 resolve:{extensions:['.ts','.js','.cjs','.json'],alias:{'@common':path.join(__dirname,'tabby-plugin-common/src')}},
 module:{rules:[{test:/\.ts$/,use:{loader:'ts-loader',options:{configFile:path.join(__dirname,'tsconfig.json')}}},{test:/\.(html|css|po)$/,type:'asset/source'}]},
 externals:[...builtinModules,'electron','@electron/remote',/^rxjs/,/^@angular/,/^tabby-/],
 plugins:[new webpack.DefinePlugin({__SFTP_PLUS_BUILD_TIME__:JSON.stringify(new Date().toISOString())})],
 optimization:{minimize:false},stats:'errors-warnings'};
