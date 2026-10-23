import test from'node:test';
import assert from'node:assert/strict';
import {PDFDocument,PDFName,PDFNumber,degrees,PDFDict}from'pdf-lib';
import {designForm,getFields,exportPdf}from'../src/pdf-engine.mjs';
import {formSelectionPlan}from'../src/form-selection.mjs';
import {searchMatches,searchableContent}from'../src/search-text.mjs';
import {originalDiagnostic}from'../src/original-diagnostics.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
async function scene(rotation=0,unit=1){const doc=await PDFDocument.create(),p=doc.addPage([600,800]);p.setCropBox(20,30,500,700);p.setRotation(degrees(rotation));p.node.set(PDFName.of('UserUnit'),PDFNumber.of(unit));p.drawText('Original sin cambios',{x:60,y:600,size:14});doc.attach(new Uint8Array([1,2,3]),'control.bin');let bytes=await doc.save(),ids=[];for(const [x,y,w,h]of[[.1,.25,.2,.06],[.4,.4,.3,.08],[.75,.65,.15,.1]]){const result=await designForm(bytes,{}, {action:'create',kind:'text',page:1,rect:{x,y,w,h}});bytes=result.bytes;ids.push(result.selectedId);}return{bytes,ids};}
test('selection geometry: first reference, unequal sizes, spacing, bounds, invalid and stale selections',()=>{
  const fields=[{id:'a',page:1,x:.1,y:.1,w:.1,h:.1},{id:'b',page:1,x:.4,y:.4,w:.2,h:.2},{id:'c',page:1,x:.8,y:.7,w:.1,h:.1}];
  const plan=formSelectionPlan(fields,['a','b','c'],'distribute-x');near(plan[1].rect.x,.4);near(plan[2].rect.x,.8);
  const moved=formSelectionPlan(fields,['a','c'],'move',{dx:5,dy:-4});near(moved[0].rect.x,.2);near(moved[1].rect.x,.9);near(moved[0].rect.y,0);
  assert.equal(formSelectionPlan(fields,['b','a'],'width')[1].rect.w,.2);
  assert.throws(()=>formSelectionPlan(fields,['a','b'],'distribute-x'),/tres/);assert.throws(()=>formSelectionPlan(fields,['a','a'],'left'),/diferentes/);assert.throws(()=>formSelectionPlan(fields,['stale'],'left'),/cambió/);
  assert.throws(()=>formSelectionPlan([...fields,{id:'d',page:2,x:.1,y:.1,w:.1,h:.1}],['a','d'],'left'),/misma página/);
  assert.throws(()=>formSelectionPlan(fields.map(f=>f.id==='b'?{...f,w:.4}:f),['a','b'],'right'),/sale/);
});
test('batch geometry survives all rotations and UserUnit, preserves current/default values and body streams',async()=>{
  for(const rotation of[0,90,180,270])for(const unit of[1,2]){let{bytes,ids}=await scene(rotation,unit);const before=await PDFDocument.load(bytes),body=before.getPage(0).node.Contents().asArray().map(ref=>Buffer.from(before.context.lookup(ref).getContents()).toString('base64'));
    let result=await designForm(bytes,{Texto_1:'Respuesta áéíóú'},{action:'batch',ids,operation:'left'});assert.deepEqual(result.selectedIds,ids);
    result=await designForm(result.bytes,{}, {action:'batch',ids,operation:'size'});const fields=await getFields(result.bytes);for(const f of fields){near(f.design.x,.1);near(f.design.w,.2);near(f.design.h,.06);}assert.equal(fields[0].value,'Respuesta áéíóú');assert.equal(fields[0].defaultValue,'');
    const after=await PDFDocument.load(result.bytes);assert.deepEqual(after.getPage(0).node.Contents().asArray().map(ref=>Buffer.from(after.context.lookup(ref).getContents()).toString('base64')),body);assert.ok(after.catalog.has(PDFName.of('Names')));
    for(const f of after.getForm().getFields()){const w=f.acroField.getWidgets()[0];assert.equal(w.dict.get(PDFName.of('Parent')),f.ref);assert.equal(w.P(),after.getPage(0).ref);assert.ok(w.getAppearances().normal.getContents().length);}
  }
});
test('duplicated text fields keep values, defaults, validation and remap copied calculation sources',async()=>{
  let{bytes,ids}=await scene();let fields=await getFields(bytes);
  for(let i=0;i<2;i++){const f=fields[i];const r=await designForm(bytes,{}, {action:'properties',id:ids[i],props:{...f.design,defaultValue:String(i+2),rule:{format:'number',calculation:null}}});bytes=r.bytes;}
  fields=await getFields(bytes);bytes=(await designForm(bytes,{}, {action:'properties',id:ids[2],props:{...fields[2].design,rule:{format:'number',calculation:{operation:'sum',sources:ids.slice(0,2),decimals:2}}}})).bytes;
  const r=await designForm(bytes,{Texto_1:'7'}, {action:'batch',operation:'duplicate',ids}),all=await getFields(r.bytes),copies=all.filter(f=>r.selectedIds.includes(f.id));assert.equal(all.length,6);assert.equal(copies.length,3);assert.equal(copies[0].value,'7');assert.equal(copies[0].defaultValue,'2');assert.equal(copies[2].value,'10.00');assert.deepEqual(copies[2].rule.calculation.sources,copies.slice(0,2).map(f=>f.id));assert.equal(copies[2].readOnly,true);
  const one=await designForm(r.bytes,{}, {action:'batch',operation:'duplicate',ids:[ids[2]]}),single=(await getFields(one.bytes)).find(f=>f.id===one.selectedId);assert.deepEqual(single.rule.calculation.sources,ids.slice(0,2));
  const originalHash=Buffer.from(bytes).toString('base64');await assert.rejects(designForm(bytes,{}, {action:'batch',operation:'move',ids:['obsolete'],dx:1,dy:0}),/compatibles/);assert.equal(Buffer.from(bytes).toString('base64'),originalHash);
});
test('duplicating one radio option copies its full multi-page group with independent widgets, labels and selection',async()=>{
  const doc=await PDFDocument.create();doc.addPage([600,800]);doc.addPage([600,800]);let r=await designForm(await doc.save(),{}, {action:'create',kind:'radio',page:1,rect:{x:.1,y:.2,w:.5,h:.12}});let f=(await getFields(r.bytes))[0];r=await designForm(r.bytes,{}, {action:'add-option',id:f.designs[0].id,page:2,rect:{x:.2,y:.3,w:.5,h:.05}});f=(await getFields(r.bytes))[0];r=await designForm(r.bytes,{}, {action:'properties',id:f.designs[0].id,props:{...f.designs[0],required:true,defaultValue:'Opción 2'}});const before=await getFields(r.bytes);
  r=await designForm(r.bytes,{Grupo_1:'Opción 3'}, {action:'batch',operation:'duplicate',ids:[f.designs[1].id]});const all=await getFields(r.bytes);assert.equal(all.length,2);assert.equal(r.selectedIds.length,3);assert.notEqual(all[0].id,all[1].id);assert.equal(all[1].value,'Opción 3');assert.equal(all[1].defaultValue,'Opción 2');assert.deepEqual(all[1].designs.map(d=>d.page),[1,1,2]);assert.equal(all[1].required,true);assert.deepEqual(all[0].designs,before[0].designs);
  const saved=await PDFDocument.load(await exportPdf(r.bytes,{forms:{Grupo_1_copia_1:'Opción 1'},marks:[]}));assert.equal(saved.getForm().getRadioGroup('Grupo_1').getSelected(),'Opción 3');assert.equal(saved.getForm().getRadioGroup('Grupo_1_copia_1').getSelected(),'Opción 1');
  for(const field of saved.getForm().getFields())for(const w of field.acroField.getWidgets()){assert.equal(w.dict.get(PDFName.of('Parent')),field.ref);assert.ok(w.getAppearances().normal instanceof PDFDict);}
});
test('duplicated checkbox/dropdown/multiselect retain current values separately from defaults and do not share IDs',async()=>{
  const doc=await PDFDocument.create();doc.addPage([600,800]);let bytes=await doc.save(),ids=[];
  for(const kind of['checkbox','dropdown','list']){let r=await designForm(bytes,{}, {action:'create',kind,page:1,rect:{x:.1,y:.1+ids.length*.2,w:.5,h:.12}});const f=(await getFields(r.bytes)).find(f=>f.id===r.selectedId);r=await designForm(r.bytes,{}, {action:'properties',id:r.selectedId,props:{...f.design,multiple:true,defaultValue:kind==='checkbox'?true:kind==='list'?['Opción 1']:'Opción 1'}});bytes=r.bytes;ids.push(r.selectedId);}
  const r=await designForm(bytes,{Casilla_1:false,Lista_1:'Opción 2',Seleccion_1:['Opción 1','Opción 2']},{action:'batch',operation:'duplicate',ids});const copies=(await getFields(r.bytes)).filter(f=>r.selectedIds.includes(f.id));assert.equal(copies[0].value,false);assert.equal(copies[0].defaultValue,true);assert.deepEqual(copies[1].value,['Opción 2']);assert.equal(copies[1].defaultValue,'Opción 1');assert.deepEqual(copies[2].value,['Opción 1','Opción 2']);assert.deepEqual(copies[2].defaultValue,['Opción 1']);
});
test('reading search: literal metacharacters, Unicode word boundaries, stable offsets, caps and nonoverlap',()=>{
  assert.deepEqual(searchMatches('a.b aXb','a.b'),[{start:0,length:3}]);assert.equal(searchMatches('casa casas _casa casa2 (CASA) ácasa','casa',false,true).length,2);assert.equal(searchMatches('Bogotá BOGOTÁ','Bogotá',true,true).length,1);assert.equal(searchMatches('𐐀casa casa','casa',false,true).length,1);assert.deepEqual(searchMatches('aaaa','aa'),[{start:0,length:2},{start:2,length:2}]);assert.equal(searchMatches('x x x','x',false,false,2).length,2);assert.deepEqual(searchMatches('anything','  '),[]);
  assert.deepEqual(searchableContent([{str:'Uno',hasEOL:false},{type:'beginMarkedContent'},{str:'Dos',hasEOL:true},{str:'',hasEOL:false},{str:'Tres'}]),{text:'Uno Dos\n Tres ',spans:[{start:0,length:3},{start:4,length:3},{start:8,length:0},{start:9,length:4}]});
});
test('diagnostics distinguish editing vs movement and explain invisible OCR without offering visible editing',()=>{
  const o=originalDiagnostic({editable:false,reason:'Este texto es invisible.'});assert.match(o.suggestion,/OCR/);assert.match(o.suggestion,/no cambia/);
  const clipped=originalDiagnostic({editable:true,movable:false,moveReason:'Hay un recorte externo fijo.'});assert.match(clipped.title,/movimiento limitado/);assert.match(clipped.suggestion,/sin moverlo/);
  assert.match(originalDiagnostic({editable:false,reason:'No se pudo recuperar texto Unicode válido.'}).suggestion,/anotación/);
});
