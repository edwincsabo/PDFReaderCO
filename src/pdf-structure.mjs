import {PDFDocument,PDFDict,PDFArray,PDFName,PDFRef,PDFString,PDFHexString,PDFNumber} from 'pdf-lib';
import {collectUnreachable} from './pdf-garbage.mjs';
export const N=PDFName.of;
export const sourceHash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export async function structureDocument(bytes){
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>256*1024*1024)throw new Error('Documento inválido o mayor de 256 MB.');
  try{return await PDFDocument.load(bytes.slice(),{updateMetadata:false});}catch(error){if(/encrypt/i.test(String(error)))throw new Error('Los PDF cifrados se conservan en modo lectura.');throw new Error('No se pudo leer la estructura del PDF.');}
}
export const resolve=(doc,value)=>value?doc.context.lookup(value):undefined;
export const textOf=value=>value instanceof PDFString||value instanceof PDFHexString?value.decodeText():value instanceof PDFName?value.decodeText():'';
export function namePairs(doc,root,max=5000){
  const pairs=[],seen=new Set();let nodes=0;
  function walk(value,depth){const tree=resolve(doc,value);if(!(tree instanceof PDFDict)||seen.has(tree)||depth>32||++nodes>5000)throw new Error('El árbol de nombres del PDF está incompleto o es demasiado complejo.');seen.add(tree);
    const names=tree.lookupMaybe(N('Names'),PDFArray),kids=tree.lookupMaybe(N('Kids'),PDFArray);if(names&&kids)throw new Error('El árbol de nombres contiene una estructura ambigua.');
    if(names){if(names.size()%2)throw new Error('El árbol de nombres está incompleto.');for(let i=0;i<names.size();i+=2){const key=names.get(i);if(!(key instanceof PDFString||key instanceof PDFHexString)||pairs.length>=max)throw new Error('Hay demasiadas entradas o nombres no compatibles.');pairs.push({key,value:names.get(i+1),array:names,index:i+1});}}
    if(kids)for(const child of kids.asArray())walk(child,depth+1);
  }
  if(root)walk(root,0);return pairs;
}
export async function saveStructure(doc){await doc.flush();collectUnreachable(doc);const bytes=await doc.save({updateFieldAppearances:false});if(bytes.length>256*1024*1024)throw new Error('El PDF resultante supera los 256 MB.');return bytes;}

export function outlineSnapshot(doc){
  const root=resolve(doc,doc.catalog.get(N('Outlines'))),entries=new Map(),seen=new Set(),pages=doc.getPages(),pageRefs=new Map(pages.map((p,i)=>[p.ref.toString(),i+1]));let count=0;
  let destinations=null;
  function destination(value,visited=new Set()){
    if(!value||visited.has(value)||visited.size>32)return null;visited.add(value);value=resolve(doc,value);
    if(value instanceof PDFArray){const target=value.get(0);if(target instanceof PDFRef)return pageRefs.get(target.toString())||null;if(target instanceof PDFNumber){const n=target.asNumber();return Number.isInteger(n)&&n>=0&&n<pages.length?n+1:null;}return pages.findIndex(p=>p.node===target)+1||null;}
    if(value instanceof PDFDict)return destination(value.get(N('D')),visited);
    const name=textOf(value);if(!name)return null;
    const legacy=doc.catalog.lookupMaybe(N('Dests'),PDFDict)?.get(N(name));if(legacy)return destination(legacy,visited);
    if(destinations===null){const names=doc.catalog.lookupMaybe(N('Names'),PDFDict);destinations=new Map(namePairs(doc,names?.get(N('Dests'))).map(pair=>[textOf(pair.key),pair.value]));}
    return destination(destinations.get(name),visited);
  }
  function chain(value,depth){const out=[];if(depth>32)throw new Error('El índice supera los 32 niveles de edición.');while(value){const dict=resolve(doc,value);if(!(dict instanceof PDFDict)||seen.has(dict)||++count>1000)throw new Error('El índice contiene referencias repetidas, incompletas o más de 1.000 entradas.');seen.add(dict);const id=value instanceof PDFRef?value.toString():'direct-'+count,title=textOf(dict.get(N('Title'))),action=dict.lookupMaybe(N('A'),PDFDict);let page=null,kind='unresolved';
      if(dict.has(N('Dest'))){page=destination(dict.get(N('Dest')));kind=page?'page':'unresolved';}
      else if(action){if(action.get(N('S'))?.toString()==='/GoTo'){page=destination(action.get(N('D')));kind=page?'page':'unresolved';}else kind='external';}
      const children=chain(dict.get(N('First')),depth+1),item={id,title,page,kind,expanded:(dict.lookupMaybe(N('Count'),PDFNumber)?.asNumber()??0)>=0,children};entries.set(id,{dict,ref:value instanceof PDFRef?value:null,item});out.push(item);value=dict.get(N('Next'));
    }return out;}
  if(root&&!(root instanceof PDFDict))throw new Error('El índice del PDF no tiene una estructura compatible.');
  return {items:root?chain(root.get(N('First')),0):[],entries,root,rootRef:doc.catalog.get(N('Outlines')) instanceof PDFRef?doc.catalog.get(N('Outlines')):null};
}
export async function readPdfOutline(bytes){const doc=await structureDocument(bytes),snapshot=outlineSnapshot(doc);return {source:await sourceHash(bytes),pages:doc.getPageCount(),items:snapshot.items};}

export async function writePdfOutline(bytes,plan){
  if(!plan||plan.source!==await sourceHash(bytes))throw new Error('El documento cambió. Abre de nuevo el editor del índice.');
  const doc=await structureDocument(bytes),before=outlineSnapshot(doc),used=new Set(),objects=new Set();let count=0;
  function validate(items,depth){if(!Array.isArray(items)||depth>32)throw new Error('El índice admite hasta 32 niveles.');for(const item of items){
    if(!item||typeof item!=='object'||objects.has(item)||typeof item.id!=='string'||!item.id||item.id.length>200||used.has(item.id)||++count>1000)throw new Error('Entradas duplicadas, circulares o límite de 1.000 entradas excedido.');objects.add(item);used.add(item.id);const original=before.entries.get(item.id)?.item;
    if(typeof item.title!=='string'||item.title!==original?.title&&(!item.title.trim()||item.title.length>500||/[\u0000-\u001f\u007f]/.test(item.title)))throw new Error('El nombre de una entrada debe tener entre 1 y 500 caracteres de una sola línea.');
    if(!original||item.retarget||item.page!==original.page){if(!Number.isInteger(item.page)||item.page<1||item.page>doc.getPageCount())throw new Error('Selecciona una página válida para la entrada.');}
    if(typeof item.expanded!=='boolean')throw new Error('Estado de entrada inválido.');validate(item.children,depth+1);
  }}validate(plan.items,0);
  if(JSON.stringify(outlineComparable(plan.items))===JSON.stringify(outlineComparable(before.items)))return bytes;
  if(!plan.items.length){doc.catalog.delete(N('Outlines'));if(doc.catalog.get(N('PageMode'))?.toString()==='/UseOutlines')doc.catalog.set(N('PageMode'),N('UseNone'));return saveStructure(doc);}
  const root=before.root?.clone()||doc.context.obj({Type:'Outlines'}),rootRef=before.rootRef||doc.context.nextRef(),pages=doc.getPages();doc.context.assign(rootRef,root);
  const visible=items=>items.reduce((n,item)=>n+1+(item.expanded?visible(item.children):0),0);
  function build(items,parent){const refs=items.map(item=>{const original=before.entries.get(item.id),dict=original?.dict.clone()||doc.context.obj({});for(const key of ['Parent','Prev','Next','First','Last','Count'])dict.delete(N(key));dict.set(N('Title'),PDFHexString.fromText(item.title));dict.set(N('Parent'),parent);
      if(!original||item.retarget||item.page!==original.item.page){dict.delete(N('A'));dict.set(N('Dest'),doc.context.obj([pages[item.page-1].ref,N('Fit')]));}
      return {item,dict,ref:original?.ref||doc.context.nextRef()};});
    for(let i=0;i<refs.length;i++){const {item,dict,ref}=refs[i];if(i)dict.set(N('Prev'),refs[i-1].ref);if(i+1<refs.length)dict.set(N('Next'),refs[i+1].ref);if(item.children.length){const children=build(item.children,ref);dict.set(N('First'),children[0].ref);dict.set(N('Last'),children.at(-1).ref);dict.set(N('Count'),PDFNumber.of(visible(item.children)*(item.expanded?1:-1)));}doc.context.assign(ref,dict);}return refs;
  }
  const top=build(plan.items,rootRef);root.set(N('First'),top[0].ref);root.set(N('Last'),top.at(-1).ref);root.set(N('Count'),PDFNumber.of(visible(plan.items)));doc.catalog.set(N('Outlines'),rootRef);return saveStructure(doc);
}

export function updateOutlineTree(items,id,patch){return items.map(item=>item.id===id?{...item,...patch}:({...item,children:updateOutlineTree(item.children,id,patch)}));}
export function outlineComparable(items){return items.map(({id,title,page,expanded,retarget,children})=>({id,title,page,expanded,retarget:!!retarget,children:outlineComparable(children)}));}
export function removeOutlineNode(items,id){return items.filter(item=>item.id!==id).map(item=>({...item,children:removeOutlineNode(item.children,id)}));}
export function moveOutlineNode(items,id,action){
  const tree=structuredClone(items);let found=null;function find(list,parent=null,grand=null){for(let i=0;i<list.length;i++){if(list[i].id===id){found={list,index:i,parent,grand};return;}find(list[i].children,list[i],list);if(found)return;}}find(tree);if(!found)return tree;const {list,index,parent,grand}=found,item=list[index];
  if(action==='up'&&index>0)[list[index-1],list[index]]=[item,list[index-1]];
  if(action==='down'&&index+1<list.length)[list[index],list[index+1]]=[list[index+1],item];
  if(action==='indent'&&index>0){const owner=list[index-1];list.splice(index,1);owner.children.push(item);owner.expanded=true;}
  if(action==='outdent'&&parent){list.splice(index,1);grand.splice(grand.findIndex(n=>n.id===parent.id)+1,0,item);}
  return tree;
}
