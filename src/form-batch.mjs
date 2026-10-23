import {PDFTextField,PDFCheckBox,PDFOptionList}from'pdf-lib';
import {describeFields}from'./form-fields.mjs';
import {editFormDesign}from'./form-design.mjs';
import {formSelectionPlan}from'./form-selection.mjs';
import {duplicateRadioDesign}from'./radio-design.mjs';
import {writeFieldRule}from'./field-rules.mjs';
import {pageGeometry}from'./pdf-coordinates.mjs';
import {updateListAppearance}from'./choice-list.mjs';

export function editFormBatch(doc,change,font){
  const fields=describeFields(doc),designs=fields.flatMap(f=>f.designs|| (f.design?[f.design]:[])),ids=change.ids;
  if(!Array.isArray(ids)||!ids.length||ids.length>200||new Set(ids).size!==ids.length||ids.some(id=>!designs.some(f=>f.id===id)))throw new Error('Selecciona entre 1 y 200 campos propios compatibles.');
  if(change.operation!=='duplicate'){
    const plan=formSelectionPlan(designs,ids,change.operation,change);
    for(const item of plan)editFormDesign(doc,{action:'geometry',...item},font);
    return ids;
  }
  // A radio option belongs to a canonical group: duplicate the entire group.
  const originals=fields.filter(f=>f.design&&ids.includes(f.id)||f.designs?.some(d=>ids.includes(d.id)));
  if(originals.some(f=>f.ruleError))throw new Error('Corrige las reglas incompatibles antes de duplicar.');
  if(fields.length+originals.length>1000)throw new Error('El diseñador admite hasta 1.000 campos.');
  const expanded=originals.flatMap(f=>f.designs||[f.design]),offsets=new Map();
  if(expanded.length>200)throw new Error('La copia completa supera 200 campos u opciones. Duplica menos grupos a la vez.');
  for(const page of new Set(expanded.map(f=>f.page))){
    const group=expanded.filter(f=>f.page===page),g=pageGeometry(doc.getPage(page-1));
    offsets.set(page,{dx:Math.min(12/g.width,1-Math.max(...group.map(f=>f.x+f.w))),dy:Math.min(12/g.height,1-Math.max(...group.map(f=>f.y+f.h)))});
  }
  const copies=[],mapping=new Map(),selected=[];
  for(const original of originals){
    if(original.designs?.length){
      const result=duplicateRadioDesign(doc,original.designs[0].id,offsets,font);mapping.set(original.id,result.groupId);selected.push(...result.ids);continue;
    }
    const d=original.design,offset=offsets.get(d.page),id=editFormDesign(doc,{action:'create',kind:d.kind,page:d.page,rect:{...d,x:d.x+offset.dx,y:d.y+offset.dy}},font);
    const names=doc.getForm().getFields().map(f=>f.getName());let n=1,name;do{name=d.name.slice(0,85)+'_copia_'+n++;}while(names.some(v=>v===name||v.startsWith(name+'.')||name.startsWith(v+'.')));
    editFormDesign(doc,{action:'properties',id,props:{...d,name,rule:null}},font);
    const field=doc.getForm().getField(name);
    if(field instanceof PDFTextField)field.setText(original.value);
    else if(field instanceof PDFCheckBox)original.value?field.check():field.uncheck();
    else if(original.value.length)field.select(original.value);else field.clear();
    if(field instanceof PDFOptionList)updateListAppearance(field,font);else field.defaultUpdateAppearances(font);
    mapping.set(original.id,id);selected.push(id);copies.push({original,field});
  }
  // References to duplicated sources follow the copy; other sources stay intact.
  for(const {original,field}of copies){
    const rule=original.rule?structuredClone(original.rule):null;
    if(rule?.calculation)rule.calculation.sources=rule.calculation.sources.map(id=>mapping.get(id)||id);
    writeFieldRule(field,rule,original.design.kind);
  }
  return selected;
}
