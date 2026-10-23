import workerUrl from './compression.worker.ts?worker&url';
export type CompressionProfile={preset:'lossless'|'high'|'balanced'|'small'|'custom';quality?:number;maxEdge?:number};
export type CompressionResult={bytes:Uint8Array;before:number;after:number;reduced:boolean;changed:number;attempted:number;pages:number;items:{image:number;status:string;reason:string;before:number;after:number}[]};
export function compressDocument(bytes:Uint8Array,profile:CompressionProfile,signal:AbortSignal,onProgress:(value:{message:string;fraction:number})=>void):Promise<CompressionResult>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('Compresión cancelada.','AbortError'));return;}
    const worker=new Worker(workerUrl,{type:'module'});const timer=setTimeout(()=>{stop();reject(new Error('La compresión tardó demasiado. Prueba un documento más pequeño.'));},120000);
    const stop=()=>{clearTimeout(timer);worker.terminate();signal.removeEventListener('abort',cancel);},cancel=()=>{stop();reject(new DOMException('Compresión cancelada.','AbortError'));};signal.addEventListener('abort',cancel,{once:true});
    worker.onmessage=({data})=>{if(data.progress)onProgress(data.progress);else{stop();data.error?reject(new Error(data.error)):resolve(data.result);}};worker.onerror=()=>{stop();reject(new Error('No se pudo ejecutar el motor de compresión.'));};try{worker.postMessage({bytes,profile});}catch(e){stop();reject(e);}
  });
}
