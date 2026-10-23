import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFHexString, PDFNumber, PDFDict, PDFArray, degrees } from 'pdf-lib';
import { exportPdf, manipulate, encodeProject, decodeProject } from '../src/pdf-engine.mjs';
import { prepareEditablePdf } from '../src/native-annotations.mjs';
import { annotationBox } from '../src/text-layout.mjs';
import { readFile } from 'node:fs/promises';
import { rotatePoint } from '../src/annotation-geometry.mjs';
import { pageGeometry, viewToPdf, pdfToView } from '../src/pdf-coordinates.mjs';

async function source(rotation=0,unit=1){const doc=await PDFDocument.create(),p=doc.addPage([600,800]);p.setCropBox(20,30,500,700);p.setRotation(degrees(rotation));if(unit!==1)p.node.set(PDFName.of('UserUnit'),PDFNumber.of(unit));return doc.save();}
const text=()=>({id:'t',page:1,tool:'text',x:.12,y:.2,w:.35,h:.1,text:'Revisión española\nSegunda línea',color:'#008577',size:18,fontFamily:'serif',bold:true,italic:true,align:'center',opacity:.65,rotation:30});
const highlight=()=>({id:'h',page:1,tool:'highlight',x:.12,y:.4,w:.4,h:.035,color:'#ffdf50',size:2,rotation:15,opacity:.7});
const model=(marks=[text(),highlight()])=>({marks,forms:{}});
function annots(doc,page=0){const a=doc.getPage(page).node.Annots();return a?a.asArray().map(ref=>doc.context.lookup(ref)):[];}

test('FreeText and Highlight have standard dictionaries, Unicode contents and self-contained appearance resources',async()=>{
  const out=await exportPdf(await source(),model()),doc=await PDFDocument.load(out),[t,h]=annots(doc);
  assert.equal(t.get(PDFName.of('Subtype')).toString(),'/FreeText');assert.equal(h.get(PDFName.of('Subtype')).toString(),'/Highlight');assert.equal(t.get(PDFName.of('Contents')).decodeText(),text().text);assert.equal(h.lookup(PDFName.of('QuadPoints'),PDFArray).size(),8);
  for(const a of [t,h]){const stream=a.lookup(PDFName.of('AP'),PDFDict).lookup(PDFName.of('N'));assert.equal(stream.dict.get(PDFName.of('Subtype')).toString(),'/Form');assert.equal(stream.dict.lookup(PDFName.of('BBox'),PDFArray).size(),4);assert.ok(stream.getContents().length>20);assert.ok(stream.dict.get(PDFName.of('Resources')));assert.equal(a.lookup(PDFName.of('F'),PDFNumber).asNumber(),4);}
  const ap=t.lookup(PDFName.of('AP'),PDFDict).lookup(PDFName.of('N'));assert.ok(ap.dict.lookup(PDFName.of('Resources'),PDFDict).lookup(PDFName.of('Font'),PDFDict).entries().length);
});
test('reopen restores exact styles, normalizes the base PDF and supports edit/delete without duplicate appearances',async()=>{
  const saved=await exportPdf(await source(),model()),opened=await prepareEditablePdf(saved);assert.equal(opened.retained,0);assert.deepEqual(opened.marks,[text(),highlight()]);assert.equal(annots(await PDFDocument.load(opened.bytes)).length,0);
  const changed={...opened.marks[0],text:'Texto cambiado',x:.25,opacity:.4};const second=await exportPdf(opened.bytes,model([changed])),read=await prepareEditablePdf(second);assert.deepEqual(read.marks,[changed]);assert.equal(annots(await PDFDocument.load(second)).length,1);
  const removed=await exportPdf(read.bytes,model([]));assert.equal(annots(await PDFDocument.load(removed)).length,0);assert.deepEqual((await prepareEditablePdf(removed)).marks,[]);
});
test('native edit/reopen preserves 0/90/180/270 rotation, shifted CropBox, UserUnit and project roundtrip',async()=>{
  for(const rotation of [0,90,180,270])for(const unit of [1,2]){const out=await exportPdf(await source(rotation,unit),model()),opened=await prepareEditablePdf(out);assert.deepEqual(opened.marks,model().marks);const project=decodeProject(encodeProject(opened.bytes,{...model(opened.marks),bookmarks:[{id:'b',page:1,label:'Inicio'}]}));assert.deepEqual(project.model.marks,opened.marks);}
});
test('page rotation and crop changes reproject owned objects while keeping their raw PDF center',async()=>{
  const saved=await exportPdf(await source(),model()),originalDoc=await PDFDocument.load(saved),oldGeometry=pageGeometry(originalDoc.getPage(0)),oldBox=annotationBox(text(),oldGeometry.width,oldGeometry.height),raw=viewToPdf(oldBox.x+oldBox.w/2,oldBox.y+oldBox.h/2,oldGeometry.width,oldGeometry.height,oldGeometry.rotation,oldGeometry.crop);
  const rotated=await manipulate(saved,'rotate',{indices:[0]}),opened=await prepareEditablePdf(rotated),doc=await PDFDocument.load(opened.bytes),g=pageGeometry(doc.getPage(0)),box=annotationBox(opened.marks[0],g.width,g.height),center=viewToPdf(box.x+box.w/2,box.y+box.h/2,g.width,g.height,g.rotation,g.crop);assert.ok(Math.abs(center[0]-raw[0])<1e-8&&Math.abs(center[1]-raw[1])<1e-8);assert.equal(opened.marks[0].rotation,120);
  const cropped=await manipulate(rotated,'crop-visual',{indices:[0],rect:{x:.1,y:.1,w:.8,h:.8}});assert.equal((await prepareEditablePdf(cropped)).marks.length,2);
});
test('external edits, unsupported metadata, hidden/locked annotations and appearance changes stay native and untouched',async()=>{
  for(const mode of ['contents','metadata','editing','hidden','locked','appearance','optional']){
    const doc=await PDFDocument.load(await exportPdf(await source(),model([text()]))),a=annots(doc)[0];
    if(mode==='contents')a.set(PDFName.of('Contents'),PDFHexString.fromText('Cambio en otro lector'));
    if(mode==='metadata')a.set(PDFName.of('PDFReaderCO'),PDFHexString.fromText('{"version":99}'));
    if(mode==='editing'){const data=JSON.parse(a.get(PDFName.of('PDFReaderCO')).decodeText());data.mark.text='Datos de edición cambiados';a.set(PDFName.of('PDFReaderCO'),PDFHexString.fromText(JSON.stringify(data)));}
    if(mode==='hidden')a.set(PDFName.of('F'),PDFNumber.of(6));
    if(mode==='locked')a.set(PDFName.of('F'),PDFNumber.of(132));
    if(mode==='optional')a.set(PDFName.of('OC'),doc.context.obj({Type:'OCG',Name:PDFHexString.fromText('Capa opcional')}));
    if(mode==='appearance')a.lookup(PDFName.of('AP'),PDFDict).lookup(PDFName.of('N')).dict.set(PDFName.of('Matrix'),doc.context.obj([1,0,0,1,20,0]));
    const bytes=await doc.save(),opened=await prepareEditablePdf(bytes);assert.equal(opened.marks.length,0);assert.equal(opened.retained,1);assert.equal(opened.bytes,bytes);assert.equal(annots(await PDFDocument.load(opened.bytes)).length,1);
  }
});
test('unowned native annotations, links, widgets, replies and later overlapping appearances are preserved',async()=>{
  const doc=await PDFDocument.load(await exportPdf(await source(),model([text()]))),page=doc.getPage(0),target=page.node.Annots().get(0),owned=doc.context.lookup(target),rect=owned.lookup(PDFName.of('Rect'),PDFArray);
  const reply=doc.context.obj({Type:'Annot',Subtype:'Text',Rect:[50,50,70,70],Contents:PDFHexString.fromText('Respuesta'),IRT:target,F:4});page.node.addAnnot(doc.context.register(reply));
  const foreign=doc.context.obj({Type:'Annot',Subtype:'FreeText',Rect:rect,Contents:PDFHexString.fromText('Texto externo'),DA:PDFHexString.fromText('/Helv 12 Tf 0 g'),F:4});page.node.addAnnot(doc.context.register(foreign));
  page.node.addAnnot(doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[40,90,140,110],Border:[0,0,0],A:{S:'URI',URI:PDFHexString.fromText('https://example.org/')}})));
  const field=doc.getForm().createTextField('Nombre');field.setText('Valor');field.addToPage(page,{x:30,y:50,width:100,height:20});
  const bytes=await doc.save(),opened=await prepareEditablePdf(bytes),read=await PDFDocument.load(opened.bytes);assert.equal(opened.marks.length,0);assert.equal(opened.retained,3);assert.equal(annots(read).length,5);assert.equal(read.getForm().getTextField('Nombre').getText(),'Valor');assert.equal(annots(read).find(a=>a.get(PDFName.of('Subtype')).toString()==='/Link').lookup(PDFName.of('A'),PDFDict).get(PDFName.of('URI')).decodeText(),'https://example.org/');
});
test('duplicating pages restores unique annotation IDs and removal respects shared reference arrays',async()=>{
  const saved=await exportPdf(await source(),model()),duplicate=await manipulate(saved,'duplicate',{indices:[0]}),opened=await prepareEditablePdf(duplicate);assert.equal(opened.marks.length,4);assert.equal(new Set(opened.marks.map(m=>m.id)).size,4);assert.deepEqual(opened.marks.map(m=>m.page),[1,1,2,2]);
  const doc=await PDFDocument.load(saved),other=doc.addPage([600,800]);other.node.set(PDFName.of('Annots'),doc.getPage(0).node.Annots());const shared=await prepareEditablePdf(await doc.save());assert.equal(shared.marks.length,4);for(const page of (await PDFDocument.load(shared.bytes)).getPages())assert.equal(page.node.Annots()?.size()||0,0);
});
test('unreachable appearance data is collected across repeated saves, while attachments and fields remain rooted',async()=>{
  const doc=await PDFDocument.load(await source());await doc.attach(new TextEncoder().encode('Adjunto conservado'),'nota.txt');const field=doc.getForm().createTextField('Campo');field.addToPage(doc.getPage(0),{x:30,y:40,width:150,height:20});field.setText('Conservado');let bytes=await doc.save(),counts=[];
  for(let n=0;n<8;n++){const prepared=await prepareEditablePdf(await exportPdf(bytes,model([{...text(),text:'Versión '+n}])));bytes=prepared.bytes;const loaded=await PDFDocument.load(bytes);counts.push(loaded.context.enumerateIndirectObjects().length);assert.equal(loaded.getForm().getTextField('Campo').getText(),'Conservado');assert.ok(loaded.catalog.get(PDFName.of('Names')));}
  assert.ok(Math.max(...counts)-Math.min(...counts)<4,counts.join(','));
});
test('explicit fixed-content copy contains no owned FreeText or Highlight annotations',async()=>{
  const out=await exportPdf(await source(),model(),{flatten:true}),doc=await PDFDocument.load(out);assert.equal(annots(doc).length,0);assert.equal((await prepareEditablePdf(out)).marks.length,0);assert.ok(doc.getPage(0).node.Contents().size()>0);
});

const lines=()=>[
  {id:'u',tool:'underline',page:1,x:.15,y:.2,w:.5,h:.04,size:12,color:'#c42b45',opacity:.55,rotation:17},
  {id:'s',tool:'strike',page:1,x:.15,y:.55,w:.5,h:.04,size:8,color:'#2357d9',opacity:.7,rotation:345}
];
test('Underline and StrikeOut roundtrip their styles and enclose the entire stroke on every page rotation and UserUnit',async()=>{
  for(const rotation of [0,90,180,270])for(const unit of [1,2]){
    const marks=lines(),out=await exportPdf(await source(rotation,unit),model(marks)),doc=await PDFDocument.load(out),g=pageGeometry(doc.getPage(0));
    for(const [i,a]of annots(doc).entries()){
      const m=marks[i];assert.equal(a.get(PDFName.of('Subtype')).toString(),i===0?'/Underline':'/StrikeOut');assert.equal(a.lookup(PDFName.of('CA'),PDFNumber).asNumber(),m.opacity);assert.equal(a.lookup(PDFName.of('BS'),PDFDict).lookup(PDFName.of('W'),PDFNumber).asNumber(),m.size/unit);assert.equal(a.lookup(PDFName.of('QuadPoints'),PDFArray).size(),8);
      const rect=a.lookup(PDFName.of('Rect'),PDFArray).asArray().map(v=>v.asNumber()),half=m.size/(2*unit),y=m.y+m.h*(m.tool==='underline'?1:.5);
      for(const x of [m.x,m.x+m.w]){const point=rotatePoint(x,y,m.x+m.w/2,m.y+m.h/2,m.rotation,g.width,g.height),[px,py]=viewToPdf(...point,g.width,g.height,g.rotation,g.crop);assert.ok(px-half>=rect[0]-1e-7&&px+half<=rect[2]+1e-7&&py-half>=rect[1]-1e-7&&py+half<=rect[3]+1e-7);}
    }
    const opened=await prepareEditablePdf(out);assert.equal(opened.retained,0);assert.deepEqual(opened.marks,marks);assert.equal(annots(await PDFDocument.load(opened.bytes)).length,0);
  }
});

test('native line edits, removal, structural changes and fixed copies preserve the expected annotation set',async()=>{
  const bytes=await source(),saved=await exportPdf(bytes,model(lines())),opened=await prepareEditablePdf(saved),changed={...opened.marks[0],x:.25,size:6,color:'#008577',opacity:.35,rotation:30};
  let base=opened.bytes;for(let n=0;n<4;n++){const out=await exportPdf(base,model([changed])),prepared=await prepareEditablePdf(out);assert.equal(annots(await PDFDocument.load(out)).length,1);assert.deepEqual(prepared.marks,[changed]);base=prepared.bytes;}
  assert.equal(annots(await PDFDocument.load(await exportPdf(base,model([])))).length,0);
  const duplicated=await prepareEditablePdf(await manipulate(saved,'duplicate',{indices:[0]}));assert.equal(duplicated.marks.length,4);assert.equal(new Set(duplicated.marks.map(m=>m.id)).size,4);
  const rotated=await prepareEditablePdf(await manipulate(saved,'rotate',{indices:[0]}));assert.deepEqual(rotated.marks.map(m=>m.rotation),[107,75]);
  const crop=await prepareEditablePdf(await manipulate(saved,'crop-visual',{indices:[0],rect:{x:.1,y:.1,w:.8,h:.8}}));assert.equal(crop.marks.length,2);
  const flat=await exportPdf(bytes,model([text(),highlight(),...lines()]),{flatten:true});assert.equal(annots(await PDFDocument.load(flat)).length,0);assert.equal((await prepareEditablePdf(flat)).marks.length,0);
});

test('external or modified Underline and StrikeOut annotations stay read-only with their native data intact',async()=>{
  for(const tool of ['underline','strike'])for(const mode of ['foreign','width','quads','locked']){
    const mark=lines().find(m=>m.tool===tool),doc=await PDFDocument.load(await exportPdf(await source(),model([mark]))),a=annots(doc)[0];
    if(mode==='foreign')a.delete(PDFName.of('PDFReaderCO'));
    if(mode==='width')a.lookup(PDFName.of('BS'),PDFDict).set(PDFName.of('W'),PDFNumber.of(25));
    if(mode==='quads')a.lookup(PDFName.of('QuadPoints'),PDFArray).set(0,PDFNumber.of(99));
    if(mode==='locked')a.set(PDFName.of('F'),PDFNumber.of(132));
    const bytes=await doc.save(),prepared=await prepareEditablePdf(bytes);assert.equal(prepared.bytes,bytes);assert.equal(prepared.retained,1);assert.equal(prepared.marks.length,0);assert.equal(annots(await PDFDocument.load(prepared.bytes)).length,1);
  }
});

test('PDFs exported by released version 1.3.0 retain editable text and highlights',async()=>{
  const opened=await prepareEditablePdf(new Uint8Array(await readFile(new URL('./fixtures/native-1.3.0.pdf',import.meta.url))));assert.equal(opened.retained,0);assert.deepEqual(opened.marks.map(m=>m.tool),['text','highlight']);assert.equal(opened.marks[0].text,'Revisión española\nSegunda línea');
});

const shapes=()=>[
  {id:'r',tool:'rect',page:1,x:.15,y:.15,w:.45,h:.17,size:16,color:'#7030a0',fill:'#f0a030',fillOpacity:.3,opacity:.6,rotation:35},
  {id:'e',tool:'ellipse',page:1,x:.18,y:.55,w:.4,h:.2,size:10,color:'#138b50',fill:'#44c4b2',fillOpacity:.4,opacity:.75,rotation:325}
];
test('Square and Circle retain their border, fill, independent opacity and full rotated stroke bounds',async()=>{
  for(const rotation of [0,90,180,270])for(const unit of [1,2]){
    const marks=shapes(),out=await exportPdf(await source(rotation,unit),model(marks)),doc=await PDFDocument.load(out),geometry=pageGeometry(doc.getPage(0));
    for(const [i,a]of annots(doc).entries()){
      const m=marks[i],rect=a.lookup(PDFName.of('Rect'),PDFArray).asArray().map(n=>n.asNumber());assert.equal(a.get(PDFName.of('Subtype')).toString(),i===0?'/Square':'/Circle');assert.equal(a.has(PDFName.of('QuadPoints')),false);assert.equal(a.lookup(PDFName.of('BS'),PDFDict).lookup(PDFName.of('W'),PDFNumber).asNumber(),m.size/unit);assert.equal(a.lookup(PDFName.of('CA'),PDFNumber).asNumber(),m.opacity);assert.deepEqual(a.lookup(PDFName.of('IC'),PDFArray).asArray().map(n=>n.asNumber()),[1,3,5].map(n=>parseInt(m.fill.slice(n,n+2),16)/255));
      const ap=a.lookup(PDFName.of('AP'),PDFDict).lookup(PDFName.of('N')),states=ap.dict.lookup(PDFName.of('Resources'),PDFDict).lookup(PDFName.of('ExtGState'),PDFDict).entries().map(([,ref])=>doc.context.lookup(ref));assert.ok(states.some(s=>s.lookupMaybe(PDFName.of('CA'),PDFNumber)?.asNumber()===m.opacity));assert.ok(states.some(s=>Math.abs((s.lookupMaybe(PDFName.of('ca'),PDFNumber)?.asNumber()??-1)-m.opacity*m.fillOpacity)<1e-8));
      if(m.tool==='rect'){
        const dx=m.size/(2*geometry.width),dy=m.size/(2*geometry.height);
        for(const x of [m.x-dx,m.x+m.w+dx])for(const y of [m.y-dy,m.y+m.h+dy]){const point=rotatePoint(x,y,m.x+m.w/2,m.y+m.h/2,m.rotation,geometry.width,geometry.height),[px,py]=viewToPdf(...point,geometry.width,geometry.height,geometry.rotation,geometry.crop);assert.ok(px>=rect[0]-1e-7&&px<=rect[2]+1e-7&&py>=rect[1]-1e-7&&py<=rect[3]+1e-7);}
      }
    }
    const opened=await prepareEditablePdf(out);assert.equal(opened.retained,0);assert.deepEqual(opened.marks,marks);assert.equal(annots(await PDFDocument.load(opened.bytes)).length,0);
  }
});

test('native shapes support repeated edits, deleting fill or objects, page operations and fixed export without duplicates',async()=>{
  const original=await source(),saved=await exportPdf(original,model(shapes())),opened=await prepareEditablePdf(saved);let base=opened.bytes;
  const changed={...opened.marks[0],x:.25,size:8,opacity:.5,fillOpacity:0,rotation:90};delete changed.fill;
  for(let n=0;n<4;n++){const out=await exportPdf(base,model([changed])),doc=await PDFDocument.load(out);assert.equal(annots(doc).length,1);assert.equal(annots(doc)[0].has(PDFName.of('IC')),false);const read=await prepareEditablePdf(out);assert.deepEqual(read.marks,[changed]);base=read.bytes;}
  assert.equal(annots(await PDFDocument.load(await exportPdf(base,model([])))).length,0);
  const duplicate=await prepareEditablePdf(await manipulate(saved,'duplicate',{indices:[0]}));assert.equal(duplicate.marks.length,4);assert.equal(new Set(duplicate.marks.map(m=>m.id)).size,4);
  const rotated=await prepareEditablePdf(await manipulate(saved,'rotate',{indices:[0]}));assert.deepEqual(rotated.marks.map(m=>m.rotation),[125,55]);
  const cropped=await prepareEditablePdf(await manipulate(saved,'crop-visual',{indices:[0],rect:{x:.1,y:.1,w:.8,h:.8}}));assert.equal(cropped.marks.length,2);
  const flat=await exportPdf(original,model([text(),highlight(),...lines(),...shapes()]),{flatten:true});assert.equal(annots(await PDFDocument.load(flat)).length,0);assert.equal((await prepareEditablePdf(flat)).marks.length,0);
});

test('external shape changes in fill, border, rectangle differences, effects or appearance remain read-only',async()=>{
  for(const tool of ['rect','ellipse'])for(const mode of ['foreign','fill','border','inset','effect','appearance','private']){
    const doc=await PDFDocument.load(await exportPdf(await source(),model(shapes().filter(m=>m.tool===tool)))),a=annots(doc)[0];
    if(mode==='foreign')a.delete(PDFName.of('PDFReaderCO'));
    if(mode==='fill')a.set(PDFName.of('IC'),doc.context.obj([1,0,0]));
    if(mode==='border')a.lookup(PDFName.of('BS'),PDFDict).set(PDFName.of('W'),PDFNumber.of(25));
    if(mode==='inset')a.set(PDFName.of('RD'),doc.context.obj([27,27,27,27]));
    if(mode==='effect')a.set(PDFName.of('BE'),doc.context.obj({S:'C',I:2}));
    if(mode==='appearance')a.lookup(PDFName.of('AP'),PDFDict).lookup(PDFName.of('N')).dict.set(PDFName.of('Matrix'),doc.context.obj([1,0,0,1,30,0]));
    if(mode==='private'){const data=JSON.parse(a.get(PDFName.of('PDFReaderCO')).decodeText());data.mark.fillOpacity=.99;a.set(PDFName.of('PDFReaderCO'),PDFHexString.fromText(JSON.stringify(data)));}
    const bytes=await doc.save(),read=await prepareEditablePdf(bytes);assert.ok(read.bytes===bytes,tool+': '+mode);assert.equal(read.retained,1);assert.equal(read.marks.length,0);assert.equal(annots(await PDFDocument.load(read.bytes)).length,1);
  }
});

test('PDFs exported by released version 1.4.0 retain all four editable text and markup types',async()=>{
  const read=await prepareEditablePdf(new Uint8Array(await readFile(new URL('./fixtures/native-1.4.0.pdf',import.meta.url))));assert.equal(read.retained,0);assert.deepEqual(read.marks.map(m=>m.tool),['text','highlight','underline','strike']);
});
