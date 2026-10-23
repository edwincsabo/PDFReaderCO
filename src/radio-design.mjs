import {PDFRadioGroup,PDFName,PDFString,PDFHexString,PDFDict,PDFArray,PDFNumber,PDFPage,rgb,degrees,pushGraphicsState,popGraphicsState,concatTransformationMatrix}from'pdf-lib';
import {pageGeometry,viewToPdf,pdfToView}from'./pdf-coordinates.mjs';
import {safeText}from'./annotation-drawing.mjs';
import {readFieldRule,writeFieldRule}from'./field-rules.mjs';
const N=PDFName.of,key=N('PDFReaderCOForm'),labelsKey=N('PDFReaderCORadioLabels'),labelKey=N('PDFReaderCORadioLabel');
const text=value=>value instanceof PDFString||value instanceof PDFHexString?value.decodeText():'';
const forbidden=dict=>['A','AA','IRT','Popup','OC','RC'].some(name=>dict.has(N(name)))||((dict.lookupMaybe(N('F'),PDFNumber)?.asNumber()||0)&(1|2|32|64|128|256|512))!==0;
function owner(doc,dict){const ref=doc.context.getObjectRef(dict),pages=doc.getPages().filter(page=>page.node.Annots()?.asArray().includes(ref));return pages.length===1?pages[0]:null;}
function rectangle(rect,g){const a=viewToPdf(rect.x,rect.y,g.width,g.height,g.rotation,g.crop),b=viewToPdf(rect.x+rect.w,rect.y+rect.h,g.width,g.height,g.rotation,g.crop);return{x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),width:Math.abs(b[0]-a[0]),height:Math.abs(b[1]-a[1])};}
function normalized(raw,g){const a=pdfToView(raw.x,raw.y,g),b=pdfToView(raw.x+raw.width,raw.y+raw.height,g);return{x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),w:Math.abs(b[0]-a[0]),h:Math.abs(b[1]-a[1])};}
function labelRect(dict){const values=dict.lookup(N('Rect'),PDFArray).asArray().map(v=>dict.context.lookup(v).asNumber());return{x:values[0],y:values[1],width:values[2]-values[0],height:values[3]-values[1]};}
function snapshot(doc,field){
  try{
    if(!(field instanceof PDFRadioGroup)||field.acroField.getParent()||field.isReadOnly()||forbidden(field.acroField.dict))return null;
    const data=JSON.parse(text(field.acroField.dict.get(key))),widgets=field.acroField.getWidgets(),options=field.getOptions(),refs=field.acroField.dict.lookup(labelsKey,PDFArray).asArray();
    if(data.version!==2||typeof data.id!=='string'||data.id.length>100||!Array.isArray(data.optionIds)||widgets.length<2||widgets.length>50||widgets.length!==data.optionIds.length||refs.length!==widgets.length||options.length!==widgets.length||new Set(options).size!==options.length||new Set(data.optionIds).size!==widgets.length||data.optionIds.some(id=>typeof id!=='string'||!id||id.length>100)||options.some(option=>!option.trim()||option.length>100||/[\r\n\x00-\x1f]/.test(option)))return null;
    const entries=widgets.map((widget,i)=>{
      const label=doc.context.lookup(refs[i],PDFDict),page=owner(doc,widget.dict),labelPage=owner(doc,label),g=page&&pageGeometry(page),on=widget.getOnValue();
      if(!page||page!==labelPage||widget.P()!==page.ref||widget.dict.get(N('Parent'))!==field.ref||forbidden(widget.dict)||forbidden(label)||label.get(N('Subtype'))?.toString()!=='/FreeText'||text(label.get(labelKey))!==data.optionIds[i]||text(label.get(N('Contents')))!==options[i]||!label.has(N('AP'))||!on)throw new Error('Opción no compatible.');
      const a=normalized(widget.getRectangle(),g),b=normalized(labelRect(label),g),rect={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.max(a.x+a.w,b.x+b.w)-Math.min(a.x,b.x),h:Math.max(a.y+a.h,b.y+b.h)-Math.min(a.y,b.y)},da=text(label.get(N('DA'))),fontSize=Number(da.match(/([\d.]+)\s+Tf/)?.[1])*g.unit;
      if(!Object.values(rect).every(Number.isFinite)||!Number.isFinite(fontSize)||fontSize<1||fontSize>200)throw new Error('Geometría no compatible.');
      const orientation=label.lookupMaybe(N('Rotate'),PDFNumber)?.asNumber()??g.rotation;if(![0,90,180,270].includes(orientation))throw new Error('Orientación no compatible.');
      return{id:data.optionIds[i],widget,label,labelRef:refs[i],page,g,rect,value:options[i],on,fontSize,orientation};
    });
    if(new Set(entries.map(entry=>entry.on.toString())).size!==widgets.length)return null;
    const targets=new Set(entries.flatMap(entry=>[entry.widget.dict,entry.label]));
    if(doc.getPages().some(page=>page.node.Annots()?.asArray().some(ref=>{const dict=doc.context.lookup(ref);return dict instanceof PDFDict&&dict.has(N('IRT'))&&targets.has(doc.context.lookup(dict.get(N('IRT'))));})))return null;
    const dv=field.acroField.dict.get(N('DV')),defaultValue=entries.find(entry=>entry.on===dv)?.value||'';
    return{data,entries,defaultValue};
  }catch{return null;}
}
export function describeRadioDesigns(doc,field){
  const state=snapshot(doc,field);if(!state)return[];
  return state.entries.map(entry=>({...entry.rect,id:entry.id,groupId:state.data.id,name:field.getName(),page:doc.getPages().indexOf(entry.page)+1,kind:'radio',required:field.isRequired(),defaultValue:state.defaultValue,options:state.entries.map(e=>e.value),optionValue:entry.value,multiline:false,fontSize:entry.fontSize,...readFieldRule(field,'radio')}));
}
function validateRect(rect,g,label,font,size){
  if(!rect||!['x','y','w','h'].every(k=>Number.isFinite(rect[k]))||rect.x<0||rect.y<0||rect.x+rect.w>1.000001||rect.y+rect.h>1.000001||rect.h*g.height<Math.max(16,size*1.25)||rect.w*g.width<22+font.widthOfTextAtSize(label,size))throw new Error('El área debe quedar dentro de la página y dejar espacio para el botón y su etiqueta. Amplía el ancho o alto, o reduce el tamaño de letra.');
}
function validValue(value,font){if(typeof value!=='string'||!value.trim()||value.length>100||/[\r\n\x00-\x1f]/.test(value))throw new Error('La opción debe tener entre 1 y 100 caracteres de una línea.');return safeText(value.trim(),font);}
function basis(entry,rect){const current=pageGeometry(entry.page),rotation=entry.orientation??current.rotation,g={...current,rotation,width:(rotation%180?current.crop.height:current.crop.width)*current.unit,height:(rotation%180?current.crop.width:current.crop.height)*current.unit};return{g,rect:normalized(rectangle(rect,current),g)};}
function paintLabel(doc,entry,rect,font,size,g){
  const r=rectangle(rect,g),scratch=PDFPage.create(doc);scratch.setSize(r.width,r.height);scratch.pushOperators(pushGraphicsState(),concatTransformationMatrix(1,0,0,1,-r.x,-r.y));
  const p=viewToPdf(rect.x,rect.y+rect.h/2+size*.35/g.height,g.width,g.height,g.rotation,g.crop);scratch.drawText(entry.value,{x:p[0],y:p[1],size:size/g.unit,font,color:rgb(.12,.17,.22),rotate:degrees(g.rotation)});scratch.pushOperators(popGraphicsState());
  const parts=scratch.node.Contents().asArray().map(ref=>doc.context.lookup(ref).getUnencodedContents()),length=parts.reduce((n,p)=>n+p.length,0),bytes=new Uint8Array(length);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
  const appearance=doc.context.register(doc.context.flateStream(bytes,{Type:'XObject',Subtype:'Form',BBox:[0,0,r.width,r.height],Matrix:[1,0,0,1,0,0],Resources:scratch.node.Resources()}));
  const alias=scratch.node.Resources().lookup(N('Font'),PDFDict).entries().find(([,ref])=>ref===font.ref)?.[0];
  const label=entry.label;label.set(N('Rect'),doc.context.obj([r.x,r.y,r.x+r.width,r.y+r.height]));label.set(N('Contents'),PDFHexString.fromText(entry.value));label.set(N('DA'),PDFString.of(`${alias} ${size/g.unit} Tf 0.12 0.17 0.22 rg`));label.set(N('AP'),doc.context.obj({N:appearance}));label.set(N('Rotate'),PDFNumber.of(g.rotation));
}
function place(doc,entry,rect,font,size){
  const layout=basis(entry,rect),g=layout.g,b=layout.rect;validateRect(b,g,entry.value,font,size);const circle=16,button={x:b.x,y:b.y+(b.h-circle/g.height)/2,w:circle/g.width,h:circle/g.height},caption={x:b.x+22/g.width,y:b.y,w:b.w-22/g.width,h:b.h},r=rectangle(button,g);
  entry.widget.setRectangle(r);entry.widget.getOrCreateAppearanceCharacteristics().setRotation(g.rotation);entry.widget.getOrCreateBorderStyle().setWidth(1/g.unit);paintLabel(doc,entry,caption,font,size,g);entry.rect=rect;
}
function add(doc,field,data,page,rect,value,font,size){
  const g=pageGeometry(page);validateRect(rect,g,value,font,size);field.addOptionToPage(value,page,{x:0,y:0,width:16,height:16,borderWidth:1/g.unit,borderColor:rgb(.12,.38,.4),backgroundColor:rgb(.96,.99,1)});
  const widget=field.acroField.getWidgets().at(-1),id=crypto.randomUUID(),label=doc.context.obj({Type:'Annot',Subtype:'FreeText',Rect:[0,0,1,1],F:4,Border:[0,0,0],PDFReaderCORadioLabel:PDFHexString.fromText(id)}),labelRef=doc.context.register(label);
  page.node.addAnnot(labelRef);const refs=field.acroField.dict.lookupMaybe(labelsKey,PDFArray)?.asArray()||[];field.acroField.dict.set(labelsKey,doc.context.obj([...refs,labelRef]));data.optionIds.push(id);const entry={id,widget,label,labelRef,page,value};place(doc,entry,rect,font,size);return entry;
}
const store=(field,data)=>field.acroField.dict.set(key,PDFHexString.fromText(JSON.stringify(data)));
export function duplicateRadioDesign(doc,id,offsets,font){
  const form=doc.getForm(),source=form.getFields().map(field=>({field,state:snapshot(doc,field)})).find(s=>s.state?.entries.some(e=>e.id===id));
  if(!source)throw new Error('El grupo ya no es compatible.');
  const {field:original,state}=source,total=form.getFields().reduce((n,f)=>n+f.acroField.getWidgets().length,0);
  if(total+state.entries.length>2000)throw new Error('El diseñador admite hasta 2.000 widgets.');
  let n=1,name;do{name=original.getName().slice(0,85)+'_copia_'+n++;}while(form.getFields().some(f=>f.getName()===name||f.getName().startsWith(name+'.')||name.startsWith(f.getName()+'.')));
  const field=form.createRadioGroup(name),data={version:2,id:crypto.randomUUID(),optionIds:[]};field.enableMutualExclusion();field.disableOffToggling();original.isRequired()?field.enableRequired():field.disableRequired();
  const entries=state.entries.map(e=>{const page=doc.getPages().indexOf(e.page)+1,offset=offsets.get(page);return add(doc,field,data,e.page,{...e.rect,x:e.rect.x+offset.dx,y:e.rect.y+offset.dy},e.value,font,e.fontSize);});
  store(field,data);selection(field,entries,entries.find(e=>e.value===original.getSelected())?.id,entries.find(e=>e.value===state.defaultValue)?.id);field.defaultUpdateAppearances(font);writeFieldRule(field,readFieldRule(original,'radio').rule,'radio');
  return{groupId:data.id,ids:entries.map(e=>e.id)};
}
function reindex(field){for(const [i,widget]of field.acroField.getWidgets().entries()){const normal=widget.getAppearances().normal,on=widget.getOnValue(),ref=normal.get(on);normal.delete(on);normal.set(N(String(i)),ref);}}
function selection(field,entries,currentId,defaultId){const selected=entries.find(e=>e.id===currentId),initial=entries.find(e=>e.id===defaultId);selected?field.select(selected.value):field.clear();field.acroField.dict.set(N('DV'),initial?.widget.getOnValue()||N('Off'));}
export function editRadioDesign(doc,change,font){
  const form=doc.getForm(),fields=form.getFields();
  if(change.action==='create'&&change.kind==='radio'){
    if(fields.length>=1000||fields.reduce((n,f)=>n+f.acroField.getWidgets().length,0)>1998)throw new Error('Límite de 1.000 campos o 2.000 botones alcanzado.');
    if(!Number.isInteger(change.page)||change.page<1||change.page>doc.getPageCount())throw new Error('Página inválida.');
    const page=doc.getPage(change.page-1),g=pageGeometry(page),area=change.rect;if(!area||area.h*g.height<36)throw new Error('Dibuja un área de al menos 36 puntos de alto para las dos opciones iniciales.');
    let number=1;while(fields.some(f=>f.getName()==='Grupo_'+number||f.getName().startsWith('Grupo_'+number+'.')))number++;
    const field=form.createRadioGroup('Grupo_'+number),data={version:2,id:crypto.randomUUID(),optionIds:[]};field.enableMutualExclusion();field.disableOffToggling();
    const height=(area.h-4/g.height)/2,entries=[add(doc,field,data,page,{...area,h:height},'Opción 1',font,12),add(doc,field,data,page,{...area,y:area.y+height+4/g.height,h:height},'Opción 2',font,12)];store(field,data);field.acroField.dict.set(N('DV'),N('Off'));field.defaultUpdateAppearances(font);return entries[0].id;
  }
  let field,state,entry;for(const candidate of fields){const found=snapshot(doc,candidate);if(!found)continue;const option=found.entries.find(e=>e.id===change.id);if(option){field=candidate;state=found;entry=option;break;}}
  if(!entry)return undefined;
  const currentId=state.entries.find(e=>e.value===field.getSelected())?.id,defaultId=state.entries.find(e=>e.value===state.defaultValue)?.id;
  if(change.action==='delete'){
    for(const e of state.entries){e.page.node.removeAnnot(doc.context.getObjectRef(e.widget.dict));e.page.node.removeAnnot(e.labelRef);}form.removeField(field);return '';
  }
  if(change.action==='delete-option'){
    if(state.entries.length<=2)throw new Error('El grupo debe conservar al menos dos opciones. Puedes eliminar el grupo completo.');const index=state.entries.indexOf(entry);entry.page.node.removeAnnot(doc.context.getObjectRef(entry.widget.dict));entry.page.node.removeAnnot(entry.labelRef);field.acroField.removeWidget(index);field.acroField.removeExportValue(index);reindex(field);state.data.optionIds.splice(index,1);const rest=state.entries.filter(e=>e!==entry);field.acroField.dict.set(labelsKey,doc.context.obj(rest.map(e=>e.labelRef)));store(field,state.data);selection(field,rest,currentId,defaultId);field.defaultUpdateAppearances(font);return rest[Math.min(index,rest.length-1)].id;
  }
  if(change.action==='add-option'){
    if(state.entries.length>=50||fields.reduce((n,f)=>n+f.acroField.getWidgets().length,0)>=2000)throw new Error('Se admiten hasta 50 opciones por grupo y 2.000 botones por documento.');if(!Number.isInteger(change.page)||change.page<1||change.page>doc.getPageCount())throw new Error('Página inválida.');
    let n=1;while(state.entries.some(e=>e.value==='Opción '+n))n++;const next=add(doc,field,state.data,doc.getPage(change.page-1),change.rect,'Opción '+n,font,entry.fontSize);store(field,state.data);selection(field,[...state.entries,next],currentId,defaultId);field.defaultUpdateAppearances(font);return next.id;
  }
  if(change.action==='geometry'){place(doc,entry,change.rect,font,entry.fontSize);field.defaultUpdateAppearances(font);return entry.id;}
  if(change.action!=='properties')throw new Error('Operación de grupo no compatible.');
  const props=change.props,name=String(props?.name||'').trim();if(!name||name.length>100||/[.\x00-\x1f]/.test(name))throw new Error('Usa un nombre de grupo de 1 a 100 caracteres, sin puntos ni saltos.');if(fields.some(f=>f.ref!==field.ref&&(f.getName()===name||f.getName().startsWith(name+'.'))))throw new Error('Ya existe un campo con ese nombre.');
  const value=validValue(props.optionValue,font);if(state.entries.some(e=>e!==entry&&e.value===value))throw new Error('Las opciones del grupo deben tener nombres diferentes.');if(!Number.isFinite(props.fontSize)||props.fontSize<6||props.fontSize>48)throw new Error('El tamaño de letra debe estar entre 6 y 48 puntos.');entry.value=value;
  const defaultValue=typeof props.defaultValue==='string'?props.defaultValue.trim():props.defaultValue,initial=state.entries.find(e=>e.value===defaultValue);if(defaultValue!==''&&!initial)throw new Error('La selección inicial debe pertenecer al grupo.');
  for(const e of state.entries){const layout=basis(e,e.rect);validateRect(layout.rect,layout.g,e.value,font,props.fontSize);}
  field.acroField.setPartialName(name);props.required?field.enableRequired():field.disableRequired();field.acroField.setOpt(state.entries.map(e=>PDFHexString.fromText(e.value)));for(const e of state.entries)place(doc,e,e.rect,font,props.fontSize);selection(field,state.entries,initial?.id!==defaultId?initial?.id:currentId,initial?.id);field.defaultUpdateAppearances(font);if(Object.prototype.hasOwnProperty.call(props,'rule'))writeFieldRule(field,props.rule,'radio');return entry.id;
}
