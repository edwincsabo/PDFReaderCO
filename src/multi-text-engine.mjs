import{PDFDocument,PDFName,PDFNumber}from'pdf-lib';
import{validateParts,validateMultiFormatRequest,multiFormatEdit}from'./multi-text.mjs';
export function createMultiTextFormatter(engine,hash){
  let cached=null;
  const clearMultiFormat=()=>{cached=null;return true;};
  async function reviewMultiFormat(bytes,request){
    cached=null;if(request.source!==await hash(bytes))throw new Error('El documento cambió. Selecciona de nuevo el texto.');
    if(request.fonts!==undefined&&(!Array.isArray(request.fonts)||request.fonts.length>8||request.fonts.some(f=>!(f.bytes instanceof Uint8Array))||request.fonts.reduce((n,f)=>n+f.bytes.length,0)>64*1024*1024))throw new Error('Las fuentes del conjunto superan ocho archivos o 64 MB.');
    validateMultiFormatRequest(request);const info=await engine.inspect(bytes,request.page),parts=validateParts(info,request.parts),doc=await PDFDocument.load(bytes.slice(),{updateMetadata:false}),unit=doc.getPage(request.page-1).node.lookupMaybe(PDFName.of('UserUnit'),PDFNumber)?.asNumber()??1;
    if(request.catalog!==undefined&&(!Array.isArray(request.catalog)||request.catalog.length>4000))throw new Error('El catálogo de fuentes no es válido.');
    const entries=[];
    for(const{run,part}of parts){try{const edit=multiFormatEdit(info,part,request,unit);edit.fonts=request.fonts;const fit=await engine.measure(bytes,edit);if(!fit.fits)throw new Error(fit.expansionReason||'El formato nuevo no cabe en el área actual. Reduce el tamaño o cambia los atributos.');entries.push({index:part.index,text:run.text.slice(part.start,part.end),status:'ready',reason:'Conserva el área y el anclaje del bloque.'});}catch(e){entries.push({index:part.index,text:run.text.slice(part.start,part.end),status:'blocked',reason:e.message});}}
    if(entries.some(e=>e.status==='blocked'))return{id:null,source:info.source,entries,ready:entries.filter(e=>e.status==='ready').length,blocked:entries.filter(e=>e.status==='blocked').length};
    // Descending native/virtual indices keep all unprocessed object identities
    // stable, including shared/nested Form occurrences. Commit only the final
    // complete result; a failure leaves the caller's document untouched.
    let output=bytes;for(const part of [...request.parts].sort((a,b)=>b.index-a.index)){
      const current=await engine.inspect(output,request.page),edit=multiFormatEdit(current,part,request,unit);edit.fonts=request.fonts;output=await engine.edit(output,edit);
    }
    const id=crypto.randomUUID();cached={id,source:info.source,output,expires:Date.now()+600000};
    return{id,source:info.source,entries,ready:entries.length,blocked:0,image:await engine.renderPage(output,request.page,request.previewWidth)};
  }
  const applyMultiFormat=async(bytes,request)=>{const plan=cached;if(!plan||plan.id!==request.id||plan.source!==request.source||plan.expires<Date.now()||plan.source!==await hash(bytes))throw new Error('La revisión ya no es válida. Revisa de nuevo el formato antes de aplicar.');cached=null;return plan.output;};
  return{reviewMultiFormat,applyMultiFormat,clearMultiFormat};
}
