import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFNumber,PDFDict,PDFArray,degrees} from 'pdf-lib';
import {createBlank,designForm,getFields,exportPdf,encodeProject,decodeProject,manipulate} from '../src/pdf-engine.mjs';
import {evaluateForm} from '../src/form-rules.mjs';
import {listSelection} from '../src/choice-list.mjs';

const rect={x:.2,y:.25,w:.4,h:.2},empty={marks:[],forms:{}};
const create=(bytes,page=1)=>designForm(bytes,{}, {action:'create',kind:'list',page,rect});
const descriptor=async(bytes,id)=>(await getFields(bytes)).find(f=>f.id===id);
async function props(result,patch,values={}){const f=await descriptor(result.bytes,result.selectedId);return designForm(result.bytes,values,{action:'properties',id:result.selectedId,props:{...f.design,...patch}});}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('list designer creates canonical list fields on four rotations and UserUnit 1/2 with defaults and linked appearances',async()=>{
  for(const rotation of[0,90,180,270])for(const unit of[1,2]){
    const doc=await PDFDocument.create(),p=doc.addPage([600,800]);p.setCropBox(20,30,500,700);p.setRotation(degrees(rotation));p.node.set(PDFName.of('UserUnit'),PDFNumber.of(unit));
    let r=await create(await doc.save());r=await props(r,{name:'Ciudades',options:['Bogotá','Cali','Medellín'],defaultValue:['Cali'],required:true,rule:null});
    const f=await descriptor(r.bytes,r.selectedId);assert.equal(f.list,true);assert.equal(f.multiple,false);assert.equal(f.design.kind,'list');assert.deepEqual(f.design.defaultValue,['Cali']);assert.deepEqual(f.value,['Cali']);assert.equal(f.defaultValue,'Cali');assert.equal(f.rule.requiredCheck,true);for(const k of['x','y','w','h'])near(f.design[k],rect[k]);near(f.design.fontSize,12);
    const saved=await PDFDocument.load(r.bytes),field=saved.getForm().getOptionList('Ciudades'),w=field.acroField.getWidgets()[0],ref=saved.context.getObjectRef(w.dict);
    assert.equal(field.acroField.dict.get(PDFName.of('FT')).toString(),'/Ch');assert.equal(field.acroField.hasFlag(1<<17),false);assert.equal(w.dict.get(PDFName.of('Parent')),field.ref);assert.equal(w.P(),saved.getPage(0).ref);assert.ok(saved.getPage(0).node.Annots().asArray().includes(ref));assert.ok(w.getAppearances().normal.getContents().length>0);assert.equal(field.isSorted(),false);assert.equal(field.isSelectOnClick(),false);
  }
});

test('multiple lists keep exact V, DV and numerically sorted I while canonicalizing selections to option order',async()=>{
  let r=await create(await createBlank());const options=Array.from({length:14},(_,i)=>'Opción '+i);r=await props(r,{options,multiple:true,defaultValue:[options[11],options[2]]});
  const saved=await exportPdf(r.bytes,{marks:[],forms:{Seleccion_1:[options[12],options[3],options[1]]}}),doc=await PDFDocument.load(saved),f=doc.getForm().getOptionList('Seleccion_1');
  assert.equal(f.isMultiselect(),true);assert.deepEqual(f.getSelected(),[options[1],options[3],options[12]]);assert.deepEqual(f.acroField.dict.lookup(PDFName.of('I'),PDFArray).asArray().map(v=>v.asNumber()),[1,3,12]);
  assert.deepEqual((await descriptor(saved,r.selectedId)).defaultValue,[options[2],options[11]]);
  const cleared=await exportPdf(saved,{marks:[],forms:{Seleccion_1:[]}}),cf=(await PDFDocument.load(cleared)).getForm().getOptionList('Seleccion_1');assert.equal(cf.acroField.dict.has(PDFName.of('V')),false);assert.equal(cf.acroField.dict.has(PDFName.of('I')),false);assert.deepEqual((await descriptor(cleared,r.selectedId)).design.defaultValue,[options[2],options[11]]);
});

test('list edits preserve current answers, filter removed choices, reorder indices and explicitly reset changed defaults',async()=>{
  let r=await create(await createBlank());r=await props(r,{options:['Uno','Dos','Tres'],multiple:true,defaultValue:['Uno']});r=await props(r,{name:'Opciones',fontSize:15},{Seleccion_1:['Dos','Tres']});assert.deepEqual((await descriptor(r.bytes,r.selectedId)).value,['Dos','Tres']);
  r=await props(r,{options:['Tres','Uno','Dos']});assert.deepEqual((await descriptor(r.bytes,r.selectedId)).value,['Tres','Dos']);
  r=await props(r,{options:['Tres','Uno']});assert.deepEqual((await descriptor(r.bytes,r.selectedId)).value,['Tres']);
  r=await props(r,{defaultValue:['Uno','Tres']});assert.deepEqual((await descriptor(r.bytes,r.selectedId)).value,['Tres','Uno']);
  await assert.rejects(props(r,{multiple:false}),/sola selección/);r=await props(r,{multiple:false,defaultValue:['Uno']});assert.deepEqual((await descriptor(r.bytes,r.selectedId)).value,['Uno']);assert.equal((await descriptor(r.bytes,r.selectedId)).multiple,false);
  r=await props(r,{multiple:true},{Opciones:'Tres'});assert.deepEqual((await descriptor(r.bytes,r.selectedId)).value,['Tres']);r=await props(r,{multiple:false});assert.deepEqual((await descriptor(r.bytes,r.selectedId)).value,['Tres']);
});

test('single lists reject multiselection without silently enabling it, unknown choices, duplicates and invalid values',async()=>{
  let r=await create(await createBlank());r=await props(r,{options:['Uno','Dos']});const original=r.bytes.slice();
  for(const value of[['Uno','Dos'],['Uno','Uno'],['Inexistente'],true,3])await assert.rejects(exportPdf(r.bytes,{marks:[],forms:{Seleccion_1:value}}));
  for(const patch of[{options:[]},{options:['a','a']},{options:['Uno'],defaultValue:['Dos']},{options:['Uno\nDos']},{options:['日本語']},{multiple:'sí'}])await assert.rejects(props(r,patch));assert.deepEqual(r.bytes,original);assert.equal((await descriptor(r.bytes,r.selectedId)).multiple,false);
  assert.deepEqual(listSelection(['Uno','Dos'],['Dos','Uno'],true),['Uno','Dos']);
});

test('required lists block empty or invalid response exports while draft projects and empty templates remain available',async()=>{
  let r=await create(await createBlank());r=await props(r,{multiple:true,required:true,rule:null});const fields=await getFields(r.bytes);assert.ok(evaluateForm(fields,{Seleccion_1:[]}).errors.Seleccion_1);assert.ok(evaluateForm(fields,{Seleccion_1:['desconocida']}).errors.Seleccion_1);await assert.rejects(exportPdf(r.bytes,empty),/obligatorio/);
  const template=await exportPdf(r.bytes,empty,{formsMode:'template'});assert.deepEqual((await descriptor(template,r.selectedId)).value,[]);
  const project=decodeProject(encodeProject(r.bytes,{marks:[],forms:{Seleccion_1:[]}}));assert.deepEqual(project.model.forms.Seleccion_1,[]);
  const filled=await exportPdf(r.bytes,{marks:[],forms:{Seleccion_1:['Opción 2']}});assert.deepEqual((await descriptor(filled,r.selectedId)).value,['Opción 2']);
});

test('movement, repeated resizing and deletion preserve content and defaults without growing unreachable widget resources',async()=>{
  const base=await PDFDocument.create();base.addPage([600,800]).drawText('Contenido original');let r=await create(await base.save());r=await props(r,{multiple:true,defaultValue:['Opción 1']});const counts=[];
  for(let i=0;i<6;i++){r=await designForm(r.bytes,{Seleccion_1:['Opción 2']},{action:'geometry',id:r.selectedId,rect:{...rect,x:.3,w:.5}});const f=await descriptor(r.bytes,r.selectedId);assert.deepEqual(f.value,['Opción 2']);assert.deepEqual(f.design.defaultValue,['Opción 1']);counts.push((await PDFDocument.load(r.bytes)).context.enumerateIndirectObjects().length);}
  assert.ok(Math.max(...counts)-Math.min(...counts)<3);r=await designForm(r.bytes,{}, {action:'delete',id:r.selectedId});const doc=await PDFDocument.load(r.bytes);assert.equal(doc.getForm().getFields().length,0);assert.equal(doc.getPage(0).node.Annots()?.size()||0,0);assert.ok(doc.getPage(0).node.Contents().size()>0);
});

test('PDFCO, page reorder and flattened copies retain list responses while external fields stay outside own designer',async()=>{
  const doc=await PDFDocument.create();doc.addPage([600,800]);doc.addPage([600,800]);const external=doc.getForm().createOptionList('Externa');external.setOptions(['A','B']);external.select('A');external.addToPage(doc.getPage(0));
  let r=await create(await doc.save(),2);r=await props(r,{name:'Propia',multiple:true,defaultValue:['Opción 1']});assert.equal((await getFields(r.bytes)).find(f=>f.name==='Externa').design,undefined);
  const project=decodeProject(encodeProject(r.bytes,{marks:[],forms:{Propia:['Opción 2'],Externa:'B'}})),saved=await exportPdf(project.bytes,project.model),reordered=await manipulate(saved,'reorder',{indices:[1,0]});assert.equal((await descriptor(reordered,r.selectedId)).page,1);assert.deepEqual((await descriptor(reordered,r.selectedId)).value,['Opción 2']);
  const flat=await manipulate(reordered,'flatten'),flattened=await PDFDocument.load(flat);assert.equal(flattened.catalog.has(PDFName.of('AcroForm')),false);for(const p of flattened.getPages())assert.ok(!p.node.Annots()?.asArray().some(ref=>flattened.context.lookup(ref,PDFDict).get(PDFName.of('Subtype'))?.toString()==='/Widget'));
});

test('long option appearances use one row each, show a late selection and keep all options in the interactive field',async()=>{
  let r=await create(await createBlank());const options=Array.from({length:20},(_,i)=>'Opción '+i+' con descripción extensa que debe quedar en una sola fila');r=await props(r,{options,defaultValue:[options[18]],fontSize:16});
  const doc=await PDFDocument.load(r.bytes),f=doc.getForm().getOptionList('Seleccion_1'),ap=f.acroField.getWidgets()[0].getAppearances().normal,top=f.acroField.dict.lookup(PDFName.of('TI'),PDFNumber).asNumber();assert.ok(top>0);assert.equal(f.getOptions().length,20);assert.ok(ap.getContents().length>0);assert.deepEqual((await descriptor(r.bytes,r.selectedId)).value,[options[18]]);
});
