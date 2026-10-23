import{PDFName,PDFDict,PDFArray,PDFRawStream,decodePDFRawStream}from'pdf-lib';
import{contentTokens}from'./original-groups.mjs';
import{inspectOcrSource}from'./ocr-engine.mjs';
import{collectUnreachable}from'./pdf-garbage.mjs';
const N=PDFName.of,decode=s=>{const b=decodePDFRawStream(s).decode();if(b.length>16*1024*1024)throw new Error('El contenido supera el límite de análisis OCR.');let text='';for(let i=0;i<b.length;i+=16384)text+=String.fromCharCode(...b.subarray(i,i+16384));return text;},name=t=>N(t.slice(1).replace(/#([a-f0-9]{2})/gi,(_,h)=>String.fromCharCode(parseInt(h,16))));
export async function removeExternalOcr(bytes,request){
  const{doc,source}=await inspectOcrSource(bytes);if(request?.source!==source||!Number.isInteger(request.page)||request.page<1||request.page>doc.getPageCount())throw new Error('El documento o la página cambiaron.');const page=doc.getPage(request.page-1);if(page.node.has(N('PDFReaderCOOCR')))throw new Error('Retira las capas propias desde su listado antes de sustituir texto invisible externo.');
  const active=new Set();let objects=0,budget=0;
  function rewrite(text,originalResources,initialMode=0,depth=0){
    budget+=text.length;if(depth>8||budget>32*1024*1024||++objects>2000)throw new Error('La estructura supera los límites de sustitución de OCR.');
    const tokens=contentTokens(text),resources=originalResources?.clone(doc.context)||doc.context.obj({}),originalX=resources.lookup(N('XObject')),xobjects=originalX instanceof PDFDict?originalX.clone(doc.context):doc.context.obj({});resources.set(N('XObject'),xobjects);
    let args=[],nesting=0,mode=initialMode,bt=null,count=0,stack=[],serial=0;const changes=[];
    for(const token of tokens){
      if(token.kind==='delimiter'){nesting+=['[','<<'].includes(token.value)?1:-1;if(nesting<0)throw new Error('Contenido PDF incompleto.');args.push(token);continue;}
      if(nesting||token.kind!=='word'||/^[-+.]?\d/.test(token.value)||['true','false','null'].includes(token.value)){args.push(token);continue;}
      const op=token.value;
      if(op==='q')stack.push(mode);else if(op==='Q'){if(!stack.length)throw new Error('Estado gráfico incompleto.');mode=stack.pop();}
      else if(op==='Tr'){if(args.length!==1||!Number.isInteger(Number(args[0].value))||Number(args[0].value)<0||Number(args[0].value)>7)throw new Error('Modo de texto no compatible.');mode=Number(args[0].value);}
      else if(op==='BT'){if(bt)throw new Error('Objeto de texto anidado.');bt={invisible:[],visible:false};}
      else if(op==='ET'){if(!bt)throw new Error('Objeto de texto incompleto.');if(bt.invisible.length&&bt.visible)throw new Error('Un mismo objeto mezcla texto visible e invisible. Se conserva sin sustituir.');if(bt.invisible.length){changes.push(...bt.invisible);count+=bt.invisible.length;}bt=null;}
      else if(['Tj','TJ',"'",'"'].includes(op)){if(!bt)throw new Error('Texto fuera de un objeto compatible.');if(mode===3){if(op!== 'Tj'&&op!=='TJ')throw new Error('El texto invisible utiliza avances especiales. Se conserva sin sustituir.');bt.invisible.push({start:args[0]?.start??token.start,end:token.end,value:''});}else bt.visible=true;}
      else if(op==='Do'){
        if(args.length!==1||args[0].kind!=='name')throw new Error('Referencia de objeto no compatible.');const key=name(args[0].value),ref=xobjects.get(key),form=ref&&doc.context.lookup(ref);
        if(form instanceof PDFRawStream&&form.dict.get(N('Subtype'))===N('Form')){if(active.has(form))throw new Error('Grupo cíclico no compatible.');active.add(form);const child=rewrite(decode(form),form.dict.lookup(N('Resources'))||originalResources,mode,depth+1);active.delete(form);if(child.count){const dict=form.dict.clone(doc.context);dict.set(N('Resources'),child.resources);dict.delete(N('Filter'));dict.delete(N('DecodeParms'));dict.delete(N('Length'));const newForm=doc.context.flateStream(Uint8Array.from(child.text,c=>c.charCodeAt(0)));for(const[k,v]of dict.entries())newForm.dict.set(k,v);let newName;do{newName=N('PDFCOCleanOCR'+(++serial));}while(xobjects.has(newName));xobjects.set(newName,doc.context.register(newForm));changes.push({start:args[0].start,end:args[0].end,value:newName.toString()});count+=child.count;}}
      }
      args=[];
    }
    if(bt||stack.length||nesting)throw new Error('Contenido PDF incompleto.');if(count&&tokens.some(t=>t.kind==='name'&&['/ActualText','/OC'].includes(t.value)))throw new Error('La capa contiene texto alternativo o contenido opcional. Se conserva sin sustituir.');
    for(const edit of changes.sort((a,b)=>b.start-a.start))text=text.slice(0,edit.start)+edit.value+text.slice(edit.end);return{text,resources,count};
  }
  const raw=page.node.Contents(),streams=raw instanceof PDFArray?raw.asArray().map(ref=>doc.context.lookup(ref)):raw?[raw]:[];if(streams.some(s=>!(s instanceof PDFRawStream)))throw new Error('Contenido de página no compatible.');const result=rewrite(streams.map(decode).join('\n'),page.node.Resources());if(!result.count)throw new Error('No se encontró texto invisible externo compatible en esta página.');
  page.node.set(N('Resources'),result.resources);page.node.set(N('Contents'),doc.context.register(doc.context.flateStream(Uint8Array.from(result.text,c=>c.charCodeAt(0)))));await doc.flush();collectUnreachable(doc);return{bytes:await doc.save({updateFieldAppearances:false}),removed:result.count,page:request.page};
}
