const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {createReadStream}=require('node:fs');
const {safeAttachmentName}=require('./attachment-name.cjs');
const {createBatchJournal}=require('./batch-journal.cjs');
const LIMIT=256*1024*1024,STATUSES=['pending','running','done','unchanged','error','canceled','interrupted'];
const fingerprint=s=>s?{size:s.size,mtimeMs:s.mtimeMs,ino:s.ino,dev:s.dev}:null;
const equal=(a,b)=>!!a&&!!b&&['size','mtimeMs','ino','dev'].every(k=>a[k]===b[k]);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fileDigest(file,size){const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==size||size>LIMIT)throw new Error('La copia no está completa.');const hash=createHash('sha256');let count=0;for await(const part of createReadStream(file)){count+=part.length;if(count>LIMIT)throw new Error('Copia demasiado grande.');hash.update(part);}if(count!==size)throw new Error('La copia cambió al comprobarla.');return hash.digest('hex');}
function bounded(value,max=32000){const data=JSON.stringify(value);if(typeof data!=='string'||data.length>max)throw new Error('Opciones del lote inválidas.');return JSON.parse(data);}
function createBatchFiles({directory,onPhase}={}){
  const files=new Map(),folders=new Map(),journal=createBatchJournal(directory);let settings={profile:null,folder:null,lastProfile:null},order=[],sequence=Promise.resolve();
  const serial=fn=>{const next=sequence.then(fn,fn);sequence=next.catch(()=>{});return next;};
  const persist=()=>journal.write({version:1,...settings,items:order.filter(id=>files.has(id)).map(id=>({id,...files.get(id)}))});
  const inside=(folder,name)=>{if(typeof name!=='string'||path.basename(name)!==name)throw new Error('Nombre de copia inválido.');const target=path.resolve(folder,name);if(path.dirname(target).toLowerCase()!==folder.toLowerCase())throw new Error('Ruta del lote fuera del destino.');return target;};
  const publicState=file=>({...file.public,...file.state,id:file.public.id});
  const api={
    async add(paths){
      if(!Array.isArray(paths)||paths.length>100)throw new Error('Selecciona hasta 100 archivos PDF.');
      const result=[],staged=new Map();
      for(const input of paths){
        if(typeof input!=='string')throw new Error('Ruta PDF inválida.');const absolute=path.resolve(input);let canonical=absolute,stat,error='';
        try{canonical=await fs.realpath(absolute);stat=await fs.stat(canonical);if(path.extname(absolute).toLowerCase()!=='.pdf'||!stat.isFile())throw new Error('Selecciona un archivo PDF.');if(stat.size>LIMIT)throw new Error('El archivo supera los 256 MB.');}catch(e){error=e.message?.startsWith('Selecciona')||e.message?.includes('256 MB')?e.message:'No se pudo acceder al archivo seleccionado.';}
        const prior=[...files.values(),...staged.values()].find(file=>file.path.toLowerCase()===canonical.toLowerCase());if(prior){result.push(prior.public);continue;}
        if(files.size+staged.size>=100)throw new Error('La cola admite hasta 100 archivos. Quita archivos antes de añadir otros.');
        const id=randomUUID(),item={id,name:path.basename(absolute),size:stat?.size||0,error};staged.set(id,{path:canonical,stat:fingerprint(stat),public:item,state:{status:'pending',message:error||'Listo para procesar.'}});result.push(item);
      }
      for(const [id,file]of staged){files.set(id,file);order.push(id);}return result;
    },
    release(ids){if(!Array.isArray(ids)||ids.length>100)throw new Error('Selección de archivos inválida.');for(const id of ids)files.delete(id);order=order.filter(id=>files.has(id));},
    async folder(input){const folder=await fs.realpath(input),stat=await fs.stat(folder);if(!stat.isDirectory())throw new Error('Selecciona una carpeta de destino.');const id=randomUUID();folders.clear();folders.set(id,folder);return{id,path:folder};},
    async read(id){const file=files.get(id);if(!file)throw new Error('Vuelve a añadir el archivo a la cola.');if(file.public.error)throw new Error(file.public.error);
      const canonical=await fs.realpath(file.path);if(canonical.toLowerCase()!==file.path.toLowerCase())throw new Error('La ruta del archivo cambió. Vuelve a añadirlo.');
      const handle=await fs.open(file.path,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size>LIMIT)throw new Error('Archivo no válido o mayor de 256 MB.');if(!equal(stat,file.stat))throw new Error('El archivo cambió desde que se añadió. Quítalo y vuelve a añadirlo.');const bytes=new Uint8Array(await handle.readFile());if(bytes.length>LIMIT||!equal(await handle.stat(),stat))throw new Error('El archivo cambió mientras se leía. Vuelve a añadirlo.');return bytes;}finally{await handle.close();}
    },
    save:raw=>serial(async()=>{
      if(!raw||!Array.isArray(raw.items)||raw.items.length>100||new Set(raw.items.map(i=>i.id)).size!==raw.items.length)throw new Error('Cola inválida.');
      const next=raw.items.map(item=>{const file=files.get(item.id);if(!file||!STATUSES.includes(item.status))throw new Error('Elemento del lote inválido.');const state=bounded(item);delete state.id;return{file,state};});
      const folder=raw.folder?{id:raw.folder.id,path:folders.get(raw.folder.id)}:null;if(folder&&!folder.path)throw new Error('Vuelve a elegir la carpeta de destino.');
      settings={profile:bounded(raw.profile),lastProfile:bounded(raw.lastProfile??null),folder};order=raw.items.map(i=>i.id);for(const{file,state}of next){if(file.receipt&&state.status==='pending'&&(!state.output||state.attempt!==file.receipt.attempt))file.receipt=null;file.state=state;}await persist();return{saved:true};
    }),
    restore:()=>serial(async()=>{
      const raw=await journal.read();if(!raw)return{items:[],profile:null,folder:null,lastProfile:null};
      if(raw.version!==1||!Array.isArray(raw.items)||raw.items.length>100)throw new Error('Formato de cola no compatible. El registro se conserva.');
      const staged=new Map();
      for(const f of raw.items){
        if(!f||typeof f.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(f.id)||staged.has(f.id)||typeof f.path!=='string'||!path.isAbsolute(f.path)||path.extname(f.path).toLowerCase()!=='.pdf'||f.public?.id!==f.id||typeof f.public.name!=='string'||!STATUSES.includes(f.state?.status))throw new Error('La cola guardada contiene datos no compatibles.');
        f.state=bounded(f.state);f.public=bounded(f.public);if(f.stat&&!['size','mtimeMs','ino','dev'].every(k=>Number.isFinite(f.stat[k])))throw new Error('Identidad de archivo inválida.');staged.set(f.id,f);
      }
      let folder=raw.folder;if(folder){if(typeof folder.id!=='string'||typeof folder.path!=='string'||!path.isAbsolute(folder.path))throw new Error('Destino guardado inválido.');try{const actual=await fs.realpath(folder.path);if(actual.toLowerCase()!==folder.path.toLowerCase()||!(await fs.stat(actual)).isDirectory())throw new Error();folders.set(folder.id,actual);}catch{folder=null;}}
      for(const f of staged.values()){
        if(f.staging){const t=f.staging;if(typeof t.folder!=='string'||!path.isAbsolute(t.folder)||typeof t.temp!=='string'||!/^\.pdfreaderco-[a-zA-Z0-9-]+\.partial$/.test(t.temp))throw new Error('Registro temporal inválido.');f.state={...f.state,status:'interrupted',message:'Trabajo interrumpido. Temporal conservado para revisión: '+inside(t.folder,t.temp)};}
        const record=f.intent||f.receipt;let verified=false;
        if(record){if(typeof record.folder!=='string'||!path.isAbsolute(record.folder)||!Number.isSafeInteger(record.size)||record.size<1||record.size>LIMIT||!/^[a-f0-9]{64}$/.test(record.sha256))throw new Error('Registro de copia inválido.');const target=inside(record.folder,record.name);
          try{verified=await fileDigest(target,record.size)===record.sha256;}catch{}
          if(verified){f.receipt=record;f.intent=null;f.staging=null;f.state={...f.state,status:'done',output:record.name,outputSize:record.size,message:'Copia terminada y verificada al recuperar.'};}
          else if(f.intent||f.state.status==='done')f.state={...f.state,status:'interrupted',message:'Copia ausente, modificada o incompleta. Revisa '+target+' antes de reintentar.'+(record.temp?' Temporal conservado: '+inside(record.folder,record.temp):'')};
        }
        if(f.state.status==='running')f.state={...f.state,status:'interrupted',message:'Trabajo interrumpido. No se reanudó automáticamente.'};
        if(f.state.status==='done'&&!verified)f.state={...f.state,status:'interrupted',message:'No existe una copia verificada para este resultado.'};
        if(!['done','unchanged'].includes(f.state.status))try{if((await fs.realpath(f.path)).toLowerCase()!==f.path.toLowerCase()||!equal(await fs.stat(f.path),f.stat))throw new Error();}catch{f.public.error='El original cambió o ya no está disponible. Quítalo y vuelve a añadirlo.';f.state={...f.state,status:'error',message:f.public.error};}
        delete f.state.fraction;
      }
      files.clear();for(const[id,f]of staged)files.set(id,f);order=[...files.keys()];settings={profile:bounded(raw.profile),lastProfile:bounded(raw.lastProfile??null),folder};await persist();
      return{items:order.map(id=>publicState(files.get(id))),...settings};
    }),
    clear:()=>serial(async()=>{files.clear();folders.clear();order=[];settings={profile:null,folder:null,lastProfile:null};await persist();}),
    write:request=>serial(async()=>{
      const{id,folder,operation,bytes}=request,source=files.get(id),destination=folders.get(folder),suffix={numbers:'numerado',watermark:'marca-de-agua',extract:'paginas',compress:'comprimido',ocr:'ocr'}[operation];
      if(!['numbers','watermark','extract','compress','ocr'].includes(operation)||!suffix||!source||!destination||!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>LIMIT)throw new Error('Destino o datos del lote inválidos.');
      if((await fs.realpath(destination)).toLowerCase()!==destination.toLowerCase())throw new Error('La carpeta de salida cambió. Vuelve a elegirla.');
      const attempt=source.state?.attempt,sha256=digest(bytes),prior=source.receipt||source.intent;
      if(directory&&attempt&&prior?.attempt===attempt&&prior.sha256===sha256){try{if(await fileDigest(inside(prior.folder,prior.name),prior.size)===sha256){source.receipt=prior;source.intent=null;await persist();return{name:prior.name,size:prior.size};}}catch{}}
      const stem=safeAttachmentName(source.public.name.replace(/\.pdf$/i,'')).slice(0,120),temp='.pdfreaderco-'+randomUUID()+'.partial',temporary=inside(destination,temp);let handle,published=false;
      try{
        source.staging={folder:destination,temp,size:bytes.length,sha256,attempt};await persist();await onPhase?.('preparing',source.staging);
        handle=await fs.open(temporary,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
        for(let n=0;n<10000;n++){
          const name=`${stem}-${suffix}${n?' ('+(n+1)+')':''}.pdf`,target=inside(destination,name);
          source.intent={folder:destination,name,temp,size:bytes.length,sha256,attempt};await persist();await onPhase?.('staged',source.intent);
          try{await fs.copyFile(temporary,target,require('node:fs').constants.COPYFILE_EXCL);published=true;const output=await fs.open(target,'r+');try{await output.sync();}finally{await output.close();}if(await fileDigest(target,bytes.length)!==sha256)throw new Error('La copia no coincide con sus datos.');}catch(e){if(e.code==='EEXIST'){source.intent=null;await persist();continue;}throw e;}
          await onPhase?.('published',source.intent);source.receipt=source.intent;source.intent=null;source.staging=null;await persist();await fs.rm(temporary,{force:true});return{name,size:bytes.length};
        }throw new Error('Hay demasiadas copias con el mismo nombre.');
      }catch(e){await handle?.close().catch(()=>{});if(!e.simulatedCrash){await fs.rm(temporary,{force:true}).catch(()=>{});if(!published){const exists=source.intent&&await fs.lstat(inside(source.intent.folder,source.intent.name)).then(()=>true,()=>false);if(!exists)source.intent=null;source.staging=null;await persist().catch(()=>{});}}throw new Error(published?'La copia se creó, pero su registro no terminó. Se comprobará al recuperar la cola.':e.simulatedCrash?'Interrupción simulada.':'No se pudo completar la copia. Comprueba el espacio y los permisos.');}
    })
  };return api;
}
module.exports={createBatchFiles};
