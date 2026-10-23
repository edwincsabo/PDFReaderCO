import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFHexString, degrees } from 'pdf-lib';
import { exportPdf, manipulate, encodeProject, decodeProject } from '../src/pdf-engine.mjs';
import { prepareEditablePdf } from '../src/native-annotations.mjs';

const note=()=>({id:'note',page:1,tool:'note',x:.23,y:.35,w:.04,h:.03,size:2,color:'#ffdf60',opacity:.65,rotation:0,text:'Revisión española áéíóú\n第二行 · Ελληνικά'});
const model=marks=>({marks,forms:{}});
async function source(rotation=0,unit=1){const doc=await PDFDocument.create(),p=doc.addPage([600,800]);p.setCropBox(20,30,500,700);p.setRotation(degrees(rotation));p.node.set(PDFName.of('UserUnit'),PDFNumber.of(unit));return doc.save();}
function annotations(doc){return doc.getPage(0).node.Annots()?.asArray().map(ref=>doc.context.lookup(ref))||[];}
function center(a){const values=a.lookup(PDFName.of('Rect'),PDFArray).asArray().map(n=>n.asNumber());return [(values[0]+values[2])/2,(values[1]+values[3])/2];}

test('Text comments retain Unicode content, standard icon, opacity and own appearance on all page rotations',async()=>{
  for(const rotation of [0,90,180,270])for(const unit of [1,2]){
    const mark=note(),saved=await exportPdf(await source(rotation,unit),model([mark])),doc=await PDFDocument.load(saved),a=annotations(doc)[0];assert.equal(a.get(PDFName.of('Subtype')).toString(),'/Text');assert.equal(a.get(PDFName.of('Name')).toString(),'/Comment');assert.equal(a.get(PDFName.of('Open')).toString(),'false');assert.equal(a.get(PDFName.of('Contents')).decodeText(),mark.text);assert.equal(a.lookup(PDFName.of('CA'),PDFNumber).asNumber(),.65);assert.equal(a.has(PDFName.of('QuadPoints')),false);assert.equal(a.has(PDFName.of('InkList')),false);assert.equal(a.lookup(PDFName.of('F'),PDFNumber).asNumber(),4);assert.ok(a.lookup(PDFName.of('AP'),PDFDict).lookup(PDFName.of('N')).dict.has(PDFName.of('Resources')));assert.equal(doc.getPage(0).node.Contents()?.size()||0,0);
    const opened=await prepareEditablePdf(saved);assert.equal(opened.retained,0);assert.deepEqual(opened.marks,[mark]);assert.equal(annotations(await PDFDocument.load(opened.bytes)).length,0);assert.deepEqual(decodeProject(encodeProject(opened.bytes,model(opened.marks))).model.marks,[mark]);
  }
});

test('comment edits and deletion remove their entire appearance without fixed ghosts or repeated copies',async()=>{
  let prepared=await prepareEditablePdf(await exportPdf(await source(),model([note()]))),counts=[];const changed={...note(),text:'Comentario corregido\n日本語 y español',x:.4,y:.5,color:'#008577',opacity:.4};
  for(let n=0;n<6;n++){const saved=await exportPdf(prepared.bytes,model([changed])),doc=await PDFDocument.load(saved);assert.equal(annotations(doc).length,1);assert.equal(annotations(doc)[0].get(PDFName.of('Contents')).decodeText(),changed.text);assert.equal(doc.getPage(0).node.Contents()?.size()||0,0);counts.push(doc.context.enumerateIndirectObjects().length);prepared=await prepareEditablePdf(saved);assert.deepEqual(prepared.marks,[changed]);}
  assert.ok(Math.max(...counts)-Math.min(...counts)<3);const removed=await PDFDocument.load(await exportPdf(prepared.bytes,model([])));assert.equal(annotations(removed).length,0);assert.equal(removed.getPage(0).node.Contents()?.size()||0,0);
});

test('comments survive page rotation, crop and duplicate with stable physical center and distinct identifiers',async()=>{
  const saved=await exportPdf(await source(),model([note()])),before=center(annotations(await PDFDocument.load(saved))[0]),rotated=await manipulate(saved,'rotate',{indices:[0]}),cropped=await manipulate(rotated,'crop-visual',{indices:[0],rect:{x:.1,y:.1,w:.8,h:.8}}),prepared=await prepareEditablePdf(cropped);assert.equal(prepared.marks.length,1);assert.equal(prepared.marks[0].rotation,90);assert.equal(prepared.marks[0].text,note().text);const after=center(annotations(await PDFDocument.load(await exportPdf(prepared.bytes,model(prepared.marks))))[0]);assert.ok(Math.abs(before[0]-after[0])<1e-7&&Math.abs(before[1]-after[1])<1e-7);
  const duplicated=await prepareEditablePdf(await manipulate(saved,'duplicate',{indices:[0]}));assert.equal(duplicated.marks.length,2);assert.equal(new Set(duplicated.marks.map(m=>m.id)).size,2);assert.deepEqual(duplicated.marks.map(m=>m.page),[1,2]);
});

test('external comment changes and thread relationships remain native read-only with their contents intact',async()=>{
  for(const mode of ['foreign','contents','name','open','state','subject','appearance','locked','metadata','reply','popup']){
    const doc=await PDFDocument.load(await exportPdf(await source(),model([note()]))),page=doc.getPage(0),ref=page.node.Annots().get(0),a=doc.context.lookup(ref);
    if(mode==='foreign')a.delete(PDFName.of('PDFReaderCO'));
    if(mode==='contents')a.set(PDFName.of('Contents'),PDFHexString.fromText('Texto cambiado fuera'));
    if(mode==='name')a.set(PDFName.of('Name'),PDFName.of('Help'));
    if(mode==='open')a.set(PDFName.of('Open'),doc.context.obj(true));
    if(mode==='state'){a.set(PDFName.of('State'),PDFHexString.fromText('Accepted'));a.set(PDFName.of('StateModel'),PDFHexString.fromText('Review'));}
    if(mode==='subject')a.set(PDFName.of('Subj'),PDFHexString.fromText('Revisión externa'));
    if(mode==='appearance')a.lookup(PDFName.of('AP'),PDFDict).lookup(PDFName.of('N')).dict.set(PDFName.of('Matrix'),doc.context.obj([1,0,0,1,10,0]));
    if(mode==='locked')a.set(PDFName.of('F'),PDFNumber.of(132));
    if(mode==='metadata'){const data=JSON.parse(a.get(PDFName.of('PDFReaderCO')).decodeText());data.mark.text='Datos privados cambiados';a.set(PDFName.of('PDFReaderCO'),PDFHexString.fromText(JSON.stringify(data)));}
    if(mode==='reply')page.node.addAnnot(doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Text',Rect:[30,30,50,50],IRT:ref,Contents:PDFHexString.fromText('Respuesta conservada'),F:4})));
    if(mode==='popup'){const popup=doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Popup',Rect:[30,30,100,100],Parent:ref}));a.set(PDFName.of('Popup'),popup);page.node.addAnnot(popup);}
    const bytes=await doc.save(),prepared=await prepareEditablePdf(bytes);assert.ok(prepared.bytes===bytes,mode);assert.equal(prepared.marks.length,0);assert.equal(prepared.retained,mode==='reply'?2:1);assert.equal(annotations(await PDFDocument.load(prepared.bytes)).length,['reply','popup'].includes(mode)?2:1);
  }
});

test('fixed copies retain readable standard comments without editable metadata or baked duplicate icons',async()=>{
  const saved=await exportPdf(await source(),model([note()]),{flatten:true}),doc=await PDFDocument.load(saved),a=annotations(doc)[0];assert.equal(annotations(doc).length,1);assert.equal(a.get(PDFName.of('Subtype')).toString(),'/Text');assert.equal(a.get(PDFName.of('Contents')).decodeText(),note().text);assert.equal(a.has(PDFName.of('PDFReaderCO')),false);assert.equal(doc.getPage(0).node.Contents()?.size()||0,0);const opened=await prepareEditablePdf(saved);assert.equal(opened.marks.length,0);assert.equal(opened.retained,1);
});

test('released 1.8.0 PDF still restores its seven native types and plain legacy comments stay read-only',async()=>{
  const prepared=await prepareEditablePdf(new Uint8Array(await readFile(new URL('./fixtures/native-1.8.0.pdf',import.meta.url))));assert.equal(prepared.retained,0);assert.deepEqual(prepared.marks.map(m=>m.tool),['text','highlight','underline','strike','rect','ellipse','pen']);const doc=await PDFDocument.load(await source());doc.getPage(0).node.addAnnot(doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Text',Rect:[30,30,50,50],T:PDFHexString.fromText('PDFReaderCO'),Contents:PDFHexString.fromText('Nota anterior sin metadatos propios'),Name:'Comment',F:4})));const legacy=await prepareEditablePdf(await doc.save());assert.equal(legacy.marks.length,0);assert.equal(legacy.retained,1);
});
