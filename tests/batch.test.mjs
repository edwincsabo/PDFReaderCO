import test from'node:test';
import assert from'node:assert/strict';
import {PDFDocument,PDFName,PDFNumber,PDFString,decodePDFRawStream,degrees}from'pdf-lib';
import {readFile,mkdir,mkdtemp,writeFile,readdir}from'node:fs/promises';
import path from'node:path';
import {createBatchFiles}from'../electron/batch-files.cjs';
import {processBatchPdf,validateBatchProfile}from'../src/batch-engine.mjs';
import {runBatchQueue}from'../src/batch-runner.mjs';
import {prepareEditablePdf}from'../src/native-annotations.mjs';
const numbers={operation:'numbers',range:'',start:1,prefix:'',position:'bottom-center',size:10},watermark={operation:'watermark',range:'',text:'REVISADO',size:36,opacity:.22,angle:-30},extract={operation:'extract',range:'3, 1'};
async function fixture(count=3){const doc=await PDFDocument.create();doc.setTitle('Lote de control');for(let i=1;i<=count;i++)doc.addPage([600,800]).drawText('Pagina '+i,{x:40,y:700,size:18});return doc;}
const stream=(doc,i)=>doc.getPage(i).node.Contents().asArray().map(r=>new TextDecoder().decode(decodePDFRawStream(doc.context.lookup(r)).decode())).join('\n');

test('batch numbers respect range order, start and prefix while retaining source bytes, fields, metadata and embedded files',async()=>{
  const doc=await fixture(),field=doc.getForm().createTextField('Respuesta');field.setText('Conservada');field.addToPage(doc.getPage(0),{x:30,y:30,width:180,height:25});await doc.attach(new Uint8Array([0,255,4]),'original.bin');const bytes=await doc.save(),copy=bytes.slice(),result=await processBatchPdf(bytes,{...numbers,range:'3, 1',start:5,prefix:'Folio '});assert.deepEqual(bytes,copy);assert.equal(result.pages,2);const after=await PDFDocument.load(result.bytes);assert.equal(after.getTitle(),'Lote de control');assert.equal(after.getForm().getTextField('Respuesta').getText(),'Conservada');assert.ok(after.catalog.lookup(PDFName.of('Names')).has(PDFName.of('EmbeddedFiles')));assert.ok(stream(after,2).includes('466F6C696F2035202F2036'));assert.ok(stream(after,0).includes('466F6C696F2036202F2036'));assert.ok(!stream(after,1).includes('466F6C696F'));assert.ok(after.getPage(0).node.Annots().size());
});
test('batch drawing accounts for rotations, shifted crop and physical UserUnit and places marks with bounded progress',async()=>{
  for(const angle of[0,90,180,270]){const doc=await fixture(1),p=doc.getPage(0);p.setRotation(degrees(angle));p.setCropBox(20,30,500,700);p.node.set(PDFName.of('UserUnit'),PDFNumber.of(2));const updates=[],result=await processBatchPdf(await doc.save(),watermark,p=>updates.push(p));const after=await PDFDocument.load(result.bytes),content=stream(after,0);assert.equal(after.getPage(0).getRotation().angle,angle);assert.deepEqual(after.getPage(0).getCropBox(),{x:20,y:30,width:500,height:700});assert.ok(content.includes('524556495341444F'));assert.ok(content.includes('0.5')||content.includes('-0.5'));assert.ok(updates.length>=2&&updates.every(p=>p.fraction>=0&&p.fraction<=1));}
});
test('batch extraction emits selected pages in requested order; forms and signed or encrypted inputs fail explicitly',async()=>{
  const doc=await fixture(),bytes=await doc.save(),out=await processBatchPdf(bytes,extract),after=await PDFDocument.load(out.bytes);assert.equal(after.getPageCount(),2);assert.ok(stream(after,0).includes('506167696E612033'));assert.ok(stream(after,1).includes('506167696E612031'));
  const form=doc.getForm().createTextField('Campo');form.addToPage(doc.getPage(0),{x:10,y:10,width:100,height:20});const formBytes=await doc.save();await assert.rejects(()=>processBatchPdf(formBytes,extract),/aplanados/);
});

test('batch rejects invalid profiles, glyphs, short documents and signatures without changing the input',async()=>{
  const doc=await fixture(1),bytes=await doc.save(),copy=bytes.slice();await assert.rejects(()=>processBatchPdf(bytes,{...numbers,range:'2'}),/rango/);await assert.rejects(()=>processBatchPdf(bytes,{...watermark,text:'漢字'}),/caracteres/);await assert.rejects(()=>processBatchPdf(bytes,{...numbers,prefix:'L'.repeat(40),size:36}),/no cabe/);await assert.rejects(()=>processBatchPdf(new Uint8Array([0,1]),numbers),/leer/);assert.deepEqual(bytes,copy);
  for(const value of[{...numbers,start:0},{...watermark,opacity:0},{...watermark,text:''},{...numbers,range:'1,,3'},{...watermark,angle:180}])assert.throws(()=>validateBatchProfile(value));
  doc.catalog.set(PDFName.of('Perms'),doc.context.obj({}));const signed=await doc.save();await assert.rejects(()=>processBatchPdf(signed,numbers),/firma/);
  const encrypted=new Uint8Array(await readFile('tests/fixtures/comparison-encrypted.pdf'));await assert.rejects(()=>processBatchPdf(encrypted,numbers),/cifrado/);
});

test('batch file access issues capabilities, deduplicates selected paths and detects changed files and released selections',async()=>{
  const base=path.resolve('test-results/batch-files');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'run-')),file=path.join(root,'Documento.pdf');await writeFile(file,new Uint8Array([1,2,3]));const store=createBatchFiles(),[a,b]=await store.add([file,file]);assert.equal(a.id,b.id);assert.equal('path'in a,false);assert.deepEqual(await store.read(a.id),new Uint8Array([1,2,3]));await assert.rejects(()=>store.read(file),/añadir/);await writeFile(file,new Uint8Array([4,5]));await assert.rejects(()=>store.read(a.id),/cambió/);store.release([a.id]);await assert.rejects(()=>store.read(a.id),/añadir/);const [next]=await store.add([file]);assert.equal(next.size,2);
});
test('batch exclusive output creation never replaces sources or existing names, even with concurrent saves and rejects arbitrary paths',async()=>{
  const base=path.resolve('test-results/batch-files');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'run-')),file=path.join(root,'Documento.pdf'),output=path.join(root,'Documento-numerado.pdf');await writeFile(file,new Uint8Array([1,2,3]));await writeFile(output,'Conservar');const store=createBatchFiles(),[item]=await store.add([file]),folder=await store.folder(root),bytes=new Uint8Array([9,8,7]);const results=await Promise.all(Array.from({length:4},()=>store.write({id:item.id,folder:folder.id,operation:'numbers',bytes})));assert.equal(new Set(results.map(v=>v.name)).size,4);assert.equal(await readFile(output,'utf8'),'Conservar');assert.deepEqual(new Uint8Array(await readFile(file)),new Uint8Array([1,2,3]));for(const result of results)assert.deepEqual(new Uint8Array(await readFile(path.join(root,result.name))),bytes);assert.ok(!(await readdir(root)).some(n=>n.endsWith('.tmp')));await assert.rejects(()=>store.write({id:item.id,folder:root,operation:'../escape',bytes}),/inválidos/);
});
test('batch queue continues after failures, isolates output bytes and cancels before starting later files',async()=>{
  const controller=new AbortController(),updates=[],writes=[];const result=await runBatchQueue([{id:'a'},{id:'b'},{id:'c'},{id:'d'}],numbers,{signal:controller.signal,read:async id=>{if(id==='a')throw new Error('Archivo inválido');return new Uint8Array([1]);},process:async(bytes,profile,signal,onProgress)=>{onProgress({fraction:.5,message:'Mitad'});return{bytes,pages:1,total:1};},write:async(id,bytes)=>{writes.push(id);controller.abort();return{name:'Copia.pdf',size:bytes.length};},onUpdate:update=>updates.push(update)});assert.deepEqual(result.map(item=>item.status),['error','done','canceled','canceled']);assert.deepEqual(writes,['b']);assert.ok(!result.some(item=>'bytes'in item));assert.ok(updates.some(item=>item.fraction===.5));
});
test('batch cancellation during read or transform writes no copy and retains finished copies on save errors',async()=>{
  for(const stage of['read','process']){const c=new AbortController(),writes=[];const result=await runBatchQueue([{id:'a'},{id:'b'}],numbers,{signal:c.signal,read:async()=>{if(stage==='read')c.abort();return new Uint8Array([1]);},process:async bytes=>{c.abort();return{bytes,pages:1};},write:async()=>writes.push('unexpected'),onUpdate:()=>{}});assert.deepEqual(result.map(r=>r.status),['canceled','canceled']);assert.equal(writes.length,0);}
  const result=await runBatchQueue([{id:'a'},{id:'b'}],numbers,{signal:new AbortController().signal,read:async()=>new Uint8Array([1]),process:async bytes=>({bytes,pages:1}),write:async id=>{if(id==='b')throw new Error('Sin espacio');return{name:'Bien.pdf',size:1};},onUpdate:()=>{}});assert.deepEqual(result.map(r=>r.status),['done','error']);assert.equal(result[0].output,'Bien.pdf');
});

test('batch guards actual signature fields before modification and rejects unknown output operations',async()=>{
  const doc=await fixture(1),page=doc.getPage(0),widget=doc.context.register(doc.context.obj({Type:'Annot',Subtype:'Widget',FT:'Sig',T:PDFString.of('Firma'),Rect:[10,10,150,40],P:page.ref}));page.node.set(PDFName.of('Annots'),doc.context.obj([widget]));doc.catalog.set(PDFName.of('AcroForm'),doc.context.obj({Fields:[widget]}));const bytes=await doc.save();await assert.rejects(()=>processBatchPdf(bytes,numbers),/campos de firma/);
  const root=path.resolve('test-results/batch-files');await mkdir(root,{recursive:true});const dir=await mkdtemp(path.join(root,'signed-')),file=path.join(dir,'Firma.pdf');await writeFile(file,bytes);const store=createBatchFiles(),[item]=await store.add([file]),folder=await store.folder(dir);await assert.rejects(()=>store.write({id:item.id,folder:folder.id,operation:'constructor',bytes}),/inválidos/);
});

test('batch queue capability limits reject an overflowing addition without retaining hidden selections',async()=>{
  const root=path.resolve('test-results/batch-files');await mkdir(root,{recursive:true});const dir=await mkdtemp(path.join(root,'capacity-')),paths=Array.from({length:101},(_,i)=>path.join(dir,'Archivo-'+i+'.pdf'));await Promise.all(paths.map(file=>writeFile(file,'P')));const store=createBatchFiles(),items=await store.add(paths.slice(0,99));await assert.rejects(()=>store.add(paths.slice(99)),/100 archivos/);const [last]=await store.add([paths[100]]);assert.equal(last.name,'Archivo-100.pdf');store.release([items[0].id]);const [other]=await store.add([paths[99]]);assert.equal(other.name,'Archivo-99.pdf');
});

test('batch numbering keeps the released native annotations independently editable after reopening',async()=>{
  const bytes=new Uint8Array(await readFile('tests/fixtures/native-1.10.1.pdf')),before=await prepareEditablePdf(bytes),result=await processBatchPdf(bytes,numbers),after=await prepareEditablePdf(result.bytes);assert.ok(before.marks.length>0);assert.deepEqual(after.marks,before.marks);
});
