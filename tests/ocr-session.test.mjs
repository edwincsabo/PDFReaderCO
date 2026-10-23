import test from'node:test';
import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{PDFDocument}from'pdf-lib';
import{encodeOcrSession,decodeOcrSession,packedOcrSession}from'../src/ocr-session.mjs';
import{ocrSourceId,ocrOptions}from'../src/ocr-engine.mjs';
import{normalizeOcrWords,rotationGeometry}from'../src/ocr-review.mjs';
import{encodeProject,decodeProject}from'../src/pdf-engine.mjs';
import{ocrMetrics,editDistance}from'../src/ocr-metrics.mjs';
const layer=new Uint8Array(await readFile('tests/fixtures/ocr-native-layer.pdf')),native=JSON.parse(await readFile('tests/fixtures/ocr-native-words.json','utf8'));
async function sample(){const doc=await PDFDocument.create();doc.addPage([600,800]);doc.addPage([600,800]);const bytes=await doc.save(),source=await ocrSourceId(bytes),options=ocrOptions({language:'spa+eng',dpi:200,range:'1-2',layout:'column'}),details=normalizeOcrWords(native.text,native.lines,1200,1600);details.words.find(w=>w.text==='2026').correction='2031';details.words[0].reviewed=true;return{bytes,session:{version:1,report:{source,options,pages:[{page:1,status:'recognized',text:native.text,confidence:91,language:'spa+eng',pdf:layer,geometry:rotationGeometry(1200,1600,0),preview:'not-persisted',message:'Control',...details}]},options,selected:[1],current:1,views:{1:{chosen:0,threshold:90,lowOnly:true,zoom:2}},remaining:[2],pixels:1920000}};}
test('OCR session roundtrip preserves native layer, corrections, confidence, pending pages, options and review position',async()=>{
  const{session}=await sample(),packed=await encodeOcrSession(session);assert.equal(packedOcrSession(packed),true);assert.equal(packed.encoding,'gzip-base64');const restored=await decodeOcrSession(packed,session.report.source);assert.deepEqual(restored.report.pages[0].pdf,layer);assert.equal(restored.report.pages[0].words.find(w=>w.text==='2026').correction,'2031');assert.equal(restored.report.pages[0].words[0].reviewed,true);assert.equal(restored.report.pages[0].preview,undefined);assert.deepEqual(restored.views,session.views);assert.deepEqual(restored.remaining,[2]);assert.equal(restored.options.layout,'column');assert.equal(restored.pixels,1920000);
});
test('OCR recovery stays separate from confirmed project content and a bad wrapper does not discard applied PDF/model',async()=>{
  const{bytes,session}=await sample(),model={forms:{},marks:[]},packed=await encodeOcrSession(session),project=decodeProject(encodeProject(bytes,model,undefined,packed));assert.deepEqual(project.bytes,bytes);assert.deepEqual(project.model,model);assert.ok(project.ocrReview);assert.equal(decodeProject(encodeProject(bytes,model)).ocrReview,null);
  const raw=JSON.parse(new TextDecoder().decode(encodeProject(bytes,model)));raw.ocrReview={version:99};const bad=decodeProject(new TextEncoder().encode(JSON.stringify(raw)));assert.deepEqual(bad.bytes,bytes);assert.equal(bad.ocrReview,null);assert.match(bad.ocrWarning,/aplicados/);
});
test('OCR recovery rejects stale source, corrupt compression, invalid counts and unbounded data',async()=>{
  const{session}=await sample(),packed=await encodeOcrSession(session);await assert.rejects(decodeOcrSession(packed,'0'.repeat(64)),/base cambió/);await assert.rejects(decodeOcrSession({...packed,data:'AAAA'}));assert.equal(packedOcrSession({...packed,rawBytes:32*1024*1024+1}),false);
  await assert.rejects(encodeOcrSession({...session,selected:[1,1]}),/compatible/);await assert.rejects(encodeOcrSession({...session,remaining:[1]}),/pendientes/);await assert.rejects(encodeOcrSession({...session,views:{1:{...session.views[1],chosen:99999}}}),/Vista/);
});
test('OCR sessions preserve invalid typed corrections for review without silently repairing or applying them',async()=>{
  const{session}=await sample();session.report.pages[0].words[0].correction=String.fromCodePoint(0x1D11E);const restored=await decodeOcrSession(await encodeOcrSession(session));assert.equal(restored.report.pages[0].words[0].correction,String.fromCodePoint(0x1D11E));
});
test('OCR layouts select supported modes explicitly and keep automatic mode compatible with older settings',()=>{
  for(const layout of['auto','column','block','sparse'])assert.equal(ocrOptions({language:'eng',dpi:200,range:'',layout}).layout,layout);assert.equal(ocrOptions({language:'spa',dpi:150,range:''}).layout,'auto');assert.throws(()=>ocrOptions({language:'eng',dpi:200,range:'',layout:'unknown'}),/diseño/);
});
test('OCR quality metrics measure reference edits, accents, digits and word errors instead of inferring accuracy from confidence',()=>{
  const same=ocrMetrics('canción\nTotal 2026','cancio\u0301n  Total 2026');assert.equal(same.exact,true);assert.equal(same.cer,0);const changed=ocrMetrics('Bogotá 2026','Bogota 2028');assert.equal(changed.characterErrors,2);assert.equal(changed.wordErrors,2);assert.equal(changed.wer,1);assert.equal(editDistance(['a','b'],['b','a']),2);assert.equal(ocrMetrics('','extra').characterErrors,5);assert.throws(()=>editDistance(Array(4000).fill('a'),Array(4000).fill('b')),/grande/);
});
