'use strict';
// Compatible with the v0.1 Python PARCHIVE container. SQL remains in memory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const initSqlJs = require('sql.js');
const fields = require('./fields.json');
const FormModel = require('../renderer/form-model.js');
const {validateDocuments,userMetadata}=require('./attachments.cjs');
const scrypt = promisify(crypto.scrypt);
const MAGIC = Buffer.from('504152434849564501', 'hex');
const MAX_DB = 256 * 1024 * 1024, MAX_FILE = 20 * 1024 * 1024;
const PW_AAD = Buffer.from('personal-archive/password/v1');
const REC_AAD = Buffer.from('personal-archive/recovery/v1');
let sqlPromise;
const now = () => {
  const date=new Date(), offset=-date.getTimezoneOffset();
  const local=new Date(date.getTime()+offset*60000).toISOString().slice(0,19);
  return local+(offset>=0?'+':'-')+String(Math.floor(Math.abs(offset)/60)).padStart(2,'0')+':'+String(Math.abs(offset)%60).padStart(2,'0');
};
const clone = value => JSON.parse(JSON.stringify(value));
const uuid = () => crypto.randomUUID();
const b64 = bytes => Buffer.from(bytes).toString('base64');

async function sqlEngine() {
  return sqlPromise ||= initSqlJs({locateFile: name => require.resolve('sql.js/dist/' + name)});
}
function bytes(value, length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('档案头格式不正确。');
  const result = Buffer.from(value, 'base64');
  if (length && result.length !== length) throw new Error('档案头长度不正确。');
  return result;
}
function encrypt(key, nonce, data, aad) {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}
function decrypt(key, nonce, data, aad) {
  if (data.length < 16) throw new Error('加密文件不完整。');
  const cipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  cipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([cipher.update(data.subarray(0, -16)), cipher.final()]);
}
async function derive(password, salt) {
  if (typeof password !== 'string' || password.length > 4096) throw new Error('密码输入无效。');
  return scrypt(password, salt, 32, {N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024});
}
function checkPassword(password) {
  if (typeof password !== 'string' || [...password].length < 12 || [...password].length > 1024)
    throw new Error('密码应为 12～1024 个字符。建议使用不易猜测的长密码。');
}
function encodeRecovery(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let value = 0, bits = 0, result = '';
  for (const byte of input) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) {bits -= 5; result += alphabet[(value >>> bits) & 31];}
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result.match(/.{1,4}/g).join('-');
}
function decodeRecovery(text) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(text).replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z2-7]{52}$/.test(clean)) throw new Error('恢复密钥格式不正确。');
  let value = 0, bits = 0; const result = [];
  for (const char of clean) {
    value = (value << 5) | alphabet.indexOf(char); bits += 5;
    if (bits >= 8) {bits -= 8; result.push((value >>> bits) & 255);}
  }
  if ((value & 15) !== 0) throw new Error('恢复密钥格式不正确。');
  return Buffer.from(result);
}
function atomicWrite(destination, content) {
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  const temporary = path.join(path.dirname(destination), '.archive-' + uuid() + '.tmp');
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {fs.writeFileSync(fd, content); fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    fs.renameSync(temporary, destination);
  } finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
}
function rows(db, sql, args = []) {
  const statement = db.prepare(sql);
  const result = [];
  try {statement.bind(args); while (statement.step()) result.push(statement.getAsObject());}
  finally {statement.free();}
  return result;
}
function configure(db, validate = false) {
  db.run('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA temp_store=MEMORY;');
  if (validate) {
    if (rows(db, 'PRAGMA user_version')[0].user_version !== 1) throw new Error('此档案版本暂不支持。');
    if (Object.values(rows(db, 'PRAGMA quick_check')[0])[0] !== 'ok') throw new Error('档案完整性检查失败。');
    const tables = rows(db, "SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name).sort();
    if (tables.join(',') !== 'attachments,collection_items,collections,records') throw new Error('档案表结构不匹配。');
    if (rows(db, "SELECT name FROM sqlite_master WHERE type IN ('view','trigger')").length) throw new Error('档案包含不支持的结构。');
    db.exec('SELECT id,category,title,fields,versions,tags,notes,pinned,deleted,created,updated FROM records LIMIT 1;');
    db.exec('SELECT id,record_id,name,mime,size,hash,metadata,data,created FROM attachments LIMIT 1;');
    db.exec('SELECT id,title,created FROM collections LIMIT 1; SELECT collection_id,record_id FROM collection_items LIMIT 1;');
  }
  return db;
}
const SCHEMA = `
CREATE TABLE records(id TEXT PRIMARY KEY,category TEXT NOT NULL,title TEXT NOT NULL,
 fields TEXT NOT NULL,versions TEXT NOT NULL,tags TEXT NOT NULL,notes TEXT NOT NULL,
 pinned INTEGER NOT NULL DEFAULT 0,deleted INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL,updated TEXT NOT NULL);
CREATE TABLE attachments(id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
 name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,hash TEXT NOT NULL,metadata TEXT NOT NULL,data BLOB NOT NULL,created TEXT NOT NULL);
CREATE TABLE collections(id TEXT PRIMARY KEY,title TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE collection_items(collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
 record_id TEXT REFERENCES records(id) ON DELETE CASCADE,PRIMARY KEY(collection_id,record_id));
PRAGMA user_version=1;`;

function readInternal(values){
  const raw=values._pavInternal;if(typeof raw!=='string'||!raw.startsWith('PAV-META-v1:'))return {};
  try{const value=JSON.parse(raw.slice(12));return value&&typeof value==='object'&&!Array.isArray(value)&&value.version===1?value:{};}catch{return {};}
}

class Vault {
  constructor(filename, header, key, db, SQL) {Object.assign(this, {filename, header, key, db, SQL});}
  static async create(filename, password) {
    checkPassword(password);
    if (fs.existsSync(filename)) throw new Error('档案库已存在，不能覆盖。');
    const SQL = await sqlEngine(), key = crypto.randomBytes(32), recovery = crypto.randomBytes(32);
    const salt = crypto.randomBytes(16), pn = crypto.randomBytes(12), rn = crypto.randomBytes(12);
    const passwordKey = await derive(password, salt);
    const header = {version:1, kdf:'scrypt-131072-8-1', salt:b64(salt), pw_nonce:b64(pn),
      pw_wrap:b64(encrypt(passwordKey, pn, key, PW_AAD)), rec_nonce:b64(rn), rec_wrap:b64(encrypt(recovery, rn, key, REC_AAD))};
    passwordKey.fill(0);
    const db = configure(new SQL.Database()); db.run(SCHEMA);
    const vault = new Vault(filename, header, key, db, SQL);
    try {vault.persist(false);} catch (error) {vault.close(); throw error;}
    const text = encodeRecovery(recovery); recovery.fill(0);
    return {vault, recovery:text};
  }
  static async openWithKey(filename,deviceKey){
    if(!Buffer.isBuffer(deviceKey)||deviceKey.length!==32)throw new Error('设备解锁密钥格式错误。');
    return this.open(filename,null,false,deviceKey);
  }
  static async open(filename, credential, recovery = false, deviceKey=null) {
    let key, derived, db;
    try {
      if (fs.statSync(filename).size > MAX_DB + 8192) throw new Error('档案过大，当前支持最多 256 MiB。');
      const file = fs.readFileSync(filename);
      if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('文件不是兼容的个人档案库。');
      const size = file.readUInt32BE(MAGIC.length), start = MAGIC.length + 4;
      if (size < 100 || size > 4096 || start + size + 16 > file.length) throw new Error('档案文件头不完整。');
      const aad = file.subarray(start, start + size), header = JSON.parse(aad.toString('utf8'));
      if (header.version !== 1 || header.kdf !== 'scrypt-131072-8-1') throw new Error('不支持此加密版本。');
      if(deviceKey){key=Buffer.from(deviceKey);}else{
        derived = recovery ? decodeRecovery(credential) : await derive(credential, bytes(header.salt, 16));
        key = decrypt(derived, bytes(header[recovery?'rec_nonce':'pw_nonce'], 12), bytes(header[recovery?'rec_wrap':'pw_wrap'], 48), recovery?REC_AAD:PW_AAD);
      }
      const payload = decrypt(key, bytes(header.nonce, 12), file.subarray(start + size), aad);
      const SQL = await sqlEngine();
      try {db = configure(new SQL.Database(Uint8Array.from(payload)), true);} finally {payload.fill(0);}
      return new Vault(filename, header, key, db, SQL);
    } catch (error) {
      if (key) key.fill(0); if (db) db.close();
      if (error.code === 'ENOENT' || error.code === 'EACCES') throw new Error('无法读取档案，请检查文件位置与权限。');
      throw new Error('无法解锁：密码或恢复密钥不正确，或档案已损坏。原文件未被修改。');
    } finally {if (derived) derived.fill(0);}
  }
  serialize() {
    const result = Buffer.from(this.db.export());
    // sql.js export closes and reopens its SQLite connection: reapply pragmas.
    configure(this.db);
    return result;
  }
  persist(backup = true) {
    const data = this.serialize();
    try {
      if (data.length > MAX_DB) throw new Error('档案已超过 256 MiB，请减少附件。');
      const header = clone(this.header), nonce = crypto.randomBytes(12);
      header.nonce = b64(nonce);
      const encoded = Buffer.from(JSON.stringify(header)), size = Buffer.alloc(4); size.writeUInt32BE(encoded.length);
      const output = Buffer.concat([MAGIC, size, encoded, encrypt(this.key, nonce, data, encoded)]);
      if (backup && fs.existsSync(this.filename)) this.dailyBackup();
      atomicWrite(this.filename, output); this.header = header;
    } finally {data.fill(0);}
  }
  dailyBackup() {
    const dir = path.join(path.dirname(this.filename), 'backups');
    const date = new Date(), day = [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
    const filename = path.join(dir, 'daily-' + day + '.pav');
    if (!fs.existsSync(filename)) {
      atomicWrite(filename, fs.readFileSync(this.filename));
      const old = fs.readdirSync(dir).filter(n => /^daily-.*\.pav$/.test(n)).sort().reverse().slice(7);
      for (const name of old) fs.unlinkSync(path.join(dir, name));
    }
  }
  mutate(callback) {
    const previous = this.serialize();
    try {
      this.db.run('BEGIN'); const result = callback(); this.db.run('COMMIT'); this.persist(); return result;
    } catch (error) {
      this.db.close(); this.db = configure(new this.SQL.Database(Uint8Array.from(previous)), true); throw error;
    } finally {previous.fill(0);}
  }
  record(id) {
    const row = rows(this.db, 'SELECT * FROM records WHERE id=?', [id])[0];
    if (!row) throw new Error('资料不存在。');
    return this.decodeRecord(row);
  }
  internal(id){const row=rows(this.db,'SELECT fields FROM records WHERE id=?',[id])[0];if(!row)throw new Error('资料不存在。');return readInternal(JSON.parse(row.fields));}
  decodeRecord(row) {const values=JSON.parse(row.fields),internal=readInternal(values);if(internal.version===1)delete values._pavInternal;return {...row,fields:values,versions:JSON.parse(row.versions),tags:JSON.parse(row.tags),reminders:internal.reminders||{},aiUndoAvailable:!!internal.aiUndo};}
  setReminder(id,key,input){
    const record=this.record(id),docs=JSON.parse(record.fields['证件资料']||'[]');
    if(!(key==='record'&&record.category==='证书资质')&&!docs.some(doc=>doc.id===key))throw new Error('证件或证书不存在。');
    if(!input||typeof input.enabled!=='boolean'||input.days!==null&&(!Number.isInteger(input.days)||input.days<1||input.days>3650)||input.snoozeUntil&&!/^\d{4}-\d{2}-\d{2}$/.test(input.snoozeUntil))throw new Error('提醒设置无效。');
    const internal=this.internal(id);internal.reminders={...internal.reminders,[key]:{enabled:input.enabled,days:input.days,snoozeUntil:input.snoozeUntil||''}};return this.saveRecord(record,internal);
  }
  upgradeAdvanced(){
    if(this.header.features_v030)return;
    this.backup(path.join(path.dirname(this.filename),'backups','before-v0.3.0-'+Date.now()+'-'+uuid().slice(0,8)+'.pav'));
    const previous=this.header;this.header={...this.header,features_v030:true};
    try{this.mutate(()=>{for(const row of rows(this.db,'SELECT id,fields FROM records')){const values=JSON.parse(row.fields),value=values._pavInternal;if(value!==undefined&&readInternal(values).version!==1){let name='_pavInternal（旧字段）';while(Object.hasOwn(values,name))name+='副本';values[name]=value;delete values._pavInternal;this.db.run('UPDATE records SET fields=? WHERE id=?',[JSON.stringify(values),row.id]);}}});}catch(error){this.header=previous;throw error;}
  }

  records({category, query='', deleted=false, collection}={}) {
    let sql = 'SELECT r.*,(SELECT count(*) FROM attachments a WHERE a.record_id=r.id) AS attachment_count FROM records r WHERE deleted=?';
    const args = [deleted?1:0];
    if (category) {sql += ' AND category=?'; args.push(category);}
    if (collection) {sql += ' AND EXISTS(SELECT 1 FROM collection_items i WHERE i.record_id=r.id AND i.collection_id=?)'; args.push(collection);}
    sql += ' ORDER BY pinned DESC, julianday(updated) DESC, id';
    const terms = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return rows(this.db, sql, args).map(r=>this.decodeRecord(r)).filter(r=>terms.every(t=>JSON.stringify(r).toLocaleLowerCase().includes(t)));
  }
  saveRecord(input, internalOverride, attachmentChanges=[]) {
    if (!input || typeof input !== 'object') throw new Error('资料格式无效。');
    const category = input.category;
    let title = String(input.title || '').trim();
    if (!Object.hasOwn(fields.categories, category)) throw new Error('请选择资料分类。');
    if(fields.singletons.includes(category))title=category;
    if(input.fields!==undefined&&(!input.fields||typeof input.fields!=='object'||Array.isArray(input.fields)))throw new Error('字段名和内容应为文字。');
    const values = {...(input.fields || {})}, versions = {}, tags = Array.isArray(input.tags)?[...new Set(input.tags.map(t=>String(t).trim()).filter(Boolean))]:[];
    if (typeof values !== 'object' || Array.isArray(values) || Object.entries(values).some(([k,v])=>!k.trim() || typeof v!=='string')) throw new Error('字段名和内容应为文字。');
    if(Object.hasOwn(values,'_pavInternal'))throw new Error('此字段名为程序保留字段。');
    if(category==='就学经历'){
      if(!Object.hasOwn(fields.educationStages,values['就学阶段']))throw new Error('请先选择就学阶段。');
      title=values['就学阶段'];
    }
    if(!title)throw new Error('请填写资料标题。');
    if(category==='个人基本信息')validateDocuments(values['证件资料']);
    if(category==='家庭信息'&&values['亲属信息']){
      const relatives=FormModel.relatives(values['亲属信息']);
      if(!relatives||relatives.length>100||relatives.some(r=>Object.entries(r).some(([k,v])=>!fields.relativeFields.includes(k)||typeof v!=='string')))
        throw new Error('亲属信息格式无效，最多可保存 100 位亲属。');
    }
    for (const name of fields.versions) versions[name] = String(input.versions?.[name] || '');
    const id = input.id || uuid(), old = rows(this.db,'SELECT created,deleted,fields FROM records WHERE id=?',[id])[0], timestamp = now();
    const internal=internalOverride??(old?readInternal(JSON.parse(old.fields)):undefined);if(internal&&Object.keys(internal).length)values._pavInternal='PAV-META-v1:'+JSON.stringify({...internal,version:1});
    if(fields.singletons.includes(category)&&rows(this.db,'SELECT id FROM records WHERE category=? AND deleted=0 AND id<>?',[category,id]).length)
      throw new Error(category+'只能保存一份，请编辑已有档案。');
    return this.mutate(()=>{
      this.db.run(`INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        category=excluded.category,title=excluded.title,fields=excluded.fields,versions=excluded.versions,
        tags=excluded.tags,notes=excluded.notes,pinned=excluded.pinned,updated=excluded.updated`,
        [id,category,title,JSON.stringify(values),JSON.stringify(versions),JSON.stringify(tags),String(input.notes||''),input.pinned?1:0,old?.deleted||0,old?.created||timestamp,timestamp]);
      const documentIds=category==='个人基本信息'?new Set(JSON.parse(values['证件资料']||'[]').map(doc=>doc.id)):new Set();
      for(const attachment of this.attachments(id)){
        const metadata=attachment.metadata;
        if(metadata.role==='document'&&!documentIds.has(metadata.documentId)||metadata.role==='profile-photo'&&category!=='个人基本信息'){
          metadata.role='general';metadata.documentId='';metadata.pageLabel='';
          this.db.run('UPDATE attachments SET metadata=? WHERE id=?',[JSON.stringify(metadata),attachment.id]);
        }
      }
      for(const change of attachmentChanges){const attachment=this.attachments(id).find(file=>file.id===change.id);if(!attachment)throw new Error('来源附件已删除，请重新识别。');const metadata={...attachment.metadata,...userMetadata(this.record(id),{...attachment.metadata,...change})};this.db.run('UPDATE attachments SET metadata=? WHERE id=?',[JSON.stringify(metadata),change.id]);}
      return id;
    });
  }
  trash(ids, deleted) {return this.mutate(()=>{for (const id of ids) {
    if(!deleted){
      const record=this.record(id);
      if(fields.singletons.includes(record.category)&&rows(this.db,'SELECT id FROM records WHERE category=? AND deleted=0 AND id<>?',[record.category,id]).length)
        throw new Error(record.category+'已有一份有效档案。请先将现有档案移入回收站，再恢复所需版本。');
    }
    this.db.run('UPDATE records SET deleted=?,updated=? WHERE id=?',[deleted?1:0,now(),id]);
  }});}
  upgradeForms(){
    const updates=[];
    for(const category of fields.singletons){
      const records=rows(this.db,'SELECT * FROM records WHERE category=? ORDER BY deleted ASC,julianday(updated) DESC,id',[category]);
      let active=false;
      for(const record of records){
        const values=JSON.parse(record.fields);let changed=false,deleted=record.deleted,notes=record.notes;
        if(category==='个人基本信息'&&values['证件资料']){
          try{validateDocuments(values['证件资料']);}catch{
            let key='证件资料（旧自定义字段）',suffix=2;
            while(Object.hasOwn(values,key))key='证件资料（旧自定义字段 '+suffix+++'）';
            values[key]=values['证件资料'];delete values['证件资料'];changed=true;
          }
        }
        if(record.title!==category){if(!values['原资料标题'])values['原资料标题']=record.title;changed=true;}
        if(!deleted){if(active){deleted=1;notes='[v0.2.2 升级保留] 此分类仅保留最近修改的一份有效档案。本份原始内容、附件和清单关系已保留，可在回收站查看。\n'+notes;changed=true;}else active=true;}
        if(changed)updates.push([category,JSON.stringify(values),deleted,notes,record.id]);
      }
    }
    if(!updates.length)return false;
    this.backup(path.join(path.dirname(this.filename),'backups','before-forms-v0.2.3-'+Date.now()+'-'+uuid().slice(0,8)+'.pav'));
    this.mutate(()=>{for(const args of updates)this.db.run('UPDATE records SET title=?,fields=?,deleted=?,notes=? WHERE id=?',args);});
    return true;
  }
  purge(ids) {return this.mutate(()=>{for(const id of ids)this.db.run('DELETE FROM records WHERE id=? AND deleted=1',[id]);});}
  attachments(id) {
    return rows(this.db,'SELECT id,record_id,name,mime,size,metadata,created FROM attachments WHERE record_id=? ORDER BY created,id',[id])
      .map(r=>({...r,metadata:JSON.parse(r.metadata)}));
  }
  attachment(id) {
    const result = rows(this.db,'SELECT * FROM attachments WHERE id=?',[id])[0];
    if(!result)throw new Error('附件不存在。');
    return {...result, metadata:JSON.parse(result.metadata), data:Buffer.from(result.data)};
  }
  addAttachment(recordId, name, data, metadata={}) {
    this.record(recordId);
    if(!data.length || data.length>MAX_FILE)throw new Error('单个附件应大于 0 且不超过 20 MiB。');
    const ext=path.extname(name).toLowerCase(), mime=({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.bmp':'image/bmp','.pdf':'application/pdf'})[ext];
    if(!mime)throw new Error('支持 JPG、PNG、WEBP、BMP 图片与 PDF。');
    if(ext==='.pdf' && data.subarray(0,5).toString()!=='%PDF-')throw new Error('PDF 文件头无效。');
    const hash=crypto.createHash('sha256').update(data).digest('hex');
    if(rows(this.db,'SELECT id FROM attachments WHERE record_id=? AND hash=?',[recordId,hash]).length)throw new Error('这条资料中已存在相同附件。');
    const id=uuid();
    return this.mutate(()=>{this.db.run('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)',[id,recordId,path.basename(name),mime,data.length,hash,JSON.stringify(metadata),data,now()]);return id;});
  }
  copyInbox(sourceId,targetId){
    const source=this.record(sourceId),target=this.record(targetId);if(source.id===target.id||source.category!=='收集箱'||source.deleted||target.deleted)throw new Error('请选择有效的收集箱来源和已有资料。');
    const files=rows(this.db,'SELECT * FROM attachments WHERE record_id=?',[sourceId]);let added=0,skipped=0;
    this.mutate(()=>{for(const file of files){if(rows(this.db,'SELECT id FROM attachments WHERE record_id=? AND hash=?',[targetId,file.hash]).length){skipped++;continue;}const metadata=JSON.parse(file.metadata);metadata.role='general';metadata.documentId='';metadata.pageLabel='';this.db.run('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?,?)',[uuid(),targetId,file.name,file.mime,file.size,file.hash,JSON.stringify(metadata),file.data,now()]);added++;}this.db.run('UPDATE records SET updated=? WHERE id=?',[now(),targetId]);});return {added,skipped};
  }
  deleteAttachment(id) {return this.mutate(()=>this.db.run('DELETE FROM attachments WHERE id=?',[id]));}
  updateAttachment(id,input){
    const attachment=this.attachment(id),record=this.record(attachment.record_id);
    if(record.deleted)throw new Error('请先恢复资料再修改附件。');
    const metadata={...attachment.metadata,...userMetadata(record,{...attachment.metadata,...input})};
    return this.mutate(()=>{this.db.run('UPDATE attachments SET metadata=? WHERE id=?',[JSON.stringify(metadata),id]);return id;});
  }
  collections() {return rows(this.db,'SELECT * FROM collections ORDER BY created,id');}
  createCollection(title) {
    title=String(title||'').trim();if(!title)throw new Error('请填写清单名称。');
    const id=uuid();return this.mutate(()=>{this.db.run('INSERT INTO collections VALUES(?,?,?)',[id,title,now()]);return id;});
  }
  deleteCollection(id){return this.mutate(()=>this.db.run('DELETE FROM collections WHERE id=?',[id]));}
  addToCollection(id, recordIds){return this.mutate(()=>{for(const r of recordIds)this.db.run('INSERT OR IGNORE INTO collection_items VALUES(?,?)',[id,r]);});}
  removeFromCollection(id, recordIds){return this.mutate(()=>{for(const r of recordIds)this.db.run('DELETE FROM collection_items WHERE collection_id=? AND record_id=?',[id,r]);});}
  stats() {
    return {records:rows(this.db,'SELECT count(*) AS n FROM records WHERE deleted=0')[0].n,
      attachments:rows(this.db,'SELECT count(*) AS n FROM attachments a JOIN records r ON a.record_id=r.id WHERE r.deleted=0')[0].n,
      photos:rows(this.db,"SELECT count(*) AS n FROM records WHERE deleted=0 AND category='个人照片'")[0].n,
      collections:this.collections().length, bytes:fs.statSync(this.filename).size};
  }
  async changePassword(password) {
    checkPassword(password);const old=clone(this.header), salt=crypto.randomBytes(16), nonce=crypto.randomBytes(12), derived=await derive(password,salt);
    this.header={...this.header,salt:b64(salt),pw_nonce:b64(nonce),pw_wrap:b64(encrypt(derived,nonce,this.key,PW_AAD))};derived.fill(0);
    try{this.persist();}catch(error){this.header=old;throw error;}
  }
  backup(destination){if(path.resolve(destination)===path.resolve(this.filename))throw new Error('备份不能覆盖当前档案。');atomicWrite(destination,fs.readFileSync(this.filename));}
  async restore(source, credential, recovery=false) {
    const candidate=await Vault.open(source,credential,recovery);let data;
    try{data=candidate.serialize();}finally{candidate.close();}
    const target=path.join(path.dirname(this.filename),'backups','before-restore-'+Date.now()+'-'+uuid().slice(0,8)+'.pav');
    try {
      this.backup(target);
      const previous=this.serialize();
      try {
        const replacement=configure(new this.SQL.Database(Uint8Array.from(data)),true);
        this.db.close();this.db=replacement;this.persist();
      } catch(error) {
        this.db.close();this.db=configure(new this.SQL.Database(Uint8Array.from(previous)),true);throw error;
      } finally {previous.fill(0);}
      return target;
    } finally {data.fill(0);}
  }
  close(){if(this.db){this.db.close();this.db=null;}if(this.key)this.key.fill(0);this.key=null;this.header=null;}
}
function formatRecord(record, version='完整记录') {
  const lines=[record.title,'分类：'+record.category];
  for(const [k,v]of Object.entries(record.fields))if(v)lines.push(k+'：'+FormModel.display(k,v));
  if(record.versions[version])lines.push('',record.versions[version]);
  if(record.tags.length)lines.push('标签：'+record.tags.join('、'));
  if(record.notes)lines.push('备注：'+record.notes);
  return lines.join('\n');
}
module.exports={Vault,fields,MAX_DB,MAX_FILE,atomicWrite,formatRecord,encodeRecovery,decodeRecovery,sqlEngine};
