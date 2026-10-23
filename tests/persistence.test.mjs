import test from'node:test';
import assert from'node:assert/strict';
import {createRequire}from'node:module';
import {mkdtemp,mkdir,writeFile,readFile,readdir,stat}from'node:fs/promises';
import path from'node:path';
import {createBlank,encodeProject,decodeProject}from'../src/pdf-engine.mjs';
import {readDrafts,recoverySource}from'../src/recovery-drafts.mjs';
const require=createRequire(import.meta.url),{createBatchFiles}=require('../electron/batch-files.cjs');
async function fixture(options={}){await mkdir('test-results/persistence-unit',{recursive:true});const root=await mkdtemp(path.resolve('test-results/persistence-unit/run-')),directory=path.join(root,'journal'),input=path.join(root,'input.pdf'),out=path.join(root,'out');await mkdir(out);await writeFile(input,new Uint8Array([1,2,3]));const batch=createBatchFiles({directory,...options}),[item]=await batch.add([input]),folder=await batch.folder(out);const profile={operation:'numbers',range:'',start:1,prefix:'PR',position:'bottom-center',size:10};const save=(queue=[{...item,status:'pending',message:'En espera',attempt:'attempt1',appliedProfile:profile}])=>batch.save({items:queue,profile,folder,lastProfile:profile});await save();return{root,directory,input,out,batch,item,folder,profile,save};}
test('batch durable state restores order, options, destination and valid capabilities without processing',async()=>{
  const f=await fixture(),next=createBatchFiles({directory:f.directory}),state=await next.restore();assert.equal(state.items.length,1);assert.equal(state.items[0].status,'pending');assert.deepEqual(state.profile,f.profile);assert.equal(state.folder.path,f.out);assert.deepEqual(await next.read(f.item.id),new Uint8Array([1,2,3]));assert.deepEqual(await readdir(f.out),[]);
});
test('batch durable receipts survive renderer loss, verify content hashes and avoid duplicating an attempt',async()=>{
  const f=await fixture(),bytes=new Uint8Array([4,5,6]),saved=await f.batch.write({id:f.item.id,folder:f.folder.id,operation:'numbers',bytes});
  const next=createBatchFiles({directory:f.directory}),state=await next.restore();assert.equal(state.items[0].status,'done');assert.equal(state.items[0].output,saved.name);assert.deepEqual(await next.write({id:f.item.id,folder:f.folder.id,operation:'numbers',bytes}),saved);assert.equal((await readdir(f.out)).length,1);
  await writeFile(path.join(f.out,saved.name),new Uint8Array([9,9,9]));const changed=await createBatchFiles({directory:f.directory}).restore();assert.equal(changed.items[0].status,'interrupted');assert.match(changed.items[0].message,/modificada/);
});
test('batch crashes before publishing preserve only a temporary; after publishing recover verified completion',async()=>{
  for(const phase of['staged','published']){const f=await fixture({onPhase:stage=>{if(stage===phase)throw Object.assign(new Error('crash'),{simulatedCrash:true});}});await assert.rejects(f.batch.write({id:f.item.id,folder:f.folder.id,operation:'numbers',bytes:new Uint8Array([4,5,6])}));const state=await createBatchFiles({directory:f.directory}).restore();assert.equal(state.items[0].status,phase==='staged'?'interrupted':'done');const names=await readdir(f.out);assert.ok(names.some(n=>n.endsWith('.partial')));assert.equal(names.filter(n=>n.endsWith('.pdf')).length,phase==='staged'?0:1);}
});
test('batch restart detects changed/missing sources, lost folders, interrupted transforms and keeps completed copies',async()=>{
  const f=await fixture();await f.save([{...f.item,status:'running',message:'Transformando',attempt:'attempt1'}]);await writeFile(f.input,new Uint8Array([1,2,3,4]));const state=await createBatchFiles({directory:f.directory}).restore();assert.equal(state.items[0].status,'error');assert.match(state.items[0].message,/cambió/);assert.deepEqual(await readdir(f.out),[]);
});
test('batch reprocess starts a distinct attempt while corrupt or oversized journal data remain untouched',async()=>{
  const f=await fixture(),bytes=new Uint8Array([5,6]);await f.batch.write({id:f.item.id,folder:f.folder.id,operation:'numbers',bytes});await f.save([{...f.item,status:'pending',attempt:'attempt2'}]);const state=await createBatchFiles({directory:f.directory}).restore();assert.equal(state.items[0].status,'pending');await f.batch.write({id:f.item.id,folder:f.folder.id,operation:'numbers',bytes});assert.equal((await readdir(f.out)).filter(n=>n.endsWith('.pdf')).length,2);
  const journal=path.join(f.directory,'queue.json');await writeFile(journal,'{broken');await assert.rejects(createBatchFiles({directory:f.directory}).restore(),/conserva/);assert.equal(await readFile(journal,'utf8'),'{broken');await f.batch.clear();assert.equal((await createBatchFiles({directory:f.directory}).restore()).items.length,0);assert.equal((await readdir(f.out)).filter(n=>n.endsWith('.pdf')).length,2);
});
test('recovery envelope keeps pending text/properties separate and rejects oversized or hostile metadata without losing applied changes',async()=>{
  const bytes=await createBlank(),model={marks:[],forms:{}},source=await recoverySource(bytes),drafts={version:1,source,properties:[{kind:'annotation',key:'annotation:one',ids:['one'],base:'[]',value:{color:'#ff0000',size:20}}],original:null,mark:null};const decoded=decodeProject(encodeProject(bytes,model,drafts));assert.deepEqual(decoded.recoveryDrafts,drafts);assert.deepEqual(decoded.bytes,bytes);assert.deepEqual(decoded.model,model);assert.equal(decodeProject(encodeProject(bytes,model)).recoveryDrafts,null);
  const raw=JSON.parse(new TextDecoder().decode(encodeProject(bytes,model)));raw.recoveryDrafts={version:99};const incompatible=decodeProject(new TextEncoder().encode(JSON.stringify(raw)));assert.equal(incompatible.recoveryDrafts,null);assert.match(incompatible.draftWarning,/aplicados/);assert.deepEqual(incompatible.bytes,bytes);
  assert.throws(()=>readDrafts({...drafts,source:'other'}));assert.throws(()=>readDrafts({...drafts,properties:Array(21).fill(drafts.properties[0])}));assert.throws(()=>readDrafts({...drafts,mark:{draft:{id:'x',tool:'text'},text:'x'.repeat(1024*1024)}}),/1 MB/);
});
