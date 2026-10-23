import { PDFDocument, PDFPage, PDFDict, PDFArray, PDFRef, PDFName, PDFNumber, PDFString, PDFHexString, pushGraphicsState, popGraphicsState, concatTransformationMatrix } from 'pdf-lib';
import { annotationBox, fontName } from './text-layout.mjs';
import { pageGeometry, viewToPdf, pdfToView } from './pdf-coordinates.mjs';
import { rotatePoint } from './annotation-geometry.mjs';
import { paintAnnotation } from './annotation-drawing.mjs';
import { annotationData, validateMark } from './mark-schema.mjs';
import { collectUnreachable } from './pdf-garbage.mjs';
import { storeImageAsset, readImageAsset } from './image-assets.mjs';

const key=PDFName.of('PDFReaderCO');
const nativeSubtypes=Object.freeze({text:'FreeText',highlight:'Highlight',underline:'Underline',strike:'StrikeOut',rect:'Square',ellipse:'Circle',pen:'Ink',note:'Text',image:'Stamp',signature:'Stamp'});
const nativeTools=new Set(Object.keys(nativeSubtypes));
const supportedSubtypes=new Set(Object.values(nativeSubtypes).map(name=>'/'+name));
const prepareCache=new WeakMap();
const baseFacts=new WeakMap();
const standardKeys=['Type','Subtype','Rect','Contents','NM','T','F','DA','Q','C','CA','Border','BS','Rotate','QuadPoints','AP'];
export const isNativeTool=mark=>nativeTools.has(mark.tool);
export const isVisualTool=mark=>mark.tool==='image'||mark.tool==='signature';
// Preserve the established stacking: images and visual signatures below other marks.
export const annotationPaintOrder=marks=>[...marks.filter(isVisualTool),...marks.filter(m=>!isVisualTool(m))];

async function digest(bytes){return Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');}
async function canonical(object,context,seen=new Set(),depth=0,maxStream=4*1024*1024){
  if(depth>32)throw new Error('Recursos de apariencia demasiado complejos.');
  if(object===undefined)return null;
  if(object instanceof PDFRef){if(seen.has(object))return 'cycle';const next=new Set(seen);next.add(object);return canonical(context.lookup(object),context,next,depth+1,maxStream);}
  if(object instanceof PDFString||object instanceof PDFHexString)return ['text',object.decodeText()];
  if(object instanceof PDFArray){const out=[];if(object.size()>100000)throw new Error('Recurso de anotación demasiado grande.');for(let i=0;i<object.size();i++)out.push(await canonical(object.get(i),context,seen,depth+1,maxStream));return out;}
  if(object instanceof PDFDict){const out={};for(const [name,value]of object.entries().sort(([a],[b])=>a.toString().localeCompare(b.toString()))){if(name.toString()==='/Length')continue;out[name.toString()]=await canonical(value,context,seen,depth+1,maxStream);}return out;}
  if(object?.dict instanceof PDFDict&&typeof object.getContents==='function'){const bytes=object.getContents();if(bytes.length>maxStream)throw new Error('Apariencia demasiado grande.');return {stream:await digest(bytes),dict:await canonical(object.dict,context,seen,depth+1,maxStream)};}
  return object?.toString()??null;
}
async function fingerprint(dict,context,mark,geometry){const data={},value=object=>canonical(object,context,new Set(),0,isVisualTool(mark)?16*1024*1024:4*1024*1024);for(const name of standardKeys)data[name]=await value(dict.get(PDFName.of(name)));if(mark.tool==='rect'||mark.tool==='ellipse')for(const name of ['IC','RD','BE'])data[name]=await value(dict.get(PDFName.of(name)));if(mark.tool==='pen')data.InkList=await value(dict.get(PDFName.of('InkList')));if(mark.tool==='note')for(const name of ['Name','Open','Subj','State','StateModel','RT'])data[name]=await value(dict.get(PDFName.of(name)));if(isVisualTool(mark))for(const name of ['Name','PDFReaderCOAsset'])data[name]=await value(dict.get(PDFName.of(name)));data.editing={mark,geometry};return digest(new TextEncoder().encode(JSON.stringify(data)));}

function sourceGeometry(geometry){
  if(!geometry||!geometry.crop||![geometry.rotation,geometry.unit,geometry.width,geometry.height,...Object.values(geometry.crop)].every(Number.isFinite)||![0,90,180,270].includes(geometry.rotation)||geometry.unit<=0||geometry.crop.width<=0||geometry.crop.height<=0)throw new Error('Geometría de anotación inválida.');
  const width=(geometry.rotation%180?geometry.crop.height:geometry.crop.width)*geometry.unit,height=(geometry.rotation%180?geometry.crop.width:geometry.crop.height)*geometry.unit;
  if(Math.abs(width-geometry.width)>1e-6||Math.abs(height-geometry.height)>1e-6)throw new Error('Geometría inconsistente.');return geometry;
}
function transformedMark(mark,previous,current,page){
  if(JSON.stringify(previous)===JSON.stringify(current))return {...mark,page};
  const b=annotationBox(mark,previous.width,previous.height),center=viewToPdf(b.x+b.w/2,b.y+b.h/2,previous.width,previous.height,previous.rotation,previous.crop),[cx,cy]=pdfToView(...center,current),ratio=current.unit/previous.unit,w=b.w*previous.width*ratio/current.width,h=b.h*previous.height*ratio/current.height;
  return validateMark({...mark,page,x:cx-w/2,y:cy-h/2,w,h,size:mark.size*ratio,rotation:((mark.rotation||0)+current.rotation-previous.rotation+360)%360,...(mark.tool==='pen'||mark.tool==='signature'&&!mark.image?{points:mark.points.map(([x,y])=>[cx+(x-b.x-b.w/2)*previous.width*ratio/current.width,cy+(y-b.y-b.h/2)*previous.height*ratio/current.height])}:{})});
}
function annotationCorners(mark,geometry){
  const b=annotationBox(mark,geometry.width,geometry.height),cx=b.x+b.w/2,cy=b.y+b.h/2;
  return [[b.x,b.y],[b.x+b.w,b.y],[b.x,b.y+b.h],[b.x+b.w,b.y+b.h]].map(([x,y])=>{const p=rotatePoint(x,y,cx,cy,mark.rotation||0,geometry.width,geometry.height);return viewToPdf(...p,geometry.width,geometry.height,geometry.rotation,geometry.crop);});
}
function rectangle(corners){const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];}
function rgbValues(hex){return [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);}
function dateString(){return 'D:'+new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14)+'Z';}

export async function appendNativeAnnotations(doc,marks,fonts,options={}){
  const pending=[];
  for(const source of marks){
    const mark=annotationData(source);if(!isNativeTool(mark))throw new Error('Tipo de anotación nativa no compatible.');
    if((mark.tool==='pen'||mark.tool==='signature'&&!mark.image)&&JSON.stringify(mark).length>240*1024)throw new Error('El trazo supera el tamaño admitido para una anotación editable. Divide el dibujo en varios trazos o guarda un proyecto PDFCO.');
    const page=doc.getPage(mark.page-1),geometry=pageGeometry(page),corners=annotationCorners(mark,geometry),rect=rectangle(corners),line=mark.tool==='underline'||mark.tool==='strike',shape=mark.tool==='rect'||mark.tool==='ellipse',ink=mark.tool==='pen',note=mark.tool==='note',visual=isVisualTool(mark),vectorSignature=mark.tool==='signature'&&!mark.image,angle=(mark.rotation||0)*Math.PI/180,padding=note?.5/geometry.unit:line||shape||ink||vectorSignature?mark.size/(2*geometry.unit)*(mark.tool==='rect'?Math.abs(Math.cos(angle))+Math.abs(Math.sin(angle)):1):mark.stamp?1/geometry.unit:0;
    rect[0]-=padding;rect[1]-=padding;rect[2]+=padding;rect[3]+=padding;
    const scratch=PDFPage.create(doc);scratch.setSize(rect[2]-rect[0],rect[3]-rect[1]);
    scratch.pushOperators(pushGraphicsState(),concatTransformationMatrix(1,0,0,1,-rect[0],-rect[1]));
    await paintAnnotation(scratch,note?{...mark,opacity:1}:mark,geometry,fonts);scratch.pushOperators(popGraphicsState());
    const contents=scratch.node.Contents(),parts=[];
    for(let n=0;n<contents.size();n++){const stream=doc.context.lookup(contents.get(n));parts.push(stream.getUnencodedContents());}
    const total=parts.reduce((sum,p)=>sum+p.length,0),bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    const opacity=mark.opacity??1,bbox=[0,0,rect[2]-rect[0],rect[3]-rect[1]],appearanceData={Type:'XObject',Subtype:'Form',BBox:bbox,Matrix:[1,0,0,1,0,0],Resources:scratch.node.Resources()};
    let appearance;
    if(note){
      const icon=doc.context.register(doc.context.flateStream(bytes,{...appearanceData,Group:{Type:'Group',S:'Transparency',I:true,CS:'DeviceRGB'}}));
      appearance=doc.context.flateStream('q\n/NoteAlpha gs\n/NoteIcon Do\nQ\n',{...appearanceData,Resources:{XObject:{NoteIcon:icon},ExtGState:{NoteAlpha:{Type:'ExtGState',ca:opacity,CA:opacity}}}});
    }else appearance=doc.context.flateStream(bytes,appearanceData);
    const appearanceRef=doc.context.register(appearance);
    const dict=doc.context.obj({Type:'Annot',Subtype:nativeSubtypes[mark.tool],Rect:rect,NM:PDFHexString.fromText('PDFReaderCO:'+mark.id),T:PDFHexString.fromText('PDFReaderCO'),Contents:PDFHexString.fromText(mark.tool==='text'||note?mark.text||'':''),F:4,Border:[0,0,line||shape||ink?mark.size/geometry.unit:mark.stamp?1.5/geometry.unit:0],C:rgbValues(mark.color),CA:mark.tool==='highlight'?.32*opacity:opacity,CreationDate:PDFString.of(dateString()),M:PDFString.of(dateString()),AP:{N:appearanceRef}});
    if(line||shape||ink)dict.set(PDFName.of('BS'),doc.context.obj({Type:'Border',W:mark.size/geometry.unit,S:'S'}));
    if(shape){dict.set(PDFName.of('RD'),doc.context.obj([padding,padding,padding,padding]));if(mark.fill)dict.set(PDFName.of('IC'),doc.context.obj(rgbValues(mark.fill)));}
    if(note){dict.set(PDFName.of('Name'),PDFName.of('Comment'));dict.set(PDFName.of('Open'),doc.context.obj(false));}
    else if(mark.tool==='text'){
      const font=fonts.get(fontName(mark)),fontResources=scratch.node.Resources().lookup(PDFName.of('Font'),PDFDict),entry=fontResources.entries().find(([,ref])=>ref===font.ref);
      if(!entry)throw new Error('Falta el recurso de fuente de la anotación.');
      const da=entry[0].toString()+' '+PDFNumber.of(mark.size/geometry.unit).toString()+' Tf '+rgbValues(mark.color).map(v=>PDFNumber.of(v).toString()).join(' ')+' rg';
      dict.set(PDFName.of('DA'),PDFString.of(da));dict.set(PDFName.of('Q'),PDFNumber.of(mark.align==='center'?1:mark.align==='right'?2:0));
      const rotation=((geometry.rotation-(mark.rotation||0))%360+360)%360;if(rotation%90===0)dict.set(PDFName.of('Rotate'),PDFNumber.of(rotation));
    }else if(ink){const b=annotationBox(mark,geometry.width,geometry.height),points=mark.points.map(([x,y])=>{const p=rotatePoint(x,y,b.x+b.w/2,b.y+b.h/2,mark.rotation||0,geometry.width,geometry.height);return viewToPdf(...p,geometry.width,geometry.height,geometry.rotation,geometry.crop);});dict.set(PDFName.of('InkList'),doc.context.obj([points.flat()]));}
    else if(!shape&&!visual)dict.set(PDFName.of('QuadPoints'),doc.context.obj(corners.flat()));
    if(visual){dict.set(PDFName.of('Name'),PDFName.of(mark.tool==='image'?'Image':'Signature'));dict.set(PDFName.of('Contents'),PDFHexString.fromText(mark.tool==='image'?'Imagen añadida':'Firma visual sin certificado'));if(mark.image&&options.editable!==false)dict.set(PDFName.of('PDFReaderCOAsset'),storeImageAsset(doc,mark.image));}const existing=page.node.Annots()?.asArray()||[];page.node.set(PDFName.of('Annots'),doc.context.obj([...existing,doc.context.register(dict)]));if(options.editable!==false){const {image,...withoutImage}=mark;pending.push({dict,mark:image?withoutImage:mark,geometry,version:visual?2:1});}
  }
  await doc.flush();
  for(let i=0;i<pending.length;i+=16)await Promise.all(pending.slice(i,i+16).map(async({dict,mark,geometry,version})=>{
    const data=JSON.stringify({version,mark,geometry,fingerprint:await fingerprint(dict,doc.context,mark,geometry)});if(data.length>256*1024)throw new Error(mark.tool==='note'?'El comentario supera el tamaño admitido. Divídelo en varias notas.':'El texto supera el tamaño admitido para una anotación editable. Divídelo en varias cajas.');dict.set(key,PDFHexString.fromText(data));
  }));
}

function textValue(object){return object instanceof PDFString||object instanceof PDFHexString?object.decodeText():null;}
function rawRect(dict){const r=dict.lookupMaybe(PDFName.of('Rect'),PDFArray);if(!r||r.size()!==4)return null;const values=r.asArray().map(v=>dict.context.lookup(v)).map(v=>v instanceof PDFNumber?v.asNumber():NaN);return values.every(Number.isFinite)?values:null;}
function intersects(a,b){return a&&b&&a[0]<b[2]&&a[2]>b[0]&&a[1]<b[3]&&a[3]>b[1];}
function safeToEdit(dict){
  const flags=dict.lookupMaybe(PDFName.of('F'),PDFNumber)?.asNumber()||0;
  return !(flags&(1|2|32|64|128|256|512))&&!['OC','Popup','IRT','AA','A','CL','RC'].some(name=>dict.has(PDFName.of(name)));
}
async function prepare(bytes){
  let doc;try{doc=await PDFDocument.load(bytes.slice(),{updateMetadata:false});}catch{return {bytes,marks:[],retained:0};}
  const groups=[],incoming=new Set();
  for(const [pageIndex,page]of doc.getPages().entries()){
    const entries=[],annots=page.node.Annots();for(let i=0;i<(annots?.size()||0);i++){
      const ref=annots.get(i),dict=doc.context.lookup(ref);entries.push({ref,dict});
      if(dict instanceof PDFDict)for(const name of ['Parent','Popup','IRT']){const target=dict.get(PDFName.of(name));if(target instanceof PDFRef)incoming.add(target);}
    }groups.push({pageIndex,page,entries});
  }
  const marks=[],ids=new Set();let retained=0;
  for(const {pageIndex,page,entries}of groups){
    let geometry;try{geometry=pageGeometry(page);}catch{continue;}
    const candidates=new Map();
    for(let i=0;i<entries.length;i++){
      const {ref,dict}=entries[i];if(!(dict instanceof PDFDict))continue;const subtype=dict.get(PDFName.of('Subtype'))?.toString();if(!supportedSubtypes.has(subtype))continue;
      try{
        const raw=textValue(dict.get(key));if(!raw||raw.length>256*1024||!safeToEdit(dict)||incoming.has(ref))throw new Error('Anotación no compatible.');
        const data=JSON.parse(raw);if((isVisualTool(data.mark||{})?data.version!==2:data.version!==1)||typeof data.fingerprint!=='string')throw new Error('Versión no compatible.');
        const hydrated={...data.mark,...(dict.has(PDFName.of('PDFReaderCOAsset'))?{image:readImageAsset(dict)}:{})},mark=annotationData(hydrated);if(!isNativeTool(mark)||'/'+nativeSubtypes[mark.tool]!==subtype)throw new Error('Tipo inconsistente.');
        if(await fingerprint(dict,doc.context,data.mark,data.geometry)!==data.fingerprint)throw new Error('La anotación fue modificada en otro lector.');
        candidates.set(i,transformedMark(mark,sourceGeometry(data.geometry),geometry,pageIndex+1));
      }catch{retained++;}
    }
    // Editable overlays are painted above the canvas: keep occluded native objects intact.
    for(let i=entries.length-1;i>=0;i--)if(candidates.has(i)){
      const source=rawRect(entries[i].dict);let blocked=false;
      for(let j=i+1;j<entries.length;j++)if(!candidates.has(j)&&entries[j].dict instanceof PDFDict&&intersects(source,rawRect(entries[j].dict))){blocked=true;break;}
      if(blocked){candidates.delete(i);retained++;}
    }
    const keep=[];
    for(let i=0;i<entries.length;i++)if(candidates.has(i)){
      const mark=candidates.get(i);if(ids.has(mark.id))mark.id=globalThis.crypto.randomUUID();ids.add(mark.id);marks.push(mark);
    }else keep.push(entries[i].ref);
    if(candidates.size)page.node.set(PDFName.of('Annots'),doc.context.obj(keep));
  }
  if(!marks.length)return {bytes,marks,retained};
  collectUnreachable(doc);const base=await doc.save({updateFieldAppearances:false});return {bytes:base,marks,retained};
}
export function prepareEditablePdf(bytes){if(!prepareCache.has(bytes))prepareCache.set(bytes,prepare(bytes).then(result=>{baseFacts.set(result.bytes,{retained:result.retained});return result;}));return prepareCache.get(bytes);}
export function retainedNativeCount(bytes){return baseFacts.get(bytes)?.retained||0;}
