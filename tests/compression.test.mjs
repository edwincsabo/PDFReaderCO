import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PDFDocument,PDFName,PDFDict,PDFRawStream,PDFNumber,decodePDFRawStream} from 'pdf-lib';
import {compressPdf,compressionProfile} from '../src/compression-engine.mjs';
import {compressionFixture} from './compression-fixture.mjs';
import {getFields,exportPdf} from '../src/pdf-engine.mjs';
const N=PDFName.of,jpeg=()=>readFile(new URL('./fixtures/compression-rgb.jpg',import.meta.url));
const images=doc=>doc.context.enumerateIndirectObjects().filter(([,s])=>s instanceof PDFRawStream&&s.dict.get(N('Subtype'))===N('Image'));
test('compression preserves vector page streams, metadata, pending form values, defaults, attachments and original bytes',async()=>{
  const source=await exportPdf(await compressionFixture(),{marks:[],forms:{Respuesta:'Respuesta actual'}}),copy=source.slice(),before=await PDFDocument.load(source);let calls=0;
  const out=await compressPdf(source,{preset:'balanced'},async info=>{calls++;assert.equal(info.data.length,64*64*3);assert.equal(info.targetWidth,64);return new Uint8Array(await jpeg());});assert.ok(out.reduced);assert.equal(out.changed,1);assert.equal(calls,1);assert.deepEqual(source,copy);
  const after=await PDFDocument.load(out.bytes);assert.equal(after.getTitle(),before.getTitle());assert.equal(after.getAuthor(),before.getAuthor());assert.equal((await getFields(out.bytes))[0].value,'Respuesta actual');assert.equal((await getFields(out.bytes))[0].defaultValue,'Valor inicial');
  const content=doc=>doc.getPage(0).node.Contents().asArray().map(ref=>Buffer.from(decodePDFRawStream(doc.context.lookup(ref)).decode()).toString('hex'));assert.deepEqual(content(after),content(before));assert.equal(after.catalog.lookup(N('Names'),PDFDict).lookup(N('EmbeddedFiles'),PDFDict).toString(),before.catalog.lookup(N('Names'),PDFDict).lookup(N('EmbeddedFiles'),PDFDict).toString());assert.equal(images(after)[0][1].dict.get(N('Filter')),N('DCTDecode'));
});
test('lossless profile never decodes images and returns the original when rewriting would not reduce size',async()=>{
  const source=await compressionFixture();let calls=0;const out=await compressPdf(source,{preset:'lossless'},()=>{calls++;throw new Error();});assert.equal(calls,0);assert.equal(out.changed,0);assert.equal(out.reduced,false);assert.deepEqual(out.bytes,source);const a=images(await PDFDocument.load(source))[0][1],b=images(await PDFDocument.load(out.bytes))[0][1];assert.deepEqual(a.contents,b.contents);assert.ok(out.after<=source.length);
  const again=await compressPdf(out.bytes,{preset:'lossless'},()=>{});assert.ok(again.after<=out.bytes.length);if(!again.reduced)assert.deepEqual(again.bytes,out.bytes);
});
test('compression skips alpha, decode parameters, CMYK, image masks and nonstandard color overrides without changing their streams',async()=>{
  for(const patch of[{SMask:'None'},{DecodeParms:{Predictor:12}},{ColorSpace:'DeviceCMYK'},{ImageMask:true},{Decode:[1,0,1,0,1,0]}]){
    const doc=await PDFDocument.load(await compressionFixture()),[,image]=images(doc)[0];for(const [key,v]of Object.entries(patch))image.dict.set(N(key),doc.context.obj(v));const bytes=await doc.save({updateFieldAppearances:false});let calls=0;const out=await compressPdf(bytes,{preset:'small'},()=>{calls++;});assert.equal(calls,0);assert.equal(out.changed,0);assert.deepEqual(images(await PDFDocument.load(out.bytes))[0][1].contents,image.contents);
  }
  const doc=await PDFDocument.load(await compressionFixture());doc.getPage(0).node.Resources().set(N('ColorSpace'),doc.context.obj({DefaultRGB:'DeviceRGB'}));const out=await compressPdf(await doc.save(),{preset:'small'},()=>{throw new Error('Must not run');});assert.equal(out.changed,0);
});
test('shared image in a nested Form is compressed once; image shared with an annotation appearance stays protected',async()=>{
  const doc=await PDFDocument.load(await compressionFixture()),[ref]=images(doc)[0],form=doc.context.register(doc.context.flateStream('q /Inner Do Q',{Type:'XObject',Subtype:'Form',BBox:[0,0,1,1],Resources:{XObject:{Inner:ref}}}));doc.getPage(0).node.Resources().lookup(N('XObject'),PDFDict).set(N('Nested'),form);
  let calls=0;const out=await compressPdf(await doc.save(),{preset:'high'},async()=>{calls++;return new Uint8Array(await jpeg());});assert.equal(calls,1);assert.equal(out.changed,1);
  doc.getPage(0).node.addAnnot(doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Stamp',Rect:[10,10,30,30],AP:{N:form}})));calls=0;const protectedResult=await compressPdf(await doc.save(),{preset:'high'},()=>{calls++;});assert.equal(calls,0);assert.equal(protectedResult.changed,0);
});
test('bad conversion, larger image encodings and malformed raw pixels are kept intact with a reason',async()=>{
  for(const convert of[()=>{throw new Error();},()=>new Uint8Array([1,2,3]),()=>{const b=new Uint8Array(20000);b.set([255,216]);b.set([255,217],19998);return b;}]){const source=await compressionFixture(),out=await compressPdf(source,{preset:'high'},convert);assert.equal(out.changed,0);assert.deepEqual(images(await PDFDocument.load(out.bytes))[0][1].contents,images(await PDFDocument.load(source))[0][1].contents);assert.ok(out.items[0].reason);}
  const doc=await PDFDocument.load(await compressionFixture());images(doc)[0][1].dict.set(N('Width'),PDFNumber.of(63));let called=false;const out=await compressPdf(await doc.save(),{preset:'high'},()=>{called=true;});assert.equal(called,false);assert.equal(out.changed,0);
});
test('profile validation and signed or encrypted inputs fail explicitly without modifying source bytes',async()=>{
  for(const p of[{}, {preset:'bad'},{preset:'custom',quality:.4,maxEdge:1000},{preset:'custom',quality:.8,maxEdge:799},{preset:'custom',quality:.8,maxEdge:NaN}])assert.throws(()=>compressionProfile(p));
  const bytes=await compressionFixture(),doc=await PDFDocument.load(bytes);doc.catalog.set(N('Perms'),doc.context.obj({}));await assert.rejects(compressPdf(await doc.save(),{preset:'high'},()=>{}),/firma/);
  const encrypted=new Uint8Array(await readFile(new URL('./fixtures/comparison-encrypted.pdf',import.meta.url)));await assert.rejects(compressPdf(encrypted,{preset:'high'},()=>{}),/cifrados/);await assert.rejects(compressPdf(new Uint8Array([1]),{preset:'high'},()=>{}),/leer/);
});
test('downsampling preserves aspect ratio without upscaling and custom profile reaches the image converter',async()=>{
  const bytes=await compressionFixture(1600,1000);let dimensions;await compressPdf(bytes,{preset:'custom',quality:.65,maxEdge:800},async info=>{dimensions=[info.targetWidth,info.targetHeight,info.quality];return new Uint8Array(await jpeg());});assert.deepEqual(dimensions,[800,500,.65]);
});
