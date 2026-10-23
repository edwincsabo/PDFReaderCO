import{rectifyOcrPixels}from'./ocr-perspective.mjs';
import {cleanOcrPixels}from'./ocr-image.mjs';
import {rotationGeometry}from'./ocr-review.mjs';
const scope=self as unknown as{onmessage:(event:MessageEvent)=>void;postMessage:(message:unknown,transfer?:Transferable[])=>void};
let source:OffscreenCanvas|null=null,perspective:number[]|undefined;
scope.onmessage=async({data})=>{try{
  if(data.type==='prepare'){if(source)source.width=1;perspective=data.options.perspective;const input=new Uint8ClampedArray(data.rgba),rgba=cleanOcrPixels(perspective?rectifyOcrPixels(input,data.width,data.height,perspective):input,data.width,data.height,data.options);source=new OffscreenCanvas(data.width,data.height);source.getContext('2d')!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>,data.width,data.height),0,0);}
  if(!source)throw new Error('La imagen de análisis no está preparada.');const g=rotationGeometry(source.width,source.height,data.degrees);
  const output=new OffscreenCanvas(g.processedWidth,g.processedHeight),ctx=output.getContext('2d')!;ctx.fillStyle='#ffffff';ctx.fillRect(0,0,output.width,output.height);ctx.translate(output.width/2,output.height/2);ctx.rotate(g.degrees*Math.PI/180);ctx.drawImage(source,-source.width/2,-source.height/2);
  const image=new Uint8Array(await(await output.convertToBlob({type:'image/png'})).arrayBuffer()),factor=Math.min(1,1200/Math.max(output.width,output.height)),preview=new OffscreenCanvas(Math.max(1,Math.round(output.width*factor)),Math.max(1,Math.round(output.height*factor)));preview.getContext('2d')!.drawImage(output,0,0,preview.width,preview.height);const thumbnail=new Uint8Array(await(await preview.convertToBlob({type:'image/jpeg',quality:.7})).arrayBuffer());
  scope.postMessage({image,thumbnail,geometry:{...g,...(perspective?{perspective}:{})}},[image.buffer,thumbnail.buffer]);output.width=preview.width=1;
}catch(e){scope.postMessage({error:e instanceof Error?e.message:String(e)});}};
