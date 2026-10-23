import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const {createRecoveryStore}=createRequire(import.meta.url)('../electron/recovery-store.cjs');
async function fixture(options={}){const parent=path.resolve('test-results/history-unit');await mkdir(parent,{recursive:true});const root=await mkdtemp(path.join(parent,'run-'));return {root,store:createRecoveryStore(root,options)};}
const bytes=n=>new TextEncoder().encode('v'+n);

test('history retains immutable versions, deduplicates consecutive states and restores independent documents',async()=>{
  const {root,store}=await fixture();await store.write('tab','Uno.pdf',bytes(1),'document');await store.write('tab','Uno.pdf',bytes(2),'document');await store.write('tab','Uno.pdf',bytes(2),'document');
  let data=await store.listHistory();assert.equal(data.groups.length,1);assert.deepEqual(data.groups[0].versions.map(v=>v.number),[2,1]);assert.deepEqual(data.groups[0].versions.map(v=>v.protected),[true,false]);assert.equal(data.usageBytes,4);
  const [current,old]=data.groups[0].versions;await assert.rejects(()=>store.deleteVersion('document',current.id),/sesión sin guardar/);const restored=await store.readVersion('document',old.id);assert.notEqual(restored.id,'tab');assert.equal(restored.historyId,restored.id);assert.equal(restored.recovered,true);assert.deepEqual(restored.bytes,bytes(1));assert.deepEqual((await store.read('tab')).bytes,bytes(2));
  await store.remove('tab');assert.equal((await store.list()).length,0);const restarted=createRecoveryStore(root);data=await restarted.listHistory();assert.equal(data.groups[0].versions.length,2);assert.equal(data.groups[0].versions.some(v=>v.protected),false);await restarted.deleteVersion('document',old.id);assert.equal((await restarted.listHistory()).groups[0].versions.length,1);assert.equal((await readdir(path.join(root,'history'))).filter(f=>f.endsWith('.tmp')).length,0);
});

test('history limits versions per document and serializes queued writes and latest-copy deletion',async()=>{
  const {store}=await fixture({maxVersions:3});await Promise.all(Array.from({length:7},(_,i)=>store.write('tab','Orden.pdf',bytes(i),'document')));const data=await store.listHistory();assert.deepEqual(data.groups[0].versions.map(v=>v.number),[7,6,5]);assert.deepEqual((await store.read('tab')).bytes,bytes(6));const writing=store.write('tab','Orden.pdf',bytes(9),'document'),removing=store.remove('tab');await Promise.all([writing,removing]);assert.equal((await store.list()).length,0);assert.deepEqual((await store.listHistory()).groups[0].versions.map(v=>v.number),[8,7,6]);
});

test('global byte pruning keeps the latest of each document and failures leave prior copies intact',async()=>{
  const {store}=await fixture({maxBytes:16,maxVersionBytes:8,maxVersions:4,maxDocuments:3});const small=n=>new Uint8Array(4).fill(n),large=n=>new Uint8Array(8).fill(n);
  await store.write('a','A',small(1));const old=(await store.listHistory()).groups[0].versions[0].id;await store.write('a','A',small(2));await store.write('b','B',small(3));await store.write('c','C',small(4));assert.equal((await store.listHistory()).usageBytes,16);await store.write('c','C',large(5));assert.equal((await store.listHistory()).usageBytes,16);await assert.rejects(()=>store.readVersion('a',old),/no está disponible/);
  await assert.rejects(()=>store.write('a','A',large(8)),/sin borrar copias protegidas/);assert.deepEqual((await store.read('a')).bytes,small(2));assert.deepEqual((await store.read('c')).bytes,large(5));assert.equal((await store.listHistory()).usageBytes,16);await assert.rejects(()=>store.write('d','D',small(6)),/límite/);await assert.rejects(()=>store.write('a','A',new Uint8Array(9)),/inválidos/);
});

test('multiple sessions of one document protect their own active versions and retention never deletes them',async()=>{
  const {store}=await fixture({maxVersions:2});await store.write('one','Mismo.pdf',bytes(1),'same-file');await store.write('two','Mismo.pdf',bytes(2),'same-file');await assert.rejects(()=>store.write('three','Mismo.pdf',bytes(3),'same-file'),/protegidas/);assert.deepEqual((await store.read('one')).bytes,bytes(1));assert.deepEqual((await store.read('two')).bytes,bytes(2));await store.write('one','Mismo.pdf',bytes(4),'same-file');assert.equal((await store.listHistory()).groups[0].versions.length,2);await assert.rejects(()=>store.write('one','Otro.pdf',bytes(5),'other-file'),/otro documento/);
});

test('legacy recovery remains available and migrates its old state before saving a new version',async()=>{
  const {root,store}=await fixture();await writeFile(path.join(root,'legacy.json'),JSON.stringify({id:'legacy',name:'Anterior.pdf',updated:'2026-10-01T12:00:00.000Z'}));await writeFile(path.join(root,'legacy.pdfco'),bytes(1));assert.deepEqual((await store.read('legacy')).bytes,bytes(1));let data=await store.listHistory();assert.equal(data.groups[0].versions[0].id,'legacy:legacy');assert.equal(data.groups[0].versions[0].protected,true);assert.deepEqual((await store.readVersion('legacy','legacy:legacy')).bytes,bytes(1));
  await store.write('legacy','Anterior.pdf',bytes(2));data=await store.listHistory();assert.deepEqual(data.groups[0].versions.map(v=>v.number),[2,1]);assert.deepEqual((await store.readVersion('legacy',data.groups[0].versions[1].id)).bytes,bytes(1));assert.equal((JSON.parse(await readFile(path.join(root,'legacy.json'),'utf8'))).version,2);await assert.rejects(()=>readFile(path.join(root,'legacy.pdfco')));assert.deepEqual((await createRecoveryStore(root).read('legacy')).bytes,bytes(2));
});

test('clearing a legacy latest copy archives it even before its first new autosave',async()=>{
  const {root,store}=await fixture();await writeFile(path.join(root,'legacy.json'),JSON.stringify({id:'legacy',name:'Anterior.pdf',updated:'2026-10-01T12:00:00.000Z'}));await writeFile(path.join(root,'legacy.pdfco'),bytes(1));await store.remove('legacy');assert.equal((await store.list()).length,0);const group=(await store.listHistory()).groups[0];assert.equal(group.versions.length,1);assert.equal(group.versions[0].protected,false);assert.deepEqual((await store.readVersion(group.id,group.versions[0].id)).bytes,bytes(1));
});

test('history validates identifiers and document ownership, detects corrupt bytes and preserves active copies on clearing',async()=>{
  const {root,store}=await fixture();await store.write('tab','Prueba.pdf',bytes(1),'doc');await store.write('tab','Prueba.pdf',bytes(2),'doc');const [current,old]=(await store.listHistory()).groups[0].versions;
  await assert.rejects(()=>store.write('../escape','Error',bytes(1)));await assert.rejects(()=>store.write('ok','Error',bytes(1),'../escape'));await assert.rejects(()=>store.readVersion('doc','../../escape'));await assert.rejects(()=>store.readVersion('otro',old.id));await assert.rejects(()=>store.clearHistory('../escape'));await writeFile(path.join(root,'history',old.id+'.pdfco'),bytes(8));await assert.rejects(()=>store.readVersion('doc',old.id),/fue modificada/);
  assert.deepEqual(await store.clearHistory('doc'),{removed:1,kept:1});assert.equal((await store.listHistory()).groups[0].versions[0].id,current.id);await store.remove('tab');assert.deepEqual(await store.clearHistory('doc'),{removed:1,kept:0});const data=await store.listHistory();assert.equal(data.groups.length,0);assert.equal(data.usageBytes,0);
});

test('failed latest-pointer commit rolls back staged versions without pruning other history',async()=>{
  const {root,store}=await fixture();await store.write('safe','Seguro.pdf',bytes(1));const before=await store.listHistory();await mkdir(path.join(root,'blocked.json'));await assert.rejects(()=>store.write('blocked','Fallido.pdf',bytes(2)));const after=await store.listHistory();assert.deepEqual(after,before);assert.deepEqual((await store.read('safe')).bytes,bytes(1));assert.equal((await readdir(root)).filter(n=>n.endsWith('.tmp')).length,0);assert.equal((await readdir(path.join(root,'history'))).filter(n=>n.endsWith('.tmp')).length,0);
});
