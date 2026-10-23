import{transformCaretGeometry}from'./text-caret.mjs';
import{paragraphOuterBounds}from'./paragraph-area.mjs';
import{scaleSpanSizes}from'./text-spans.mjs';
import{expandedTextFit,containsBox}from'./original-text-space.mjs';
import{findTextSize}from'./original-text-fit.mjs';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFNumber,PDFRawStream,PDFObjectCopier,decodePDFRawStream} from 'pdf-lib';
import {collectUnreachable} from './pdf-garbage.mjs';

const I=[1,0,0,1,0,0],N=PDFName.of;
export const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
export const transformBounds=(m,b)=>{const p=[[b[0],b[1]],[b[0],b[3]],[b[2],b[1]],[b[2],b[3]]].map(([x,y])=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]]);return [Math.min(...p.map(p=>p[0])),Math.min(...p.map(p=>p[1])),Math.max(...p.map(p=>p[0])),Math.max(...p.map(p=>p[1]))];};
const inverse=m=>{const d=m[0]*m[3]-m[1]*m[2];return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];};
const inside=(bounds,box)=>bounds[0]>=box[0]-.01&&bounds[1]>=box[1]-.01&&bounds[2]<=box[2]+.01&&bounds[3]<=box[3]+.01;
const vectorInverse=(m,x,y)=>{const det=m[0]*m[3]-m[1]*m[2];if(Math.abs(det)<1e-8)throw new Error('La transformación del grupo no es invertible.');return {dx:(m[3]*x-m[2]*y)/det,dy:(m[0]*y-m[1]*x)/det};};
const decode=stream=>{const bytes=decodePDFRawStream(stream).decode();let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return text;};
// Content operators and offsets are read without interpreting strings, names,
// arrays, dictionaries or comments as operators. Inline binary images need a
// dedicated parser and are rejected for group traversal, never regex-rewritten.
export function contentTokens(text){
  const tokens=[];let i=0;const white=c=>!c||/[\0\t\n\f\r ]/.test(c),delimiter=c=>white(c)||'()<>[]{}/%'.includes(c);
  while(i<text.length){
    if(white(text[i])){i++;continue;}if(text[i]==='%'){while(i<text.length&&!/[\r\n]/.test(text[i]))i++;continue;}
    const start=i;let kind='word';
    if(text[i]==='('){kind='object';let depth=1;i++;while(i<text.length&&depth){const c=text[i++];if(c==='\\'){if(i<text.length)i++;}else if(c==='(')depth++;else if(c===')')depth--;}if(depth)throw new Error('Cadena PDF incompleta.');}
    else if(text[i]==='<'&&text[i+1]!=='<'){kind='object';i++;while(i<text.length&&text[i]!=='>')i++;if(i===text.length)throw new Error('Cadena hexadecimal PDF incompleta.');i++;}
    else if(text[i]==='/'){kind='name';i++;while(i<text.length&&!delimiter(text[i]))i++;}
    else if('[]<>'.includes(text[i])){kind='delimiter';i+=text.slice(i,i+2)==='<<'||text.slice(i,i+2)==='>>'?2:1;}
    else{while(i<text.length&&!delimiter(text[i]))i++;if(i===start)throw new Error('Operador PDF no compatible.');}
    const value=text.slice(start,i);if(value==='BI')throw new Error('Este grupo contiene una imagen en línea que no se puede inspeccionar completamente.');tokens.push({kind,value,start,end:i});if(tokens.length>1000000)throw new Error('El contenido del grupo es demasiado complejo.');
  }
  return tokens;
}

const resolved=(context,value)=>value?context.lookup(value):undefined;
const numbers=value=>value?.asArray?.().map(n=>n.asNumber());
const resourcesOf=(holder,parent,context)=>{const value=holder?.get(N('Resources'));return resolved(context,value)||parent;};
function pageData(doc,page){const raw=page.node.Contents(),streams=raw?.asArray?raw.asArray().map(v=>resolved(doc.context,v)):raw?[raw]:[];if(streams.some(s=>!(s instanceof PDFRawStream)))throw new Error('Contenido de página no compatible.');return streams.map(decode).join('\n');}
function invocations(text,resources,context){
  if(!(resources instanceof PDFDict))return [];
  const tokens=contentTokens(text),xobjects=resources.lookupMaybe(N('XObject'),PDFDict),out=[],stack=[],marks=[];let matrix=I,clipped=false,depth=0,args=[];
  for(const token of tokens){
    if(token.kind==='delimiter'){if(['[','<<'].includes(token.value))depth++;else depth--;args.push(token);continue;}
    if(depth||token.kind!=='word'||/^[-+.]?\d/.test(token.value)||['true','false','null'].includes(token.value)){args.push(token);continue;}
    if(token.value==='q')stack.push({matrix,clipped});
    else if(token.value==='Q'){const old=stack.pop();if(!old)throw new Error('Estado gráfico de grupo incompleto.');({matrix,clipped}=old);}
    else if(token.value==='cm'){const values=args.map(t=>Number(t.value));if(values.length!==6||!values.every(Number.isFinite))throw new Error('Matriz de grupo inválida.');matrix=multiply(matrix,values);}
    else if(token.value==='W'||token.value==='W*')clipped=true;
    else if(['BMC','BDC'].includes(token.value)){let guarded=args.some(t=>t.kind==='name'&&['/OC','/ActualText'].includes(t.value));const property=args.at(-1);if(property?.kind==='name'){const properties=resources.lookupMaybe(N('Properties'),PDFDict),value=properties?.lookupMaybe(N(property.value.slice(1)),PDFDict);guarded||=!!value&&(value.has(N('ActualText'))||value.has(N('OC'))||value.get(N('Type'))?.toString()==='/OCG');}marks.push(guarded);}
    else if(token.value==='EMC'){if(!marks.length)throw new Error('Etiqueta de grupo incompleta.');marks.pop();}
    else if(token.value==='Do'){
      const name=args.at(-1);if(args.length!==1||name?.kind!=='name')throw new Error('Referencia de grupo inválida.');
      const key=N(name.value.slice(1).replace(/#([0-9a-f]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)))),ref=xobjects?.get(key),stream=resolved(context,ref);
      if(stream instanceof PDFRawStream&&stream.dict.get(N('Subtype'))?.toString()==='/Form')out.push({name:key,stream,ref,start:name.start,end:name.end,matrix,clipped,guarded:marks.some(Boolean)});
    }
    args=[];
  }
  if(stack.length||depth||marks.length)throw new Error('Estado gráfico de grupo incompleto.');return out;
}

async function makeLocal(doc,entry){
  const temp=await PDFDocument.create(),bbox=entry.bbox,p=temp.addPage([bbox[2]-bbox[0],bbox[3]-bbox[1]]),copy=PDFObjectCopier.for(doc.context,temp.context);
  p.setMediaBox(bbox[0],bbox[1],bbox[2]-bbox[0],bbox[3]-bbox[1]);p.setCropBox(bbox[0],bbox[1],bbox[2]-bbox[0],bbox[3]-bbox[1]);
  p.node.set(N('Resources'),copy.copy(entry.resources));p.node.set(N('Contents'),temp.context.register(temp.context.flateStream(Uint8Array.from(entry.text,c=>c.charCodeAt(0)))));
  return temp.save({updateFieldAppearances:false});
}

function replaceInvocation(doc,text,resources,call,replacement){
  const cloned=resources.clone(),xobjects=resources.lookupMaybe(N('XObject'),PDFDict)?.clone()||doc.context.obj({});let number=1,key;do{key=N('PDFCOGroup'+number++);}while(xobjects.has(key));xobjects.set(key,replacement);cloned.set(N('XObject'),xobjects);
  return {text:text.slice(0,call.start)+key.toString()+text.slice(call.end),resources:cloned};
}
function streamWith(doc,old,text,resources){const dict=old.dict.clone();for(const key of ['Length','Filter','DecodeParms'])dict.delete(N(key));dict.set(N('Resources'),resources);return doc.context.register(PDFRawStream.of(dict,Uint8Array.from(text,c=>c.charCodeAt(0))));}
async function commitLocal(state,entry,bytes){
  const changed=await PDFDocument.load(bytes,{updateMetadata:false}),p=changed.getPage(0),copy=PDFObjectCopier.for(changed.context,state.doc.context),resources=copy.copy(p.node.getInheritableAttribute(N('Resources'))),text=pageData(changed,p);
  let ref=streamWith(state.doc,entry.stream,text,resources),child=entry;
  while(child.parent){const parent=child.parent,replaced=replaceInvocation(state.doc,parent.text,parent.resources,child.call,ref);ref=streamWith(state.doc,parent.stream,replaced.text,replaced.resources);child=parent;}
  const root=replaceInvocation(state.doc,state.text,state.resources,child.call,ref);state.page.node.set(N('Resources'),root.resources);state.page.node.set(N('Contents'),state.doc.context.register(state.doc.context.flateStream(Uint8Array.from(root.text,c=>c.charCodeAt(0)))));
  await state.doc.flush();collectUnreachable(state.doc);return state.doc.save({updateFieldAppearances:false});
}

export function createGroupEditor(base,hash){
  let cached=null;
  async function analyze(bytes,number){
    const source=await hash(bytes);if(cached?.source===source&&cached.number===number)return cached;
    const root=await base.inspect(bytes,number);if(!root.grouped||root.pageRestricted)return {source,number,root,entries:[],targets:new Map()};
    const doc=await PDFDocument.load(bytes.slice(),{updateMetadata:false}),page=doc.getPage(number-1),resources=resolved(doc.context,page.node.getInheritableAttribute(N('Resources'))),state={source,number,root,doc,page,resources,text:pageData(doc,page),entries:[],targets:new Map(),warnings:[]},locals=new Map();let next=100000,retained=0;
    async function walk(text,res,parent,matrix,path,ancestors){
      let calls;try{calls=invocations(text,res,doc.context);}catch(error){state.warnings.push(error.message);return;}
      for(let i=0;i<calls.length;i++){
        try{
        if(state.entries.length>=100||path.length>=16){state.warnings.push('Se inspeccionan hasta 100 grupos por página y 16 niveles.');return;}const call=calls[i];if(ancestors.has(call.stream)){state.warnings.push('Referencia circular de grupo conservada.');continue;}
        const bbox=numbers(call.stream.dict.lookupMaybe(N('BBox'),PDFArray)),own=numbers(call.stream.dict.lookupMaybe(N('Matrix'),PDFArray))||I,global=multiply(matrix,multiply(call.matrix,own)),det=global[0]*global[3]-global[1]*global[2];
        if(!bbox||bbox.length!==4||!bbox.every(Number.isFinite)||bbox[2]<=bbox[0]||bbox[3]<=bbox[1]||!global.every(Number.isFinite)||Math.abs(det)<1e-8){state.warnings.push('Grupo con geometría no compatible conservado.');continue;}
        const entry={call,parent,stream:call.stream,text:decode(call.stream),resources:resourcesOf(call.stream.dict,res,doc.context),bbox,matrix:global,path:[...path,i],externalClip:call.clipped||parent?.externalClip||false};
        if(call.guarded||call.stream.dict.has(N('OC'))||call.stream.dict.has(N('Ref'))){state.warnings.push('Grupo con capas, texto alternativo o contenido externo conservado.');continue;}
        const byResource=locals.get(call.stream)||new Map();let local=byResource.get(entry.resources);
        if(!local){const bytes=await makeLocal(doc,entry);if(retained+bytes.byteLength>96*1024*1024){state.warnings.push('Los grupos superan el límite de memoria de edición de esta página.');continue;}local={bytes,info:await base.inspect(bytes,1)};retained+=bytes.byteLength;byResource.set(entry.resources,local);locals.set(call.stream,byResource);}
        entry.bytes=local.bytes;entry.info=local.info;entry.ids=new Map();const paintIndex=(parent?.info||root).space?.objects.filter(o=>o.type===5)[i]?.index;entry.paintPath=paintIndex===undefined||parent&&!parent.paintPath?null:[...(parent?.paintPath||[]),paintIndex];state.entries.push(entry);
        for(const r of entry.info.objects){const index=next++;entry.ids.set(r.index,index);state.targets.set(index,{entry,local:r});}
        const transform=r=>{
          let contained=inside(r.bounds,bbox);for(let ancestor=parent;ancestor;ancestor=ancestor.parent)contained&&=inside(transformBounds(multiply(inverse(ancestor.matrix),global),r.bounds),ancestor.bbox);
          const bounds=transformBounds(global,r.bounds),m=multiply(global,r.matrix),moveReason=r.moveReason||(entry.externalClip?'El texto pertenece a un grupo con un recorte externo fijo. Puedes editar su contenido.':!contained?'Parte del texto está fuera del límite del grupo; su movimiento se bloquea para conservar lo oculto.':'');
          return {...r,readingOrder:entry.paintPath?[...entry.paintPath,r.index]:undefined,index:entry.ids.get(r.index),indices:r.indices?.map(id=>entry.ids.get(id)),matrix:m,bounds,characters:r.characters?.map(c=>({...c,bounds:transformBounds(global,c.bounds)})),richSpans:r.richSpans?.map(s=>({...s,sourceIndex:entry.ids.get(s.sourceIndex)})),clipBounds:r.clipBounds?transformBounds(global,r.clipBounds):null,groupPath:entry.path,growthRestricted:entry.externalClip,movable:!moveReason,moveReason};
        };
        entry.objects=entry.info.objects.map(transform);entry.lines=entry.info.lines.map(transform);entry.paragraphs=(entry.info.paragraphs||[]).map(transform);
        if(!entry.info.pageRestricted)await walk(entry.text,entry.resources,entry,global,entry.path,new Set([...ancestors,call.stream]));
        }catch(error){state.warnings.push(error instanceof Error?error.message:String(error));}
      }
    }
    await walk(state.text,resources,null,I,[],new Set());cached=state;return state;
  }
  const inspect=async(bytes,number)=>{const s=await analyze(bytes,number);return {...s.root,objects:[...s.root.objects,...s.entries.flatMap(e=>e.objects)],lines:[...s.root.lines,...s.entries.flatMap(e=>e.lines)],paragraphs:[...(s.root.paragraphs||[]),...s.entries.flatMap(e=>e.paragraphs)],groupWarnings:s.warnings||[],nested:s.entries.reduce((n,e)=>n+e.objects.length,0)};};
  async function target(bytes,req){
    if(req.source!==await hash(bytes))throw new Error('El documento cambió. Selecciona de nuevo el texto.');
    const state=await analyze(bytes,req.page),t=state.targets.get(req.index);if(!t)throw new Error('El texto agrupado cambió. Selecciónalo de nuevo.');
    const {entry}=t,mapId=id=>{const pair=[...entry.ids].find(([,virtual])=>virtual===id);if(!pair)throw new Error('La selección cruza grupos incompatibles.');return pair[0];};
    return {state,entry,request:{...req,source:entry.info.source,page:1,index:mapId(req.index),indices:req.indices?.map(mapId),groups:req.groups?.map(g=>({...g,index:mapId(g.index),indices:g.indices.map(mapId)})),spans:req.spans?.map(s=>({...s,sourceIndex:s.sourceIndex===undefined?undefined:mapId(s.sourceIndex)}))}};
  }
  const mappedFit=(fit,entry)=>{const area=transformBounds(entry.matrix,fit.area),bounds=transformBounds(entry.matrix,fit.bounds);return {...fit,area,bounds,...(fit.geometry?{geometry:transformCaretGeometry(fit.geometry,entry.matrix)}:{}),...(fit.blocker?{blocker:{...fit.blocker,bounds:fit.blocker.bounds?transformBounds(entry.matrix,fit.blocker.bounds):undefined,clipPaths:fit.blocker.clipPaths?.map(path=>path.map(([t,c,x,y])=>[t,c,entry.matrix[0]*x+entry.matrix[2]*y+entry.matrix[4],entry.matrix[1]*x+entry.matrix[3]*y+entry.matrix[5]]))}}:{}),...(fit.spaceBounds?{spaceBounds:transformBounds(entry.matrix,fit.spaceBounds)}:{}),...(fit.originalArea?{originalArea:transformBounds(entry.matrix,fit.originalArea)}:{}),width:bounds[2]-bounds[0],height:bounds[3]-bounds[1],availableWidth:area[2]-area[0],availableHeight:area[3]-area[1]};};
  function expandedGroupFit(fit,state,entry,req){
    if(!(req.paragraph?(req.paragraphAutoGrow||req.paragraphSpace):req.expandToSpace)||!fit.expanded)return fit;
    for(let ancestor=entry.parent;ancestor;ancestor=ancestor.parent)if(!containsBox(ancestor.bbox,transformBounds(inverse(ancestor.matrix),fit.spaceBounds||fit.bounds),.01))return{...fit,fits:false,blocker:{kind:'group',bounds:transformBounds(ancestor.matrix,ancestor.bbox),suggestion:'Mantén el texto dentro de su grupo, acórtalo o reduce el tamaño.'},expansionReason:'El texto alcanzaría el límite de uno de sus grupos.'};
    const context={pageBox:state.root.space?.pageBox,objects:[],unknown:!!state.warnings.length},selected=req.indices||[req.index];
    const add=(info,owner=null)=>{if(!info.space){context.unknown=true;return;}context.unknown||=info.space.unknown;const path=owner?.path||[],isAncestor=path.length<entry.path.length&&path.every((n,i)=>n===entry.path[i]),forms=info.space.objects.filter(o=>o.type===5),child=isAncestor?forms[entry.path[path.length]]?.index:null;
      if(isAncestor&&child===undefined)context.unknown=true;
      for(const item of info.space.objects){if(item.type===5)continue;let before;
        if(owner===entry)before=item.index<Math.min(...selected.map(id=>{const pair=[...entry.ids].find(([,virtual])=>virtual===id);return pair?pair[0]:Infinity;}));
        else if(isAncestor)before=item.index<child;
        else{const different=path.findIndex((n,i)=>n!==entry.path[i]);before=different>=0&&path[different]<entry.path[different];}
        context.objects.push({...item,index:owner?(owner.ids.get(item.index)??(-100000-owner.path.length*50000-item.index)):item.index,bounds:owner?transformBounds(owner.matrix,item.bounds):item.bounds,background:item.background&&before});
      }
    };
    add(state.root);for(const other of state.entries)add(other.info,other);
    const run=entry.objects.find(r=>r.index===req.index),size=req.fontSize*Math.hypot(run.matrix[2],run.matrix[3]),checked=expandedTextFit(fit.originalArea||fit.area,fit.spaceBounds||fit.bounds,size,context,selected,true);return{...fit,...checked,bounds:fit.bounds,width:fit.width,height:fit.height,fits:fit.fits&&checked.fits};
  }
  async function execute(kind,bytes,req){
    if(req.index<100000){if(['blocks','blockPlan'].includes(kind)&&req.groups?.some(g=>g.indices?.some(id=>id>=100000)))throw new Error('La selección cruza grupos incompatibles.');return base[kind](bytes,req);}
    const {state,entry,request}=await target(bytes,req);
    if(kind==='blockPlan'){const plan=await base.blockPlan(entry.bytes,request);return{...plan,blocks:plan.blocks.map(b=>({...b,indices:b.indices.map(id=>entry.ids.get(id)),bounds:transformBounds(entry.matrix,b.bounds)}))};}
    if(kind==='blocks'){const local=await base.blocks(entry.bytes,request);cached=null;return commitLocal(state,entry,local);}
    if(entry.externalClip){request.expandToSpace=false;request.paragraphAutoGrow=false;}
    if(kind==='measure')return expandedGroupFit(mappedFit(await base.measure(entry.bytes,request),entry),state,entry,req);
    if(kind==='autoFit'&&req.expandToSpace&&!req.paragraph){const run=entry.objects.find(r=>r.index===req.index),unit=state.page.node.lookupMaybe(N('UserUnit'),PDFNumber)?.asNumber()??1;return findTextSize(size=>execute('measure',bytes,scaleSpanSizes(req,size)),{fontSize:req.fontSize,factor:Math.hypot(run.matrix[2],run.matrix[3])*unit,minimum:req.fitMinimum??8});}
    if(kind==='autoFit'){
      const local=(request.paragraph?entry.info.paragraphs:request.indices?entry.info.lines:entry.info.objects).find(r=>r.index===request.index),scale=Math.hypot(...multiply(entry.matrix,local.matrix).slice(2,4))/Math.hypot(...local.matrix.slice(2,4)),doc=await PDFDocument.load(entry.bytes),unit=state.page.node.lookupMaybe(N('UserUnit'),PDFNumber)?.asNumber()??1;
      doc.getPage(0).node.set(N('UserUnit'),doc.context.obj(unit*scale));const fitBytes=await doc.save({updateFieldAppearances:false});return base.autoFit(fitBytes,{...request,source:await hash(fitBytes)});
    }
    let fit;
    if(kind==='move'||kind==='previewMove'){
      const run=(req.paragraph?entry.paragraphs:req.indices?entry.lines:entry.objects).find(r=>r.index===req.index);if(!run?.movable)throw new Error(run?.moveReason||'Movimiento de grupo no compatible.');
      const localRun=(req.paragraph?entry.info.paragraphs:req.indices?entry.info.lines:entry.info.objects).find(r=>r.index===request.index);
      for(let ancestor=entry.parent;ancestor;ancestor=ancestor.parent){const delta=vectorInverse(ancestor.matrix,req.dx,req.dy),original=transformBounds(multiply(inverse(ancestor.matrix),entry.matrix),(req.paragraph?paragraphOuterBounds(localRun):localRun.bounds)),destination=original.map((v,i)=>v+(i%2?delta.dy:delta.dx));if(!inside(destination,ancestor.bbox))throw new Error('El texto debe permanecer dentro de los límites de sus grupos.');}
      Object.assign(request,vectorInverse(entry.matrix,req.dx,req.dy));const b=(req.paragraph?paragraphOuterBounds(run):run.bounds).map((v,i)=>v+(i%2?req.dy:req.dx)),media=state.page.getMediaBox(),crop=state.page.getCropBox(),view=[Math.max(media.x,crop.x),Math.max(media.y,crop.y),Math.min(media.x+media.width,crop.x+crop.width),Math.min(media.y+media.height,crop.y+crop.height)];
      if(b[0]<view[0]-.01||b[1]<view[1]-.01||b[2]>view[2]+.01||b[3]>view[3]+.01)throw new Error('El texto debe permanecer dentro del área visible de la página.');
      fit={bounds:b,dx:req.dx,dy:req.dy};
    }else if(kind==='preview'||kind==='edit'&&(req.expandToSpace||req.paragraphAutoGrow||req.paragraphSpace)){fit=expandedGroupFit(mappedFit(await base.measure(entry.bytes,request),entry),state,entry,req);if(kind==='edit'&&request.checkFit&&!fit.fits&&!request.allowOverflow)throw new Error(fit.expansionReason||'El texto no cabe en el espacio disponible del grupo.');}
    const local=kind==='move'||kind==='previewMove'?await base.move(entry.bytes,request):await base.edit(entry.bytes,{...request,checkFit:kind==='preview'?false:request.checkFit});
    cached=null;const output=await commitLocal(state,entry,local);
    if(kind==='preview'||kind==='previewMove')return {...fit,image:await base.renderPage(output,req.page,req.previewWidth)};
    return output;
  }
  return {...base,inspect,...Object.fromEntries(['edit','move','preview','previewMove','measure','autoFit','blocks','blockPlan'].map(kind=>[kind,(bytes,request)=>execute(kind,bytes,request)]))};
}
