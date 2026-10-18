'use strict';
const fs=require('node:fs'),path=require('node:path');
const {downloadArtifact}=require('@electron/get');
const extract=require('extract-zip');
const {packageApp}=require('./package-app.cjs');
const project=path.resolve(__dirname,'..');
async function build(){
 const pkg=require('../package.json');
 const runtime=await downloadArtifact({version:pkg.devDependencies.electron,artifactName:'electron',platform:'win32',arch:'x64'});
 const out=path.join(project,'dist','PersonalArchive-win-x64');
 fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out,{recursive:true});
 await extract(runtime,{dir:out});
 for(const name of fs.readdirSync(path.join(out,'locales')))if(!['zh-CN.pak','en-US.pak'].includes(name))fs.unlinkSync(path.join(out,'locales',name));
 const resources=path.join(out,'resources');fs.mkdirSync(resources,{recursive:true});
 await packageApp(path.join(resources,'app.asar'));
 const defaultApp=path.join(resources,'default_app.asar');if(fs.existsSync(defaultApp))fs.unlinkSync(defaultApp);
 fs.renameSync(path.join(out,'electron.exe'),path.join(out,'PersonalArchive.exe'));
 fs.copyFileSync(path.join(project,'README-Windows.txt'),path.join(out,'先读我.txt'));
 fs.copyFileSync(path.join(project,'THIRD_PARTY_NOTICES.md'),path.join(out,'第三方组件说明.md'));
 fs.writeFileSync(path.join(out,'version.txt'),`Personal Archive ${pkg.version}\nElectron ${pkg.devDependencies.electron}\nWindows x64 portable\n`);
 console.log('Windows application:',out);
}
build().catch(error=>{console.error(error);process.exit(1);});
