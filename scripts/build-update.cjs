'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {packageApp}=require('./package-app.cjs');
const project=path.resolve(__dirname,'..');
const bases=require('./update-bases.json');
const hash=filename=>crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
async function build(){
 const out=path.join(project,'dist','PersonalArchive-v0.3.0-update');fs.rmSync(out,{recursive:true,force:true});
 const asar=path.join(out,'resources','app.asar');await packageApp(asar);
 fs.writeFileSync(path.join(out,'version.txt'),'Personal Archive 0.3.0\r\nElectron 44.9.0\r\nWindows x64 portable\r\n');
 const files=[];
 function walk(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const filename=path.join(directory,entry.name);if(entry.isDirectory())walk(filename);else files.push({path:path.relative(out,filename).replaceAll('\\','/'),sha256:hash(filename)});}}
 walk(path.join(out,'resources'));files.push({path:'version.txt',sha256:hash(path.join(out,'version.txt'))});
 fs.writeFileSync(path.join(out,'update-manifest.json'),JSON.stringify({product:'PersonalArchive',from:bases.versions,to:'0.3.0',runtime:'44.9.0',baseAsarSha256:bases.hashes,files},null,2));
 for(const name of ['apply-update.ps1','apply-update.bat','更新说明.txt','验证记录.txt','第三方组件说明.txt'])fs.copyFileSync(path.join(project,'update-assets',name),path.join(out,name));
 console.log('Update package:',out);
}
build().catch(error=>{console.error(error);process.exit(1);});
