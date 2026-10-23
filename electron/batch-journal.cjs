const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
function createBatchJournal(directory){
  const root=directory&&path.resolve(directory),target=root&&path.join(root,'queue.json');let queue=Promise.resolve();
  const enqueue=fn=>{const next=queue.then(fn,fn);queue=next.catch(()=>{});return next;};
  return{
    read:()=>enqueue(async()=>{if(!target)return null;try{const stat=await fs.lstat(target);if(!stat.isFile()||stat.size>2*1024*1024)throw new Error('Registro de lote inválido.');return JSON.parse(await fs.readFile(target,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw new Error('No se pudo leer la cola guardada. Se conserva el registro; puedes reintentar o descartarlo expresamente.');}}),
    write:value=>enqueue(async()=>{if(!target)return;const data=JSON.stringify(value);if(Buffer.byteLength(data)>2*1024*1024)throw new Error('La cola guardada supera 2 MB.');await fs.mkdir(root,{recursive:true});const temp=path.join(root,randomUUID()+'.tmp');let handle;try{handle=await fs.open(temp,'wx');await handle.writeFile(data);await handle.sync();await handle.close();handle=null;await fs.rename(temp,target);}finally{await handle?.close().catch(()=>{});await fs.rm(temp,{force:true}).catch(()=>{});}})
  };
}
module.exports={createBatchJournal};
