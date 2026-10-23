import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFHexString, degrees } from 'pdf-lib';
import { exportPdf, manipulate, encodeProject, decodeProject } from '../src/pdf-engine.mjs';
import { prepareEditablePdf } from '../src/native-annotations.mjs';
import { pageGeometry, viewToPdf } from '../src/pdf-coordinates.mjs';
import { annotationBox } from '../src/text-layout.mjs';
import { pointBounds, rotatePoint, translateMarks, resizeMark } from '../src/annotation-geometry.mjs';

const ink=()=>({id:'ink',page:1,tool:'pen',x:.15,y:.2,w:.5,h:.3,size:14,color:'#dc6700',opacity:.55,rotation:25,points:[[.15,.2],[.65,.35],[.25,.5],[.15,.2],[.45,.25]]});
const model=marks=>({marks,forms:{}});
async function source(rotation=0,unit=1){const doc=await PDFDocument.create(),p=doc.addPage([600,800]);p.setCropBox(20,30,500,700);p.setRotation(degrees(rotation));p.node.set(PDFName.of('UserUnit'),PDFNumber.of(unit));return doc.save();}
function annotations(doc){return doc.getPage(0).node.Annots()?.asArray().map(ref=>doc.context.lookup(ref))||[];}
function coordinates(doc){return annotations(doc)[0].lookup(PDFName.of('InkList'),PDFArray).lookup(0,PDFArray).asArray().map(n=>n.asNumber());}
function near(a,b){assert.equal(a.length,b.length);a.forEach((n,i)=>assert.ok(Math.abs(n-b[i])<1e-7,`${i}: ${n} != ${b[i]}`));}

test('Ink contains standard coordinates, border, opacity, rounded appearance and complete rotated bounds',async()=>{
  for(const rotation of [0,90,180,270])for(const unit of [1,2]){
    const mark=ink(),bytes=await exportPdf(await source(rotation,unit),model([mark])),doc=await PDFDocument.load(bytes),a=annotations(doc)[0],g=pageGeometry(doc.getPage(0)),b=annotationBox(mark,g.width,g.height),raw=coordinates(doc),rect=a.lookup(PDFName.of('Rect'),PDFArray).asArray().map(n=>n.asNumber());
    assert.equal(a.get(PDFName.of('Subtype')).toString(),'/Ink');assert.equal(a.has(PDFName.of('QuadPoints')),false);assert.equal(raw.length,mark.points.length*2);assert.equal(a.lookup(PDFName.of('CA'),PDFNumber).asNumber(),.55);assert.equal(a.lookup(PDFName.of('BS'),PDFDict).lookup(PDFName.of('W'),PDFNumber).asNumber(),14/unit);
    const expected=mark.points.flatMap(([x,y])=>{const point=rotatePoint(x,y,b.x+b.w/2,b.y+b.h/2,mark.rotation,g.width,g.height);return viewToPdf(...point,g.width,g.height,g.rotation,g.crop);});near(raw,expected);
    for(let i=0;i<raw.length;i+=2){const half=mark.size/(2*unit);assert.ok(raw[i]-half>=rect[0]-1e-7&&raw[i]+half<=rect[2]+1e-7&&raw[i+1]-half>=rect[1]-1e-7&&raw[i+1]+half<=rect[3]+1e-7);}
    const ap=a.lookup(PDFName.of('AP'),PDFDict).lookup(PDFName.of('N'));assert.ok(ap.dict.has(PDFName.of('Resources')));const drawing=inflateSync(ap.getContents()).toString('latin1');assert.match(drawing,/1 J/);assert.match(drawing,/1 j/);assert.equal(drawing.match(/\nS\n/g)?.length,1);const read=await prepareEditablePdf(bytes);assert.deepEqual(read.marks,[mark]);assert.equal(annotations(await PDFDocument.load(read.bytes)).length,0);assert.deepEqual(decodeProject(encodeProject(read.bytes,model(read.marks))).model.marks,[mark]);
  }
});

test('page rotation, crop and UserUnit changes preserve every physical InkList coordinate including degenerate strokes',async()=>{
  for(const kind of ['loop','horizontal','vertical']){
    const mark=ink();if(kind==='horizontal')Object.assign(mark,{rotation:45,x:.2,y:.3,w:.4,h:0,points:[[.2,.3],[.6,.3]]});if(kind==='vertical')Object.assign(mark,{rotation:20,x:.3,y:.2,w:0,h:.4,points:[[.3,.2],[.3,.6]]});
    const saved=await exportPdf(await source(0,2),model([mark])),original=coordinates(await PDFDocument.load(saved));
    const rotated=await manipulate(saved,'rotate',{indices:[0]}),cropped=await manipulate(rotated,'crop-visual',{indices:[0],rect:{x:.1,y:.1,w:.8,h:.8}}),changed=await PDFDocument.load(cropped);changed.getPage(0).node.set(PDFName.of('UserUnit'),PDFNumber.of(.5));
    const opened=await prepareEditablePdf(await changed.save());assert.equal(opened.marks.length,1);assert.equal(opened.marks[0].points.length,mark.points.length);const resaved=await PDFDocument.load(await exportPdf(opened.bytes,model(opened.marks)));near(coordinates(resaved),original);
  }
});

test('Ink edits, resize, grouped movement, duplication and deletion survive repeated save cycles',async()=>{
  const mark=ink(),bytes=await source(),opened=await prepareEditablePdf(await exportPdf(bytes,model([mark]))),box=annotationBox(mark,500,700),resized=resizeMark(mark,box,{...box,w:box.w*1.2,h:box.h*1.2},500,700),moved=translateMarks([resized],.02,.03,{x:0,y:0,w:.9,h:.9})[0],edited={...moved,color:'#008577',opacity:.4,size:8};let base=opened.bytes,counts=[];
  for(let n=0;n<6;n++){const out=await exportPdf(base,model([edited])),doc=await PDFDocument.load(out);assert.equal(annotations(doc).length,1);counts.push(doc.context.enumerateIndirectObjects().length);const prepared=await prepareEditablePdf(out);assert.deepEqual(prepared.marks,[edited]);base=prepared.bytes;}
  assert.ok(Math.max(...counts)-Math.min(...counts)<3);const duplicate=await prepareEditablePdf(await manipulate(await exportPdf(base,model([edited])),'duplicate',{indices:[0]}));assert.equal(duplicate.marks.length,2);assert.equal(new Set(duplicate.marks.map(m=>m.id)).size,2);assert.deepEqual(duplicate.marks[0].points,duplicate.marks[1].points);assert.equal(annotations(await PDFDocument.load(await exportPdf(base,model([])))).length,0);
});

test('external Ink, changed paths, locked objects and modified appearance remain native and untouched',async()=>{
  for(const mode of ['foreign','path','width','locked','appearance','metadata']){
    const doc=await PDFDocument.load(await exportPdf(await source(),model([ink()]))),a=annotations(doc)[0];
    if(mode==='foreign')a.delete(PDFName.of('PDFReaderCO'));
    if(mode==='path')a.lookup(PDFName.of('InkList'),PDFArray).lookup(0,PDFArray).set(0,PDFNumber.of(999));
    if(mode==='width')a.lookup(PDFName.of('BS'),PDFDict).set(PDFName.of('W'),PDFNumber.of(25));
    if(mode==='locked')a.set(PDFName.of('F'),PDFNumber.of(132));
    if(mode==='appearance')a.lookup(PDFName.of('AP'),PDFDict).lookup(PDFName.of('N')).dict.set(PDFName.of('Matrix'),doc.context.obj([1,0,0,1,30,0]));
    if(mode==='metadata'){const data=JSON.parse(a.get(PDFName.of('PDFReaderCO')).decodeText());data.mark.points[1][0]=.99;a.set(PDFName.of('PDFReaderCO'),PDFHexString.fromText(JSON.stringify(data)));}
    const bytes=await doc.save(),prepared=await prepareEditablePdf(bytes);assert.ok(prepared.bytes===bytes,mode);assert.equal(prepared.marks.length,0);assert.equal(prepared.retained,1);assert.equal(annotations(await PDFDocument.load(prepared.bytes)).length,1);
  }
});

test('loop bounds include all points, legacy inaccurate boxes are expanded, and very long native strokes fail explicitly',async()=>{
  const mark={...ink(),x:.15,y:.2,w:.01,h:.01};assert.deepEqual(pointBounds(mark.points),{x:.15,y:.2,w:.5,h:.3});const b=annotationBox(mark,500,700);assert.equal(b.w,.5);assert.equal(b.h,.3);const saved=await exportPdf(await source(),model([mark]));assert.equal((await prepareEditablePdf(saved)).marks[0].points.length,5);
  const long={...ink(),points:Array.from({length:15000},(_,n)=>[n/15000,(n%37)/37])};await assert.rejects(async()=>exportPdf(await source(),model([long])),/Divide el dibujo/);
});

test('fixed-copy export draws Ink into page content while released 1.7.0 files retain all six editable types',async()=>{
  const bytes=await exportPdf(await source(),model([ink()]),{flatten:true}),doc=await PDFDocument.load(bytes);assert.equal(annotations(doc).length,0);assert.ok(doc.getPage(0).node.Contents().size()>0);const old=await prepareEditablePdf(new Uint8Array(await readFile(new URL('./fixtures/native-1.7.0.pdf',import.meta.url))));assert.equal(old.retained,0);assert.deepEqual(old.marks.map(m=>m.tool),['text','highlight','underline','strike','rect','ellipse']);
});
