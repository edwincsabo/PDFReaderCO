import{createMultiTextFormatter}from'./multi-text-engine.mjs';
import{createMultiTextReplacer}from'./multi-replace-engine.mjs';
import{textCaretGeometry}from'./text-caret.mjs';
import{planOriginalBlocks}from'./original-blocks.mjs';
import{paragraphOuterBounds}from'./paragraph-area.mjs';
import{validateTypography,typographyValues}from'./paragraph-typography.mjs';
import{paragraphBasic,validateParagraphTextData}from'./paragraph-text-data.mjs';
import{scaleSpanSizes}from'./text-spans.mjs';
import{expandedTextFit,createTextSpace}from'./original-text-space.mjs';
import { init } from '@embedpdf/pdfium';
import { PDFDocument, PDFObjectCopier, PDFName, PDFNumber, PDFDict } from 'pdf-lib';
import { collectUnreachable } from './pdf-garbage.mjs';
import { groupOriginalLines, textFit } from './original-text-lines.mjs';
import { findTextSize } from './original-text-fit.mjs';
import { createTextReplacer } from './original-text-replace.mjs';
import { rectangleClipBounds, clipPaths, translatedClipMatches,expandableClipPaths,clipContainsBox } from './original-clip.mjs';
import { createGroupEditor } from './original-groups.mjs';
import { groupOriginalParagraphs, createTextRewriter } from './original-paragraphs.mjs';
import { createStrokeMarker, normalizeParagraphMetadata } from './original-rewrite.mjs';

const standardFonts=new Set(['Helvetica','Helvetica-Bold','Helvetica-Oblique','Helvetica-BoldOblique','Times-Roman','Times-Bold','Times-Italic','Times-BoldItalic','Courier','Courier-Bold','Courier-Oblique','Courier-BoldOblique']);
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');

export async function createOriginalTextEngine(wasmBinary){
  const api=await init({wasmBinary});api.PDFiumExt_Init();const memory=api.pdfium;
  const allocated=(size,fn)=>{const ptr=memory._malloc(Math.max(8,size));if(!ptr)throw new Error('No hay memoria suficiente para procesar el PDF.');try{return fn(ptr);}finally{memory._free(ptr);}};
  const floats=(fn,count)=>allocated(count*4,ptr=>{if(!fn(ptr))throw new Error('No se pudo leer la geometría del texto.');return Array.from(memory.HEAPF32.slice(ptr/4,ptr/4+count));});
  const textSpace=createTextSpace({api,memory,allocated,floats});
  const textIndexes=new Map(),textClipPages=new Set(),pageRestrictions=new Map(),featureCache=new Map();let paragraphCache=new Map(),metadataBudget=4*1024*1024;
  const paragraphKey=properties=>JSON.stringify(paragraphBasic(properties));
  async function restriction(bytes,page){
    const key=(await hash(bytes))+':'+page;if(featureCache.has(key))return featureCache.get(key);
    const doc=await PDFDocument.load(bytes.slice(),{updateMetadata:false}),p=doc.getPage(page-1),resources=doc.context.lookup(p.node.getInheritableAttribute(PDFName.of('Resources'))),states=resources?.lookupMaybe(PDFName.of('ExtGState'),PDFDict);let reason='';
    for(const [,value]of states?.entries()||[]){const state=doc.context.lookup(value);if(state instanceof PDFDict){const mask=state.get(PDFName.of('SMask'));if(mask&&mask.toString()!=='/None'){reason='La página contiene una máscara de transparencia que se conserva sin editar.';break;}}}
    featureCache.set(key,reason);if(featureCache.size>32)featureCache.delete(featureCache.keys().next().value);return reason;
  }
  function textIndex(textPage){
    if(textIndexes.has(textPage))return textIndexes.get(textPage);
    const count=api.FPDFText_CountChars(textPage);if(count>1000000)throw new Error('La página contiene demasiado texto para este editor.');const items=new Map(),characters=[];
    for(let i=0;i<count;i++){const code=api.FPDFText_GetUnicode(textPage,i),ch=code>=0&&code<=0x10ffff?String.fromCodePoint(code):'\0';characters.push(ch);if(api.FPDFText_IsGenerated(textPage,i)===1)continue;const object=api.FPDFText_GetTextObject(textPage,i);if(!object)continue;const item=items.get(object)||{text:'',first:i,last:i,characters:[]};if(item.characters.length<12000){const box=allocated(32,p=>{if(!api.FPDFText_GetCharBox(textPage,i,p,p+8,p+16,p+24))return null;const v=Array.from(memory.HEAPF64.slice(p/8,p/8+4));return[v[0],v[2],v[1],v[3]];});if(ch.trim()&&box?.every(Number.isFinite))item.characters.push({start:item.text.length,end:item.text.length+ch.length,bounds:box});}item.text+=ch;item.last=i;items.set(object,item);}
    const value={items,characters};textIndexes.set(textPage,value);return value;
  }
  // FPDFTextObj_GetText also includes synthetic spaces between page objects.
  // Use only real glyph characters, so a neighboring column cannot become part
  // of an edit or make post-edit validation reject a correctly encoded string.
  const objectText=(object,textPage)=>textIndex(textPage).items.get(object)?.text||'';
  const fontName=font=>{const length=api.FPDFFont_GetBaseFontName(font,0,0);return length>0&&length<2000?allocated(length,ptr=>{api.FPDFFont_GetBaseFontName(font,ptr,length);return memory.UTF8ToString(ptr);}):'Fuente del documento';};
  const withPage=(bytes,number,fn,restriction='')=>{
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>256*1024*1024||!Number.isInteger(number)||number<1)throw new Error('Documento o página inválidos.');
    return allocated(bytes.length,ptr=>{memory.HEAPU8.set(bytes,ptr);const doc=api.FPDF_LoadMemDocument(ptr,bytes.length,'');if(!doc)throw new Error('No se pudo abrir el PDF para editar texto. Los documentos cifrados no se modifican.');let page=0,textPage=0;const oldCache=paragraphCache,oldBudget=metadataBudget;paragraphCache=new Map();metadataBudget=4*1024*1024;
      try{if(api.EPDF_IsEncrypted(doc))throw new Error('Los PDF cifrados están disponibles solo para lectura.');page=api.FPDF_LoadPage(doc,number-1);if(!page)throw new Error('Página inválida.');textPage=api.FPDFText_LoadPage(page);if(!textPage)throw new Error('No se pudo leer el texto de la página.');
        // CountPaths exposes geometric paths, but omits text used as a clip.
        // Until those can be inspected/serialized reliably, block page moves.
        const count=api.FPDFPage_CountObjects(page);if(count>50000)throw new Error('La página contiene demasiados objetos para este editor.');
        for(let i=0;i<count;i++){const object=api.FPDFPage_GetObject(page,i);if(api.FPDFPageObj_GetType(object)===1&&api.FPDFTextObj_GetTextRenderMode(object)>=4){textClipPages.add(textPage);break;}}
        if(restriction)pageRestrictions.set(textPage,restriction);return fn({doc,page,textPage});}
      finally{paragraphCache=oldCache;metadataBudget=oldBudget;if(textPage){textIndexes.delete(textPage);textClipPages.delete(textPage);pageRestrictions.delete(textPage);api.FPDFText_ClosePage(textPage);}if(page)api.FPDF_ClosePage(page);api.FPDF_CloseDocument(doc);}
    });
  };
  function clipSignature(object){
    const clip=api.FPDFPageObj_GetClipPath(object),count=api.FPDFClipPath_CountPaths(clip);if(count<=0)return '';
    const paths=[];let total=0;
    for(let i=0;i<count;i++){const length=api.FPDFClipPath_CountPathSegments(clip,i);if(length<0||(total+=length)>2000)return 'individual:'+object;const segments=[];for(let j=0;j<length;j++){const segment=api.FPDFClipPath_GetPathSegment(clip,i,j);segments.push([api.FPDFPathSegment_GetType(segment),api.FPDFPathSegment_GetClose(segment),...floats(ptr=>api.FPDFPathSegment_GetPoint(segment,ptr,ptr+4),2)]);}paths.push(segments);}
    return JSON.stringify(paths);
  }
  const markName=mark=>allocated(1024,ptr=>allocated(4,out=>{if(!api.FPDFPageObjMark_GetName(mark,ptr,1024,out)||memory.HEAPU32[out/4]>1024)return null;return memory.UTF16ToString(ptr);}));
  function paragraphMark(mark){
    if(paragraphCache.has(mark))return paragraphCache.get(mark);
    if(markName(mark)!=='PDFCOParagraph'||![7,8,9,10,11,12,13].includes(api.FPDFPageObjMark_CountParams(mark)))return null;
    const read=key=>allocated(4,p=>api.FPDFPageObjMark_GetParamFloatValue(mark,key,p)?memory.HEAPF32[p/4]:NaN),width=read('Width'),height=read('Height'),top=read('Top'),leading=read('Leading'),alignment=read('Alignment'),x=read('X'),y=read('Y');
    if(![width,height,top,leading,alignment,x,y].every(Number.isFinite)||width<1||width>10000||height<1||height>10000||Math.abs(top)>10000||leading<.8||leading>3||![0,1,2,3].includes(alignment))return null;
    const properties={paragraphWidth:width,paragraphHeight:height,paragraphTop:top,lineSpacing:leading,align:['left','center','right','justify'][alignment],paragraphAnchor:[x,y]};
    if(api.FPDFPageObjMark_GetParamValueType(mark,'AutoGrow')>0){const grow=read('AutoGrow');if(![0,1].includes(grow))return null;properties.paragraphAutoGrow=!!grow;}
    const readText=(key,max=24002)=>allocated(4,out=>{if(!api.FPDFPageObjMark_GetParamBlobValue(mark,key,0,0,out))return null;const length=memory.HEAPU32[out/4];if(length>max||length<2||length>metadataBudget)return null;metadataBudget-=length;return allocated(length,ptr=>{if(!api.FPDFPageObjMark_GetParamBlobValue(mark,key,ptr,length,out))return null;const bytes=memory.HEAPU8.slice(ptr,ptr+length);if(bytes[0]!==254||bytes[1]!==255||length%2)return null;let value='';for(let i=2;i<length;i+=2)value+=String.fromCharCode(bytes[i]*256+bytes[i+1]);return value;});});
    if(api.FPDFPageObjMark_GetParamValueType(mark,'Block')>0){const id=readText('Block',100);if(!/^[a-f0-9-]{36}$/.test(id||''))return null;properties.manualBlock=id;}
    if(api.FPDFPageObjMark_GetParamValueType(mark,'Typography')>0){try{const raw=readText('Typography',4096);if(raw===null)return null;Object.assign(properties,validateTypography(JSON.parse(raw),width));}catch{return null;}}
    if(api.FPDFPageObjMark_GetParamValueType(mark,'Text')>0){const text=readText('Text'),paint=readText('Paint',24402);if(text!==null&&paint!==null&&text.length<=12000&&paint.length<=12200){properties.paragraphSourceText=text;properties.paragraphPaint=paint;
      if(api.FPDFPageObjMark_GetParamValueType(mark,'Data')>0){properties.paragraphTextDataInvalid=true;try{const raw=readText('Data',3*1024*1024);if(raw!==null){const parsed=validateParagraphTextData(JSON.parse(raw),text);if(parsed){properties.paragraphTextData=parsed;delete properties.paragraphTextDataInvalid;}}}catch{}}
    }}
    paragraphCache.set(mark,properties);return properties;
  }
  function markSignature(object){
    const count=api.FPDFPageObj_CountMarks(object),items=[];
    const manual=Array.from({length:count},(_,i)=>paragraphMark(api.FPDFPageObj_GetMark(object,i))).some(p=>p?.manualBlock);
    for(let i=0;i<count;i++){const mark=api.FPDFPageObj_GetMark(object,i),name=markName(mark);if(name===null)return 'individual:'+object;if(manual&&name.startsWith('PDFCORich_'))continue;const paragraph=paragraphMark(mark);if(paragraph){items.push([name,paragraphBasic(paragraph)]);continue;}
      const params=api.FPDFPageObjMark_CountParams(mark);let mcid=null;
      // Joining only identical semantic spans retains their original MCID.
      // Unknown properties are deliberately never merged.
      if(params){if(params!==1||api.FPDFPageObjMark_GetParamValueType(mark,'MCID')!==2)return 'individual:'+object;mcid=allocated(4,ptr=>api.FPDFPageObjMark_GetParamIntValue(mark,'MCID',ptr)?memory.HEAP32[ptr/4]:null);if(mcid===null)return 'individual:'+object;}
      items.push([name,mcid]);
    }
    return JSON.stringify(items);
  }
  function describe(object,index,textPage){
    const text=objectText(object,textPage),bounds=floats(ptr=>api.FPDFPageObj_GetBounds(object,ptr,ptr+4,ptr+8,ptr+12),4),matrix=floats(ptr=>api.FPDFPageObj_GetMatrix(object,ptr),6),fontSize=floats(ptr=>api.FPDFTextObj_GetFontSize(object,ptr),1)[0],font=api.FPDFTextObj_GetFont(object),name=fontName(font);
    const rgba=allocated(16,ptr=>{if(!api.FPDFPageObj_GetFillColor(object,ptr,ptr+4,ptr+8,ptr+12))return null;return Array.from(memory.HEAPU32.slice(ptr/4,ptr/4+4));}),renderMode=api.FPDFTextObj_GetTextRenderMode(object),marks=api.FPDFPageObj_CountMarks(object),clip=api.FPDFClipPath_CountPaths(api.FPDFPageObj_GetClipPath(object));
    let reason='';if(!text.trim()||/[\u0000-\u0008\u000b-\u001f]/.test(text))reason='No se pudo recuperar texto Unicode válido.';
    else if(renderMode===3||rgba&& !rgba[3])reason='Este texto es invisible.';
    else if(!rgba||renderMode!==0)reason='Este texto utiliza contornos, recorte o un modo de pintado especial.';
    else if(!matrix.every(Number.isFinite)||Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])<1e-8||fontSize<=0)reason='La transformación del texto no es compatible.';
    if(textClipPages.has(textPage))reason='La página contiene una máscara formada por texto y se conserva sin editar para mantener lo oculto.';
    if(pageRestrictions.has(textPage))reason=pageRestrictions.get(textPage);
    let paragraph=null,ownMarks=0;for(let i=0;i<marks;i++){const mark=api.FPDFPageObj_GetMark(object,i),properties=paragraphMark(mark);if(properties){paragraph=properties;ownMarks++;}if(api.FPDFPageObjMark_GetParamValueType(mark,'ActualText')>0||api.FPDFPageObjMark_GetParamValueType(mark,'OC')>0)reason='Este texto contiene información alternativa o capas que se conservan sin editar.';}
    const active=allocated(4,ptr=>api.FPDFPageObj_GetIsActive(object,ptr)?!!memory.HEAPU8[ptr]:true);if(!active)reason='Este texto está oculto.';
    const clipKey=clipSignature(object),clipBounds=rectangleClipBounds(clipKey),moveReason=reason||(textClipPages.has(textPage)?'La página contiene una máscara formada por texto. Su movimiento todavía no está disponible.':'')||(clip>0&&!clipPaths(clipKey)?'No se pudo comprobar la geometría completa de esta máscara.':'');
    const rich=Array.from({length:marks},(_,i)=>markName(api.FPDFPageObj_GetMark(object,i))).some(name=>name?.startsWith('PDFCORich_'));
    return {index,text,visible:active&&renderMode!==3&&!!rgba&&rgba[3]>0,readingOrder:[index],characters:textIndex(textPage).items.get(object)?.characters||[],rich:rich||!!paragraph?.manualBlock,bounds,matrix,fontSize,fontName:name,fontKey:font,clipKey,clipBounds,clipExpandable:!!expandableClipPaths(clipKey),movable:!moveReason,moveReason,markKey:markSignature(object),embedded:!!api.FPDFFont_GetIsEmbedded(font),subset:/^[A-Z]{6}\+/.test(name),clipped:clip>0,clipCount:Math.max(0,clip),color:rgba?'#'+rgba.slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join(''):'#000000',opacity:rgba?rgba[3]/255:1,marks:marks-ownMarks,...paragraph,editable:!reason,reason};
  }
  function save(doc){const writer=api.PDFiumExt_OpenFileWriter();if(!writer)throw new Error('No se pudo preparar el PDF modificado.');try{if(!api.FPDF_SaveAsCopy(doc,writer,2))throw new Error('No se pudo guardar el PDF modificado.');const size=api.PDFiumExt_GetFileWriterSize(writer);if(size<=0||size>256*1024*1024)throw new Error('El PDF resultante supera el tamaño admitido.');return allocated(size,ptr=>{if(api.PDFiumExt_GetFileWriterData(writer,ptr,size)!==size)throw new Error('No se pudo recuperar el PDF completo.');return memory.HEAPU8.slice(ptr,ptr+size);});}finally{api.PDFiumExt_CloseFileWriter(writer);}}
  function renderPreview(page,requestedWidth){
    const pw=api.FPDF_GetPageWidthF(page),ph=api.FPDF_GetPageHeightF(page);
    if(!Number.isFinite(pw)||!Number.isFinite(ph)||pw<=0||ph<=0)throw new Error('La página no tiene dimensiones válidas.');
    const scale=Math.min(Math.max(100,Math.min(2400,Number(requestedWidth)||1000))/pw,Math.sqrt(1800000/(pw*ph))),width=Math.max(1,Math.floor(pw*scale)),height=Math.max(1,Math.floor(ph*scale)),bitmap=api.FPDFBitmap_Create(width,height,1);
    if(!bitmap)throw new Error('No se pudo crear la vista previa.');
    try{
      if(!api.FPDFBitmap_FillRect(bitmap,0,0,width,height,0xffffffff))throw new Error('No se pudo preparar el fondo de la vista previa.');
      api.FPDF_RenderPageBitmap(bitmap,page,0,0,width,height,0,1);
      const buffer=api.FPDFBitmap_GetBuffer(bitmap),stride=api.FPDFBitmap_GetStride(bitmap);if(!buffer||stride<width*4||api.FPDFBitmap_GetFormat(bitmap)!==4)throw new Error('Formato de vista previa no compatible.');
      const data=new Uint8ClampedArray(width*height*4),heap=memory.HEAPU8;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++){const from=buffer+y*stride+x*4,to=(y*width+x)*4;data[to]=heap[from+2];data[to+1]=heap[from+1];data[to+2]=heap[from];data[to+3]=heap[from+3];}
      return {width,height,data};
    }finally{api.FPDFBitmap_Destroy(bitmap);}
  }
  function readObjects(handle,textPage){const objects=[],text=textIndex(textPage);let grouped=0,unsupported=0,previous=null;const count=api.FPDFPage_CountObjects(handle);if(count>50000)throw new Error('La página contiene demasiados objetos para este editor.');for(let index=0;index<count;index++){const object=api.FPDFPage_GetObject(handle,index),type=api.FPDFPageObj_GetType(object);if(type===1){try{const item=describe(object,index,textPage),range=text.items.get(object);if(item.text.trim()){if(previous&&range){const gap=text.characters.slice(previous.last+1,range.first).join('');item.separatorBefore=range.first>previous.last&&/^[ ]*$/.test(gap)?(gap?' ':''):undefined;}objects.push(item);previous=range;}}catch{unsupported++;previous=null;}}else if(type===5)grouped++;}return {objects,grouped,unsupported};}
  const inspect=async(bytes,page)=>{const source=await hash(bytes),limited=await restriction(bytes,page);return withPage(bytes,page,({page:handle,textPage})=>{const data=readObjects(handle,textPage);return {source,page,...data,space:textSpace(handle),pageRestricted:textClipPages.has(textPage)||!!limited,lines:groupOriginalLines(data.objects),paragraphs:groupOriginalParagraphs(data.objects),objects:data.objects.map(({fontKey,clipKey,markKey,...item})=>item)};},limited);};
  const rewriteText=createTextRewriter({api,memory,withPage,allocated,floats,describe,readObjects,save,hash,standardFonts:{has:font=>standardFonts.has(font)||/^local:[a-f0-9]{64}$/.test(font)},textSpace,clearTextPage:ptr=>textIndexes.delete(ptr)});
  const modify=async(bytes,request,preview=false)=>{
    if(!request||request.source!==await hash(bytes))throw new Error('El documento cambió. Selecciona de nuevo el texto.');
    if(request.expandToSpace!==undefined&&typeof request.expandToSpace!=='boolean')throw new Error('La opción de expansión no es válida.');
    const limited=await restriction(bytes,request.page);if(limited)throw new Error(limited);
    const rewrite=request.paragraph||request.spans!==undefined||request.font?.startsWith('local:')||request.font!=='original'&&withPage(bytes,request.page,({page,textPage})=>{const object=api.FPDFPage_GetObject(page,request.index);if(!object||api.FPDFPageObj_GetType(object)!==1)return false;const run=describe(object,request.index,textPage);return run.clipped||run.marks>0;});
    if(rewrite){const result=await rewriteText(bytes,request,preview);if(preview===true||preview==='validate')return result.fit;if(preview==='render')return {...result.fit,image:withPage(result.bytes,request.page,({page})=>renderPreview(page,request.previewWidth))};return result.bytes;}
    if(typeof request.text!=='string'||request.text.length>4000||/[\r\n\u0000-\u001f]/.test(request.text))throw new Error('Edita un fragmento de una sola línea, de hasta 4.000 caracteres.');
    return withPage(bytes,request.page,({doc,page,textPage})=>{
      if(!Number.isInteger(request.index)||request.index<0||request.index>=api.FPDFPage_CountObjects(page))throw new Error('Objeto de texto inválido.');
      const original=api.FPDFPage_GetObject(page,request.index);if(api.FPDFPageObj_GetType(original)!==1)throw new Error('Selecciona un objeto de texto.');
      const before=describe(original,request.index,textPage);let indices=[request.index],area=before.bounds;
      if(request.indices){
        const line=groupOriginalLines(readObjects(page,textPage).objects).find(o=>o.index===request.index);
        if(!line||JSON.stringify(line.indices)!==JSON.stringify(request.indices)||JSON.stringify(line.originals)!==JSON.stringify(request.originals)||line.text!==request.original)throw new Error('La línea seleccionada cambió o contiene fragmentos incompatibles. Selecciónala de nuevo.');
        indices=line.indices;area=line.bounds;
      }else if(before.text!==request.original)throw new Error('El texto seleccionado cambió. Selecciónalo de nuevo.');
      // Side bearings shrink when the font or size changes. The unchanged
      // insertion point belongs to the available area even before the first
      // painted pixel, otherwise a smaller replacement can falsely overflow.
      area=[Math.min(area[0],before.matrix[4]),Math.min(area[1],before.matrix[5]),Math.max(area[2],before.matrix[4]),Math.max(area[3],before.matrix[5])];
      if(!before.editable)throw new Error(before.reason);
      if(!Number.isFinite(request.fontSize)||request.fontSize<1||request.fontSize>400||typeof request.color!=='string'||!/^#[0-9a-f]{6}$/i.test(request.color))throw new Error('Tamaño o color de texto inválidos.');
      if(request.font!=='original'&&!standardFonts.has(request.font))throw new Error('Selecciona una fuente admitida.');
      if(request.font==='original'&&before.embedded&&request.text!==before.text){const available=new Set();for(const item of readObjects(page,textPage).objects)if(item.fontKey===before.fontKey)for(const ch of item.text)available.add(ch);if(Array.from(request.text).some(ch=>!available.has(ch)))throw new Error('Para conservar la fuente incorporada se admiten los caracteres comprobados con esa fuente en la página. Selecciona una fuente alternativa para añadir otros.');}
      if(before.clipped&&request.font!=='original')throw new Error('Conserva la fuente original para mantener la máscara de recorte de este fragmento.');
      const resizeClipped=request.font==='original'&&(before.clipped||before.marks>0)&&Math.abs(request.fontSize-before.fontSize)>.001,replace=request.font!=='original'||!before.clipped&&!before.marks&&Math.abs(request.fontSize-before.fontSize)>.001;
      if(replace&&before.marks)throw new Error('Este texto está etiquetado. Conserva su fuente y tamaño originales en esta versión.');
      if(request.font!=='original'&&Array.from(request.text).some(ch=>ch.codePointAt(0)>255&&!/[€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/.test(ch)))throw new Error('La fuente alternativa admite texto latino. Conserva una fuente original compatible para otros alfabetos.');
      const space=request.expandToSpace&&(!before.clipped||before.clipExpandable)?textSpace(page):null;
      let object=original,ownedFont=0,detached=false,fit=textFit(area,[area[0],area[1],area[0],area[1]],request.fontSize);
      try{
        if(!request.text){if(!api.FPDFPage_RemoveObject(page,original))throw new Error('No se pudo eliminar el texto.');api.FPDFPageObj_Destroy(original);}
        else{
          // Updating the existing object retains every rectangular/curved clip.
          // Resize only its text matrix; the clipping paths stay in page space.
          if(resizeClipped){const ratio=request.fontSize/before.fontSize,matrix=before.matrix.map((value,index)=>index<4?value*ratio:value);allocated(24,ptr=>{memory.HEAPF32.set(matrix,ptr/4);if(!api.FPDFPageObj_SetMatrix(object,ptr))throw new Error('No se pudo ajustar el tamaño conservando el recorte.');});}
          if(replace){const font=request.font==='original'?api.FPDFTextObj_GetFont(original):(ownedFont=api.FPDFText_LoadStandardFont(doc,request.font));if(!font)throw new Error('No se pudo cargar la fuente.');object=api.FPDFPageObj_CreateTextObj(doc,font,request.fontSize);if(!object)throw new Error('No se pudo crear el texto de reemplazo.');detached=true;allocated(24,ptr=>{memory.HEAPF32.set(before.matrix,ptr/4);if(!api.FPDFPageObj_SetMatrix(object,ptr))throw new Error('No se pudo conservar la posición del texto.');});}
          if(replace||request.text!==before.text){allocated((request.text.length+1)*2,ptr=>{memory.stringToUTF16(request.text,ptr,(request.text.length+1)*2);if(!api.FPDFText_SetText(object,ptr))throw new Error('La fuente no admite el texto nuevo. Selecciona una fuente alternativa.');});}
          const color=[1,3,5].map(i=>parseInt(request.color.slice(i,i+2),16));if(!api.FPDFPageObj_SetFillColor(object,...color,Math.round(before.opacity*255)))throw new Error('No se pudo aplicar el color.');
          if(replace){if(!api.FPDFPage_RemoveObject(page,original))throw new Error('No se pudo sustituir el texto original.');if(!api.FPDFPage_InsertObjectAtIndex(page,object,request.index)){api.FPDFPageObj_Destroy(original);throw new Error('No se pudo insertar el texto nuevo.');}detached=false;api.FPDFPageObj_Destroy(original);}
          const bounds=floats(ptr=>api.FPDFPageObj_GetBounds(object,ptr,ptr+4,ptr+8,ptr+12),4);fit=expandedTextFit(area,bounds,request.fontSize*Math.hypot(before.matrix[2],before.matrix[3]),space,indices,!!request.expandToSpace&&(!before.clipped||before.clipExpandable));if(request.expandToSpace&&before.clipped&&fit.expanded&&!clipContainsBox(before.clipKey,bounds))fit={...fit,fits:false,blocker:{kind:'clip',clipPaths:expandableClipPaths(before.clipKey),suggestion:'Acorta el texto, mueve texto y máscara juntos o reduce el tamaño.'},expansionReason:'El texto alcanzaría el límite de su máscara de recorte. Acórtalo o ajusta su tamaño.'};
          if(preview===true)return fit;
          if(!preview&&request.checkFit&&!fit.fits&&!request.allowOverflow)throw new Error(fit.expansionReason||'El texto nuevo supera el área original. Activa la expansión al espacio libre, acórtalo o ajusta el tamaño.');
          if(!preview&&request.checkFit&&!fit.fits&&before.clipped)throw new Error('El texto nuevo supera el área original y puede quedar oculto por la máscara. Acórtalo o reduce el tamaño.');
          // Remove the remaining members only after validating the replacement.
          // Descending indices preserve the identities of all other page objects.
          for(const index of indices.slice(1).reverse()){const member=api.FPDFPage_GetObject(page,index);if(!api.FPDFPage_RemoveObject(page,member))throw new Error('No se pudo sustituir la línea completa.');api.FPDFPageObj_Destroy(member);}
          const checkPage=api.FPDFText_LoadPage(page);try{if((!preview||fit.fits)&&(!checkPage||objectText(object,checkPage)!==request.text))throw new Error('La fuente original no puede representar todos los caracteres nuevos. Selecciona una fuente alternativa.');if(request.caretGeometry)fit.geometry=textCaretGeometry(request.text,[describe(object,request.index,checkPage)],before);}finally{if(checkPage){textIndexes.delete(checkPage);api.FPDFText_ClosePage(checkPage);}}
        }
        if(!request.text){if(preview===true)return fit;for(const index of indices.slice(1).reverse()){const member=api.FPDFPage_GetObject(page,index-1);if(!api.FPDFPage_RemoveObject(page,member))throw new Error('No se pudo eliminar la línea completa.');api.FPDFPageObj_Destroy(member);}}
        if(preview==='validate')return fit;
        if(request.caretGeometry&&!request.text)fit.geometry=textCaretGeometry('',[],before);
        if(preview==='render')return {...fit,image:renderPreview(page,request.previewWidth)};
        if(!api.FPDFPage_GenerateContent(page))throw new Error('No se pudo reconstruir el contenido de la página.');return save(doc);
      }finally{if(detached)api.FPDFPageObj_Destroy(object);if(ownedFont)api.FPDFFont_Close(ownedFont);}
    });
  };
  const mergePage=async(bytes,output,number)=>{
    // Only import the edited page's content graph. Keep the original document's
    // annotations, form tree, outlines, attachments and private metadata intact.
    const originalDoc=await PDFDocument.load(bytes.slice(),{updateMetadata:false}),changedDoc=await PDFDocument.load(output,{updateMetadata:false}),page=originalDoc.getPage(number-1),changed=changedDoc.getPage(number-1),copier=PDFObjectCopier.for(changedDoc.context,originalDoc.context);
    for(const key of ['Contents','Resources']){const name=PDFName.of(key),value=key==='Resources'?changed.node.getInheritableAttribute(name):changed.node.get(name);if(value)page.node.set(name,copier.copy(value));else page.node.delete(name);}
    await originalDoc.flush();collectUnreachable(originalDoc);return originalDoc.save({updateFieldAppearances:false});
  };
  const normalizeParagraphs=async(bytes,number,move=null,invalidated=new Set())=>{
    let serialized=null,markers=[];const pool={};
    withPage(bytes,number,({doc,page})=>{
      const selected=new Set(move?.indices||[move?.index]),items=[],dataOwners=new Set();
      for(let index=0;index<api.FPDFPage_CountObjects(page);index++){
        const object=api.FPDFPage_GetObject(page,index);if(api.FPDFPageObj_GetType(object)!==1)continue;let properties=null;
        for(let i=0;i<api.FPDFPageObj_CountMarks(object);i++)properties=paragraphMark(api.FPDFPageObj_GetMark(object,i))||properties;
        if(properties){items.push({object,index,properties});if(move&&!move.paragraph&&selected.has(index))invalidated.add(paragraphKey(properties));}
      }
      for(let {object,index,properties}of items){if(invalidated.has(paragraphKey(properties)))properties=null;else{if(move&&selected.has(index))properties={...properties,paragraphAnchor:[properties.paragraphAnchor[0]+move.dx,properties.paragraphAnchor[1]+move.dy]};if(properties.paragraphSourceText!==undefined){const key=JSON.stringify(properties);if(dataOwners.has(key))properties=paragraphBasic(properties);else dataOwners.add(key);}}markers.push({...createStrokeMarker(api,memory,allocated,page,object,pool),properties});}
      if(markers.length){if(!api.FPDFPage_GenerateContent(page))throw new Error('No se pudo conservar el área de los párrafos.');serialized=save(doc);}
    });
    return serialized?mergePage(bytes,await normalizeParagraphMetadata(serialized,number,markers),number):bytes;
  };
  const edit=async(bytes,request)=>{
    const invalidated=new Set();if(!request.paragraph)withPage(bytes,request.page,({page})=>{const object=api.FPDFPage_GetObject(page,request.index);if(!object)return;for(let i=0;i<api.FPDFPageObj_CountMarks(object);i++){const properties=paragraphMark(api.FPDFPageObj_GetMark(object,i));if(properties)invalidated.add(paragraphKey(properties));}});
    return normalizeParagraphs(await mergePage(bytes,await modify(bytes,request),request.page),request.page,null,invalidated);
  };
  const translate=async(bytes,request,preview=false)=>{
    if(!request||request.source!==await hash(bytes))throw new Error('El documento cambió. Selecciona de nuevo el texto.');
    const limited=await restriction(bytes,request.page);if(limited)throw new Error(limited);
    if(!Number.isFinite(request.dx)||!Number.isFinite(request.dy))throw new Error('Desplazamiento de texto inválido.');
    return withPage(bytes,request.page,({doc,page,textPage})=>{
      if(!Number.isInteger(request.index)||request.index<0||request.index>=api.FPDFPage_CountObjects(page))throw new Error('Objeto de texto inválido.');
      const object=api.FPDFPage_GetObject(page,request.index);if(api.FPDFPageObj_GetType(object)!==1)throw new Error('Selecciona un objeto de texto.');
      let run=describe(object,request.index,textPage),indices=[request.index];
      if(request.indices){const line=(request.paragraph?groupOriginalParagraphs:groupOriginalLines)(readObjects(page,textPage).objects).find(item=>item.index===request.index);if(!line||JSON.stringify(line.indices)!==JSON.stringify(request.indices)||JSON.stringify(line.originals)!==JSON.stringify(request.originals)||line.text!==request.original)throw new Error('La línea seleccionada cambió. Selecciónala de nuevo.');run=line;indices=line.indices;}
      else if(run.text!==request.original)throw new Error('El texto seleccionado cambió. Selecciónalo de nuevo.');
      if(!run.editable)throw new Error(run.reason);
      if(!run.movable)throw new Error(run.moveReason);
      const getBox=method=>allocated(16,ptr=>method(page,ptr,ptr+4,ptr+8,ptr+12)?Array.from(memory.HEAPF32.slice(ptr/4,ptr/4+4)):null),media=getBox(api.FPDFPage_GetMediaBox),crop=getBox(api.FPDFPage_GetCropBox)||media;
      if(!media||!crop)throw new Error('No se pudo comprobar el área visible de la página.');
      const view=[Math.max(media[0],crop[0]),Math.max(media[1],crop[1]),Math.min(media[2],crop[2]),Math.min(media[3],crop[3])],bounds=run.bounds.map((v,i)=>v+(i%2?request.dy:request.dx)),frame=(run.paragraph?paragraphOuterBounds(run):run.bounds).map((v,i)=>v+(i%2?request.dy:request.dx));
      if(!frame.every(Number.isFinite)||view[2]<=view[0]||view[3]<=view[1]||frame[0]<view[0]-.01||frame[1]<view[1]-.01||frame[2]>view[2]+.01||frame[3]>view[3]+.01)throw new Error('El texto debe permanecer dentro del área visible de la página.');
      for(const index of indices){
        const member=api.FPDFPage_GetObject(page,index),before=describe(member,index,textPage);if(!before.movable)throw new Error(before.moveReason);
        const matrix=[...before.matrix];matrix[4]+=request.dx;matrix[5]+=request.dy;
        allocated(24,ptr=>{memory.HEAPF32.set(matrix,ptr/4);if(!api.FPDFPageObj_SetMatrix(member,ptr))throw new Error('No se pudo mover el texto original.');});
        if(before.clipped){
          // Transform the object's clip, not the page's shared graphics state.
          // PDFium makes a private copy, so other objects retain their masks.
          api.FPDFPageObj_TransformClipPath(member,1,0,0,1,request.dx,request.dy);
          if(!translatedClipMatches(before.clipKey,clipSignature(member),request.dx,request.dy))throw new Error('No se pudo conservar la máscara al mover el texto.');
        }
        const actual=floats(ptr=>api.FPDFPageObj_GetBounds(member,ptr,ptr+4,ptr+8,ptr+12),4);if(actual[0]<view[0]-.01||actual[1]<view[1]-.01||actual[2]>view[2]+.01||actual[3]>view[3]+.01)throw new Error('El texto quedaría fuera de la página.');
      }
      if(preview)return {bounds,dx:request.dx,dy:request.dy,image:renderPreview(page,request.previewWidth)};
      if(Math.abs(request.dx)+Math.abs(request.dy)<1e-8)return bytes;
      if(!api.FPDFPage_GenerateContent(page))throw new Error('No se pudo reconstruir la página después de mover el texto.');return save(doc);
    });
  };
  const move=async(bytes,request)=>{const output=await translate(bytes,request);return output===bytes?bytes:normalizeParagraphs(await mergePage(bytes,output,request.page),request.page,request);};
  const autoFit=async(bytes,request)=>{
    if(!request||request.source!==await hash(bytes))throw new Error('El documento cambió. Selecciona de nuevo el texto.');
    if(typeof request.text!=='string'||!request.text.trim())throw new Error('Escribe el texto que quieres ajustar.');
    // Validate membership, source font, characters, color and current size with
    // exactly the same code path used by a normal measurement and commit.
    const initial=await modify(bytes,request,true);
    const scale=withPage(bytes,request.page,({page,textPage})=>{const run=describe(api.FPDFPage_GetObject(page,request.index),request.index,textPage);return Math.hypot(run.matrix[2],run.matrix[3]);});
    const doc=await PDFDocument.load(bytes.slice(),{updateMetadata:false}),unit=doc.getPage(request.page-1).node.lookupMaybe(PDFName.of('UserUnit'),PDFNumber)?.asNumber()??1,factor=scale*unit;
    let first=true;
    const result=await findTextSize(size=>{if(first&&size===request.fontSize){first=false;return initial;}first=false;return modify(bytes,{...scaleSpanSizes(request,size),allowOverflow:false},true);},{fontSize:request.fontSize,factor,minimum:request.fitMinimum??8});
    if(result.fits)await modify(bytes,{...scaleSpanSizes(request,result.fontSize),allowOverflow:false},'validate');
    return result;
  };
  const blockOperation=async(bytes,request,preview=false)=>{
    if(!request||request.source!==await hash(bytes))throw new Error('El documento cambió. Selecciona de nuevo los bloques.');
    const limited=await restriction(bytes,request.page);if(limited)throw new Error(limited);
    let plan,serialized,markers=[];const pool={};
    withPage(bytes,request.page,({doc,page,textPage})=>{
      const items=readObjects(page,textPage).objects;plan=planOriginalBlocks(items,request);if(preview)return;
      const changed=new Map(plan.blocks.flatMap(b=>b.indices.map((id,i)=>[id,i===0?b.properties:paragraphBasic(b.properties)])));
      for(const r of items){let properties=changed.get(r.index);if(!properties&&r.paragraphAnchor){const{fontKey,clipKey,markKey,...rest}=r;properties=Object.fromEntries(['manualBlock','paragraphWidth','paragraphHeight','paragraphTop','paragraphAnchor','lineSpacing','align','paragraphAutoGrow','paragraphSourceText','paragraphPaint','paragraphTextData','indentLeft','indentRight','firstLineIndent','spaceBefore','spaceAfter'].filter(k=>rest[k]!==undefined).map(k=>[k,rest[k]]));}
        if(properties)markers.push({...createStrokeMarker(api,memory,allocated,page,api.FPDFPage_GetObject(page,r.index),pool),properties});
      }
      if(!api.FPDFPage_GenerateContent(page))throw new Error('No se pudo guardar la estructura de los bloques.');serialized=save(doc);
    });
    if(preview)return{...plan,blocks:plan.blocks.map(({properties,...b})=>b)};
    return mergePage(bytes,await normalizeParagraphMetadata(serialized,request.page,markers),request.page);
  };
  const engine=createGroupEditor({inspect,edit,move,blocks:(bytes,request)=>blockOperation(bytes,request),blockPlan:(bytes,request)=>blockOperation(bytes,request,true),previewMove:(bytes,request)=>translate(bytes,request,true),measure:(bytes,request)=>modify(bytes,request,true),preview:(bytes,request)=>modify(bytes,request,'render'),autoFit,renderPage:(bytes,page,width)=>withPage(bytes,page,({page})=>renderPreview(page,width))},hash);
  return {...engine,...createTextReplacer(engine,hash),...createMultiTextFormatter(engine,hash),...createMultiTextReplacer(engine,hash)};
}
