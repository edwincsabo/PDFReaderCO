const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');

function createRecoveryStore(directory,options={}){
  const root=path.resolve(directory),history=path.join(root,'history');
  const limits={maxVersionBytes:64*1024*1024,maxBytes:256*1024*1024,maxVersions:10,maxDocuments:30,...options};
  for(const value of Object.values(limits))if(!Number.isSafeInteger(value)||value<1)throw new Error('Límite de recuperación inválido.');
  let queue=Promise.resolve(),lastTime=0;
  const enqueue=fn=>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next;};
  const validate=id=>{if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new Error('Identificador de recuperación inválido.');return id;};
  const file=(folder,id,extension)=>{validate(id);const target=path.resolve(folder,id+extension);if(!target.startsWith(folder+path.sep))throw new Error('Ruta de recuperación inválida.');return target;};
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  const now=()=>{lastTime=Math.max(Date.now(),lastTime+1);return new Date(lastTime).toISOString();};
  const names=async folder=>{try{return await fs.readdir(folder);}catch(error){if(error.code==='ENOENT')return [];throw error;}};
  const unlink=async target=>{for(let attempt=0;;attempt++)try{await fs.rm(target,{force:true});return;}catch(error){if(attempt>=3||!['EPERM','EBUSY','EACCES'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,25*(attempt+1)));}};
  const atomic=async(target,data)=>{const temporary=file(path.dirname(target),randomUUID(),'.tmp');try{await fs.writeFile(temporary,data,{flag:'wx'});await fs.rename(temporary,target);}finally{await unlink(temporary).catch(()=>{});}};
  const json=async target=>{const stat=await fs.lstat(target);if(!stat.isFile()||stat.size>65536)throw new Error('Metadatos de recuperación inválidos.');return JSON.parse(await fs.readFile(target,'utf8'));};
  const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
  const snapshot=async id=>{
    const value=await json(file(history,id,'.json'));validate(value.historyId);validate(value.sourceId);
    if(value.version!==1||value.id!==id||typeof value.name!=='string'||value.name.length>240||!validDate(value.created)||!Number.isSafeInteger(value.sequence)||value.sequence<1||!Number.isSafeInteger(value.size)||value.size<0||value.size>limits.maxVersionBytes||!/^[a-f0-9]{64}$/.test(value.sha256))throw new Error('Versión recuperable inválida.');
    const stat=await fs.lstat(file(history,id,'.pdfco'));if(!stat.isFile()||stat.size!==value.size)throw new Error('Versión recuperable incompleta.');return value;
  };
  const record=async id=>{
    const value=await json(file(root,id,'.json'));if(value.id!==id||typeof value.name!=='string'||value.name.length>240||!validDate(value.updated))throw new Error('Recuperación inválida.');
    if(value.version===2){validate(value.historyId);const version=await snapshot(value.latestVersionId);if(version.historyId!==value.historyId)throw new Error('Recuperación inconsistente.');return {...value,size:version.size,snapshot:version};}
    if(value.version!==undefined)throw new Error('Formato de recuperación no compatible.');
    const stat=await fs.lstat(file(root,id,'.pdfco'));if(!stat.isFile()||stat.size>limits.maxVersionBytes)throw new Error('Tamaño de recuperación inválido.');return {...value,historyId:id,size:stat.size,legacy:true};
  };
  const scan=async()=>{
    const versions=[],records=[];
    for(const name of await names(history))if(name.endsWith('.json'))try{versions.push(await snapshot(name.slice(0,-5)));}catch{}
    for(const name of await names(root))if(name.endsWith('.json'))try{records.push(await record(name.slice(0,-5)));}catch{}
    return {versions,records};
  };
  const legacyVersion=entry=>({id:'legacy:'+entry.id,historyId:entry.historyId,sourceId:entry.id,name:entry.name,created:entry.updated,size:entry.size,sequence:1,legacy:true});
  const allVersions=state=>[...state.versions,...state.records.filter(r=>r.legacy).map(legacyVersion)];
  const protectedIds=records=>new Set(records.map(r=>r.legacy?'legacy:'+r.id:r.latestVersionId));
  const newestFirst=(a,b)=>b.sequence-a.sequence||b.created.localeCompare(a.created)||b.id.localeCompare(a.id);
  const usage=async()=>{let total=0;for(const folder of [root,history])for(const name of await names(folder))if(name.endsWith('.pdfco'))try{const stat=await fs.lstat(file(folder,name.slice(0,-6),'.pdfco'));if(stat.isFile())total+=stat.size;}catch{}return total;};
  const bytesOf=async version=>{
    const target=version.legacy?file(root,version.sourceId,'.pdfco'):file(history,version.id,'.pdfco');const bytes=new Uint8Array(await fs.readFile(target));
    if(bytes.byteLength!==version.size||bytes.byteLength>limits.maxVersionBytes||!version.legacy&&digest(bytes)!==version.sha256)throw new Error('La copia está incompleta o fue modificada. No se restauró.');return bytes;
  };
  const deleteSnapshot=async version=>{await unlink(file(history,version.id,'.pdfco'));await unlink(file(history,version.id,'.json'));};
  const findVersion=(state,historyId,versionId)=>{validate(historyId);if(typeof versionId!=='string')throw new Error('Identificador de versión inválido.');if(versionId.startsWith('legacy:'))validate(versionId.slice(7));else validate(versionId);const version=allVersions(state).find(v=>v.historyId===historyId&&v.id===versionId);if(!version)throw new Error('La versión ya no está disponible.');return version;};
  const latestEntry=entry=>({id:entry.id,historyId:entry.historyId,name:entry.name,updated:entry.updated,size:entry.size});

  const writeNow=async(id,name,bytes,requestedHistoryId)=>{
      validate(id);if(!(bytes instanceof Uint8Array)||bytes.byteLength>limits.maxVersionBytes||typeof name!=='string')throw new Error('Datos de recuperación inválidos.');
      const state=await scan(),existing=state.records.find(r=>r.id===id),historyId=validate(requestedHistoryId??existing?.historyId??id);
      if(existing&&existing.historyId!==historyId)throw new Error('La recuperación pertenece a otro documento.');
      if(!existing&&state.records.length>=limits.maxDocuments)throw new Error('Se alcanzó el límite de sesiones recuperables. Guarda o cierra un documento.');
      const data=bytes.slice(),staged=[],base=allVersions(state).filter(v=>!(existing?.legacy&&v.id==='legacy:'+id));let sequence=Math.max(0,...base.filter(v=>v.historyId===historyId).map(v=>v.sequence));
      const stage=(content,versionName,created)=>{const version={version:1,id:randomUUID(),historyId,sourceId:id,name:versionName.slice(0,240),created,sequence:++sequence,size:content.byteLength,sha256:digest(content)};staged.push({version,bytes:content});base.push(version);return version;};
      // Archive a legacy latest copy before replacing its metadata with a pointer.
      if(existing?.legacy)stage(await bytesOf(legacyVersion(existing)),existing.name,existing.updated);
      const hash=digest(data);let target=base.filter(v=>v.historyId===historyId).sort(newestFirst)[0];
      if(!target||target.legacy||target.sha256!==hash||target.size!==data.byteLength)target=stage(data,name,now());
      const groups=new Set([...base.map(v=>v.historyId),...state.records.map(r=>r.historyId)]);if(groups.size>limits.maxDocuments)throw new Error('Se alcanzó el límite de documentos con historial. Elimina un historial que ya no necesites.');
      const protectedVersions=protectedIds(state.records.filter(r=>r.id!==id));protectedVersions.add(target.id);
      for(const group of groups){const newest=base.filter(v=>v.historyId===group).sort(newestFirst)[0];if(newest)protectedVersions.add(newest.id);}
      const pruning=new Set(),eligible=base.filter(v=>!v.legacy&&!protectedVersions.has(v.id)).sort((a,b)=>a.created.localeCompare(b.created)||a.sequence-b.sequence);
      for(const group of groups){let count=base.filter(v=>v.historyId===group).length;for(const version of eligible.filter(v=>v.historyId===group))if(count>limits.maxVersions){pruning.add(version);count--;}if(count>limits.maxVersions)throw new Error('Las versiones están protegidas por sesiones sin guardar. Guarda o cierra una sesión antes de crear otra versión.');}
      let total=await usage()+staged.reduce((sum,s)=>sum+s.version.size,0)-(existing?.legacy?existing.size:0)-[...pruning].reduce((sum,v)=>sum+v.size,0);
      for(const version of eligible)if(total>limits.maxBytes&&!pruning.has(version)){pruning.add(version);total-=version.size;}
      if(total>limits.maxBytes)throw new Error('No hay espacio de recuperación disponible sin borrar copias protegidas. Guarda un documento o elimina versiones antiguas.');
      const metadata={version:2,id,historyId,name:name.slice(0,240),updated:now(),latestVersionId:target.id};
      await fs.mkdir(history,{recursive:true});
      try{
        for(const item of staged){await atomic(file(history,item.version.id,'.pdfco'),item.bytes);await atomic(file(history,item.version.id,'.json'),JSON.stringify(item.version));}
        await atomic(file(root,id,'.json'),JSON.stringify(metadata));
      }catch(error){for(const item of staged){await unlink(file(history,item.version.id,'.pdfco')).catch(()=>{});await unlink(file(history,item.version.id,'.json')).catch(()=>{});}throw error;}
      // Commit the new latest pointer before pruning anything from the old history.
      let warning;try{if(existing?.legacy)await unlink(file(root,id,'.pdfco'));for(const version of pruning)await deleteSnapshot(version);}catch{warning='Copia guardada; no se pudo completar la limpieza de versiones antiguas.';}
      return {created:staged.length>0,warning};
  };
  return {
    write:(id,name,bytes,historyId)=>enqueue(()=>writeNow(id,name,bytes,historyId)),
    remove:id=>enqueue(async()=>{validate(id);let existing;try{existing=await record(id);}catch{}if(existing?.legacy)await writeNow(id,existing.name,await bytesOf(legacyVersion(existing)),existing.historyId);await unlink(file(root,id,'.json'));await unlink(file(root,id,'.pdfco'));}),
    list:()=>enqueue(async()=>{const state=await scan();return state.records.map(latestEntry).sort((a,b)=>b.updated.localeCompare(a.updated)).slice(0,limits.maxDocuments);}),
    read:id=>enqueue(async()=>{const entry=await record(id),version=entry.legacy?legacyVersion(entry):entry.snapshot;return {id,historyId:entry.historyId,name:entry.name.replace(/\.(pdf|pdfco)$/i,'')+' (recuperado).pdfco',bytes:await bytesOf(version),recovered:true};}),
    listHistory:()=>enqueue(async()=>{
      const state=await scan(),versions=allVersions(state),protectedVersions=protectedIds(state.records),groups=[];
      for(const historyId of new Set(versions.map(v=>v.historyId))){const entries=versions.filter(v=>v.historyId===historyId).sort(newestFirst),first=entries[0];groups.push({id:historyId,name:first.name,updated:first.created,versions:entries.map(v=>({id:v.id,created:v.created,size:v.size,number:v.sequence,protected:protectedVersions.has(v.id)}))});}
      groups.sort((a,b)=>b.updated.localeCompare(a.updated));return {groups,usageBytes:await usage(),maxBytes:limits.maxBytes,maxVersions:limits.maxVersions,maxDocuments:limits.maxDocuments};
    }),
    readVersion:(historyId,versionId)=>enqueue(async()=>{const version=findVersion(await scan(),historyId,versionId),id=randomUUID();return {id,historyId:id,name:version.name.replace(/\.(pdf|pdfco)$/i,'')+' (versión recuperada).pdfco',bytes:await bytesOf(version),recovered:true};}),
    deleteVersion:(historyId,versionId)=>enqueue(async()=>{const state=await scan(),version=findVersion(state,historyId,versionId);if(protectedIds(state.records).has(version.id))throw new Error('Esta versión protege una sesión sin guardar. Guarda o cierra ese documento antes de eliminarla.');await deleteSnapshot(version);}),
    clearHistory:historyId=>enqueue(async()=>{validate(historyId);const state=await scan(),protectedVersions=protectedIds(state.records);let removed=0,kept=0;for(const version of allVersions(state).filter(v=>v.historyId===historyId)){if(protectedVersions.has(version.id)){kept++;continue;}await deleteSnapshot(version);removed++;}return {removed,kept};})
  };
}
module.exports={createRecoveryStore};
