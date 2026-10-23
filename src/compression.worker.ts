import {compressPdf} from './compression-engine.mjs';
import {transcodeImage} from './compression-codec';

const scope=self as unknown as {onmessage:(event:MessageEvent)=>void;postMessage:(message:unknown,transfer?:Transferable[])=>void};
scope.onmessage=async(event:MessageEvent)=>{try{const result=await compressPdf(event.data.bytes,event.data.profile,transcodeImage,(progress:any)=>scope.postMessage({progress}));scope.postMessage({result},[result.bytes.buffer as ArrayBuffer]);}catch(error){scope.postMessage({error:error instanceof Error?error.message:String(error)});}};
