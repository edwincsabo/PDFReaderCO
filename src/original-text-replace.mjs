import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

const LIMIT=1000,word=/[\p{L}\p{N}\p{M}_]/u;
function options(value){
  if(!value||typeof value.query!=='string'||!value.query.length||value.query.length>200||/[\r\n\u0000-\u001f]/.test(value.query))throw new Error('Busca texto literal de una sola línea, de 1 a 200 caracteres.');
  return {query:value.query,caseSensitive:!!value.caseSensitive,wholeWord:!!value.wholeWord};
}
export function literalMatches(text,query,caseSensitive=false,wholeWord=false,limit=Infinity){
  const regex=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),caseSensitive?'gu':'giu'),found=[];
  for(const match of text.matchAll(regex)){
    const start=match.index,end=start+match[0].length,previous=Array.from(text.slice(Math.max(0,start-2),start)).at(-1)||'',next=Array.from(text.slice(end,end+2))[0]||'';
    if(!wholeWord||!word.test(previous)&&!word.test(next)){found.push({start,length:match[0].length,text:match[0]});if(found.length>=limit)break;}
  }
  return found;
}
const step=async(ctx,progress)=>{ctx.check?.();ctx.progress?.(progress);await new Promise(resolve=>setTimeout(resolve,0));ctx.check?.();};
const close=(a,b)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<.002);
const sameLine=(line,expected)=>line.text===expected.text&&line.fontName===expected.fontName&&Math.abs(line.fontSize-expected.fontSize)<.002&&line.color===expected.color&&Math.abs(line.opacity-expected.opacity)<.001&&line.marks===expected.marks&&line.clipped===expected.clipped&&close(line.bounds,expected.bounds)&&close(line.matrix,expected.matrix)&&JSON.stringify(line.originals)===JSON.stringify(expected.originals);

export function createTextReplacer(api,hash){
  // Prepared PDFs never replace the open document until Apply. Retain at most
  // four reviews / 96 MB, or one larger document within the normal file limit.
  const plans=new Map();
  async function scan(bytes,raw,ctx={}){
    const settings=options(raw),source=await hash(bytes);ctx.check?.();
    const doc=await PDFDocument.load(bytes.slice(),{updateMetadata:false}),pages=doc.getPageCount(),matches=[],groups=new Map();let scanned=0,grouped=0,unsupported=0,truncated=false;
    outer:for(let page=1;page<=pages;page++){
      await step(ctx,{stage:'search',current:page,total:pages,matches:matches.length});
      const analysis=await api.inspect(bytes,page);ctx.check?.();scanned=page;grouped+=analysis.grouped;unsupported+=analysis.unsupported;
      const unit=doc.getPage(page-1).node.lookupMaybe(PDFName.of('UserUnit'),PDFNumber)?.asNumber()??1;
      for(const line of analysis.lines){
        if(line.text.length>4000){unsupported++;continue;}
        const hits=literalMatches(line.text,settings.query,settings.caseSensitive,settings.wholeWord,LIMIT+1-matches.length);if(!hits.length)continue;
        const groupKey=`${page}:${line.index}`;groups.set(groupKey,{page,line,unit,hits:[]});
        for(const hit of hits){
          if(matches.length===LIMIT){truncated=true;break outer;}
          const id=`${groupKey}:${hit.start}`,item={id,page,index:line.index,start:hit.start,length:hit.length,text:hit.text,line:line.text,bounds:line.bounds,editable:line.editable,reason:line.reason};
          matches.push(item);groups.get(groupKey).hits.push(item);
        }
      }
    }
    return {source,settings,pages,scanned,truncated,grouped,unsupported,matches,groups};
  }
  async function search(bytes,raw,ctx={}){const {groups,...result}=await scan(bytes,raw,ctx);return result;}
  async function review(bytes,raw,ctx={}){
    if(!raw||raw.source!==await hash(bytes))throw new Error('El documento cambió. Busca y revisa las coincidencias de nuevo.');
    if(typeof raw.replacement!=='string'||raw.replacement.length>4000||/[\r\n\u0000-\u001f]/.test(raw.replacement))throw new Error('El reemplazo debe tener una sola línea y hasta 4.000 caracteres.');
    if(raw.expandToSpace!==undefined&&typeof raw.expandToSpace!=='boolean')throw new Error('La opción de expansión del reemplazo no es válida.');
    if(raw.autoFit&&(!Number.isFinite(raw.minimum)||raw.minimum<6||raw.minimum>72))throw new Error('Indica un mínimo entre 6 y 72 puntos.');
    const data=await scan(bytes,raw,ctx);
    if(data.truncated&&!raw.ids)throw new Error('Hay más de 1.000 coincidencias. Acota la búsqueda antes de revisar todas.');
    if(raw.ids&&(!Array.isArray(raw.ids)||!raw.ids.length||new Set(raw.ids).size!==raw.ids.length||raw.ids.some(id=>!data.matches.some(match=>match.id===id))))throw new Error('La selección de coincidencias cambió. Busca de nuevo.');
    const ids=raw.ids?new Set(raw.ids):null,entries=[],work=[];
    for(const {page,line,unit,hits:allHits} of data.groups.values()){
      const hits=allHits.filter(hit=>!ids||ids.has(hit.id));if(!hits.length)continue;
      let after=line.text;for(const hit of hits.slice().reverse())after=after.slice(0,hit.start)+raw.replacement+after.slice(hit.start+hit.length);
      const count=hits.filter(hit=>hit.text!==raw.replacement).length,pointSize=line.fontSize*Math.hypot(line.matrix[2],line.matrix[3])*unit;
      const entry={id:`${page}:${line.index}`,page,ids:hits.map(hit=>hit.id),selected:hits.length,count,before:line.text,after,bounds:line.bounds,status:count?'ready':'unchanged',reason:count?'Listo para reemplazar.':'El texto ya coincide con el reemplazo.',pointSize,previousSize:pointSize};
      const edit={source:data.source,page,index:line.index,indices:line.indices,originals:line.originals,original:line.text,text:after,font:'original',fontSize:line.fontSize,color:line.color,expandToSpace:!!raw.expandToSpace,checkFit:true,allowOverflow:false,fitMinimum:raw.minimum??8};
      entries.push(entry);work.push({entry,line,edit});
    }
    let prepared=bytes;
    // Descending object order minimizes index shifts; re-resolve identities
    // after each serialization rather than trusting any previous object index.
    work.sort((a,b)=>a.entry.page-b.entry.page||b.line.index-a.line.index);
    let current=0;
    for(const {entry,line,edit} of work){
      await step(ctx,{stage:'review',current:++current,total:work.length});if(entry.status==='unchanged')continue;
      try{
        if(!line.editable)throw new Error(line.reason||'Texto no compatible.');
        const fit=await api.measure(bytes,edit);ctx.check?.();if(fit.expanded)entry.reason='Se ampliará el área al espacio libre conservando el tamaño.';
        if(!fit.fits){
          if(!raw.autoFit)throw new Error(fit.expansionReason||'El reemplazo no cabe. Activa la expansión o el ajuste de tamaño y vuelve a revisar.');
          const adjusted=await api.autoFit(bytes,edit);ctx.check?.();
          if(!adjusted.fits)throw new Error(`No cabe con el mínimo de ${raw.minimum??8} pt. Acorta el reemplazo o cambia el mínimo.`);
          edit.fontSize=adjusted.fontSize;entry.pointSize=adjusted.pointSize;entry.status='adjusted';entry.reason=raw.expandToSpace?'Se reducirá el tamaño para caber en el espacio libre comprobado.':'Se reducirá el tamaño para conservar el área original.';
        }
        const analysis=await api.inspect(prepared,entry.page);ctx.check?.();
        const candidates=analysis.lines.filter(candidate=>sameLine(candidate,line));
        if(candidates.length!==1)throw new Error('La geometría o agrupación de esta línea cambió al preparar el lote. Reemplázala por separado.');
        const target=candidates[0],next={...edit,source:analysis.source,index:target.index,indices:target.indices,originals:target.originals,original:target.text};
        const result=await api.edit(prepared,next);ctx.check?.();prepared=result;
      }catch(error){if(error?.name==='AbortError')throw error;entry.status='blocked';entry.reason=error instanceof Error?error.message:String(error);entry.pointSize=entry.previousSize;}
    }
    ctx.check?.();
    const applicable=entries.filter(entry=>entry.status==='ready'||entry.status==='adjusted'),replaced=applicable.reduce((sum,entry)=>sum+entry.count,0),selected=entries.reduce((sum,entry)=>sum+entry.selected,0),blocked=entries.filter(entry=>entry.status==='blocked').reduce((sum,entry)=>sum+entry.count,0),unchanged=selected-replaced-blocked,id=crypto.randomUUID();
    if(replaced){
      plans.set(id,{source:data.source,bytes:prepared,replaced,lines:applicable.length});
      while(plans.size>1&&(plans.size>4||Array.from(plans.values()).reduce((sum,plan)=>sum+plan.bytes.byteLength,0)>96*1024*1024))plans.delete(plans.keys().next().value);
    }
    return {id,source:data.source,mode:raw.ids?'single':'all',entries,replaced,lines:applicable.length,selected,blocked,unchanged,settings:{...data.settings,replacement:raw.replacement,autoFit:!!raw.autoFit,expandToSpace:!!raw.expandToSpace,minimum:raw.minimum??8}};
  }
  async function apply(bytes,raw,ctx={}){
    ctx.check?.();const plan=plans.get(raw?.id);
    if(!plan)throw new Error('La revisión caducó o ya se aplicó. Revisa las coincidencias de nuevo.');
    if(raw.source!==plan.source||plan.source!==await hash(bytes))throw new Error('El documento cambió. Revisa las coincidencias de nuevo.');
    ctx.check?.();plans.delete(raw.id);return {bytes:plan.bytes,replaced:plan.replaced,lines:plan.lines};
  }
  return {searchReplacements:search,reviewReplacements:review,applyReplacements:apply};
}
