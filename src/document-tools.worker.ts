import{removeExternalOcr}from'./ocr-external.mjs';
import wasmUrl from'@embedpdf/pdfium/pdfium.wasm?url';
import{inspectOriginalImages,changeOriginalImage,originalImageDocument}from'./original-images.mjs';
import{createDocumentAnalysis}from'./document-analysis.mjs';
const scope=self as unknown as{onmessage:(e:MessageEvent)=>void;postMessage:(v:any,transfer?:Transferable[])=>void};
scope.onmessage=async({data})=>{try{
  const{type,bytes,payload}=data;let result:any;
  if(type==='ocr-external-remove')result=await removeExternalOcr(bytes,payload);
  else if(type==='images')result=await inspectOriginalImages(bytes,payload.page);
  else if(type==='image-change')result=await changeOriginalImage(bytes,payload);
  else if(type==='image-document')result=await originalImageDocument(bytes,payload);
  else if(type==='table-page'){const wasm=await new Promise<Uint8Array>((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('GET',wasmUrl);xhr.responseType='arraybuffer';xhr.onload=()=>xhr.response&&(xhr.status===0||xhr.status===200)?resolve(new Uint8Array(xhr.response)):reject(new Error('No se encontró PDFium local.'));xhr.onerror=()=>reject(new Error('No se pudo leer PDFium.'));xhr.send();});result=await(await createDocumentAnalysis(wasm)).page(bytes,payload.page);}
  else throw new Error('Operación de contenido desconocida.');
  scope.postMessage({result},result instanceof Uint8Array?[result.buffer as ArrayBuffer]:result?.bytes?[result.bytes.buffer]:[]);
}catch(e){scope.postMessage({error:e instanceof Error?e.message:String(e)});}};
