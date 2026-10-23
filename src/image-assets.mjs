import { PDFName, PDFRawStream } from 'pdf-lib';

export const MAX_IMAGE_BYTES=8*1024*1024;
const cache=new WeakMap();
export function imageData(data){
  if(typeof data!=='string'||data.length>Math.ceil(MAX_IMAGE_BYTES/3)*4+40)throw new Error('La imagen supera 8 MB. Reduce su tamaño o conserva un proyecto PDFCO.');
  const match=data.match(/^data:image\/(png|jpeg);base64,([a-z0-9+/=]+)$/i);if(!match)throw new Error('Usa una imagen PNG o JPEG válida.');
  let binary;try{binary=atob(match[2]);}catch{throw new Error('Datos de imagen inválidos.');}
  const bytes=Uint8Array.from(binary,ch=>ch.charCodeAt(0)),view=new DataView(bytes.buffer);if(bytes.length>MAX_IMAGE_BYTES)throw new Error('La imagen supera 8 MB.');
  const mime=match[1].toLowerCase();let width=0,height=0;
  if(mime==='png'){
    if(bytes.length<33||[137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n)||view.getUint32(8)!==13||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')throw new Error('Cabecera PNG inválida.');
    width=view.getUint32(16);height=view.getUint32(20);
  }else{
    if(bytes.length<12||view.getUint16(0)!==0xffd8)throw new Error('Cabecera JPEG inválida.');
    let offset=2;
    while(offset+4<=bytes.length){const marker=view.getUint16(offset),length=view.getUint16(offset+2);if(length<2||offset+2+length>bytes.length)break;if(marker>=0xffc0&&marker<=0xffcf&&![0xffc4,0xffcc].includes(marker)){if(length<8)break;height=view.getUint16(offset+5);width=view.getUint16(offset+7);break;}offset+=2+length;}
  }
  if(!width||!height)throw new Error('No se pudieron leer las dimensiones de la imagen.');
  if(width>8192||height>8192||width*height>16000000)throw new Error('La imagen admite hasta 16 millones de píxeles y 8192 por lado. Reduce sus dimensiones.');
  return {bytes,mime,width,height};
}
function entry(doc,data){let images=cache.get(doc);if(!images){images=new Map();cache.set(doc,images);}if(!images.has(data))images.set(data,{...imageData(data)});return images.get(data);}
export function storeImageAsset(doc,data){const item=entry(doc,data);if(!item.asset)item.asset=doc.context.register(doc.context.stream(item.bytes,{Type:'PDFReaderCOImage',Mime:PDFName.of(item.mime==='png'?'PNG':'JPEG')}));return item.asset;}
export function embedMarkImage(doc,data){const item=entry(doc,data);if(!item.image)item.image=item.mime==='png'?doc.embedPng(item.bytes):doc.embedJpg(item.bytes);return item.image;}
export function readImageAsset(dict){
  const stream=dict.context.lookup(dict.get(PDFName.of('PDFReaderCOAsset')));
  if(!(stream instanceof PDFRawStream)||stream.dict.get(PDFName.of('Type'))?.toString()!=='/PDFReaderCOImage'||stream.dict.has(PDFName.of('Filter'))||stream.getContentsSize()>MAX_IMAGE_BYTES)throw new Error('Recurso de imagen no compatible.');
  const mime=stream.dict.get(PDFName.of('Mime'))?.toString();if(!['/PNG','/JPEG'].includes(mime))throw new Error('Formato de imagen no compatible.');
  const bytes=stream.getContents();let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const data='data:image/'+(mime==='/PNG'?'png':'jpeg')+';base64,'+btoa(binary);imageData(data);return data;
}
