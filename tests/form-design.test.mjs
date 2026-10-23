import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFNumber, PDFDict, degrees } from 'pdf-lib';
import { createBlank, designForm, getFields, exportPdf, encodeProject, decodeProject, manipulate } from '../src/pdf-engine.mjs';
const rect={x:.2,y:.25,w:.4,h:.07},create=(bytes,kind='text',page=1)=>designForm(bytes,{}, {action:'create',kind,page,rect});
const fields=async bytes=>(await getFields(bytes)).filter(f=>f.design),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
async function props(bytes,id,patch,values={}){const f=(await fields(bytes)).find(f=>f.design.id===id);return designForm(bytes,values,{action:'properties',id,props:{...f.design,...patch}});}

test('designer creates canonical text, checkbox and dropdown fields with linked widgets, default values and nonempty appearances on all page rotations',async()=>{
  for(const rotation of [0,90,180,270])for(const unit of [1,2]){
    const doc=await PDFDocument.create(),p=doc.addPage([600,800]);p.setCropBox(20,30,500,700);p.setRotation(degrees(rotation));p.node.set(PDFName.of('UserUnit'),PDFNumber.of(unit));let bytes=await doc.save();
    for(const kind of ['text','checkbox','dropdown']){let r=await create(bytes,kind),f=(await fields(r.bytes)).find(f=>f.design.id===r.selectedId);r=await props(r.bytes,r.selectedId,{defaultValue:kind==='checkbox'?true:kind==='dropdown'?'Bogotá':'José áéíóú',options:['Bogotá','Cali'],required:true});bytes=r.bytes;f=(await fields(bytes)).find(f=>f.design.id===r.selectedId);assert.equal(f.required,true);assert.deepEqual(f.value,kind==='checkbox'?true:kind==='dropdown'?['Bogotá']:'José áéíóú');for(const k of ['x','y','w','h'])near(f.design[k],rect[k]);near(f.design.fontSize,12);}
    const saved=await PDFDocument.load(bytes),form=saved.getForm();assert.equal(form.getFields().length,3);assert.equal(saved.getPage(0).node.Annots().size(),3);
    for(const f of form.getFields()){const w=f.acroField.getWidgets()[0],ref=saved.context.getObjectRef(w.dict);assert.equal(w.P(),saved.getPage(0).ref);assert.equal(w.dict.get(PDFName.of('Parent')),f.ref);assert.ok(saved.getPage(0).node.Annots().asArray().includes(ref));assert.ok(f.acroField.dict.has(PDFName.of('DV')));const normal=w.getAppearances().normal;if(normal instanceof PDFDict)for(const [,ref]of normal.entries())assert.ok(saved.context.lookup(ref).getContents().length>0);else assert.ok(normal.getContents().length>0);}
  }
});

test('designer movement and resize preserve filled values and defaults; repeated edits and deletion leave no orphan widgets or resources',async()=>{
  let result=await create(await createBlank()),id=result.selectedId,counts=[];result=await props(result.bytes,id,{name:'Nombre',defaultValue:'Inicial'});
  for(let i=0;i<6;i++){result=await designForm(result.bytes,{Nombre:'Respuesta'},{action:'geometry',id,rect:{...rect,x:.3,w:.5}});const f=(await fields(result.bytes))[0];assert.equal(f.value,'Respuesta');assert.equal(f.design.defaultValue,'Inicial');counts.push((await PDFDocument.load(result.bytes)).context.enumerateIndirectObjects().length);}
  assert.ok(Math.max(...counts)-Math.min(...counts)<3);result=await designForm(result.bytes,{}, {action:'delete',id});const doc=await PDFDocument.load(result.bytes);assert.equal(doc.getForm().getFields().length,0);assert.equal(doc.getPage(0).node.Annots()?.size()||0,0);
});

test('designer updates names, required and multiline flags, resets defaults explicitly and preserves filled values on unrelated property changes',async()=>{
  let r=await create(await createBlank()),id=r.selectedId;r=await props(r.bytes,id,{name:'Observaciones',multiline:true,required:true,defaultValue:'Primera\nSegunda',fontSize:16});
  r=await props(r.bytes,id,{name:'Detalle',fontSize:18},{Observaciones:'Respuesta\náéíóú'});const f=(await fields(r.bytes))[0];assert.equal(f.name,'Detalle');assert.equal(f.value,'Respuesta\náéíóú');assert.equal(f.multiline,true);assert.equal(f.required,true);assert.equal(f.design.defaultValue,'Primera\nSegunda');assert.equal(f.design.fontSize,18);
  r=await props(r.bytes,id,{defaultValue:'Nueva',required:false,multiline:false});assert.equal((await fields(r.bytes))[0].value,'Nueva');assert.equal((await fields(r.bytes))[0].required,false);
});

test('dropdown choices and empty selections save correctly without changing unrelated fields or checkbox values',async()=>{
  let r=await create(await createBlank(),'dropdown'),id=r.selectedId;r=await props(r.bytes,id,{options:['Uno','Dos'],defaultValue:'Dos'});r=await create(r.bytes,'checkbox');const check=r.selectedId;r=await props(r.bytes,check,{defaultValue:true});
  const saved=await exportPdf(r.bytes,{marks:[],forms:{Lista_1:'',Casilla_1:false}}),list=(await fields(saved)).find(f=>f.design.id===id),box=(await fields(saved)).find(f=>f.design.id===check);assert.deepEqual(list.value,[]);assert.equal(list.design.defaultValue,'Dos');assert.equal(box.value,false);assert.equal(box.design.defaultValue,true);
  r=await props(saved,id,{options:['Tres'],defaultValue:'Tres'});assert.deepEqual((await fields(r.bytes)).find(f=>f.design.id===id).value,['Tres']);
});

test('designer rejects invalid sizes, duplicate or hierarchical names, invalid choices, unsupported glyphs and external fields without changing source bytes',async()=>{
  let r=await create(await createBlank()),id=r.selectedId;const original=r.bytes.slice();
  for(const patch of [{name:''},{name:'a.b'},{fontSize:0},{defaultValue:'日本語'},{defaultValue:'Una\nDos'}])await assert.rejects(props(r.bytes,id,patch));
  for(const bad of [{...rect,w:0},{...rect,x:.9},{...rect,y:NaN}])await assert.rejects(designForm(r.bytes,{}, {action:'geometry',id,rect:bad}));assert.deepEqual(r.bytes,original);
  const second=await create(r.bytes);await assert.rejects(props(second.bytes,second.selectedId,{name:'Texto_1'}),/existe/);
  const dd=await create(r.bytes,'dropdown');for(const patch of [{options:[]},{options:['a','a']},{options:['a'],defaultValue:'b'}])await assert.rejects(props(dd.bytes,dd.selectedId,patch));
  const doc=await PDFDocument.load(r.bytes),external=doc.getForm().getTextField('Texto_1');external.acroField.dict.delete(PDFName.of('PDFReaderCOForm'));const bytes=await doc.save();assert.equal((await getFields(bytes))[0].design,undefined);await assert.rejects(designForm(bytes,{}, {action:'delete',id}),/compatible/);
});

test('designer fields survive page changes and PDFCO, flatten removes both the canonical fields and all widgets',async()=>{
  let r=await create(await createBlank());const project=decodeProject(encodeProject(r.bytes,{marks:[],forms:{Texto_1:'Proyecto'}}));assert.equal((await fields(project.bytes)).length,1);
  let saved=await exportPdf(project.bytes,project.model),rotated=await manipulate(saved,'rotate',{indices:[0]});assert.equal((await fields(rotated))[0].value,'Proyecto');assert.equal((await fields(rotated))[0].design.page,1);
  const flat=await manipulate(saved,'flatten'),doc=await PDFDocument.load(await exportPdf(flat,{marks:[],forms:{}}));assert.equal(doc.catalog.has(PDFName.of('AcroForm')),false);assert.equal(doc.getPage(0).node.Annots()?.size()||0,0);
});

test('designer preserves external shared fields, their responses, annotations and page contents when creating and deleting a new own field',async()=>{
  const doc=await PDFDocument.create(),p=doc.addPage([600,800]),p2=doc.addPage([600,800]),external=doc.getForm().createTextField('Texto_1.Nombre');external.setText('Anterior');external.addToPage(p,{x:40,y:500,width:200,height:30});external.addToPage(p2,{x:40,y:500,width:200,height:30});p.drawText('Contenido original');
  p.node.addAnnot(doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Text',Rect:[40,40,65,65],Contents:'Comentario externo',F:4})));
  let r=await create(await doc.save());assert.equal((await fields(r.bytes))[0].name,'Texto_2');r=await designForm(r.bytes,{'Texto_1.Nombre':'Respuesta conservada'},{action:'delete',id:r.selectedId});
  const saved=await PDFDocument.load(r.bytes),f=saved.getForm().getTextField('Texto_1.Nombre');assert.equal(f.getText(),'Respuesta conservada');assert.equal(f.acroField.getWidgets().length,2);assert.equal(saved.getPage(0).node.Annots().size(),2);assert.equal(saved.getPage(1).node.Annots().size(),1);assert.ok(saved.getPage(0).node.Contents().size()>0);assert.equal((await getFields(r.bytes))[0].design,undefined);
});
