import {PDFDocument,PDFName,PDFDict,PDFArray,PDFSignature,StandardFonts,rgb,degrees,pushGraphicsState,popGraphicsState,concatTransformationMatrix}from'pdf-lib';
import {parsePageRange}from'./page-range.mjs';
import {pageGeometry,viewToPdf}from'./pdf-coordinates.mjs';
import {collectUnreachable}from'./pdf-garbage.mjs';
import {compressPdf,compressionProfile}from'./compression-engine.mjs';
import{ocrOptions}from'./ocr-engine.mjs';
const N=PDFName.of;
export function validateBatchProfile(profile){
  if(!profile||!['numbers','watermark','extract','compress','ocr'].includes(profile.operation)||typeof profile.range!=='string'||profile.range.length>1000)throw new Error('Operación o rango del lote inválidos.');
  if(profile.operation==='ocr')return{operation:'ocr',range:profile.range,ocr:ocrOptions({...profile.ocr,range:profile.range,region:undefined,regions:undefined})};
  if(profile.operation==='compress'){if(profile.range.trim())throw new Error('La compresión del lote se aplica al documento completo. Deja vacío el rango de páginas.');return{operation:'compress',range:'',compression:compressionProfile(profile.compression)};}
  if(profile.range.trim()&&!/^\s*\d+\s*(?:-\s*\d+\s*)?(?:,\s*\d+\s*(?:-\s*\d+\s*)?)*$/.test(profile.range))throw new Error('Usa un rango como 1, 3-5, 8, o déjalo vacío para todas las páginas.');
  if(profile.operation==='numbers'&&(!Number.isSafeInteger(profile.start)||profile.start<1||profile.start>99999999||typeof profile.prefix!=='string'||profile.prefix.length>40||/[\r\n\u0000-\u001f]/.test(profile.prefix)||!['bottom-center','bottom-right','top-center','top-right'].includes(profile.position)))throw new Error('Revisa el inicio, prefijo y posición de la numeración.');
  if(profile.operation!=='extract'&&(!Number.isFinite(profile.size)||profile.size<(profile.operation==='numbers'?6:8)||profile.size>(profile.operation==='numbers'?36:120)))throw new Error('Tamaño de texto fuera de los límites.');
  if(profile.operation==='watermark'&&(typeof profile.text!=='string'||!profile.text.trim()||profile.text.length>100||/[\r\n\u0000-\u001f]/.test(profile.text)||!Number.isFinite(profile.opacity)||profile.opacity<.05||profile.opacity>1||!Number.isFinite(profile.angle)||profile.angle< -90||profile.angle>90))throw new Error('Revisa el texto, opacidad y ángulo de la marca de agua.');
  return {...profile};
}
/** @param {any} [transcode] */
export async function processBatchPdf(bytes,input,onProgress=(_value)=>{},transcode=undefined){
  const profile=validateBatchProfile(input);if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>256*1024*1024)throw new Error('Archivo vacío o mayor de 256 MB.');
  if(profile.operation==='compress'){
    if(profile.compression.preset!=='lossless'&&typeof transcode!=='function')throw new Error('La compresión de imágenes requiere el conversor local.');
    const result=await compressPdf(bytes,profile.compression,transcode,onProgress);
    const reasons=Object.create(null);for(const item of result.items)if(item.status!=='compressed')reasons[item.reason]=(reasons[item.reason]||0)+1;
    return{bytes:result.bytes,pages:result.pages,total:result.pages,compression:{before:result.before,after:result.after,reduced:result.reduced,changed:result.changed,images:result.items.length,kept:result.items.length-result.changed,profile:result.profile,reasons:Object.entries(reasons).map(([reason,count])=>({reason,count}))}};
  }
  let doc;try{doc=await PDFDocument.load(bytes.slice(),{updateMetadata:false});}catch(e){throw new Error(/encrypt/i.test(String(e))?'PDF cifrado: procésalo individualmente en modo lectura.':'No se pudo leer este PDF.');}
  const count=doc.getPageCount();if(!count)throw new Error('El PDF no contiene páginas.');
  if(doc.catalog.has(N('Perms'))||doc.catalog.has(N('AcroForm'))&&doc.getForm().getFields().some(field=>field instanceof PDFSignature))throw new Error('PDF con campos de firma: revísalo individualmente antes de crear una copia modificada.');
  const indices=parsePageRange(profile.range,count);if(!indices.length)throw new Error('No hay páginas seleccionadas.');
  onProgress({message:'Revisando páginas',fraction:.15});
  if(profile.operation==='extract'){
    if(doc.catalog.has(N('AcroForm'))&&doc.getForm().getFields().length||doc.getPages().some(page=>page.node.Annots()?.asArray().some(ref=>doc.context.lookup(ref)?.get?.(N('Subtype'))?.toString()==='/Widget')))throw new Error('La extracción por lotes requiere formularios aplanados para conservar sus respuestas.');
    const extracted=await PDFDocument.create();for(const page of await extracted.copyPages(doc,indices))extracted.addPage(page);const result=await extracted.save({updateFieldAppearances:false});if(result.length>256*1024*1024)throw new Error('La copia supera los 256 MB.');return {bytes:result,pages:indices.length,total:count};
  }
  const font=await doc.embedFont(StandardFonts.Helvetica);
  for(let j=0;j<indices.length;j++){
    const page=doc.getPage(indices[j]),g=pageGeometry(page),a=viewToPdf(0,1,g.crop.width,g.crop.height,g.rotation,g.crop),b=viewToPdf(1,1,g.crop.width,g.crop.height,g.rotation,g.crop),c=viewToPdf(0,0,g.crop.width,g.crop.height,g.rotation,g.crop);
    const text=profile.operation==='numbers'?`${profile.prefix}${profile.start+j} / ${profile.start+indices.length-1}`:profile.text;
    try{font.encodeText(text);}catch{throw new Error('El texto contiene caracteres no admitidos por la fuente latina. Usa letras latinas y acentos españoles.');}
    const margin=20;let size=profile.size,x,y,angle=0;
    if(g.width<=2*margin+12||g.height<=2*margin+12)throw new Error('La página es demasiado pequeña para colocar el texto con margen.');
    if(profile.operation==='numbers'){
      const width=font.widthOfTextAtSize(text,size);if(width>g.width-2*margin)throw new Error('La numeración no cabe en una de las páginas. Reduce el prefijo o el tamaño.');
      x=profile.position.endsWith('right')?g.width-margin-width:(g.width-width)/2;y=profile.position.startsWith('top')?g.height-margin-size:margin;
    }else{
      angle=profile.angle;const r=angle*Math.PI/180,co=Math.cos(r),si=Math.sin(r),w=font.widthOfTextAtSize(text,size),h=size*1.25,wide=Math.abs(w*co)+Math.abs(h*si),high=Math.abs(w*si)+Math.abs(h*co),factor=Math.min(1,(g.width-2*margin)/wide,(g.height-2*margin)/high);size*=factor;if(size<4)throw new Error('La marca no cabe con un tamaño legible. Acorta el texto.');
      const width=font.widthOfTextAtSize(text,size),height=size*1.25;x=g.width/2-(width*co-height*si)/2-size*.25*si;y=g.height/2-(width*si+height*co)/2+size*.25*co;
    }
    page.pushOperators(pushGraphicsState(),concatTransformationMatrix((b[0]-a[0])/g.width,(b[1]-a[1])/g.width,(c[0]-a[0])/g.height,(c[1]-a[1])/g.height,a[0],a[1]));
    page.drawText(text,{x,y,size,font,rotate:degrees(angle),color:rgb(.25,.3,.38),opacity:profile.operation==='numbers'?1:profile.opacity});page.pushOperators(popGraphicsState());
    onProgress({message:`Procesando página ${j+1} de ${indices.length}`,fraction:.15+.65*(j+1)/indices.length});
  }
  doc.setProducer('PDFReaderCO · Procesamiento por lotes');doc.setModificationDate(new Date());await doc.flush();collectUnreachable(doc);const result=await doc.save({updateFieldAppearances:false});if(result.length>256*1024*1024)throw new Error('La copia supera los 256 MB.');return{bytes:result,pages:indices.length,total:count};
}
