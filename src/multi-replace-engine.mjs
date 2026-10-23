import{validateParts}from'./multi-text.mjs';
import{validateMultiReplacement,multiReplacementEdit,distributeReplacement}from'./multi-replace.mjs';

export function createMultiTextReplacer(engine,hash){
  let cached=null;
  const clearMultiReplacement=()=>{cached=null;return true;};
  async function reviewMultiReplacement(bytes,request){
    cached=null;
    if(!request||request.source!==await hash(bytes))throw new Error('El documento cambió. Selecciona de nuevo el texto.');
    validateMultiReplacement(request);
    if(request.fonts!==undefined&&(!Array.isArray(request.fonts)||request.fonts.length>8||request.fonts.some(f=>!(f.bytes instanceof Uint8Array))||request.fonts.reduce((n,f)=>n+f.bytes.length,0)>64*1024*1024))throw new Error('Las fuentes del conjunto superan ocho archivos o 64 MB.');
    const info=await engine.inspect(bytes,request.page),parts=validateParts(info,request.parts),measure=edit=>engine.measure(bytes,{...edit,fonts:request.fonts}),chunks=await distributeReplacement(info,request,measure),entries=[];
    for(let i=0;i<parts.length;i++){
      const{part,run}=parts[i],inserted=chunks[i],after=run.text.slice(0,part.start)+inserted+run.text.slice(part.end);
      const entry={index:part.index,text:run.text.slice(part.start,part.end),inserted,before:run.text,after};
      try{const edit=multiReplacementEdit(info,part,inserted,request.replacement.font),fit=await measure(edit);if(!fit.fits)throw new Error(fit.expansionReason||'El reemplazo no cabe en este bloque. Ajusta la distribución o acorta el texto.');entries.push({...entry,status:'ready',reason:after?'Conserva el área, el anclaje y los estilos fuera de la selección.':'Se elimina el texto completo de este bloque.'});}
      catch(e){entries.push({...entry,status:'blocked',reason:e.message});}
    }
    const blocked=entries.filter(e=>e.status==='blocked').length;
    if(blocked)return{id:null,source:info.source,entries,ready:entries.length-blocked,blocked};
    if(entries.every(e=>e.before===e.after))throw new Error('El reemplazo no cambia el texto seleccionado.');
    let output=bytes;
    for(const{part,inserted}of parts.map(({part},i)=>({part,inserted:chunks[i]})).sort((a,b)=>b.part.index-a.part.index)){
      const current=await engine.inspect(output,request.page),edit=multiReplacementEdit(current,part,inserted,request.replacement.font);
      output=await engine.edit(output,{...edit,fonts:request.fonts});
    }
    // Cache only a completely built, rendered candidate, never an intermediate.
    const image=await engine.renderPage(output,request.page,request.previewWidth),id=crypto.randomUUID();cached={id,source:info.source,output,expires:Date.now()+600000};
    return{id,source:info.source,entries,ready:entries.length,blocked:0,image};
  }
  const applyMultiReplacement=async(bytes,request)=>{const plan=cached;if(!plan||plan.id!==request.id||plan.source!==request.source||plan.expires<Date.now()||plan.source!==await hash(bytes))throw new Error('La revisión ya no es válida. Revisa de nuevo el reemplazo antes de aplicar.');cached=null;return plan.output;};
  return{reviewMultiReplacement,applyMultiReplacement,clearMultiReplacement};
}
