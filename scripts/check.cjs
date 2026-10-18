'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');let count=0;
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()){if(entry.name!=='vendor')walk(file);}else if(/\.(cjs|js|mjs)$/.test(file)){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr||result.error?.message||file);process.exit(1);}count++;}}}
for(const name of ['app','renderer','scripts','tests'])walk(path.join(root,name));
for(const name of ['package.json','package-lock.json','app/fields.json','scripts/update-bases.json'])JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
console.log(`Syntax OK: ${count} JavaScript files; JSON OK.`);
