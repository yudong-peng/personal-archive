'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Zip,ZipDeflate}=require('fflate');
const root=path.resolve(__dirname,'..'),dist=path.join(root,'dist'),pkg=require('../package.json');
function list(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{const p=path.join(dir,entry.name);return entry.isDirectory()?list(p):[p];}).sort();}
async function zipDirectory(directory,output){
 let fd=fs.openSync(output,'w'),error=null,finished=false;
 const zip=new Zip((err,data,final)=>{if(err){error=err;return;}let offset=0;while(offset<data.length)offset+=fs.writeSync(fd,data,offset,data.length-offset);if(final)finished=true;});
 try{
  for(const file of list(directory)){
   const entry=new ZipDeflate(path.relative(path.dirname(directory),file).replaceAll('\\','/'),{level:6});zip.add(entry);
   for await(const chunk of fs.createReadStream(file,{highWaterMark:128*1024})){entry.push(chunk,false);if(error)throw error;}
   entry.push(new Uint8Array(),true);if(error)throw error;
  }
  zip.end();if(error)throw error;if(!finished)throw new Error('ZIP did not finalize.');fs.fsyncSync(fd);
 }catch(err){zip.terminate();throw err;}finally{fs.closeSync(fd);}
}
async function main(){
 const outputs=[];
 for(const [folder,suffix]of [['PersonalArchive-win-x64','win-x64'],[`PersonalArchive-v${pkg.version}-update`,'update']]){
  const directory=path.join(dist,folder);if(!fs.existsSync(directory))throw new Error('Build the application first: '+folder);
  const output=path.join(dist,`personal-archive-v${pkg.version}-${suffix}.zip`);await zipDirectory(directory,output);outputs.push(output);console.log('Release archive:',output);
 }
 const lines=[];for(const filename of outputs){const digest=crypto.createHash('sha256');for await(const data of fs.createReadStream(filename))digest.update(data);lines.push(digest.digest('hex')+'  '+path.basename(filename));}
 fs.writeFileSync(path.join(dist,'SHA256SUMS.txt'),lines.join('\n')+'\n');
}
main().catch(error=>{console.error(error);process.exit(1);});
