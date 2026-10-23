import{PDFName,PDFDict,PDFArray,PDFRawStream,PDFHexString,decodePDFRawStream}from'pdf-lib';
import{inspectOcrSource}from'./ocr-engine.mjs';
import{collectUnreachable}from'./pdf-garbage.mjs';
import{contentTokens}from'./original-groups.mjs';
const N=PDFName.of,key=N('PDFReaderCOOCR');
function invisibleForm(doc,form,active=new Set(),depth=0){
  if(depth>8||active.has(form))throw new Error('La capa OCR contiene grupos no compatibles.');active.add(form);
  const tokens=contentTokens(new TextDecoder().decode(decodePDFRawStream(form).decode()));let mode=0,args=[],nesting=0;const states=[];
  for(const token of tokens){if(token.kind==='delimiter'){nesting+=['[','<<'].includes(token.value)?1:-1;args.push(token);continue;}if(nesting||token.kind!=='word'||/^[-+.]?\d/.test(token.value)){args.push(token);continue;}const op=token.value;
    if(!['q','Q','cm','BT','ET','Tf','Tr','Tm','Tj','TJ','Td','TD','T*','Tc','Tw','Tz','TL','Ts','Do'].includes(op))throw new Error('La capa propia incluye contenido que no es texto invisible compatible.');
    if(op==='q')states.push(mode);if(op==='Q'){if(!states.length)throw new Error('Estado OCR incompleto.');mode=states.pop();}if(op==='Tr')mode=Number(args[0]?.value);if(['Tj','TJ'].includes(op)&&mode!==3)throw new Error('La capa propia contiene texto visible. Se conserva sin quitar.');
    if(op==='Do'){const value=args[0]?.value,child=value&&form.dict.lookup(N('Resources'))?.lookup(N('XObject'))?.lookup(N(value.slice(1)));if(!(child instanceof PDFRawStream)||child.dict.get(N('Subtype'))!==N('Form'))throw new Error('La capa propia contiene imágenes u objetos ajenos.');invisibleForm(doc,child,active,depth+1);}args=[];
  }
  if(states.length||nesting)throw new Error('Estado OCR incompleto.');active.delete(form);
}
function ownLayers(doc,page){
  if(!page.node.has(key))return[];
  let marker;try{marker=JSON.parse(page.node.get(key).decodeText());}catch{throw new Error('El registro de OCR propio no es compatible.');}
  const raw=page.node.Contents(),refs=raw instanceof PDFArray?raw.asArray():raw?[page.node.get(N('Contents'))]:[],objects=page.node.Resources()?.lookup(N('XObject'));
  if(!(objects instanceof PDFDict))throw new Error('No se encontraron los objetos de la capa OCR.');
  const layers=[];for(const ref of refs){const stream=doc.context.lookup(ref);if(!(stream instanceof PDFRawStream))throw new Error('El contenido de la página no es compatible.');const text=new TextDecoder().decode(decodePDFRawStream(stream).decode()),match=text.match(/^q\s+([-\d.e+]+\s+){6}cm\s+(\/PDFReaderCOOCR[-\w]*)\s+Do\s+Q\s*$/);if(match){const name=N(match[2].slice(1)),form=objects.lookup(name);if(!(form instanceof PDFRawStream)||form.dict.get(N('Subtype'))!==N('Form'))throw new Error('La capa OCR no apunta a un formulario compatible.');layers.push({ref,name});}}
  const regions=marker.version===2&&marker.scope==='regions'?marker.regions:null;
  if(regions?regions.length!==layers.length:marker.version!==1||layers.length!==1)throw new Error('Las capas propias no coinciden con su registro. Se conservan sin quitar.');
  for(const layer of layers)invisibleForm(doc,objects.lookup(layer.name));
  return layers.map((layer,index)=>({...layer,index,region:regions?.[index]||null,metadata:regions?.[index]||marker,marker}));
}
export async function inspectOwnOcr(bytes){const{doc,pages,source}=await inspectOcrSource(bytes);return{source,layers:pages.flatMap(info=>{if(!info.hasOcr)return[];try{return ownLayers(doc,doc.getPage(info.page-1)).map(({index,region,metadata})=>({page:info.page,index,region,language:metadata.language,characters:metadata.characters,removable:true}));}catch(e){return[{page:info.page,index:0,removable:false,reason:e.message}];}})};}
export async function removeOwnOcr(bytes,request){
  const{doc,source}=await inspectOcrSource(bytes);if(request?.source!==source||!Number.isInteger(request.page)||request.page<1||request.page>doc.getPageCount()||!Array.isArray(request.indices)||!request.indices.length||new Set(request.indices).size!==request.indices.length)throw new Error('La selección de capas OCR cambió o no es válida.');
  const page=doc.getPage(request.page-1),layers=ownLayers(doc,page);if(request.indices.some(i=>!layers.some(l=>l.index===i)))throw new Error('La capa OCR seleccionada no existe.');
  const removing=layers.filter(l=>request.indices.includes(l.index)),raw=page.node.Contents(),refs=raw instanceof PDFArray?raw.asArray():[page.node.get(N('Contents'))],remaining=refs.filter(ref=>!removing.some(l=>l.ref.toString()===ref.toString()));
  // Reject another use of the same name rather than deleting a shared resource.
  for(const ref of remaining){const stream=doc.context.lookup(ref),text=new TextDecoder().decode(decodePDFRawStream(stream).decode());if(removing.some(l=>text.includes(l.name.toString())))throw new Error('El objeto OCR se utiliza en otro contenido de la página. Se conserva sin quitar.');}
  page.node.set(N('Contents'),doc.context.obj(remaining));const resources=page.node.Resources().clone(doc.context),objects=resources.lookup(N('XObject')).clone(doc.context);for(const l of removing)objects.delete(l.name);resources.set(N('XObject'),objects);page.node.set(N('Resources'),resources);
  const kept=layers.filter(l=>!request.indices.includes(l.index));if(!kept.length)page.node.delete(key);else page.node.set(key,PDFHexString.fromText(JSON.stringify({...layers[0].marker,regions:kept.map(l=>l.metadata)})));
  await doc.flush();collectUnreachable(doc);return{bytes:await doc.save({updateFieldAppearances:false}),removed:removing.length};
}
