import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const {createRecoveryStore}=createRequire(import.meta.url)('../electron/recovery-store.cjs');
test('local recovery serializes writes and deletion, rejects path traversal and ignores incomplete entries',async()=>{
  const directory=path.resolve('test-results/recovery-unit');await mkdir(directory,{recursive:true});const root=await mkdtemp(path.join(directory,'run-')),store=createRecoveryStore(root),bytes=new TextEncoder().encode('{"format":"PDFReaderCO","version":1}');
  await store.write('document-1','Prueba.pdf',bytes);assert.equal((await store.list()).length,1);const recovered=await store.read('document-1');assert.equal(recovered.recovered,true);assert.deepEqual(recovered.bytes,bytes);assert.match(recovered.name,/recuperado/);
  await store.write('document-1','Prueba.pdf',new Uint8Array([1,2,3]));assert.deepEqual((await store.read('document-1')).bytes,new Uint8Array([1,2,3]));
  const writing=store.write('document-1','Última.pdf',bytes),removing=store.remove('document-1');await Promise.all([writing,removing]);assert.deepEqual(await store.list(),[]);
  await assert.rejects(()=>store.write('../outside','error',bytes));await assert.rejects(()=>store.read('../../outside'));
  await writeFile(path.join(root,'broken.json'),'{}');assert.deepEqual(await store.list(),[]);assert.equal((await readdir(root)).filter(f=>f.endsWith('.tmp')).length,0);
});
