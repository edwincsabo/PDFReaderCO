import{imageData}from'./image-assets.mjs';
import{PDFDocument,PDFName,PDFDict,PDFRawStream,PDFNumber,PDFArray,PDFSignature,PDFObjectCopier,decodePDFRawStream}from'pdf-lib';
import{contentTokens,multiply}from'./original-groups.mjs';
import{pageGeometry,pdfToView,viewToPdf}from'./pdf-coordinates.mjs';
import{collectUnreachable}from'./pdf-garbage.mjs';
const pdfNumeric=n=>PDFNumber.of(Math.abs(n)<1e-10?0:Number(n.toFixed(10))).toString();
const N=PDFName.of,I=[1,0,0,1,0,0],limit=256*1024*1024;
const point=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
export function inverseMatrix(m){const d=m[0]*m[3]-m[1]*m[2];if(!Number.isFinite(d)||Math.abs(d)<1e-10)throw new Error('La transformación de la imagen no es invertible.');return[m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];}
export const contentSourceId=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
function decode(stream){const data=decodePDFRawStream(stream).decode();if(data.length>16*1024*1024)throw new Error('El contenido de la página supera el límite de análisis de 16 MB.');let s='';for(let i=0;i<data.length;i+=16384)s+=String.fromCharCode(...data.subarray(i,i+16384));return s;}
const bytesOf=text=>Uint8Array.from(text,c=>c.charCodeAt(0));
const nameOf=t=>N(t.slice(1).replace(/#([a-f0-9]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16))));
async function source(bytes,page){
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>limit||!Number.isInteger(page)||page<1)throw new Error('Documento o página inválidos.');
  let doc;try{doc=await PDFDocument.load(bytes.slice(),{updateMetadata:false});}catch{throw new Error('Las imágenes requieren un PDF sin cifrado y compatible.');}
  if(page>doc.getPageCount())throw new Error('La página no existe.');
  const acro=doc.catalog.lookup(N('AcroForm'));if(acro instanceof PDFDict&&acro.has(N('XFA')))throw new Error('Los formularios XFA se conservan sin editar imágenes.');
  if(doc.catalog.has(N('Perms'))||doc.catalog.has(N('AcroForm'))&&doc.getForm().getFields().some(f=>f instanceof PDFSignature))throw new Error('La edición de imágenes requiere una copia sin campos de firma digital.');
  const p=doc.getPage(page-1),raw=p.node.Contents(),streams=raw instanceof PDFArray?raw.asArray().map(r=>doc.context.lookup(r)):raw?[raw]:[];
  if(streams.some(s=>!(s instanceof PDFRawStream)))throw new Error('Contenido de página no compatible.');
  const text=streams.map(decode).join('\n');if(text.length>16*1024*1024)throw new Error('La página supera el límite de análisis de 16 MB.');
  const resources=doc.context.lookup(p.node.getInheritableAttribute(N('Resources')))||doc.context.obj({}),root={text,resources,parent:null},items=[],seen=new Set();let count=0,invisibleText=p.node.has(N('PDFReaderCOOCR'));
  function walk(holder,parentMatrix=I,clips=[],depth=0,inheritedReason=''){
    if(depth>8||++count>2000)throw new Error('La página tiene demasiados grupos de imágenes.');
    const tokens=contentTokens(holder.text),stack=[],marks=[];let matrix=parentMatrix,clipped=false,masked=false,args=[],nested=0,callIndex=0;
    for(const token of tokens){
      if(token.kind==='delimiter'){nested+=['[','<<'].includes(token.value)?1:-1;args.push(token);continue;}
      if(nested||token.kind!=='word'||/^[-+.]?\d/.test(token.value)||['true','false','null'].includes(token.value)){args.push(token);continue;}
      if(token.value==='q')stack.push({matrix,clipped,masked});
      else if(token.value==='Q'){const saved=stack.pop();if(!saved)throw new Error('Estado gráfico de imagen incompleto.');({matrix,clipped,masked}=saved);}
      else if(token.value==='cm'){const values=args.map(t=>/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(t.value)?Number(t.value):NaN);if(values.length!==6||!values.every(Number.isFinite))throw new Error('Matriz de imagen inválida.');matrix=multiply(matrix,values);}
      else if(['W','W*'].includes(token.value))clipped=true;
      else if(token.value==='Tr'){const mode=Number(args[0]?.value);if(mode===3)invisibleText=true;if(mode>=4)clipped=true;}
      else if(token.value==='gs'){const states=holder.resources.lookupMaybe(N('ExtGState'),PDFDict),state=args.length===1&&args[0].kind==='name'?states?.lookupMaybe(nameOf(args[0].value),PDFDict):null;if(state){const mask=state.get(N('SMask'));if(mask!==undefined)masked=mask.toString()!=='/None';}}
      else if(['BMC','BDC'].includes(token.value)){let guarded=args.some(t=>t.kind==='name'&&['/OC','/ActualText'].includes(t.value));const last=args.at(-1);if(last?.kind==='name'){const properties=holder.resources.lookupMaybe(N('Properties'),PDFDict),property=properties?.lookupMaybe(nameOf(last.value),PDFDict);guarded||=!!property&&(property.has(N('OC'))||property.has(N('ActualText')));}marks.push(guarded);}
      else if(token.value==='EMC'){if(!marks.length)throw new Error('Etiqueta de imagen incompleta.');marks.pop();}
      else if(token.value==='Do'){
        const arg=args[0];if(args.length!==1||arg.kind!=='name')throw new Error('Referencia de imagen no compatible.');
        const objects=holder.resources.lookupMaybe(N('XObject'),PDFDict),key=nameOf(arg.value),ref=objects?.get(key),object=ref?doc.context.lookup(ref):null,subtype=object instanceof PDFRawStream?object.dict.get(N('Subtype'))?.toString():'';
        const call={start:arg.start,end:token.end,name:key,index:callIndex++},id=(holder.id?holder.id+'/':'')+call.index,reason=inheritedReason||(marks.some(Boolean)?'Contenido con capas opcionales o texto alternativo protegido.':'');
        if(subtype==='/Image'){
          if(items.length>=500)throw new Error('La página supera quinientas apariciones de imágenes.');
          const width=object.dict.lookupMaybe(N('Width'),PDFNumber)?.asNumber(),height=object.dict.lookupMaybe(N('Height'),PDFNumber)?.asNumber(),geometry=pageGeometry(p),polygon=[[0,0],[1,0],[1,1],[0,1]].map(v=>pdfToView(...point(matrix,...v),geometry)),xs=polygon.map(v=>v[0]),ys=polygon.map(v=>v[1]),rect={x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
          const special=reason||(object.dict.has(N('OC'))?'La imagen pertenece a una capa opcional.':'')||(object.dict.get(N('ImageMask'))?.toString()==='true'?'Es una máscara de imagen que depende del color del contenido.':'');
          const moveReason=special||(clipped?'La imagen usa un recorte externo que se conserva en su posición.':'')||(masked?'La imagen usa una máscara de transparencia externa.':'')||(Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2])<1e-10?'Transformación no invertible.':'')||(rect.x<-.001||rect.y<-.001||rect.x+rect.w>1.001||rect.y+rect.h>1.001?'La imagen está parcialmente fuera del área visible.':'');
          items.push({id,page,width,height,rect,polygon,matrix:[...matrix],editable:!moveReason,reason:moveReason,replaceable:!special,extractable:!special&&Number.isSafeInteger(width)&&Number.isSafeInteger(height)&&width>0&&height>0&&width<=8192&&height<=8192&&width*height<=16000000,holder,call,object,ref,clips});
        }else if(subtype==='/Form'){
          if(seen.has(object))throw new Error('El PDF contiene grupos de imágenes recursivos.');
          const local=object.dict.lookup(N('Matrix'))?.asArray?.().map(v=>v.asNumber())||I,bbox=object.dict.lookup(N('BBox'))?.asArray?.().map(v=>v.asNumber());
          if(local.length!==6||!local.every(Number.isFinite)||!bbox||bbox.length!==4||!bbox.every(Number.isFinite))throw new Error('Geometría de grupo de imágenes no compatible.');
          const world=multiply(matrix,local),child={id,text:decode(object),resources:object.dict.lookupMaybe(N('Resources'),PDFDict)||holder.resources,parent:holder,stream:object,call};
          seen.add(object);walk(child,world,[...clips,{matrix:world,bbox}],depth+1,reason||(clipped?'El grupo usa un recorte externo.':'')||(masked?'El grupo usa una máscara externa.':''));seen.delete(object);
        }
      }
      args=[];
    }
    if(stack.length||nested||marks.length)throw new Error('Estado gráfico de imagen incompleto.');
  }
  walk(root);if(invisibleText)for(const item of items){item.editable=false;item.replaceable=false;item.reason='La página contiene OCR o texto invisible. Usa una copia anterior al OCR para no desalinear su capa de texto.';}return{doc,page:p,root,items,source:await contentSourceId(bytes)};
}
export async function inspectOriginalImages(bytes,page){const s=await source(bytes,page);return{source:s.source,page,geometry:pageGeometry(s.page),items:s.items.map(({holder,call,object,ref,clips,...item})=>item)};}
function rewritten(doc,holder,call,code,newObject){const resources=holder.resources.clone(),objects=resources.lookupMaybe(N('XObject'),PDFDict)?.clone()||doc.context.obj({});let key=call.name;if(newObject){let n=1;do{key=N('PDFCOImage'+n++);}while(objects.has(key));objects.set(key,newObject);resources.set(N('XObject'),objects);}return{text:holder.text.slice(0,call.start)+code(key)+holder.text.slice(call.end),resources};}
function cloneForm(doc,holder,result){const dict=holder.stream.dict.clone();for(const k of['Length','Filter','DecodeParms'])dict.delete(N(k));dict.set(N('Resources'),result.resources);return doc.context.register(PDFRawStream.of(dict,bytesOf(result.text)));}
async function finish(s,item,code,ref){let holder=item.holder,result=rewritten(s.doc,holder,item.call,code,ref);while(holder.parent){const replacement=cloneForm(s.doc,holder,result),call=holder.call;holder=holder.parent;result=rewritten(s.doc,holder,call,key=>key+' Do',replacement);}s.page.node.set(N('Resources'),result.resources);s.page.node.set(N('Contents'),s.doc.context.register(s.doc.context.flateStream(bytesOf(result.text))));await s.doc.flush();collectUnreachable(s.doc);const bytes=await s.doc.save({updateFieldAppearances:false});if(bytes.length>limit)throw new Error('El PDF modificado supera 256 MB.');return bytes;}
export function imageTransform(item,rect,angle,geometry){
  if(!rect||!Object.values(rect).every(Number.isFinite)||rect.x<0||rect.y<0||rect.w<.003||rect.h<.003||rect.x+rect.w>1.001||rect.y+rect.h>1.001||!Number.isFinite(angle)||Math.abs(angle)>360)throw new Error('La imagen debe quedar dentro de la página y tener tamaño válido.');
  const old=item.rect;if(old.w<1e-6||old.h<1e-6)throw new Error('El tamaño original no es válido.');
  const a=viewToPdf(0,0,geometry.crop.width,geometry.crop.height,geometry.rotation,geometry.crop),b=viewToPdf(1,0,geometry.crop.width,geometry.crop.height,geometry.rotation,geometry.crop),c=viewToPdf(0,1,geometry.crop.width,geometry.crop.height,geometry.rotation,geometry.crop),view=[b[0]-a[0],b[1]-a[1],c[0]-a[0],c[1]-a[1],...a];
  const sx=rect.w/old.w,sy=rect.h/old.h,scale=[sx,0,0,sy,rect.x-old.x*sx,rect.y-old.y*sy],r=angle*Math.PI/180,cos=Math.cos(r),sin=Math.sin(r),cx=rect.x+rect.w/2,cy=rect.y+rect.h/2,rotate=[cos,sin*geometry.width/geometry.height,-sin*geometry.height/geometry.width,cos,0,0];rotate[4]=cx-rotate[0]*cx-rotate[2]*cy;rotate[5]=cy-rotate[1]*cx-rotate[3]*cy;
  const delta=multiply(multiply(view,multiply(rotate,scale)),inverseMatrix(view)),world=multiply(delta,item.matrix),polygon=[[0,0],[1,0],[1,1],[0,1]].map(p=>point(world,...p));
  if(polygon.some(p=>{const v=pdfToView(...p,geometry);return v[0]<-.001||v[1]<-.001||v[0]>1.001||v[1]>1.001;}))throw new Error('El giro deja parte de la imagen fuera de la página.');
  for(const clip of item.clips||[]){const inv=inverseMatrix(clip.matrix);if(polygon.some(p=>{const q=point(inv,...p);return q[0]<clip.bbox[0]-.01||q[1]<clip.bbox[1]-.01||q[0]>clip.bbox[2]+.01||q[1]>clip.bbox[3]+.01;}))throw new Error('La imagen sale del área de su grupo. Reduce el movimiento o tamaño.');}
  return multiply(inverseMatrix(item.matrix),world);
}
export async function changeOriginalImage(bytes,request){
  const s=await source(bytes,request.page);if(s.source!==request.source)throw new Error('El documento cambió. Vuelve a seleccionar la imagen.');const item=s.items.find(i=>i.id===request.id);if(!item)throw new Error('La imagen seleccionada ya no existe.');
  if(request.action==='transform'){if(!item.editable)throw new Error(item.reason);const m=imageTransform(item,request.rect,request.angle||0,pageGeometry(s.page));return finish(s,item,key=>`q\n${m.map(pdfNumeric).join(' ')} cm\n${key} Do\nQ`);}
  if(request.action==='delete'){if(!item.replaceable)throw new Error(item.reason);return finish(s,item,()=>'',null);}
  if(request.action!=='replace'||!item.replaceable)throw new Error(item.reason||'Acción de imagen no compatible.');
  const data=request.image;if(!(data instanceof Uint8Array)||!data.length||data.length>8*1024*1024)throw new Error('El reemplazo admite PNG/JPEG de hasta 8 MB.');
  let binary='';for(let i=0;i<data.length;i+=32768)binary+=String.fromCharCode(...data.subarray(i,i+32768));imageData('data:image/'+(data[0]===137?'png':'jpeg')+';base64,'+btoa(binary));
  let embedded;try{embedded=data[0]===137?await s.doc.embedPng(data):await s.doc.embedJpg(data);}catch{throw new Error('El archivo no es una imagen PNG/JPEG compatible.');}
  if(embedded.width>8192||embedded.height>8192||embedded.width*embedded.height>16000000)throw new Error('La imagen supera 16 millones de píxeles u 8192 por lado.');
  const w=Math.hypot(item.matrix[0],item.matrix[1]),h=Math.hypot(item.matrix[2],item.matrix[3]),ratio=embedded.width/embedded.height,box=w/h;let sx=1,sy=1;if(request.fit!=='stretch'){if(ratio>box)sy=box/ratio;else sx=ratio/box;}
  return finish(s,item,key=>`q\n${[sx,0,0,sy,(1-sx)/2,(1-sy)/2].map(pdfNumeric).join(' ')} cm\n${key} Do\nQ`,embedded.ref);
}
export async function originalImageDocument(bytes,request){
  const s=await source(bytes,request.page);if(s.source!==request.source)throw new Error('El documento cambió. Selecciona la imagen otra vez.');const image=s.items.find(i=>i.id===request.id);if(!image?.extractable)throw new Error('La imagen no se puede extraer o supera los límites de resolución.');
  const temp=await PDFDocument.create(),copy=PDFObjectCopier.for(s.doc.context,temp.context),ref=temp.context.register(copy.copy(image.object)),p=temp.addPage([image.width,image.height]);p.node.set(N('Resources'),temp.context.obj({XObject:{Original:ref}}));p.node.set(N('Contents'),temp.context.register(temp.context.flateStream(`q ${image.width} 0 0 ${image.height} 0 0 cm /Original Do Q`)));return{bytes:await temp.save(),width:image.width,height:image.height};
}
