'use strict';
const fs=require('node:fs'),path=require('node:path'),asar=require('@electron/asar');
const project=path.resolve(__dirname,'..');
async function packageApp(destination){
 const stage=path.join(project,'build','app');fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true});
 for(const name of ['app','renderer'])fs.cpSync(path.join(project,name),path.join(stage,name),{recursive:true});
 const sqlDir=path.join(stage,'node_modules','sql.js');fs.mkdirSync(path.join(sqlDir,'dist'),{recursive:true});
 for(const name of ['package.json','LICENSE'])fs.copyFileSync(path.join(project,'node_modules','sql.js',name),path.join(sqlDir,name));
 for(const name of ['sql-wasm.js','sql-wasm.wasm'])fs.copyFileSync(path.join(project,'node_modules','sql.js','dist',name),path.join(sqlDir,'dist',name));
 fs.cpSync(path.join(project,'node_modules','fflate'),path.join(stage,'node_modules','fflate'),{recursive:true});
 const koffi=path.join(stage,'node_modules','koffi');
 for(const name of ['package.json','LICENSE.txt','index.cjs','index.js','src/koffi/index.cjs','src/koffi/index.js','src/koffi/src/static.cjs']){
  const target=path.join(koffi,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(project,'node_modules','koffi',name),target);
 }
 if(!fs.existsSync(path.join(project,'node_modules','@koromix','koffi-win32-x64','win32_x64','koffi.node')))throw new Error('缺少 Windows x64 Koffi 依赖。请在 Windows x64 上执行 npm ci 后构建；不要省略 optional dependencies。');
 const native=path.join(stage,'node_modules','@koromix','koffi-win32-x64');fs.mkdirSync(native,{recursive:true});
 for(const name of ['index.js','package.json','README.md','win32_x64/koffi.node']){
  const target=path.join(native,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(project,'node_modules','@koromix','koffi-win32-x64',name),target);
 }
 const pkg=require('../package.json');fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,description:pkg.description,main:pkg.main,private:true},null,2));
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 await asar.createPackageWithOptions(stage,destination,{unpack:'**/*.node'});
 return destination;
}
module.exports={packageApp};
