import{typographyValues,hasTypography}from'./paragraph-typography.mjs';
import{paragraphBasic}from'./paragraph-text-data.mjs';
import {PDFDocument,PDFName,PDFDict,PDFRawStream,PDFHexString,decodePDFRawStream} from 'pdf-lib';
import {contentTokens,multiply} from './original-groups.mjs';
import {collectUnreachable} from './pdf-garbage.mjs';
const N=PDFName.of;
const decode=s=>{const b=decodePDFRawStream(s).decode();let t='';for(let i=0;i<b.length;i+=16384)t+=String.fromCharCode(...b.subarray(i,i+16384));return t;};
const pageText=(doc,page)=>{const c=page.node.Contents();return (c?.asArray?c.asArray():c?[c]:[]).map(ref=>decode(doc.context.lookup(ref))).join('\n');};
const streamBytes=text=>Uint8Array.from(text,c=>c.charCodeAt(0));
export function paragraphHeader(p){const source=p.paragraphSourceText,paint=p.paragraphPaint,data=typeof source==='string'&&typeof paint==='string'?` /Text ${PDFHexString.fromText(source)} /Paint ${PDFHexString.fromText(paint)}`:'';return `/PDFCOParagraph << /Width ${p.width??p.paragraphWidth} /Height ${p.height??p.paragraphHeight} /Top ${p.top??p.paragraphTop} /Leading ${p.leading??p.lineSpacing} /Alignment ${['left','center','right','justify'].indexOf(p.align)} /X ${p.x??p.paragraphAnchor[0]} /Y ${p.y??p.paragraphAnchor[1]}${p.manualBlock?` /Block ${PDFHexString.fromText(p.manualBlock)}`:''}${typeof p.paragraphAutoGrow==='boolean'?` /AutoGrow ${p.paragraphAutoGrow?1:0}`:''}${data}${hasTypography(p)?' /Typography '+PDFHexString.fromText(JSON.stringify(typographyValues(p))):''}${p.paragraphTextData?' /Data '+PDFHexString.fromText(JSON.stringify(p.paragraphTextData)):''} >> BDC\n`;}
function markedGraphics(text,marker){
  const tokens=contentTokens(text),stack=[];let found=null;
  for(let i=0;i<tokens.length;i++)if(tokens[i].kind==='word'){
    if(tokens[i].value==='q')stack.push(i);
    if(tokens[i].value==='RG'&&tokens.slice(i-3,i).map(t=>Math.round(Number(t.value)*255)).every((v,j)=>v===marker.rgb[j])){if(!stack.length||found)throw new Error('No se pudo identificar de forma única el texto.');found={start:tokens[stack.at(-1)].start,level:stack.length,colorStart:tokens[i-3].start,colorEnd:tokens[i].end};}
    if(tokens[i].value==='Q'){if(found&&!found.end&&stack.length===found.level)found.end=tokens[i].end;stack.pop();}
  }
  if(!found?.end)throw new Error('No se pudo identificar el texto que se iba a sustituir.');return found;
}
const restoreStroke=(body,range,marker)=>body.slice(0,range.colorStart-range.start)+marker.restore.map(v=>v/255).join(' ')+' RG'+body.slice(range.colorEnd-range.start);

export function createStrokeMarker(api,memory,allocated,page,object,pool={}){
  const read=target=>allocated(16,p=>api.FPDFPageObj_GetStrokeColor(target,p,p+4,p+8,p+12)?Array.from(memory.HEAPU32.slice(p/4,p/4+4)):null),restore=read(object);if(!restore)throw new Error('No se pudo conservar el estado del texto.');
  if(!pool.used){pool.used=new Set();for(let i=0;i<api.FPDFPage_CountObjects(page);i++){const color=read(api.FPDFPage_GetObject(page,i));if(color)pool.used.add(color.slice(0,3).join(','));}}const used=pool.used;
  let value=crypto.getRandomValues(new Uint32Array(1))[0]&0xffffff,rgb;do{value=(value+65537)&0xffffff;rgb=[value>>16,(value>>8)&255,value&255];}while(used.has(rgb.join(',')));
  if(!api.FPDFPageObj_SetStrokeColor(object,...rgb,restore[3]))throw new Error('No se pudo identificar el texto.');used.add(rgb.join(','));return {rgb,restore:restore.slice(0,3)};
}

export async function normalizeParagraphMetadata(bytes,number,markers){
  const doc=await PDFDocument.load(bytes,{updateMetadata:false}),page=doc.getPage(number-1);let text=pageText(doc,page),tokens=contentTokens(text),own=new Map(),stack=[],remove=[];
  for(let i=0;i<tokens.length;i++)if(tokens[i].kind==='name'&&tokens[i].value==='/PDFCOParagraph'&&tokens[i+1]?.value==='<<'){
    let j=i+2,depth=1;for(;j<tokens.length&&depth;j++){if(tokens[j].value==='<<')depth++;if(tokens[j].value==='>>')depth--;}if(tokens[j]?.value==='BDC')own.set(j,tokens[i].start);
  }
  for(let i=0;i<tokens.length;i++)if(tokens[i].kind==='word'){
    if(['BMC','BDC'].includes(tokens[i].value))stack.push({own:own.has(i),start:own.get(i),end:tokens[i].end});
    if(tokens[i].value==='EMC'){const mark=stack.pop();if(mark?.own){remove.push([mark.start,mark.end],[tokens[i].start,tokens[i].end]);}}
  }
  for(const [a,b]of remove.sort((a,b)=>b[0]-a[0]))text=text.slice(0,a)+text.slice(b);
  const changes=[];for(const marker of markers){const range=markedGraphics(text,marker),body=restoreStroke(text.slice(range.start,range.end),range,marker);changes.push({start:range.start,end:range.end,value:marker.properties?paragraphHeader(marker.properties)+body+'\nEMC':body});}
  for(const change of changes.sort((a,b)=>b.start-a.start))text=text.slice(0,change.start)+change.value+text.slice(change.end);
  page.node.set(N('Contents'),doc.context.register(doc.context.flateStream(streamBytes(text))));await doc.flush();collectUnreachable(doc);return doc.save({updateFieldAppearances:false});
}

// Replace only the text painting block of a uniquely marked native object.
// Its original graphics state, clipping operators, alpha and semantic marks
// remain around the replacement. Fonts come from PDFium's actual encodings.
export async function rewriteMarkedText(bytes,number,marker,paragraph=null,rich=false){
  const doc=await PDFDocument.load(bytes,{updateMetadata:false}),page=doc.getPage(number-1),temp=doc.getPage(doc.getPageCount()-1),source=pageText(doc,page),generated=pageText(doc,temp),tokens=contentTokens(source),out=contentTokens(generated);
  const range=markedGraphics(source,marker),body=restoreStroke(source.slice(range.start,range.end),range,marker),bodyTokens=contentTokens(body),bt=bodyTokens.findIndex(t=>t.value==='BT'&&t.kind==='word'),et=bodyTokens.findIndex((t,i)=>i>bt&&t.value==='ET'&&t.kind==='word');
  if(bt<0||et<0||bodyTokens.slice(et+1).some(t=>t.value==='BT'&&t.kind==='word'))throw new Error('El bloque de texto original no es compatible.');
  let matrix=[1,0,0,1,0,0];for(let i=bt+1;i<et;i++)if(bodyTokens[i].value==='Tm'&&bodyTokens[i].kind==='word'){matrix=bodyTokens.slice(i-6,i).map(t=>Number(t.value));if(matrix.length!==6||!matrix.every(Number.isFinite))throw new Error('Matriz de texto no válida.');}
  const resources=doc.context.lookup(page.node.getInheritableAttribute(N('Resources'))).clone(),fonts=resources.lookupMaybe(N('Font'),PDFDict)?.clone()||doc.context.obj({}),tempResources=doc.context.lookup(temp.node.getInheritableAttribute(N('Resources'))),tempFonts=tempResources.lookupMaybe(N('Font'),PDFDict),mapping=new Map();
  const identities=new Map((fonts.entries()||[]).map(([name,ref])=>[doc.context.lookup(ref).toString(),name]));
  for(const [name,ref]of tempFonts?.entries()||[]){const identity=doc.context.lookup(ref).toString();let key=identities.get(identity);if(!key){let serial=1;do{key=N('PDFCOFont'+serial++);}while(fonts.has(key));fonts.set(key,ref);identities.set(identity,key);}mapping.set(name.toString(),key.toString());}resources.set(N('Font'),fonts);
  const blocks=[],stack=[];let ctm=[1,0,0,1,0,0],fill='0 g';for(let i=0;i<out.length;i++){
    if(out[i].kind!=='word')continue;
    if(out[i].value==='q'){stack.push({ctm,fill});continue;}if(out[i].value==='Q'){const saved=stack.pop();if(!saved)throw new Error('Estado de reemplazo incompleto.');({ctm,fill}=saved);continue;}
    if(out[i].value==='cm'){const values=out.slice(i-6,i).map(t=>Number(t.value));if(values.length!==6||!values.every(Number.isFinite))throw new Error('Matriz de reemplazo inválida.');ctm=multiply(ctm,values);continue;}
    if(['rg','g','k'].includes(out[i].value)){const n={rg:3,g:1,k:4}[out[i].value];fill=out.slice(i-n,i+1).map(t=>t.value).join(' ');continue;}
    if(out[i].value!=='BT')continue;
    const first=i;while(i<out.length&&!(out[i].kind==='word'&&out[i].value==='ET'))i++;if(i===out.length)throw new Error('Texto de reemplazo incompleto.');let code=generated.slice(out[first].start,out[i].end),changes=[];
    const local=contentTokens(code);let textMatrix=[1,0,0,1,0,0],matrixRange=null;for(let j=0;j<local.length;j++){
      if(local[j].kind==='word'&&local[j].value==='Tf'){const old=local[j-2],mapped=mapping.get(old?.value);if(!mapped)throw new Error('No se pudo conservar la fuente del reemplazo.');changes.push({start:old.start,end:old.end,value:mapped});}
      if(local[j].kind==='word'&&local[j].value==='Tm'){textMatrix=local.slice(j-6,j).map(t=>Number(t.value));matrixRange={start:local[j-6].start,end:local[j].end};}
    }
    const combined=multiply(ctm,textMatrix).join(' ')+' Tm';changes.push(matrixRange?{...matrixRange,value:combined}:{start:local[0].end,end:local[0].end,value:' '+combined+' '});
    for(const change of changes.sort((a,b)=>b.start-a.start))code=code.slice(0,change.start)+change.value+code.slice(change.end);blocks.push(code.replace(/^BT/, 'BT '+fill));
  }
  if(!blocks.length)throw new Error('No hay texto de reemplazo.');
  if(paragraph?.offset)matrix=multiply(matrix,[1,0,0,1,...paragraph.offset]);
  const richHeader=rich?'/PDFCORich_'+crypto.randomUUID().replaceAll('-','')+' BMC\n':'';
  const wrap=richHeader;
  const painting=blocks.map((code,i)=>paragraph?paragraphHeader(i===0?paragraph:paragraphBasic(paragraph))+code+'\nEMC':code).join('\n');
  const replacement=wrap+body.slice(0,bodyTokens[bt].start)+`q ${matrix.join(' ')} cm\n`+painting+'\nQ'+body.slice(bodyTokens[et].end)+(rich?'\nEMC':'');
  const text=source.slice(0,range.start)+replacement+source.slice(range.end);
  page.node.set(N('Resources'),resources);page.node.set(N('Contents'),doc.context.register(doc.context.flateStream(streamBytes(text))));doc.removePage(doc.getPageCount()-1);await doc.flush();collectUnreachable(doc);return doc.save({updateFieldAppearances:false});
}
