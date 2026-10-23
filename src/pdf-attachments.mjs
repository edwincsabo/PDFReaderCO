import {PDFDict,PDFArray,PDFRef,PDFRawStream,PDFHexString,PDFString,PDFNumber,decodePDFRawStream} from 'pdf-lib';
import {N,resolve,textOf,structureDocument,sourceHash,namePairs,saveStructure} from './pdf-structure.mjs';
export const ATTACHMENT_LIMIT=32*1024*1024,ATTACHMENT_BATCH_LIMIT=96*1024*1024;

function scan(doc){
  const names=doc.catalog.lookupMaybe(N('Names'),PDFDict),pairs=namePairs(doc,names?.get(N('EmbeddedFiles'))),files=new Map(),incoming=new Map(),afOwners=[],afArrays=new Set(),nameSlots=new Map(),annotations=new Map(),seen=new Set();let visited=0;
  const add=(raw,origin)=>{const dict=resolve(doc,raw);if(!(dict instanceof PDFDict))throw new Error('La referencia de un archivo adjunto está incompleta.');let entry=files.get(dict);if(!entry){if(files.size>=512)throw new Error('Se admiten hasta 512 archivos adjuntos por documento.');entry={dict,ref:raw instanceof PDFRef?raw:null,id:raw instanceof PDFRef?raw.toString():'direct-file-'+files.size,origins:new Set(),aliases:[]};files.set(dict,entry);}entry.origins.add(origin);return entry;};
  for(const pair of pairs){const entry=add(pair.value,'document');entry.aliases.push(textOf(pair.key));const slots=nameSlots.get(pair.array)||new Set();slots.add(pair.index);nameSlots.set(pair.array,slots);}
  for(const page of doc.getPages()){const array=page.node.Annots();if(array)for(const raw of array.asArray()){const annotation=resolve(doc,raw);if(annotation instanceof PDFDict)annotations.set(annotation,{page,array,raw});}}
  const pending=[{value:doc.catalog,parent:null,key:null}];
  while(pending.length){const {value,parent,key}=pending.pop(),object=resolve(doc,value);if(!object||typeof object!=='object')continue;
    if(parent){const edges=incoming.get(object)||[];edges.push({parent,key});incoming.set(object,edges);}
    if(seen.has(object))continue;seen.add(object);if(++visited>200000)throw new Error('El documento es demasiado complejo para administrar sus adjuntos.');
    if(object instanceof PDFDict){
      const af=object.lookupMaybe(N('AF'),PDFArray);if(af){afOwners.push({owner:object,array:af});afArrays.add(af);for(const raw of af.asArray())add(raw,'associated');}
      if(object.get(N('Subtype'))?.toString()==='/FileAttachment'&&object.has(N('FS')))add(object.get(N('FS')),'annotation');
      for(const [name,child]of object.entries())pending.push({value:child,parent:object,key:name.toString()});
    }else if(object instanceof PDFArray){for(let i=0;i<object.size();i++)pending.push({value:object.get(i),parent:object,key:i});}
    else if(object.dict instanceof PDFDict)pending.push({value:object.dict,parent:object,key:'stream'});
  }
  const pageArrays=new Set([...annotations.values()].map(a=>a.array));
  for(const entry of files.values()){
    const related=[...annotations.keys()].filter(a=>resolve(doc,a.get(N('FS')))===entry.dict&&a.get(N('Subtype'))?.toString()==='/FileAttachment'),popups=related.flatMap(a=>{const p=resolve(doc,a.get(N('Popup')));return p instanceof PDFDict&&p.get(N('Subtype'))?.toString()==='/Popup'&&resolve(doc,p.get(N('Parent')))===a?[p]:[];}),hasReplies=related.some(a=>a.has(N('IRT')))||[...annotations.keys()].some(a=>related.includes(resolve(doc,a.get(N('IRT'))))),locked=related.some(a=>((a.lookupMaybe(N('F'),PDFNumber)?.asNumber()||0)&(64|128|512))!==0),annotationUnknown=related.some(a=>a.has(N('Popup'))&&!popups.includes(resolve(doc,a.get(N('Popup')))))||[...related,...popups].some(a=>(incoming.get(a)||[]).some(edge=>edge.parent instanceof PDFArray?!pageArrays.has(edge.parent):!(edge.key==='/Parent'&&popups.includes(edge.parent)||edge.key==='/Popup'&&related.includes(edge.parent)))),unknown=annotationUnknown||(incoming.get(entry.dict)||[]).some(edge=>{
      if(edge.parent instanceof PDFArray)return !afArrays.has(edge.parent)&&!nameSlots.get(edge.parent)?.has(edge.key);
      return !(edge.key==='/FS'&&annotations.has(edge.parent)&&edge.parent.get(N('Subtype'))?.toString()==='/FileAttachment');
    });
    const ef=entry.dict.lookupMaybe(N('EF'),PDFDict);let stream=null;for(const key of ['UF','F','DOS','Unix','Mac']){const candidate=resolve(doc,ef?.get(N(key)));if(candidate instanceof PDFRawStream){stream=candidate;break;}}
    const params=stream?.dict.lookupMaybe(N('Params'),PDFDict),declared=params?.lookupMaybe(N('Size'),PDFNumber)?.asNumber(),filename=textOf(entry.dict.get(N('UF')))||textOf(entry.dict.get(N('F')))||entry.aliases[0]||'Adjunto.bin';
    Object.assign(entry,{stream,related,popups,name:filename,description:textOf(entry.dict.get(N('Desc'))),size:Number.isFinite(declared)&&declared>=0?declared:null,removable:!unknown&&!hasReplies&&!locked,reason:locked?'La anotación del adjunto está bloqueada y se conserva como solo lectura.':hasReplies?'El adjunto tiene respuestas asociadas y se conserva como solo lectura.':unknown?'El adjunto tiene vínculos adicionales no compatibles y se conserva como solo lectura.':'',mime:stream?.dict.get(N('Subtype'))?.decodeText?.()||'',extractable:!!stream});
  }
  return {names,pairs,files,afOwners,annotations};
}
export async function readPdfAttachments(bytes){const doc=await structureDocument(bytes),data=scan(doc);return {source:await sourceHash(bytes),items:[...data.files.values()].map(({id,name,description,size,removable,reason,mime,extractable,origins,aliases,related,popups})=>({id,name,description,size,removable,reason,mime,extractable,origins:[...origins],aliases,annotations:related.length+popups.length})),limit:ATTACHMENT_LIMIT};}
export async function extractPdfAttachment(bytes,request){
  if(!request||request.source!==await sourceHash(bytes))throw new Error('El documento cambió. Actualiza la lista de adjuntos.');const doc=await structureDocument(bytes),entry=[...scan(doc).files.values()].find(e=>e.id===request.id);if(!entry?.stream)throw new Error('El adjunto no contiene un archivo incorporado compatible.');
  let data;try{data=decodePDFRawStream(entry.stream).getBytes(ATTACHMENT_LIMIT+1);}catch{throw new Error('No se pudo descomprimir el adjunto. Su formato o protección no es compatible.');}if(data.length>ATTACHMENT_LIMIT)throw new Error('El adjunto supera el límite de extracción de 32 MB.');return {bytes:new Uint8Array(data),name:entry.name};
}
const compareKeys=(a,b)=>{const x=a.key.asBytes(),y=b.key.asBytes();for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
export async function writePdfAttachments(bytes,plan){
  if(!plan||plan.source!==await sourceHash(bytes))throw new Error('El documento cambió. Abre de nuevo la lista de adjuntos.');
  if(!Array.isArray(plan.remove)||new Set(plan.remove).size!==plan.remove.length||!Array.isArray(plan.add)||plan.add.length>20)throw new Error('Selección de adjuntos inválida; añade hasta 20 archivos por operación.');
  if(!plan.remove.length&&!plan.add.length)return bytes;
  const doc=await structureDocument(bytes),data=scan(doc),entries=[...data.files.values()],removed=plan.remove.map(id=>{const entry=entries.find(e=>e.id===id);if(!entry||!entry.removable)throw new Error(entry?.reason||'El adjunto seleccionado ya no está disponible.');return entry;}),deleted=new Set(removed.map(e=>e.dict));
  if(entries.length-removed.length+plan.add.length>512)throw new Error('El documento superaría los 512 adjuntos.');
  let total=0;const used=new Set(entries.filter(e=>!deleted.has(e.dict)).flatMap(e=>[e.name,...e.aliases]).map(s=>s.toLowerCase()));
  for(const item of plan.add){
    if(!item||typeof item.name!=='string'||!item.name.trim()||item.name.length>200||/[<>:"/\\|?*\u0000-\u001f\u007f]/.test(item.name)||/[. ]$/.test(item.name))throw new Error('El nombre del adjunto debe tener entre 1 y 200 caracteres y no contener rutas o caracteres reservados.');
    if(used.has(item.name.toLowerCase()))throw new Error('Ya existe un adjunto con ese nombre. Cambia el nombre del archivo que vas a añadir.');used.add(item.name.toLowerCase());
    if(!(item.bytes instanceof Uint8Array)||item.bytes.length>ATTACHMENT_LIMIT||(total+=item.bytes.length)>ATTACHMENT_BATCH_LIMIT)throw new Error('Añade archivos de hasta 32 MB, con un máximo conjunto de 96 MB por operación.');
    if(typeof item.description!=='string'||item.description.length>2000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(item.description))throw new Error('La descripción del adjunto no es válida.');
  }
  const pairs=data.pairs.filter(pair=>!deleted.has(resolve(doc,pair.value)));
  for(const item of plan.add){const stream=doc.context.flateStream(item.bytes,{Type:'EmbeddedFile',Params:{Size:item.bytes.length,ModDate:PDFString.fromDate(new Date())}}),ref=doc.context.register(stream),spec=doc.context.obj({Type:'Filespec',F:PDFString.of(item.name.replace(/[^\x20-\xff]/g,'_')),UF:PDFHexString.fromText(item.name),Desc:PDFHexString.fromText(item.description),EF:{F:ref,UF:ref}});pairs.push({key:PDFHexString.fromText(item.name),value:doc.context.register(spec)});}
  const names=data.names?.clone()||doc.context.obj({});if(pairs.length){pairs.sort(compareKeys);const values=[];for(const pair of pairs)values.push(pair.key,pair.value);names.set(N('EmbeddedFiles'),doc.context.obj({Names:values}));}else names.delete(N('EmbeddedFiles'));
  if(names.keys().length)doc.catalog.set(N('Names'),names);else doc.catalog.delete(N('Names'));
  for(const {owner,array}of data.afOwners){const keep=array.asArray().filter(raw=>!deleted.has(resolve(doc,raw)));if(keep.length)owner.set(N('AF'),doc.context.obj(keep));else owner.delete(N('AF'));}
  const removedAnnotations=new Set(removed.flatMap(e=>[...e.related,...e.popups]));
  if(removedAnnotations.size)for(const page of doc.getPages()){const array=page.node.Annots();if(array)page.node.set(N('Annots'),doc.context.obj(array.asArray().filter(raw=>!removedAnnotations.has(resolve(doc,raw)))));}
  return saveStructure(doc);
}
