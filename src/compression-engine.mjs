import {PDFDocument,PDFName,PDFDict,PDFRawStream,PDFNumber,PDFSignature,decodePDFRawStream} from 'pdf-lib';
import {collectUnreachable} from './pdf-garbage.mjs';
const N=PDFName.of,limit=256*1024*1024;
export const compressionProfiles={lossless:{quality:1,maxEdge:0},high:{quality:.9,maxEdge:0},balanced:{quality:.78,maxEdge:2400},small:{quality:.6,maxEdge:1600}};
export function compressionProfile(input){
  if(!input||!['lossless','high','balanced','small','custom'].includes(input.preset))throw new Error('Elige un perfil de compresión válido.');
  const p=input.preset==='custom'?{quality:input.quality,maxEdge:input.maxEdge}:compressionProfiles[input.preset];
  if(!Number.isFinite(p.quality)||p.quality<.5||p.quality>1||!Number.isInteger(p.maxEdge)||p.maxEdge!==0&&(p.maxEdge<800||p.maxEdge>4096))throw new Error('Usa calidad entre 50 y 100 y lado máximo entre 800 y 4096, o sin reducir.');
  return {...p,preset:input.preset};
}
function resourcesImages(doc,roots){
  const found=new Set(),seen=new Set();let count=0;
  // Traverse XObject dictionaries separately: their keys are arbitrary names.
  function resource(root){if(!(root instanceof PDFDict))return;const xo=root.lookup(N('XObject'));if(xo instanceof PDFDict)for(const [,ref]of xo.entries())xobject(ref);}
  function xobject(ref){const obj=doc.context.lookup(ref);if(!obj||seen.has(obj))return;seen.add(obj);if(++count>20000)throw new Error('Los recursos del PDF son demasiado complejos para comprimirlos.');if(obj instanceof PDFRawStream){if(obj.dict.get(N('Subtype'))===N('Image'))found.add(obj);else if(obj.dict.get(N('Subtype'))===N('Form'))resource(obj.dict.lookup(N('Resources')));}}
  for(const root of roots){if(root instanceof PDFDict&&root.has(N('XObject')))resource(root);else if(root instanceof PDFDict)for(const [,value]of root.entries()){const obj=doc.context.lookup(value);if(obj instanceof PDFRawStream)resource(obj.dict.lookup(N('Resources')));else if(obj instanceof PDFDict)for(const [,state]of obj.entries()){const stream=doc.context.lookup(state);if(stream instanceof PDFRawStream)resource(stream.dict.lookup(N('Resources')));}}}
  return found;
}
function imageInfo(stream,protectedImages){
  const d=stream.dict,width=d.lookup(N('Width')),height=d.lookup(N('Height')),bits=d.lookup(N('BitsPerComponent')),color=d.lookup(N('ColorSpace')),filter=d.lookup(N('Filter'));
  if(protectedImages.has(stream))return{reason:'Apariencia de anotación, formulario o máscara protegida'};
  const allowed=new Set(['Type','Subtype','Width','Height','BitsPerComponent','ColorSpace','Filter','Length','Interpolate','Name']);
  if(d.keys().some(k=>!allowed.has(k.decodeText())))return{reason:'Máscara, color o parámetros especiales'};
  if(!(width instanceof PDFNumber)||!(height instanceof PDFNumber)||!Number.isSafeInteger(width.asNumber())||!Number.isSafeInteger(height.asNumber())||width.asNumber()<1||height.asNumber()<1||width.asNumber()>10000||height.asNumber()>10000||width.asNumber()*height.asNumber()>16000000)return{reason:'Resolución fuera del límite de 16 millones de píxeles'};
  if(bits?.asNumber?.()!==8||![N('DeviceRGB'),N('DeviceGray')].includes(color)||filter&&![N('DCTDecode'),N('FlateDecode')].includes(filter))return{reason:'Codificación o espacio de color no compatible'};
  return{width:width.asNumber(),height:height.asNumber(),channels:color===N('DeviceGray')?1:3,jpeg:filter===N('DCTDecode')};
}
export async function compressPdf(bytes,input,transcode,onProgress=(_value)=>{}){
  const profile=compressionProfile(input);if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>limit)throw new Error('El PDF debe tener contenido y no superar 256 MB.');
  let doc;try{doc=await PDFDocument.load(bytes.slice(),{updateMetadata:false});}catch(e){throw new Error(/encrypt/i.test(String(e))?'Los PDF cifrados están disponibles solo para lectura.':'No se pudo leer el PDF para comprimirlo.');}
  if(!doc.getPageCount())throw new Error('El PDF no contiene páginas.');
  if(doc.catalog.has(N('Perms'))||doc.catalog.has(N('AcroForm'))&&doc.getForm().getFields().some(f=>f instanceof PDFSignature))throw new Error('La compresión requiere una copia sin campos de firma digital.');
  const pageRoots=doc.getPages().map(p=>p.node.Resources()),apRoots=[];
  for(const page of doc.getPages())for(const ref of page.node.Annots()?.asArray()||[]){const a=doc.context.lookup(ref);if(a instanceof PDFDict){const ap=a.lookup(N('AP'));if(ap instanceof PDFDict)apRoots.push(ap);}}
  const candidates=resourcesImages(doc,pageRoots),protectedImages=resourcesImages(doc,apRoots);
  const resourceSets=[...pageRoots,...doc.context.enumerateIndirectObjects().map(([,o])=>o instanceof PDFRawStream?o.dict.lookup(N('Resources')):undefined)];
  if(resourceSets.some(r=>{const cs=r instanceof PDFDict?r.lookup(N('ColorSpace')):undefined;return cs instanceof PDFDict&&(cs.has(N('DefaultRGB'))||cs.has(N('DefaultGray')));}))for(const image of candidates)protectedImages.add(image);
  for(const [,object]of doc.context.enumerateIndirectObjects())if(object instanceof PDFRawStream)for(const key of['SMask','Mask']){const mask=object.dict.lookup(N(key));if(mask instanceof PDFRawStream)protectedImages.add(mask);}
  const entries=doc.context.enumerateIndirectObjects().filter(([,s])=>s instanceof PDFRawStream&&s.dict.get(N('Subtype'))===N('Image'));
  const items=[];let changed=0,pixels=0,processed=0;
  for(let index=0;index<entries.length;index++){
    const [ref,stream]=entries[index],info=imageInfo(stream,protectedImages),item={image:ref.objectNumber,status:'kept',reason:'',before:stream.contents.length,after:stream.contents.length};items.push(item);
    onProgress({fraction:.1+.7*(index+1)/Math.max(1,entries.length),message:`Revisando imagen ${index+1} de ${entries.length}`});
    if(profile.preset==='lossless'){item.reason='Perfil sin pérdida: imagen intacta';continue;}
    if(!candidates.has(stream)||info.reason){item.reason=info.reason||'Recurso ajeno al contenido de página';continue;}
    if(processed>=100||pixels+info.width*info.height>120000000){item.reason='Límite de trabajo alcanzado';continue;}processed++;pixels+=info.width*info.height;
    try{
      const factor=profile.maxEdge?Math.min(1,profile.maxEdge/Math.max(info.width,info.height)):1,width=Math.max(1,Math.round(info.width*factor)),height=Math.max(1,Math.round(info.height*factor));
      let raw=stream.contents.slice();if(!info.jpeg){const expected=info.width*info.height*info.channels;raw=decodePDFRawStream(stream).getBytes(expected+1);if(raw.length!==expected)throw new Error('Longitud de píxeles incompatible');}
      const data=await transcode({...info,data:raw,targetWidth:width,targetHeight:height,quality:profile.quality});
      if(!(data instanceof Uint8Array)||data.length<4||data[0]!==255||data[1]!==216||data[data.length-2]!==255||data[data.length-1]!==217)throw new Error('No se pudo generar un JPEG válido');
      if(data.length+128>=stream.contents.length){item.reason='La conversión no reduce el tamaño';continue;}
      const dict=stream.dict.clone(doc.context);dict.set(N('Width'),PDFNumber.of(width));dict.set(N('Height'),PDFNumber.of(height));dict.set(N('ColorSpace'),N('DeviceRGB'));dict.set(N('Filter'),N('DCTDecode'));dict.set(N('Length'),PDFNumber.of(data.length));doc.context.assign(ref,PDFRawStream.of(dict,data));
      item.status='compressed';item.reason='JPEG recomprimido'+(factor<1?' y resolución reducida':'');item.after=data.length;changed++;
    }catch{item.reason='No se pudo convertir con garantías; se conserva';}
  }
  onProgress({fraction:.9,message:'Midiendo la copia final'});await doc.flush();collectUnreachable(doc);const result=await doc.save({useObjectStreams:true,updateFieldAppearances:false});
  const reduced=result.length<bytes.length,output=reduced?result:bytes.slice();if(!reduced)for(const item of items)if(item.status==='compressed'){item.status='kept';item.reason='La copia completa no reduce el tamaño; se conserva el original';item.after=item.before;}return{bytes:output,before:bytes.length,after:output.length,reduced,changed:reduced?changed:0,attempted:changed,pages:doc.getPageCount(),items,profile};
}
