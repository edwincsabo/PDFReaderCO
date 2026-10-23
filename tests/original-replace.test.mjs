import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, degrees, beginMarkedContent, endMarkedContent } from 'pdf-lib';
import { createOriginalTextEngine } from '../src/original-text-engine.mjs';
import { literalMatches } from '../src/original-text-replace.mjs';
import { designForm, getFields, exportPdf } from '../src/pdf-engine.mjs';
import { prepareEditablePdf } from '../src/native-annotations.mjs';

const engine=await createOriginalTextEngine(new Uint8Array(await readFile(new URL('../node_modules/@embedpdf/pdfium/dist/pdfium.wasm',import.meta.url))));
const settings={query:'saldo',caseSensitive:false,wholeWord:true};
async function fixture(pages=3,tagged=false){
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
  for(let n=0;n<pages;n++){const p=doc.addPage([600,800]);p.setRotation(degrees(n*90%360));if(tagged&&n===0)p.pushOperators(beginMarkedContent('Span'));let x=40;for(const text of ['Saldo ','saldo ','saldos.']){p.drawText(text,{x,y:700,size:20,font});x+=font.widthOfTextAtSize(text,20);}if(tagged&&n===0)p.pushOperators(endMarkedContent());p.drawText('Conservar esta frase '+n,{x:40,y:600,size:14,font});}
  return doc.save();
}
async function review(bytes,patch={}){const found=await engine.searchReplacements(bytes,settings);return engine.reviewReplacements(bytes,{...settings,source:found.source,replacement:'dato',autoFit:false,minimum:8,...patch});}

test('literal matching escapes regex symbols, keeps UTF-16 offsets and handles case, accents, word boundaries and nonoverlapping occurrences',()=>{
  assert.deepEqual(literalMatches('a.b A.B a+b [x] $&','a.b').map(m=>m.start),[0,4]);assert.equal(literalMatches('a+b','a+b',true).length,1);assert.equal(literalMatches('[x]','[x]',true).length,1);assert.equal(literalMatches('$&','$&',true).length,1);assert.equal(literalMatches('aaaa','aa').length,2);assert.deepEqual(literalMatches('saldo saldos SALDO presaldo','saldo',false,true).map(m=>m.start),[0,13]);assert.equal(literalMatches('área ÁREA areas','área',false,true).length,2);assert.equal(literalMatches('área ÁREA','área',true,true).length,1);assert.equal(literalMatches('日本 日本語','日本',true,true).length,1);assert.equal(literalMatches('𝒜 dato','dato')[0].start,3);
});

test('search covers every page, finds phrases split across compatible fragments and review leaves original bytes unchanged',async()=>{
  const bytes=await fixture(),copy=bytes.slice(),progress=[],found=await engine.searchReplacements(bytes,settings,{progress:p=>progress.push(p)});assert.equal(found.pages,3);assert.equal(found.scanned,3);assert.equal(found.matches.length,6);assert.equal(found.truncated,false);assert.equal(progress.length,3);const phrase=await engine.searchReplacements(bytes,{query:'Saldo saldo',caseSensitive:true,wholeWord:true});assert.equal(phrase.matches.length,3);const plan=await review(bytes);assert.equal(plan.replaced,6);assert.equal(plan.lines,3);assert.deepEqual(bytes,copy);assert.equal((await engine.inspect(bytes,1)).objects[0].text,'Saldo ');
});

test('prepared replacement applies exactly the reviewed lines on multiple rotated pages and is consumed once',async()=>{
  const bytes=await fixture(4),plan=await review(bytes),result=await engine.applyReplacements(bytes,{id:plan.id,source:plan.source});assert.equal(result.replaced,8);assert.equal(result.lines,4);for(let page=1;page<=4;page++){const before=await engine.inspect(bytes,page),after=await engine.inspect(result.bytes,page);assert.deepEqual(after.objects.map(o=>o.text),['dato dato saldos.','Conservar esta frase '+(page-1)]);assert.deepEqual(after.objects[0].matrix,before.objects[0].matrix);assert.deepEqual(after.objects[1].matrix,before.objects[3].matrix);}await assert.rejects(()=>engine.applyReplacements(bytes,{id:plan.id,source:plan.source}),/caducó|aplicó/);
});

test('individual selection replaces one occurrence, replacement is literal and deleting a whole line keeps following text',async()=>{
  const bytes=await fixture(1),found=await engine.searchReplacements(bytes,settings),plan=await review(bytes,{ids:[found.matches[1].id],replacement:'$&',autoFit:true}),out=await engine.applyReplacements(bytes,plan);assert.equal(out.replaced,1);assert.equal((await engine.inspect(out.bytes,1)).objects[0].text,'Saldo $& saldos.');const all=await engine.searchReplacements(bytes,{query:'Saldo saldo saldos.',caseSensitive:true,wholeWord:false}),deletion=await engine.reviewReplacements(bytes,{source:all.source,query:'Saldo saldo saldos.',caseSensitive:true,wholeWord:false,replacement:'',autoFit:false,minimum:8});assert.equal(deletion.replaced,1);const deleted=await engine.applyReplacements(bytes,deletion);assert.deepEqual((await engine.inspect(deleted.bytes,1)).objects.map(o=>o.text),['Conservar esta frase 0']);
});

test('overflow blocks review until explicitly fitting; tagged lines fit while retaining their marks',async()=>{
  const bytes=await fixture(2,true),copy=bytes.slice(),replacement='saldo extendido',blocked=await review(bytes,{replacement});assert.equal(blocked.replaced,0);assert.equal(blocked.blocked,4);const fitted=await review(bytes,{replacement,autoFit:true});assert.equal(fitted.replaced,4);assert.equal(fitted.blocked,0);assert.equal(fitted.entries.find(e=>e.page===1).status,'adjusted');const ready=fitted.entries.find(e=>e.page===2);assert.equal(ready.status,'adjusted');assert.ok(ready.pointSize>=8&&ready.pointSize<20);const result=await engine.applyReplacements(bytes,fitted);assert.equal((await engine.inspect(result.bytes,1)).objects[0].text,'saldo extendido saldo extendido saldos.');assert.equal((await engine.inspect(result.bytes,1)).objects[0].marks,(await engine.inspect(bytes,1)).objects[0].marks);assert.equal((await engine.inspect(result.bytes,1)).objects.at(-1).marks,0);assert.equal((await engine.inspect(result.bytes,2)).objects[0].text,'saldo extendido saldo extendido saldos.');assert.deepEqual(bytes,copy);
});

test('embedded font failures and unchanged replacements are reported without preparing unwanted edits',async()=>{
  const embedded=new Uint8Array(await readFile(new URL('./fixtures/original-subset.pdf',import.meta.url))),query='Texto',found=await engine.searchReplacements(embedded,{query}),blocked=await engine.reviewReplacements(embedded,{source:found.source,query,replacement:'日本語',autoFit:true,minimum:8});assert.equal(blocked.replaced,0);assert.equal(blocked.entries[0].status,'blocked');assert.match(blocked.entries[0].reason,/fuente alternativa/);const bytes=await fixture(1),plan=await review(bytes,{replacement:'saldo'});assert.equal(plan.replaced,1);assert.equal(plan.unchanged,1);assert.equal(plan.selected,2);
});

test('stale, forged or expired reviews and invalid requests cannot alter the source',async()=>{
  const bytes=await fixture(1),copy=bytes.slice(),plan=await review(bytes);await assert.rejects(()=>engine.applyReplacements(bytes,{id:plan.id,source:'stale'}),/cambió/);await assert.rejects(()=>engine.applyReplacements(bytes,{id:'inventado',source:plan.source}),/caducó/);for(const patch of [{source:'stale'},{ids:['inventado']},{ids:[]},{ids:['1:0:0','1:0:0']},{replacement:'dos\nlíneas'},{query:''},{query:'x'.repeat(201)}])await assert.rejects(()=>engine.reviewReplacements(bytes,{source:plan.source,...settings,replacement:'dato',...patch}));for(let n=0;n<5;n++)await review(bytes);await assert.rejects(()=>engine.applyReplacements(bytes,plan),/caducó/);assert.deepEqual(bytes,copy);
});

test('search and preparation cancellation never publish a partial PDF',async()=>{
  const bytes=await fixture(3),copy=bytes.slice();let canceled=false;const context={progress:p=>{if(p.current===2)canceled=true;},check:()=>{if(canceled)throw new DOMException('cancel','AbortError');}};await assert.rejects(()=>engine.searchReplacements(bytes,settings,context),{name:'AbortError'});canceled=false;const found=await engine.searchReplacements(bytes,settings);await assert.rejects(()=>engine.reviewReplacements(bytes,{source:found.source,...settings,replacement:'dato'},{progress:p=>{if(p.stage==='review'&&p.current===2)canceled=true;},check:context.check}),{name:'AbortError'});assert.deepEqual(bytes,copy);
});

test('more than 1000 matches requires a narrower query before reviewing the entire document',async()=>{
  const doc=await PDFDocument.create();doc.addPage([600,800]).drawText('a'.repeat(1001),{x:40,y:700,size:.1});const bytes=await doc.save(),found=await engine.searchReplacements(bytes,{query:'a'});assert.equal(found.matches.length,1000);assert.equal(found.truncated,true);await assert.rejects(()=>engine.reviewReplacements(bytes,{source:found.source,query:'a',replacement:'b'}),/1.000/);
});

test('a batch retains document metadata, interactive forms and native annotations across multiple edits',async()=>{
  let bytes=await fixture(2);bytes=(await designForm(bytes,{}, {action:'create',kind:'text',page:1,rect:{x:.2,y:.5,w:.3,h:.05}})).bytes;const doc=await PDFDocument.load(bytes);doc.setTitle('Título retenido');doc.getForm().getTextField('Texto_1').setText('Respuesta intacta');bytes=await doc.save();const note={id:'batch-note',page:1,tool:'note',x:.7,y:.4,w:.04,h:.03,size:2,color:'#ffdf60',text:'Comentario conservado'};bytes=await exportPdf(bytes,{marks:[note],forms:{}});const plan=await review(bytes),out=await engine.applyReplacements(bytes,plan),saved=await PDFDocument.load(out.bytes);assert.equal(saved.getTitle(),'Título retenido');assert.equal((await getFields(out.bytes))[0].value,'Respuesta intacta');assert.deepEqual((await prepareEditablePdf(out.bytes)).marks,[note]);assert.equal(out.replaced,4);
});
