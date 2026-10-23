import{compareWords,comparePixels}from'./comparison-engine.mjs';
const scope=self as unknown as{onmessage:(e:MessageEvent)=>void;postMessage:(v:any)=>void};
scope.onmessage=({data})=>{try{scope.postMessage({id:data.id,result:{text:data.before?compareWords(data.before,data.after,data.ignoreCase):null,visual:data.left?comparePixels(data.left,data.right,data.width,data.height,data.threshold):null}});}catch(e){scope.postMessage({id:data.id,error:e instanceof Error?e.message:String(e)});}};
