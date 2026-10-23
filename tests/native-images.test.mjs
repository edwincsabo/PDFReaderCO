import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFNumber, PDFHexString, PDFArray, degrees } from 'pdf-lib';
import { exportPdf, manipulate, encodeProject, decodeProject } from '../src/pdf-engine.mjs';
import { prepareEditablePdf, annotationPaintOrder } from '../src/native-annotations.mjs';
import { imageData, MAX_IMAGE_BYTES } from '../src/image-assets.mjs';

const image=async(name,mime='png')=>'data:image/'+mime+';base64,'+(await readFile(new URL('./fixtures/'+name,import.meta.url))).toString('base64');
const png=await image('stamp-image.png'),jpeg=await image('stamp-photo.jpg','jpeg'),signature=await image('stamp-signature.png');
const mark=(tool='image',data=png)=>({id:tool,page:1,tool,x:.2,y:.3,w:.4,h:.12,size:4,color:'#123456',rotation:23,opacity:.55,...(data?{image:data}:{points:[[.2,.3],[.6,.42],[.2,.42],[.6,.3]]})});
const model=marks=>({marks,forms:{}});
async function source(rotation=0,unit=1){const doc=await PDFDocument.create(),p=doc.addPage([600,800]);p.setCropBox(20,30,500,700);p.setRotation(degrees(rotation));p.node.set(PDFName.of('UserUnit'),PDFNumber.of(unit));return doc.save();}
const annotations=doc=>doc.getPage(0).node.Annots()?.asArray().map(ref=>doc.context.lookup(ref))||[];
const assets=doc=>doc.context.enumerateIndirectObjects().filter(([,obj])=>obj.dict?.get(PDFName.of('Type'))?.toString()==='/PDFReaderCOImage');
const center=a=>{const r=a.lookup(PDFName.of('Rect'),PDFArray).asArray().map(n=>n.asNumber());return[(r[0]+r[2])/2,(r[1]+r[3])/2];};

test('image and visual signature Stamp annotations recover original PNG/JPEG bytes, transparency and styles across rotations and UserUnit',async()=>{
  for(const rotation of [0,90,180,270])for(const unit of [1,2])for(const [tool,data]of [['image',png],['image',jpeg],['signature',signature],['signature',null]]){
    const m=mark(tool,data),saved=await exportPdf(await source(rotation,unit),model([m])),doc=await PDFDocument.load(saved),a=annotations(doc)[0],metadata=JSON.parse(a.get(PDFName.of('PDFReaderCO')).decodeText());assert.equal(a.get(PDFName.of('Subtype')).toString(),'/Stamp');assert.equal(a.get(PDFName.of('Name')).toString(),tool==='image'?'/Image':'/Signature');assert.equal(a.has(PDFName.of('InkList')),false);assert.equal(a.has(PDFName.of('QuadPoints')),false);assert.equal(metadata.version,2);assert.equal(metadata.mark.image,undefined);assert.equal(doc.getPage(0).node.Contents()?.size()||0,0);assert.equal(assets(doc).length,data?1:0);
    const prepared=await prepareEditablePdf(saved);assert.equal(prepared.retained,0);assert.deepEqual(prepared.marks,[m]);const base=await PDFDocument.load(prepared.bytes);assert.equal(annotations(base).length,0);assert.equal(assets(base).length,0);assert.deepEqual(decodeProject(encodeProject(prepared.bytes,model(prepared.marks))).model,model([m]));
  }
});

test('images larger than JSON metadata limits use a separate original asset and shared images reuse one source stream',async()=>{
  const large=await image('stamp-large.png');assert.ok(large.length>256*1024);const m=mark('image',large),saved=await exportPdf(await source(),model([m,{...m,id:'copy',x:.55}])),doc=await PDFDocument.load(saved);assert.equal(assets(doc).length,1);assert.ok(annotations(doc).every(a=>a.get(PDFName.of('PDFReaderCO')).decodeText().length<2000));assert.deepEqual((await prepareEditablePdf(saved)).marks,[m,{...m,id:'copy',x:.55}]);
});

test('repeated image transforms, copies and deletion remove prior appearances and original assets without fixed ghosts or resource accumulation',async()=>{
  let prepared=await prepareEditablePdf(await exportPdf(await source(),model([mark(),mark('signature',signature)]))),counts=[];
  for(let n=0;n<6;n++){const marks=prepared.marks.map(m=>({...m,x:.1+n*.02,w:.25,rotation:50,opacity:.4})),saved=await exportPdf(prepared.bytes,model(marks)),doc=await PDFDocument.load(saved);counts.push(doc.context.enumerateIndirectObjects().length);assert.equal(annotations(doc).length,2);assert.equal(assets(doc).length,2);assert.equal(doc.getPage(0).node.Contents()?.size()||0,0);prepared=await prepareEditablePdf(saved);assert.deepEqual(prepared.marks,marks);}
  assert.ok(Math.max(...counts)-Math.min(...counts)<3);const removed=await PDFDocument.load(await exportPdf(prepared.bytes,model([])));assert.equal(assets(removed).length,0);assert.equal(annotations(removed).length,0);assert.equal(removed.getPage(0).node.Contents()?.size()||0,0);
});

test('native image page rotation, crop and duplicate retain physical placement and unique IDs',async()=>{
  for(const m of [mark(),mark('signature',signature),mark('signature',null)]){
    const saved=await exportPdf(await source(),model([m])),original=center(annotations(await PDFDocument.load(saved))[0]),changed=await manipulate(await manipulate(saved,'rotate',{indices:[0]}),'crop-visual',{indices:[0],rect:{x:.1,y:.1,w:.8,h:.8}}),opened=await prepareEditablePdf(changed);assert.equal(opened.marks.length,1);assert.equal(opened.marks[0].rotation,113);assert.equal(opened.marks[0].image,m.image);
    const after=center(annotations(await PDFDocument.load(await exportPdf(opened.bytes,model(opened.marks))))[0]);assert.ok(after.every((v,i)=>Math.abs(v-original[i])<1e-7));const duplicate=await prepareEditablePdf(await manipulate(saved,'duplicate',{indices:[0]}));assert.equal(duplicate.marks.length,2);assert.equal(new Set(duplicate.marks.map(m=>m.id)).size,2);
  }
});

test('external stamps and modified source bytes, appearances, names, metadata, locks or replies stay native and untouched',async()=>{
  for(const mode of ['foreign','asset','asset-filter','appearance','name','metadata','locked','reply']){
    const doc=await PDFDocument.load(await exportPdf(await source(),model([mark()]))),page=doc.getPage(0),ref=page.node.Annots().get(0),a=doc.context.lookup(ref);
    if(mode==='foreign')a.delete(PDFName.of('PDFReaderCO'));
    if(mode==='asset'){const asset=a.lookup(PDFName.of('PDFReaderCOAsset'));asset.contents[asset.contents.length-1]^=1;}
    if(mode==='asset-filter')a.lookup(PDFName.of('PDFReaderCOAsset')).dict.set(PDFName.of('Filter'),PDFName.of('FlateDecode'));
    if(mode==='appearance')a.lookup(PDFName.of('AP')).lookup(PDFName.of('N')).dict.set(PDFName.of('Matrix'),doc.context.obj([1,0,0,1,10,0]));
    if(mode==='name')a.set(PDFName.of('Name'),PDFName.of('Approved'));
    if(mode==='metadata'){const metadata=JSON.parse(a.get(PDFName.of('PDFReaderCO')).decodeText());metadata.mark.opacity=.1;a.set(PDFName.of('PDFReaderCO'),PDFHexString.fromText(JSON.stringify(metadata)));}
    if(mode==='locked')a.set(PDFName.of('F'),PDFNumber.of(132));
    if(mode==='reply')page.node.addAnnot(doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Text',Rect:[30,30,50,50],IRT:ref,Contents:'Respuesta',F:4})));
    const bytes=await doc.save(),prepared=await prepareEditablePdf(bytes);assert.equal(prepared.bytes,bytes,mode);assert.equal(prepared.marks.length,0);assert.equal(prepared.retained,mode==='reply'?2:1);
  }
});

test('fixed-copy export bakes visual objects into page content without native stamps or private original assets',async()=>{
  const saved=await exportPdf(await source(),model([mark(),mark('signature',signature),{...mark('signature',null),id:'vector'}]),{flatten:true}),doc=await PDFDocument.load(saved);assert.equal(annotations(doc).length,0);assert.equal(assets(doc).length,0);assert.ok(doc.getPage(0).node.Contents().size()>0);assert.equal((await prepareEditablePdf(saved)).marks.length,0);
});

test('image validation rejects malformed payloads, oversized files and excessive pixel dimensions before decoding',async()=>{
  for(const data of ['data:image/png;base64,AAAA','data:image/jpeg;base64,AAAA',png.replace('image/png','image/jpeg'),'data:image/png;base64,'+'A'.repeat(Math.ceil(MAX_IMAGE_BYTES/3)*4+4)])assert.throws(()=>imageData(data));
  const huge=Buffer.from(png.split(',')[1],'base64');huge.writeUInt32BE(100000,16);assert.throws(()=>imageData('data:image/png;base64,'+huge.toString('base64')),/píxeles/);await assert.rejects(()=>exportPdf(awaitableSource,model([{...mark(),image:'data:image/png;base64,AAAA'}])));
});
const awaitableSource=await source();

test('released 1.10.1 restores all eight prior native types and visual stacking remains compatible with older projects',async()=>{
  const opened=await prepareEditablePdf(new Uint8Array(await readFile(new URL('./fixtures/native-1.10.1.pdf',import.meta.url))));assert.equal(opened.retained,0);assert.deepEqual(opened.marks.map(m=>m.tool),['text','highlight','underline','strike','rect','ellipse','pen','note']);
  const text={...mark(),id:'text',tool:'text',text:'Encima'},imageMark=mark(),signatureMark=mark('signature',signature);assert.deepEqual(annotationPaintOrder([text,imageMark,signatureMark]).map(m=>m.id),['image','signature','text']);
});

test('native saving never rewrites original page content or accumulates graphics wrappers around an existing document',async()=>{
  const doc=await PDFDocument.create(),page=doc.addPage([600,800]);page.drawText('Contenido original');let bytes=await doc.save(),counts=[];
  for(let i=0;i<6;i++){const saved=await exportPdf(bytes,model([mark()])),loaded=await PDFDocument.load(saved);assert.equal(loaded.getPage(0).node.Contents().size(),1);counts.push(loaded.context.enumerateIndirectObjects().length);bytes=(await prepareEditablePdf(saved)).bytes;}
  assert.ok(Math.max(...counts)-Math.min(...counts)<3);
});
