import{validateTableDraft}from'./table-engine.mjs';
import { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFHexString, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup } from 'pdf-lib';
import { appendNativeAnnotations, isNativeTool, annotationPaintOrder } from './native-annotations.mjs';
import { collectUnreachable } from './pdf-garbage.mjs';
import { describeFormDesign, editFormDesign } from './form-design.mjs';
import {editFormBatch}from'./form-batch.mjs';
import {readDrafts}from'./recovery-drafts.mjs';
import {packedOcrSession}from'./ocr-session.mjs';
import {describeFields}from'./form-fields.mjs';
import {evaluateForm,validateCalculationGraph,checkFieldValue}from'./form-rules.mjs';
import {selectList,updateListAppearance}from'./choice-list.mjs';

export {parsePageRange} from './page-range.mjs';
export { viewToPdf } from './pdf-coordinates.mjs';
import { viewToPdf, pageGeometry } from './pdf-coordinates.mjs';
import { paintAnnotation, safeText } from './annotation-drawing.mjs';
import { validateMark } from './mark-schema.mjs';
export async function loadEditable(bytes) {
  try { return await PDFDocument.load(bytes.slice()); }
  catch(error) { if(/encrypt/i.test(String(error)))throw new Error('Los PDF cifrados se pueden leer con contraseña; la edición y exportación no están disponibles.');throw error; }
}
export async function getFields(bytes){return describeFields(await loadEditable(bytes));}
function applyForms(doc,values,font,calculated=new Set()) {
  if(!Object.keys(values).length)return;
  const form=doc.getForm();
  for(const [name,value] of Object.entries(values)) {
    const field=form.getField(name);
    if(field.isReadOnly()&&!calculated.has(name))continue;
    if(field instanceof PDFTextField){safeText(String(value).replace(/[\r\n]/g,''),font);field.setText(String(value));}
    else if(field instanceof PDFCheckBox)value?field.check():field.uncheck();
    else if(field instanceof PDFOptionList&&describeFormDesign(doc,field))selectList(field,value);
    else if(field instanceof PDFDropdown||field instanceof PDFOptionList) {if(value===''||Array.isArray(value)&&!value.length)field.clear();else field.select(value);}
    else if(field instanceof PDFRadioGroup) value?field.select(String(value)):field.clear();
  }
  if(Object.keys(values).length){form.updateFieldAppearances(font);for(const name of Object.keys(values)){const field=form.getField(name);if(field instanceof PDFOptionList&&describeFormDesign(doc,field))updateListAppearance(field,font);}}
}
function formValues(doc,pending,mode='strict'){
  if(!['strict','draft','template'].includes(mode))throw new Error('Modo de guardado del formulario inválido.');
  const fields=describeFields(doc),state=evaluateForm(fields,pending,{defaults:mode==='template',allowEmptyRequired:mode==='template',allowEmptyCalculated:mode==='template'});
  if(mode!=='draft'&&state.hasRules&&Object.keys(state.errors).length){const first=Object.entries(state.errors).slice(0,3).map(([name,message])=>(name?name+': ':'')+message).join(' ');throw new Error('Revisa las respuestas del formulario antes de exportar. '+first);}
  const values=Object.create(null);
  if(mode==='template'){for(const f of fields)if(f.type!=='unsupported'&&!f.readOnly)values[f.name]=state.values[f.name];}
  else for(const [name,value]of Object.entries(pending||{}))if(!state.calculated.has(name))values[name]=value;
  for(const name of state.calculated)values[name]=state.values[name];
  return{fields,state,values};
}
export async function designForm(bytes,values,change){
  const doc=await loadEditable(bytes),font=await doc.embedFont(StandardFonts.Helvetica);
  if(change.action==='delete'){const fields=describeFields(doc),used=fields.find(f=>f.rule?.calculation?.sources.includes(change.id));if(used)throw new Error('No puedes eliminar este campo: lo usa el cálculo de '+used.name+'. Cambia ese cálculo primero.');}
  // Field edits only touch annotations. pdf-lib's add/remove widget helpers can
  // wrap page content in another q/Q pair on every load; preserve the body.
  const contents=doc.getPages().map(page=>{const body=page.node.Contents();return{page,value:body?.asArray?doc.context.obj(body.asArray()):page.node.get(PDFName.of('Contents'))};});
  applyForms(doc,values,font);const selectedIds=change.action==='batch'?editFormBatch(doc,change,font):[editFormDesign(doc,change,font)].filter(Boolean),selectedId=selectedIds.at(-1)||'';
  const fields=describeFields(doc);validateCalculationGraph(fields);
  if(change.action==='properties'&&Object.prototype.hasOwnProperty.call(change.props||{},'rule')){const target=fields.find(f=>f.id===change.id);if(target?.rule&&!target.rule.calculation){const error=checkFieldValue({...target,required:false,readOnly:false},target.defaultValue);if(error)throw new Error('Revisa el valor inicial de '+target.name+': '+error);}}
  const state=evaluateForm(fields),defaults=evaluateForm(fields,{}, {defaults:true,allowEmptyRequired:true,allowEmptyCalculated:true}),results=Object.create(null);
  for(const name of state.calculated){results[name]=state.values[name];doc.getForm().getTextField(name).acroField.dict.set(PDFName.of('DV'),PDFHexString.fromText(defaults.values[name]||''));}
  applyForms(doc,results,font,state.calculated);

  for(const {page,value}of contents)if(value)page.node.set(PDFName.of('Contents'),value);else page.node.delete(PDFName.of('Contents'));
  await doc.flush();collectUnreachable(doc);return {bytes:await doc.save({updateFieldAppearances:false}),selectedId,selectedIds};
}
export async function exportPdf(bytes,model,options={}) {
  const doc=await loadEditable(bytes);
  const font=await doc.embedFont(StandardFonts.Helvetica);
  const fonts=new Map([['Helvetica',font]]);
  const forms=formValues(doc,model.forms,options.formsMode||'strict');applyForms(doc,forms.values,font,forms.state.calculated);
  for(const mark of model.marks)validateMark(mark);
  for(const mark of (options.flatten?annotationPaintOrder(model.marks).filter(m=>m.tool!=='note'):model.marks.filter(m=>!isNativeTool(m)))) {
    const page=doc.getPage(mark.page-1);await paintAnnotation(page,mark,pageGeometry(page),fonts);
  }
  if(!options.flatten)await appendNativeAnnotations(doc,annotationPaintOrder(model.marks).filter(isNativeTool),fonts);
  else await appendNativeAnnotations(doc,model.marks.filter(m=>m.tool==='note'),fonts,{editable:false});
  doc.setProducer('PDFReaderCO · pdf-lib');doc.setModificationDate(new Date());
  await doc.flush();collectUnreachable(doc);return doc.save({updateFieldAppearances:false});
}
export async function manipulate(bytes,operation,options={}) {
  const doc=await loadEditable(bytes), indices=options.indices||doc.getPageIndices();
  if(operation==='rotate') for(const i of indices) {const p=doc.getPage(i);p.setRotation(degrees((p.getRotation().angle+90)%360));}
  else if(operation==='delete'){
    if(indices.length>=doc.getPageCount())throw new Error('El documento debe conservar al menos una página.');
    for(const i of indices){const annots=doc.getPage(i).node.Annots();for(let n=0;n<(annots?.size()||0);n++)if(doc.context.lookup(annots.get(n))?.get(PDFName.of('Subtype'))?.toString()==='/Widget')throw new Error('Esta página contiene campos de formulario. Aplana una copia antes de eliminarla.');}
    for(const i of [...indices].sort((a,b)=>b-a))doc.removePage(i);
  }
  else if(operation==='extract'){const out=await PDFDocument.create();for(const p of await out.copyPages(doc,indices))out.addPage(p);return out.save();}
  else if(operation==='reorder'){
    if(indices.length!==doc.getPageCount()||new Set(indices).size!==indices.length)throw new Error('El orden debe incluir cada página exactamente una vez.');
    // Reuse the page dictionaries so AcroForm widgets and outlines keep their identity.
    const pages=doc.getPages();for(let i=pages.length-1;i>=0;i--)doc.removePage(i);for(const i of indices)doc.addPage(pages[i]);
  }
  else if(operation==='duplicate'){
    if(doc.getForm().getFields().length)throw new Error('Aplana una copia del formulario antes de duplicar páginas.');
    const copies=await doc.copyPages(doc,indices);let offset=0;for(let n=0;n<indices.length;n++)doc.insertPage(indices[n]+1+offset++,copies[n]);
  }
  else if(operation==='blank')doc.insertPage(Math.min(options.at??doc.getPageCount(),doc.getPageCount()),[595.28,841.89]);
  else if(operation==='merge')for(const bytes of options.files||[]){const src=await loadEditable(bytes);if(src.getForm().getFields().length)throw new Error('Los PDF que se agregan deben tener sus formularios aplanados para conservar sus valores.');for(const p of await doc.copyPages(src,src.getPageIndices()))doc.addPage(p);}
  else if(operation==='crop')for(const i of indices){const p=doc.getPage(i),b=p.getCropBox(),m=Number(options.margin);if(!Number.isFinite(m)||m<0||m*2>=Math.min(b.width,b.height))throw new Error('Margen de recorte inválido.');p.setCropBox(b.x+m,b.y+m,b.width-2*m,b.height-2*m);}
  else if(operation==='crop-visual')for(const i of indices){const p=doc.getPage(i),b=p.getCropBox(),r=options.rect;if(!r||![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.x<0||r.y<0||r.w<=0||r.h<=0||r.x+r.w>1.000001||r.y+r.h>1.000001)throw new Error('Área de recorte inválida.');const a=viewToPdf(r.x,r.y,b.width,b.height,p.getRotation().angle,b),z=viewToPdf(r.x+r.w,r.y+r.h,b.width,b.height,p.getRotation().angle,b);p.setCropBox(Math.min(a[0],z[0]),Math.min(a[1],z[1]),Math.abs(z[0]-a[0]),Math.abs(z[1]-a[1]));}
  else if(operation==='watermark'||operation==='numbers') {
    const font=await doc.embedFont(StandardFonts.Helvetica);
    for(const i of indices){const p=doc.getPage(i),b=p.getCropBox(),text=safeText(operation==='numbers'?`${i+1} / ${doc.getPageCount()}`:String(options.text||''),font),size=operation==='numbers'?10:36;const w=font.widthOfTextAtSize(text,size);p.drawText(text,{x:b.x+(b.width-w)/2,y:b.y+(operation==='numbers'?20:b.height/2),size,font,color:rgb(.25,.3,.38),opacity:operation==='numbers'?1:.22});}
  }
  else if(operation==='metadata') {doc.setTitle(options.title||'');doc.setAuthor(options.author||'');doc.setSubject(options.subject||'');}
  else if(operation==='flatten'){
    const forms=formValues(doc,{},'strict');if(forms.state.hasRules)applyForms(doc,forms.values,await doc.embedFont(StandardFonts.Helvetica),forms.state.calculated);
    doc.getForm().flatten();
    // pdf-lib can leave references to removed widget dictionaries in page Annots.
    for(const page of doc.getPages()){const annots=page.node.Annots();if(annots)page.node.set(PDFName.of('Annots'),doc.context.obj(annots.asArray().filter(ref=>{const dict=doc.context.lookup(ref);return dict&&dict.get?.(PDFName.of('Subtype'))?.toString()!=='/Widget';})));}
    doc.catalog.delete(PDFName.of('AcroForm'));
  }
  else throw new Error('Operación desconocida.');
  return doc.save();
}
export async function createBlank() {const doc=await PDFDocument.create();doc.addPage([595.28,841.89]);doc.setTitle('Documento sin título');doc.setCreator('PDFReaderCO');return doc.save();}
export async function imagesToPdf(images) {
  const doc=await PDFDocument.create();
  for(const data of images){const img=data.startsWith('data:image/jpeg')?await doc.embedJpg(data):await doc.embedPng(data);const p=doc.addPage([595.28,841.89]),scale=Math.min(555/img.width,802/img.height);p.drawImage(img,{x:(p.getWidth()-img.width*scale)/2,y:(p.getHeight()-img.height*scale)/2,width:img.width*scale,height:img.height*scale});}
  return doc.save();
}
const base64Cache=new WeakMap();
export function encodeProject(bytes,model,recoveryDrafts,ocrReview,tableDraft) {
  if(!base64Cache.has(bytes)){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));base64Cache.set(bytes,btoa(binary));}
  if(ocrReview&&!packedOcrSession(ocrReview))throw new Error('La revisión OCR no está preparada para recuperación.');
  return new TextEncoder().encode(JSON.stringify({format:'PDFReaderCO',version:1,pdf:base64Cache.get(bytes),model,...(recoveryDrafts?{recoveryDrafts:readDrafts(recoveryDrafts)}:{}),...(ocrReview?{ocrReview}:{}),...(tableDraft?{tableDraft:validateTableDraft(tableDraft)}:{})}));
}
export function decodeProject(bytes) {
  const project=JSON.parse(new TextDecoder().decode(bytes));
  if(project.format!=='PDFReaderCO'||project.version!==1||typeof project.pdf!=='string'||!Array.isArray(project.model?.marks)||typeof project.model?.forms!=='object'||!project.model.forms)throw new Error('Proyecto PDFCO inválido.');
  if(project.model.marks.length>100000)throw new Error('Demasiadas anotaciones.');
  const ids=new Set();for(const mark of project.model.marks){validateMark(mark);if(ids.has(mark.id))throw new Error('Identidad de anotación duplicada.');ids.add(mark.id);}
  for(const v of Object.values(project.model.forms))if(!(typeof v==='boolean'||typeof v==='string'||Array.isArray(v)&&v.every(s=>typeof s==='string')))throw new Error('Campo inválido.');
  if(project.model.bookmarks!==undefined&&(!Array.isArray(project.model.bookmarks)||project.model.bookmarks.some(b=>typeof b.id!=='string'||!Number.isInteger(b.page)||b.page<1||typeof b.label!=='string')))throw new Error('Marcadores inválidos.');
  let recoveryDrafts=null,draftWarning='';try{recoveryDrafts=readDrafts(project.recoveryDrafts);}catch{draftWarning='Se recuperaron los cambios aplicados, pero los borradores adicionales no son compatibles.';}
  const ocrReview=packedOcrSession(project.ocrReview)?project.ocrReview:null,ocrWarning=project.ocrReview&&!ocrReview?'Se recuperaron los cambios aplicados, pero la revisión OCR no es compatible.':'';
  let tableDraft=null,tableWarning='';try{tableDraft=validateTableDraft(project.tableDraft);}catch{tableWarning='Se recuperó el PDF, pero el borrador de tabla no es compatible.';}
  return {bytes:Uint8Array.from(atob(project.pdf),c=>c.charCodeAt(0)),model:project.model,recoveryDrafts,draftWarning,ocrReview,ocrWarning,tableDraft,tableWarning};
}
