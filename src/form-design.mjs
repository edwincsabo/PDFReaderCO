import { PDFName, PDFHexString, PDFString, PDFArray, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, rgb } from 'pdf-lib';
import { pageGeometry, viewToPdf, pdfToView } from './pdf-coordinates.mjs';
import { safeText } from './annotation-drawing.mjs';
import {editRadioDesign}from'./radio-design.mjs';
import {isCalculatedField,readFieldRule,writeFieldRule}from'./field-rules.mjs';
import {listSelection,selectList,updateListAppearance}from'./choice-list.mjs';

const key=PDFName.of('PDFReaderCOForm');
const text=object=>object instanceof PDFHexString||object instanceof PDFString?object.decodeText():'';
function kindOf(field){return field instanceof PDFTextField?'text':field instanceof PDFCheckBox?'checkbox':field instanceof PDFDropdown?'dropdown':field instanceof PDFOptionList?'list':null;}
function owned(field){
  try{const data=JSON.parse(text(field.acroField.dict.get(key)));return data.version===1&&typeof data.id==='string'&&data.id.length<100&&kindOf(field)&&field.acroField.getWidgets().length===1&&!field.acroField.getParent()&&(!field.isReadOnly()||field instanceof PDFTextField&&isCalculatedField(field))&&!['A','AA'].some(name=>field.acroField.dict.has(PDFName.of(name)))?data:null;}catch{return null;}
}
function widgetPage(doc,widget){const ref=doc.context.getObjectRef(widget.dict);return doc.getPages().findIndex(p=>p.ref===widget.P()||p.node.Annots()?.asArray().includes(ref));}
export function describeFormDesign(doc,field){
  const data=owned(field);if(!data)return undefined;
  const widget=field.acroField.getWidgets()[0];if(['A','AA'].some(name=>widget.dict.has(PDFName.of(name)))||widget.getFlags()&(1|2|32|64|128|256|512))return undefined;
  const index=widgetPage(doc,widget);if(index<0)return undefined;
  const geometry=pageGeometry(doc.getPage(index)),r=widget.getRectangle(),points=[[r.x,r.y],[r.x+r.width,r.y+r.height]].map(p=>pdfToView(...p,geometry));
  const kind=kindOf(field),dv=field.acroField.dict.lookup(PDFName.of('DV')),defaultValue=kind==='checkbox'?dv?.toString()===widget.getOnValue()?.toString():kind==='list'?(dv instanceof PDFArray?dv.asArray().map(v=>text(doc.context.lookup(v))):dv?[text(dv)]:[]):text(dv);
  const da=field.acroField.getDefaultAppearance()||'',fontSize=kind==='checkbox'?12:Number(da.match(/([\d.]+)\s+Tf/)?.[1]||12)*geometry.unit;
  return {id:data.id,name:field.getName(),page:index+1,kind,x:Math.min(...points.map(p=>p[0])),y:Math.min(...points.map(p=>p[1])),w:Math.abs(points[1][0]-points[0][0]),h:Math.abs(points[1][1]-points[0][1]),required:field.isRequired(),defaultValue,options:['dropdown','list'].includes(kind)?field.getOptions():[],multiline:kind==='text'&&field.isMultiline(),...(kind==='list'?{multiple:field.isMultiselect()}:{}),fontSize,...readFieldRule(field,kind)};
}
function validateRect(rect,geometry){
  if(!rect||!['x','y','w','h'].every(k=>Number.isFinite(rect[k]))||rect.x<0||rect.y<0||rect.w*geometry.width<12||rect.h*geometry.height<12||rect.x+rect.w>1.000001||rect.y+rect.h>1.000001)throw new Error('Dibuja un campo de al menos 12 puntos de ancho y alto dentro de la página.');
}
function place(doc,field,rect){
  const widget=field.acroField.getWidgets()[0],index=widgetPage(doc,widget),geometry=pageGeometry(doc.getPage(index));validateRect(rect,geometry);
  const a=viewToPdf(rect.x,rect.y,geometry.width,geometry.height,geometry.rotation,geometry.crop),b=viewToPdf(rect.x+rect.w,rect.y+rect.h,geometry.width,geometry.height,geometry.rotation,geometry.crop);
  widget.setRectangle({x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),width:Math.abs(b[0]-a[0]),height:Math.abs(b[1]-a[1])});
  widget.getOrCreateAppearanceCharacteristics().setRotation(geometry.rotation);
  widget.getOrCreateBorderStyle().setWidth(1/geometry.unit);
}
function configure(doc,field,props,font,previous){
  const name=String(props.name||'').trim();
  if(!name||name.length>100||/[.\x00-\x1f]/.test(name))throw new Error('Usa un nombre de campo de 1 a 100 caracteres, sin puntos ni saltos de línea.');
  if(doc.getForm().getFields().some(f=>f.ref!==field.ref&&(f.getName()===name||f.getName().startsWith(name+'.'))))throw new Error('Ya existe un campo con ese nombre.');
  const geometry=pageGeometry(doc.getPage(widgetPage(doc,field.acroField.getWidgets()[0]))),kind=kindOf(field);
  if(!Number.isFinite(props.fontSize)||props.fontSize<6||props.fontSize>48)throw new Error('El tamaño de letra debe estar entre 6 y 48 puntos.');
  field.acroField.setPartialName(name);props.required?field.enableRequired():field.disableRequired();
  const setDefault=!previous||props.defaultValue!==previous.defaultValue;
  if(kind==='text'){
    const value=String(props.defaultValue||'');safeText(value.replace(/[\r\n]/g,''),font);if(value.length>10000)throw new Error('El valor inicial admite hasta 10.000 caracteres.');
    props.multiline?field.enableMultiline():field.disableMultiline();
    if(!props.multiline&&/[\r\n]/.test(value))throw new Error('Activa Varias líneas para un valor inicial con saltos de línea.');
    field.acroField.dict.set(PDFName.of('DV'),PDFHexString.fromText(value));if(setDefault)field.setText(value);
  }else if(kind==='checkbox'){
    if(typeof props.defaultValue!=='boolean')throw new Error('El valor inicial de la casilla debe ser marcado o desmarcado.');
    field.acroField.dict.set(PDFName.of('DV'),props.defaultValue?field.acroField.getWidgets()[0].getOnValue():PDFName.of('Off'));if(setDefault)props.defaultValue?field.check():field.uncheck();
  }else{
    if(!Array.isArray(props.options)||!props.options.length||props.options.length>100||props.options.some(v=>typeof v!=='string'||!v.trim()||v.length>200)||new Set(props.options).size!==props.options.length)throw new Error('Escribe entre 1 y 100 opciones diferentes, una por línea, de hasta 200 caracteres.');
    const options=props.options.map(v=>safeText(v,font));
    if(kind==='list'){
      if(typeof props.multiple!=='boolean')throw new Error('Elige selección única o múltiple.');
      if(options.some(v=>/[\r\n\x00-\x1f]/.test(v)))throw new Error('Cada opción debe ocupar una sola línea.');
      const defaults=listSelection(options,props.defaultValue,props.multiple),current=field.getSelected();
      const changed=!previous||defaults.length!==previous.defaultValue.length||defaults.some(v=>!previous.defaultValue.includes(v));
      field.setOptions(options);field.disableSorting();field.disableSelectOnClick();props.multiple?field.enableMultiselect():field.disableMultiselect();
      if(defaults.length)field.acroField.dict.set(PDFName.of('DV'),props.multiple?doc.context.obj(defaults.map(v=>PDFHexString.fromText(v))):PDFHexString.fromText(defaults[0]));else field.acroField.dict.delete(PDFName.of('DV'));
      const retained=options.filter(v=>current.includes(v));selectList(field,changed?defaults:props.multiple?retained:retained.slice(0,1));
    }else{
    const value=String(props.defaultValue||'');if(value&&!options.includes(value))throw new Error('El valor inicial debe pertenecer a las opciones.');
    const current=field.getSelected()[0];field.setOptions(options);field.disableEditing();field.disableMultiselect();
    field.acroField.dict.set(PDFName.of('DV'),PDFHexString.fromText(value));
    if(setDefault||!options.includes(current)){if(value)field.select(value);else field.clear();}
    }
  }
  if(kind!=='checkbox'){
    field.acroField.setDefaultAppearance(`/Helvetica ${props.fontSize/geometry.unit} Tf 0.12 0.17 0.22 rg`);
    // Widget-level DA overrides field-level DA in appearance generation.
    field.acroField.getWidgets()[0].dict.delete(PDFName.of('DA'));
  }
  if(kind==='list')updateListAppearance(field,font);else field.defaultUpdateAppearances(font);
  if(Object.prototype.hasOwnProperty.call(props,'rule'))writeFieldRule(field,props.rule,kind);
}
export function editFormDesign(doc,change,font){
  const radio=editRadioDesign(doc,change,font);if(radio!==undefined)return radio;
  const form=doc.getForm();let field,selectedId=change.id;
  if(change.action==='create'){
    if(!['text','checkbox','dropdown','list'].includes(change.kind))throw new Error('Tipo de campo no compatible.');
    if(!Number.isInteger(change.page)||change.page<1||change.page>doc.getPageCount())throw new Error('Página inválida.');
    if(form.getFields().length>=1000)throw new Error('El diseñador admite hasta 1.000 campos por documento.');
    const page=doc.getPage(change.page-1),geometry=pageGeometry(page);validateRect(change.rect,geometry);
    const prefix={text:'Texto',checkbox:'Casilla',dropdown:'Lista',list:'Seleccion'}[change.kind],names=form.getFields().map(f=>f.getName());let number=1;while(names.some(name=>name===prefix+'_'+number||name.startsWith(prefix+'_'+number+'.')))number++;
    const name=prefix+'_'+number;
    field=change.kind==='text'?form.createTextField(name):change.kind==='checkbox'?form.createCheckBox(name):change.kind==='list'?form.createOptionList(name):form.createDropdown(name);
    if(['dropdown','list'].includes(change.kind))field.setOptions(['Opción 1','Opción 2']);
    selectedId=globalThis.crypto.randomUUID();field.acroField.dict.set(key,PDFHexString.fromText(JSON.stringify({version:1,id:selectedId})));
    field.addToPage(page,{x:0,y:0,width:30,height:20,borderWidth:1/geometry.unit,borderColor:rgb(.12,.38,.4),backgroundColor:rgb(.96,.99,1),textColor:rgb(.12,.17,.22),font});
    place(doc,field,change.rect);
    configure(doc,field,{name,required:false,defaultValue:change.kind==='checkbox'?false:change.kind==='list'?[]:'',options:['Opción 1','Opción 2'],fontSize:12,multiline:false,multiple:false},font);
  }else{
    field=form.getFields().find(f=>describeFormDesign(doc,f)?.id===change.id);if(!field)throw new Error('Selecciona un campo propio compatible para diseñarlo.');
    if(change.action==='delete'){
      // pdf-lib 1.17.1 removes an appearance reference instead of the separate widget.
      // Remove the widget reference from its page before removing the canonical field.
      for(const widget of field.acroField.getWidgets()){const index=widgetPage(doc,widget);if(index>=0)doc.getPage(index).node.removeAnnot(doc.context.getObjectRef(widget.dict));}
      form.removeField(field);return '';
    }
    if(change.action==='geometry'){
      place(doc,field,change.rect);if(field instanceof PDFOptionList)updateListAppearance(field,font);else field.defaultUpdateAppearances(font);
    }else if(change.action==='properties')configure(doc,field,change.props,font,describeFormDesign(doc,field));
    else throw new Error('Operación de campo desconocida.');
  }
  return selectedId;
}
