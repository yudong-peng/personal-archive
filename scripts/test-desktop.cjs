'use strict';
const path=require('node:path'),{spawnSync}=require('node:child_process');
const executable=require('electron'),root=path.resolve(__dirname,'..');
for(const file of ['electron-smoke.cjs','electron-forms.cjs','electron-upgrade.cjs','electron-v030.cjs']){
 const args=[...(process.env.ARCHIVE_QA_ALLOW_NO_SANDBOX==='1'?['--no-sandbox','--disable-gpu']:[]),path.join(root,'tests',file)];
 const result=spawnSync(executable,args,{cwd:root,stdio:'inherit',env:process.env});
 if(result.error){console.error(result.error.message);process.exit(1);}if(result.status!==0)process.exit(result.status||1);
}
