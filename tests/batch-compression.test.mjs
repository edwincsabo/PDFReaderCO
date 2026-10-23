import test from'node:test';
import assert from'node:assert/strict';
import {PDFDocument}from'pdf-lib';
import {readFile,writeFile,mkdir,mkdtemp}from'node:fs/promises';
import path from'node:path';
import {processBatchPdf,validateBatchProfile}from'../src/batch-engine.mjs';
import {runBatchQueue}from'../src/batch-runner.mjs';
import {createBatchFiles}from'../electron/batch-files.cjs';
import {compressionFixture}from'./compression-fixture.mjs';
import {exportPdf,getFields}from'../src/pdf-engine.mjs';
const profile={operation:'compress',range:'',compression:{preset:'balanced'}};
const jpeg=async()=>new Uint8Array(await readFile(new URL('./fixtures/compression-rgb.jpg',import.meta.url)));
test('batch compression validates whole-document profiles and keeps only effective compression settings',()=>{
  assert.deepEqual(validateBatchProfile({...profile,size:NaN,start:0}).compression,{preset:'balanced',quality:.78,maxEdge:2400});
  for(const compression of[{preset:'custom',quality:.3,maxEdge:800},{preset:'custom',quality:.7,maxEdge:200},{preset:'unknown'},null])assert.throws(()=>validateBatchProfile({...profile,compression}));
  assert.throws(()=>validateBatchProfile({...profile,range:'1'}),/documento completo/);
  assert.deepEqual(Object.keys(validateBatchProfile(profile)).sort(),['compression','operation','range']);
});
test('batch compression reuses the engine, preserves disk form values and reports actual sizes without exposing PDF bytes in the summary',async()=>{
  const source=await exportPdf(await compressionFixture(),{marks:[],forms:{Respuesta:'Guardada en disco'}}),original=source.slice(),progress=[];
  const result=await processBatchPdf(source,profile,p=>progress.push(p),jpeg);
  assert.equal(result.compression.before,source.length);assert.equal(result.compression.after,result.bytes.length);assert.equal(result.compression.reduced,true);assert.equal(result.compression.changed,1);assert.equal(result.compression.images,1);assert.equal(result.pages,1);assert.equal(result.total,1);assert.deepEqual(source,original);
  const doc=await PDFDocument.load(result.bytes);assert.equal(doc.getTitle(),'Compresión verificable');assert.equal((await getFields(result.bytes))[0].value,'Guardada en disco');assert.equal((await getFields(result.bytes))[0].defaultValue,'Valor inicial');assert.ok(!JSON.stringify(result.compression).includes('bytes'));assert.ok(progress.every(p=>p.fraction>=0&&p.fraction<=1));
});
test('lossless batch compression needs no image codec and an unavailable lossy codec fails explicitly',async()=>{
  const source=await compressionFixture(),result=await processBatchPdf(source,{...profile,compression:{preset:'lossless'}});
  assert.equal(result.compression.reduced,false);assert.equal(result.compression.changed,0);assert.deepEqual(result.bytes,source);assert.equal(result.compression.reasons[0].count,1);
  await assert.rejects(processBatchPdf(source,profile),/conversor local/);
});
test('compression output names remain exclusive even in the source folder and when concurrent copies share a name',async()=>{
  const root=path.resolve('test-results/batch-files');await mkdir(root,{recursive:true});const folder=await mkdtemp(path.join(root,'compression-')),file=path.join(folder,'Foto.pdf'),prior=path.join(folder,'Foto-comprimido.pdf');await writeFile(file,'Original');await writeFile(prior,'Copia existente');const store=createBatchFiles(),[item]=await store.add([file]),target=await store.folder(folder);
  const results=await Promise.all(Array.from({length:3},()=>store.write({id:item.id,folder:target.id,operation:'compress',bytes:new Uint8Array([1,2])})));
  assert.equal(new Set(results.map(r=>r.name)).size,3);assert.equal(await readFile(file,'utf8'),'Original');assert.equal(await readFile(prior,'utf8'),'Copia existente');assert.ok(results.every(r=>r.name.startsWith('Foto-comprimido (')));
});
test('queue marks no reduction terminal without writing, validates metrics after input transfer and continues past failures',async()=>{
  const writes=[],updates=[],signal=new AbortController().signal;
  const result=await runBatchQueue([{id:1},{id:2},{id:3},{id:4}],profile,{signal,read:async id=>new Uint8Array([id,2,3,4]),process:async bytes=>{const id=bytes[0];structuredClone(bytes,{transfer:[bytes.buffer]});if(id===3)throw new Error('No compatible');const after=id===1?4:2;return{bytes:new Uint8Array(after),pages:1,total:1,compression:{before:4,after,reduced:id===2,changed:0,images:0,kept:0,reasons:[]}};},write:async(id,bytes)=>{writes.push(id);return{name:'Copia.pdf',size:bytes.length};},onUpdate:v=>updates.push(v)});
  assert.deepEqual(result.map(v=>v.status),['unchanged','done','error','error']);assert.deepEqual(writes,[2]);assert.equal(result[0].inputSize,4);assert.equal(result[0].output,undefined);assert.equal(result[1].inputSize,4);assert.equal(result[1].outputSize,2);assert.ok(result.every(v=>!('bytes'in v)));assert.ok(!updates.some(v=>v.id===1&&v.message==='Guardando copia'));
});
test('cancel after compression starts writes no result and cancels subsequent files',async()=>{
  const source=await compressionFixture(),abort=new AbortController(),updates=[];let writes=0;
  const results=await runBatchQueue([{id:'a'},{id:'b'}],profile,{signal:abort.signal,read:async()=>source.slice(),process:async(bytes,_profile,_signal,progress)=>{const result=await processBatchPdf(bytes,profile,()=>{},async()=>{abort.abort();return jpeg();});progress({message:'Progreso tardío',fraction:.8});return result;},write:async()=>{writes++;},onUpdate:update=>updates.push(update)});
  assert.equal(writes,0);assert.deepEqual(results.map(v=>v.status),['canceled','canceled']);
  assert.ok(!updates.some(update=>update.message==='Progreso tardío'));
});
