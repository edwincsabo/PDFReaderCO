import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { createOriginalTextEngine } from './original-text-engine.mjs';

function readWasm():Promise<Uint8Array>{return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('GET',wasmUrl);xhr.responseType='arraybuffer';xhr.onload=()=>xhr.response&&(xhr.status===0||xhr.status===200)?resolve(new Uint8Array(xhr.response)):reject(new Error('No se encontró el motor PDFium local.'));xhr.onerror=()=>reject(new Error('No se pudo leer el motor PDFium local.'));xhr.send();});}
let engine:ReturnType<typeof createOriginalTextEngine>|undefined,queue=Promise.resolve();
const active=new Set<number>(),canceled=new Set<number>();
self.onmessage=({data})=>{
  if(data.type==='cancel'){if(active.has(data.id))canceled.add(data.id);return;}
  active.add(data.id);queue=queue.then(async()=>{
    const context={check:()=>{if(canceled.has(data.id))throw new DOMException('Operación cancelada.','AbortError');},progress:(progress:any)=>self.postMessage({id:data.id,progress})};
    try{
      context.check();engine??=readWasm().then(createOriginalTextEngine);const api=await engine;context.check();
      const result=data.type==='multi-replace-review'?await api.reviewMultiReplacement(data.bytes,data.payload):data.type==='multi-replace-apply'?await api.applyMultiReplacement(data.bytes,data.payload):data.type==='multi-replace-clear'?api.clearMultiReplacement():data.type==='multi-review'?await api.reviewMultiFormat(data.bytes,data.payload):data.type==='multi-apply'?await api.applyMultiFormat(data.bytes,data.payload):data.type==='multi-clear'?api.clearMultiFormat():data.type==='blocks'?await api.blocks(data.bytes,data.payload):data.type==='blocks-plan'?await api.blockPlan(data.bytes,data.payload):data.type==='inspect'?await api.inspect(data.bytes,data.payload):data.type==='measure'?await api.measure(data.bytes,data.payload):data.type==='preview'?await api.preview(data.bytes,data.payload):data.type==='fit'?await api.autoFit(data.bytes,data.payload):data.type==='move'?await api.move(data.bytes,data.payload):data.type==='move-preview'?await api.previewMove(data.bytes,data.payload):data.type==='replacement-search'?await api.searchReplacements(data.bytes,data.payload,context):data.type==='replacement-review'?await api.reviewReplacements(data.bytes,data.payload,context):data.type==='replacement-apply'?await api.applyReplacements(data.bytes,data.payload,context):await api.edit(data.bytes,data.payload);
      context.check();self.postMessage({id:data.id,result},{transfer:(['preview','move-preview'].includes(data.type)||['multi-review','multi-replace-review'].includes(data.type)&&result.image)?[result.image.data.buffer]:data.type==='replacement-apply'?[result.bytes.buffer]:['multi-apply','multi-replace-apply'].includes(data.type)?[result.buffer]:[]});
    }catch(error){self.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});}
    finally{active.delete(data.id);canceled.delete(data.id);}
  });
};

