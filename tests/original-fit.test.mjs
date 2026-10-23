import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, concatTransformationMatrix, beginMarkedContent, endMarkedContent } from 'pdf-lib';
import { createOriginalTextEngine } from '../src/original-text-engine.mjs';
import { findTextSize } from '../src/original-text-fit.mjs';

const engine=await createOriginalTextEngine(new Uint8Array(await readFile(new URL('../node_modules/@embedpdf/pdfium/dist/pdfium.wasm',import.meta.url))));
async function fixture({angle=0,unit=1,scale=1,masked=false,tagged=false}={}){
  const doc=await PDFDocument.create(),p=doc.addPage([600,800]),font=await doc.embedFont(StandardFonts.Helvetica);p.setRotation(degrees(angle));p.setCropBox(20,30,500,700);p.node.set(PDFName.of('UserUnit'),PDFNumber.of(unit));p.drawRectangle({x:20,y:400,width:480,height:330,color:rgb(.8,.94,.86)});
  if(masked)p.pushOperators(pushGraphicsState(),rectangle(35,695,350,12),clip(),endPath());if(tagged)p.pushOperators(beginMarkedContent('Span'));p.pushOperators(pushGraphicsState(),concatTransformationMatrix(scale,0,0,scale,0,0));let x=40;for(const text of ['Texto ','original']){p.drawText(text,{x,y:700/scale,size:20,font});x+=font.widthOfTextAtSize(text,20);}p.pushOperators(popGraphicsState());if(tagged)p.pushOperators(endMarkedContent());if(masked)p.pushOperators(popGraphicsState());p.drawText('Conservar esta frase',{x:40,y:500,size:14,font});return doc.save();
}
async function request(bytes,text='Texto editado en el PDF',extra={}){const info=await engine.inspect(bytes,1),run=info.lines[0];return {source:info.source,page:1,index:run.index,indices:run.indices,originals:run.originals,original:run.text,text,font:'original',fontSize:run.fontSize,color:run.color,checkFit:true,fitMinimum:8,...extra};}

test('automatic fitting selects the largest physical 0.1 pt size that fits, preserves source bytes and commits a complete line on all page rotations',async()=>{
  for(const angle of [0,90,180,270]){const bytes=await fixture({angle}),copy=bytes.slice(),plan=await request(bytes),result=await engine.autoFit(bytes,plan);assert.equal(result.fits,true);assert.equal(result.changed,true);assert.ok(result.pointSize>=8&&result.pointSize<20);assert.ok(result.checks<=12);assert.equal((await engine.measure(bytes,{...plan,fontSize:result.fontSize+.1})).fits,false);const saved=await engine.edit(bytes,{...plan,fontSize:result.fontSize,allowOverflow:false}),info=await engine.inspect(saved,1);assert.deepEqual(info.objects.map(o=>o.text),[plan.text,'Conservar esta frase']);assert.deepEqual(info.objects[0].matrix,[1,0,0,1,40,700]);assert.deepEqual(bytes,copy);assert.equal((await engine.inspect(bytes,1)).objects.length,3);}
});

test('auto fit honors physical minimum through matrix scales, UserUnit and retained clipping paths',async()=>{
  for(const options of [{unit:2,scale:.71397316},{unit:2,masked:true},{unit:1,masked:true}]){const bytes=await fixture(options),copy=bytes.slice(),plan=await request(bytes),info=await engine.inspect(bytes,1),before=info.objects[0],result=await engine.autoFit(bytes,plan);assert.equal(result.fits,true);const factor=(options.unit||1)*(options.scale||1);assert.ok(Math.abs(result.fontSize*factor-result.pointSize)<.0001);assert.ok(result.pointSize>=8);assert.equal((await engine.measure(bytes,{...plan,fontSize:(result.pointSize+.1)/factor})).fits,false);const saved=await engine.edit(bytes,{...plan,fontSize:result.fontSize}),after=(await engine.inspect(saved,1)).objects[0];assert.equal(after.clipped,!!options.masked);assert.deepEqual(after.matrix.slice(4),before.matrix.slice(4));assert.ok(Math.abs(after.fontSize*Math.hypot(after.matrix[2],after.matrix[3])*(options.unit||1)-result.pointSize)<.001);assert.deepEqual(bytes,copy);}
});

test('no-fit and below-minimum responses leave input size and PDF untouched, and existing fitting fractional sizes are retained exactly',async()=>{
  const bytes=await fixture(),copy=bytes.slice(),plan=await request(bytes,'Texto demasiado largo '.repeat(20)),result=await engine.autoFit(bytes,plan);assert.equal(result.fits,false);assert.equal(result.reason,'no-fit');assert.equal(result.fontSize,undefined);assert.equal(plan.fontSize,20);const below=await engine.autoFit(bytes,{...plan,fontSize:7.5});assert.equal(below.reason,'below-minimum');assert.deepEqual(bytes,copy);
  const already=await engine.autoFit(bytes,await request(bytes,'Texto',{fontSize:15.123456}));assert.equal(already.fits,true);assert.equal(already.changed,false);assert.equal(already.fontSize,15.123456);assert.equal(already.checks,1);
});

test('tagged text fits while preserving tags; invalid minimums, altered selections and stale sources are rejected',async()=>{
  const tagged=await fixture({tagged:true});const taggedPlan=await request(tagged),taggedFit=await engine.autoFit(tagged,taggedPlan);assert.equal(taggedFit.fits,true);const taggedResult=await engine.edit(tagged,{...taggedPlan,fontSize:taggedFit.fontSize});assert.equal((await engine.inspect(taggedResult,1)).objects[0].marks,(await engine.inspect(tagged,1)).objects[0].marks);assert.equal((await engine.inspect(taggedResult,1)).objects.at(-1).marks,0);const bytes=await fixture(),plan=await request(bytes),copy=bytes.slice();for(const fitMinimum of [0,5.9,72.1,NaN,Infinity,'8'])await assert.rejects(()=>engine.autoFit(bytes,{...plan,fitMinimum}));for(const patch of [{source:'stale'},{index:999},{original:'alterado'},{indices:[0,1,2]},{text:''},{text:'Dos\nlíneas'}])await assert.rejects(()=>engine.autoFit(bytes,{...plan,...patch}));assert.deepEqual(bytes,copy);
});

test('auto fit uses the selected alternate font, preserves color and rejects unavailable embedded glyphs',async()=>{
  const bytes=await fixture(),plan=await request(bytes,'Texto cambiado en PDF',{font:'Courier',color:'#a02050'}),result=await engine.autoFit(bytes,plan);assert.equal(result.fits,true);const saved=await engine.edit(bytes,{...plan,fontSize:result.fontSize}),after=(await engine.inspect(saved,1)).objects[0];assert.equal(after.fontName,'Courier');assert.equal(after.color,'#a02050');const embedded=new Uint8Array(await readFile(new URL('./fixtures/original-subset.pdf',import.meta.url)));await assert.rejects(async()=>engine.autoFit(embedded,await request(embedded,'日本語')),/fuente alternativa/);
});

test('search respects exact current size, rounds minima upward and never selects an untested or larger value',async()=>{
  const attempted=[],result=await findTextSize(async size=>{attempted.push(size);return {fits:size<=10.36};},{fontSize:14.5678,factor:1,minimum:8.25});assert.equal(result.pointSize,10.3);assert.ok(attempted.includes(result.fontSize));assert.ok(attempted.slice(1).every(size=>size>=8.25&&size<=14.5678));const exact=await findTextSize(async()=>({fits:true}),{fontSize:9.12345,factor:2,minimum:8});assert.equal(exact.fontSize,9.12345);assert.equal(exact.changed,false);const tooLow=await findTextSize(async()=>{throw Error('must not measure');},{fontSize:3,factor:2,minimum:8});assert.equal(tooLow.reason,'below-minimum');
});
