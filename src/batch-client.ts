import{recognizePdf}from'./ocr-client';
import{applyOcr}from'./ocr-engine.mjs';
import{validateBatchProfile}from'./batch-engine.mjs';
import{ocrEntryId}from'./ocr-jobs.mjs';
import workerUrl from'./batch.worker.ts?worker&url';
export type BatchCompression={before:number;after:number;reduced:boolean;changed:number;images:number;kept:number;profile:unknown;reasons:{reason:string;count:number}[]};
export async function processBatchFile(bytes:Uint8Array,profile:unknown,signal:AbortSignal,onProgress:(progress:{message:string;fraction:number})=>void):Promise<{bytes:Uint8Array;pages:number;total:number;compression?:BatchCompression;ocr?:unknown}>{
  if((profile as any)?.operation==='ocr'){
    const settings=validateBatchProfile(profile),report=await recognizePdf(bytes,settings.ocr,signal,onProgress),selected=report.pages.filter(p=>p.status==='recognized').map(ocrEntryId),details={reviewed:false,language:settings.ocr.language,dpi:settings.ocr.dpi,pages:report.pages.map(p=>({page:p.page,status:p.status,confidence:p.confidence,characters:p.text.length,words:p.words?.length||0,message:p.message.slice(0,200)}))};
    if(signal.aborted)throw new DOMException('Operación cancelada.','AbortError');
    const result=selected.length?await applyOcr(bytes,report,selected):{bytes};if(signal.aborted)throw new DOMException('Operación cancelada.','AbortError');
    return{bytes:result.bytes,pages:selected.length,total:report.pages.length,ocr:details};
  }
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('Operación cancelada.','AbortError'));return;}
    const worker=new Worker(workerUrl,{type:'module'}),timer=(profile as {operation?:string})?.operation==='compress'?setTimeout(()=>{stop();reject(new Error('El archivo tardó más de dos minutos. Puedes reintentarlo con otro perfil.'));},120000):undefined,stop=()=>{clearTimeout(timer);worker.terminate();signal.removeEventListener('abort',cancel);},cancel=()=>{stop();reject(new DOMException('Operación cancelada.','AbortError'));};
    signal.addEventListener('abort',cancel,{once:true});worker.onmessage=event=>{if(signal.aborted)return;if(event.data.progress)onProgress(event.data.progress);else{stop();event.data.error?reject(new Error(event.data.error)):resolve(event.data.result);}};worker.onerror=()=>{stop();reject(new Error('No se pudo procesar el archivo en el motor del lote.'));};
    try{worker.postMessage({bytes,profile},[bytes.buffer]);}catch(error){stop();reject(error);}
  });
}
