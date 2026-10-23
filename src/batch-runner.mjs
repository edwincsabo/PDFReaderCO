export async function runBatchQueue(items,profile,{signal,read,process,write,onUpdate}){
  const results=[];const canceled=()=>{if(signal.aborted)throw new DOMException('Operación cancelada.','AbortError');};
  for(const item of items){
    if(signal.aborted){const result={id:item.id,status:'canceled',message:'Cancelado sin crear copia.'};results.push(result);await onUpdate(result);continue;}
    try{
      await onUpdate({id:item.id,status:'running',message:'Leyendo archivo',fraction:.02});const bytes=await read(item.id);canceled();const inputSize=bytes.byteLength;
      const output=await process(bytes,profile,signal,progress=>{if(!signal.aborted)onUpdate({id:item.id,status:'running',...progress});});canceled();
      const compression=output.compression;
      if(profile.operation==='ocr'&&output.pages===0){const result={id:item.id,status:'unchanged',message:'Sin texto nuevo. No se creó copia.',inputSize,pages:0,total:output.total,ocr:output.ocr};results.push(result);await onUpdate(result);continue;}
      if(profile.operation==='compress'){
        if(!compression||compression.before!==inputSize||compression.after!==output.bytes.byteLength||typeof compression.reduced!=='boolean'||compression.reduced!==(compression.after<inputSize)||compression.after>inputSize)throw new Error('El resultado de compresión no coincide con los tamaños del archivo.');
        if(!compression.reduced){const result={id:item.id,status:'unchanged',message:'Sin reducción. No se creó copia.',inputSize,pages:output.pages,total:output.total,compression};results.push(result);await onUpdate(result);continue;}
      }
      onUpdate({id:item.id,status:'running',message:'Guardando copia',fraction:.95});const saved=await write(item.id,output.bytes,profile.operation);
      const result={id:item.id,status:'done',message:profile.operation==='ocr'?'Copia OCR creada. Texto sin revisión humana; consulta el informe.':'Copia creada.',output:saved.name,outputSize:saved.size,inputSize,pages:output.pages,total:output.total,...(compression?{compression}:{}),...(output.ocr?{ocr:output.ocr}:{})};results.push(result);await onUpdate(result);
    }catch(error){const result={id:item.id,status:signal.aborted?'canceled':'error',message:signal.aborted?'Cancelado sin crear copia.':String(error.message||error)};results.push(result);await onUpdate(result);}
  }
  return results;
}
