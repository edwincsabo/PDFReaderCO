import{perspectiveQuad}from'./ocr-perspective.mjs';
import{ocrLanguage}from'./ocr-languages.mjs';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream,PDFNumber,PDFSignature,PDFHexString,decodePDFRawStream}from'pdf-lib';

import {pageGeometry,viewToPdf}from'./pdf-coordinates.mjs';

import {collectUnreachable}from'./pdf-garbage.mjs';

import {reviewedText,reviewError,rotationGeometry,reviewPoint}from'./ocr-review.mjs';

import {ocrRegion,regionsIntersect,regionPoint}from'./ocr-region.mjs';

import{ocrEntryId,ocrRegions}from'./ocr-jobs.mjs';

const pdfn=n=>PDFNumber.of(Math.abs(n)<1e-10?0:Number(n.toFixed(10))).toString();
const N=PDFName.of,key=N('PDFReaderCOOCR');

export async function ocrSourceId(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}

export async function inspectOcrSource(bytes){

  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>256*1024*1024)throw new Error('El PDF debe tener contenido y no superar 256 MB.');

  let doc;try{doc=await PDFDocument.load(bytes.slice(),{updateMetadata:false});}catch(e){throw new Error(/encrypt/i.test(String(e))?'El OCR requiere una copia sin cifrado.':'No se pudo leer el PDF para reconocer texto.');}

  const acro=doc.catalog.lookup(N('AcroForm'));if(acro instanceof PDFDict&&acro.has(N('XFA')))throw new Error('El OCR no modifica formularios XFA. Usa una copia PDF estática compatible.');

  if(doc.catalog.has(N('Perms'))||doc.catalog.has(N('AcroForm'))&&doc.getForm().getFields().some(field=>field instanceof PDFSignature))throw new Error('El OCR requiere una copia sin campos de firma digital.');

  const pages=doc.getPages().map((p,i)=>{const geometry=pageGeometry(p);let ocrRegions=null;if(p.node.has(key))try{const marker=JSON.parse(p.node.get(key).decodeText());if(marker.version===2&&marker.scope==='regions'&&JSON.stringify(marker.geometry)===JSON.stringify(geometry)&&Array.isArray(marker.regions)&&marker.regions.length>0&&marker.regions.length<=50){ocrRegions=marker.regions.map(r=>({...r,...ocrRegion({...r,page:i+1})}));}}catch{}return{page:i+1,...geometry,hasOcr:p.node.has(key),ocrRegions};});if(!pages.length)throw new Error('El PDF no tiene páginas.');if(pages.some(p=>!Number.isFinite(p.width)||!Number.isFinite(p.height)))throw new Error('La geometría del PDF no permite reconocer texto.');return{doc,pages,source:await ocrSourceId(bytes)};

}

export function ocrOptions(value){if(!value||!ocrLanguage(value.language)||![150,200,300].includes(value.dpi)||typeof value.range!=='string'||value.range.length>1000)throw new Error('Elige español, inglés o ambos y una resolución de 150, 200 o 300 ppp.');const layout=value.layout||'auto';if(!['auto','column','block','sparse'].includes(layout))throw new Error('Elige un diseño OCR compatible.');const preparation={contrast:false,denoise:false,deskew:'none',angle:0,orientation:'none',lighting:false,...value.preparation};if(!['none','auto',0,90,180,270].includes(preparation.orientation)||typeof preparation.lighting!=='boolean')throw new Error('Preparación de orientación o iluminación inválida.');if(typeof preparation.contrast!=='boolean'||typeof preparation.denoise!=='boolean'||!['none','auto','manual'].includes(preparation.deskew)||!Number.isFinite(preparation.angle)||Math.abs(preparation.angle)>5)throw new Error('Elige una preparación OCR válida y un ángulo entre -5 y 5 grados.');if(preparation.perspective)preparation.perspective=perspectiveQuad(preparation.perspective);if(preparation.perspective&&(value.regions?.length||!value.region&&!/^[1-9]\d*$/.test(value.range.trim())))throw new Error('La perspectiva se ajusta para una sola página o zona por trabajo.');ocrRegions(value);return{...(value.regions?{regions:value.regions.map(ocrRegion)}:{}),language:value.language,dpi:value.dpi,range:value.range,layout,preparation,...(value.region?{region:ocrRegion(value.region)}:{})};}

function body(doc,page){const raw=page.node.Contents();return raw instanceof PDFArray?raw.asArray().map(ref=>doc.context.lookup(ref)):raw?[raw]:[];}

async function overlay(bytes){

  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>4*1024*1024)throw new Error('La capa OCR no es válida o supera 4 MB.');

  const doc=await PDFDocument.load(bytes.slice(),{updateMetadata:false});if(doc.getPageCount()!==1)throw new Error('Cada capa OCR debe contener una sola página.');

  const p=doc.getPage(0);if(p.node.Annots()?.size())throw new Error('La capa OCR no puede incluir anotaciones.');

  if(doc.context.enumerateIndirectObjects().some(([,o])=>o instanceof PDFRawStream&&o.dict.get(N('Subtype'))===N('Image')))throw new Error('La capa OCR debe contener únicamente texto invisible.');

  const content=body(doc,p).map(s=>{if(!(s instanceof PDFRawStream))throw new Error('Contenido OCR no compatible.');return new TextDecoder().decode(decodePDFRawStream(s).decode());}).join('\n');

  const modes=[...content.matchAll(/\b([0-7])\s+Tr\b/g)].map(m=>Number(m[1]));if(!modes.length||modes.some(m=>m!==3)||/\/\S+\s+Do\b/.test(content))throw new Error('La capa OCR no es texto invisible compatible.');

  return{doc,width:p.getWidth(),height:p.getHeight()};

}

async function reviewedLayer(item){

  const layer=await overlay(item.pdf),corrected=(item.words||[]).filter(w=>w.correction!==undefined&&w.correction!==w.text);

  if(!corrected.length&&!item.geometry?.perspective)return layer;

  const error=reviewError(item);if(error)throw new Error(error);

  const{doc,width,height}=layer,p=doc.getPage(0),fonts=p.node.Resources()?.lookup(N('Font'),PDFDict);

  const font=fonts?.entries().find(([,ref])=>{const f=doc.context.lookup(ref);if(!(f instanceof PDFDict)||f.get(N('Subtype'))!==N('Type0')||f.get(N('BaseFont'))!==N('GlyphLessFont')||f.get(N('Encoding'))!==N('Identity-H'))return false;const d=f.lookup(N('DescendantFonts'),PDFArray)?.lookup(0,PDFDict),descriptor=d?.lookup(N('FontDescriptor'),PDFDict),unicode=f.lookup(N('ToUnicode'));if(!(unicode instanceof PDFRawStream))return false;const cmap=new TextDecoder().decode(decodePDFRawStream(unicode).decode());return d?.lookup(N('DW'),PDFNumber)?.asNumber()===500&&!d.has(N('W'))&&descriptor?.has(N('FontFile2'))&&descriptor.lookup(N('Ascent'),PDFNumber)?.asNumber()===1000&&/\b1\s+beginbfrange\s*<0000>\s*<FFFF>\s*<0000>\s*endbfrange/si.test(cmap)&&!cmap.includes('beginbfchar')&&(cmap.match(/beginbfrange/g)||[]).length===1;});

  if(!font)throw new Error('La fuente invisible de esta capa no permite reconstruir correcciones. Restaura las palabras para aplicar el resultado original.');

  const commands=['q','BT','3 Tr',`${font[0]} 1 Tf`];

  for(let i=0;i<item.words.length;i++){

    const word=item.words[i],value=word.correction??word.text;if(!value)continue;if(correctionUnsafe(value))throw new Error('La palabra contiene caracteres que no se pueden guardar en esta capa.');

    const next=item.words[i+1],gap=next&&next.line===word.line?' ':'';const text=value+gap,[x0,y0,x1,y1]=word.box,w=(x1-x0)*width;

    const base=word.baseline,slope=base&&Math.abs(base[2]-base[0])>1e-8?(base[3]-base[1])/(base[2]-base[0]):0,baseline=base?base[1]+slope*(x0-base[0]):y1,h=Math.max((y1-y0)*height*.2,(baseline-y0)*height);

    // GlyphLessFont has DW=500 and ascent=1000. Fit invisible text into its own

    // detected word box; the source image and adjacent boxes stay unchanged.

    let a=w/(value.length*.5),b=-slope*(x1-x0)*height/(value.length*.5),hex=Array.from(text).map(c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');if(item.geometry?.perspective){const g=item.geometry,[leftX,leftY]=reviewPoint(x0,baseline,g),[rightX,rightY]=reviewPoint(x1,baseline+slope*(x1-x0),g),[topX,topY]=reviewPoint(x0,y0,g),advance=value.length*.5;a=(rightX-leftX)*g.width/advance;b=-(rightY-leftY)*g.height/advance;commands.push(`${pdfn(a)} ${pdfn(b)} ${pdfn((topX-leftX)*g.width)} ${pdfn((leftY-topY)*g.height)} ${pdfn(leftX*g.width)} ${pdfn((1-leftY)*g.height)} Tm`,`<${hex}> Tj`);}else commands.push(`${pdfn(a)} ${pdfn(b)} 0 ${pdfn(h)} ${pdfn(x0*width)} ${pdfn((1-baseline)*height)} Tm`,`<${hex}> Tj`);

  }

  commands.push('ET','Q');if(item.geometry?.perspective){p.setSize(item.geometry.width,item.geometry.height);layer.width=item.geometry.width;layer.height=item.geometry.height;}p.node.set(N('Contents'),doc.context.register(doc.context.flateStream(commands.join('\n'))));return layer;

}

const correctionUnsafe=value=>/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(value)||Array.from(value).some(c=>c.codePointAt(0)>65535);

export async function applyOcr(bytes,report,selected){

  const source=await inspectOcrSource(bytes);if(report?.source!==source.source)throw new Error('El documento cambió. Vuelve a reconocer sus páginas.');

  if(!Array.isArray(selected)||!selected.length||selected.length>50||new Set(selected).size!==selected.length)throw new Error('Selecciona entre 1 y 50 páginas reconocidas diferentes.');

  const {doc}=source;let characters=0;

  for(const number of selected){

    const item=report.pages?.find(p=>ocrEntryId(p)===number),info=source.pages[(item?.page||0)-1];

    if(!Number.isInteger(number)||!info||!item||item.status!=='recognized'||typeof item.text!=='string'||!item.text.trim()||item.text.length>100000||!ocrLanguage(item.language)||!Number.isFinite(item.confidence)||item.confidence<0||item.confidence>100)throw new Error('Selecciona páginas con un resultado OCR válido.');

    const text=reviewedText(item);if(!text.trim()||text.length>100000)throw new Error('La página corregida debe conservar texto y no superar cien mil caracteres.');

    const region=item.region?ocrRegion(item.region):null;if(region&&region.page!==item.page)throw new Error('La zona OCR pertenece a otra página.');if(info.hasOcr&&(!region||!info.ocrRegions))throw new Error('Esta página ya tiene una capa OCR de PDFReaderCO completa o incompatible.');if(region&&info.ocrRegions?.some(r=>regionsIntersect(region,r)))throw new Error('La zona se superpone a una zona OCR ya aplicada.');if(region&&info.ocrRegions?.length>=50)throw new Error('La página ya tiene cincuenta zonas OCR.');characters+=text.length;if(characters>1000000)throw new Error('El texto OCR seleccionado supera el límite de un millón de caracteres.');

    const regionRatio=(info.width*(region?.w||1))/(info.height*(region?.h||1)),geometry=item.geometry?rotationGeometry(item.geometry.width,item.geometry.height,item.geometry.degrees):null;if(geometry&&(geometry.processedWidth!==item.geometry.processedWidth||geometry.processedHeight!==item.geometry.processedHeight||Math.abs(geometry.width/geometry.height-regionRatio)>Math.max(.01,(1+regionRatio)/geometry.height)))throw new Error('La geometría de análisis no coincide con la página.');

    if(item.geometry?.perspective){perspectiveQuad(item.geometry.perspective);if(!item.reviewable)throw new Error('La perspectiva necesita todas las palabras posicionadas para aplicar la capa.');}const ratio=geometry?(item.geometry?.perspective?geometry.width/geometry.height:geometry.processedWidth/geometry.processedHeight):(info.width*(region?.w||1))/(info.height*(region?.h||1)),layer=await reviewedLayer(item);if(!(layer.width>0&&layer.height>0)||Math.abs(layer.width/layer.height-ratio)>Math.max(.01,ratio*.01))throw new Error('La proporción de la capa OCR no coincide con la página.');

    const page=doc.getPage(item.page-1),original=page.node.Contents(),contents=original instanceof PDFArray?original.asArray():original?[page.node.get(N('Contents'))]:[];

    const [embedded]=await doc.embedPdf(layer.doc,[0]);const resources=page.node.Resources()?.clone(doc.context)||doc.context.obj({}),objects=resources.lookup(N('XObject'));if(objects instanceof PDFDict)resources.set(N('XObject'),objects.clone(doc.context));page.node.set(N('Resources'),resources);const name=page.node.newXObject('PDFReaderCOOCR',embedded.ref);

    const point=(x,y)=>{const p=geometry&&!item.geometry?.perspective?reviewPoint(x,y,geometry):[x,y];return viewToPdf(...regionPoint(...p,region),info.crop.width,info.crop.height,info.rotation,info.crop);};

    const a=point(0,1),b=point(1,1),c=point(0,0);

    const matrix=[(b[0]-a[0])/layer.width,(b[1]-a[1])/layer.width,(c[0]-a[0])/layer.height,(c[1]-a[1])/layer.height,a[0],a[1]];

    // Isolate the original painting state; its streams and images remain intact.

    const opening=doc.context.register(doc.context.flateStream('q\n')),closing=doc.context.register(doc.context.flateStream('\nQ\n'));

    const stamp=doc.context.register(doc.context.flateStream(`q\n${matrix.map(pdfn).join(' ')} cm\n${name.toString()} Do\nQ\n`));

    page.node.set(N('Contents'),doc.context.obj([... (contents.length?[opening,...contents,closing]:[]),stamp]));

    const metadata={engine:'Tesseract.js 7.0.0',language:item.language,confidence:item.confidence,characters:text.length,correctedWords:(item.words||[]).filter(w=>w.correction!==undefined&&w.correction!==w.text).length,deskewDegrees:geometry?.degrees||0,layout:item.layout||'auto',...(item.engineLayout?{engineLayout:item.engineLayout}:{})};if(region){info.ocrRegions=[...(info.ocrRegions||[]),{...region,...metadata}];info.hasOcr=true;}else info.hasOcr=true;page.node.set(key,PDFHexString.fromText(JSON.stringify(region?{version:2,scope:'regions',geometry:pageGeometry(page),regions:info.ocrRegions}:{version:1,...metadata})));

  }

  await doc.flush();collectUnreachable(doc);const result=await doc.save({updateFieldAppearances:false});if(result.length>256*1024*1024)throw new Error('El resultado OCR supera los 256 MB.');return{bytes:result,pages:selected.length,characters};

}

