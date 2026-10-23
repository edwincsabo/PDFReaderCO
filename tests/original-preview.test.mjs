import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, PDFName, PDFNumber, degrees, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from 'pdf-lib';
import { createOriginalTextEngine } from '../src/original-text-engine.mjs';

const engine=await createOriginalTextEngine(new Uint8Array(await readFile(new URL('../node_modules/@embedpdf/pdfium/dist/pdfium.wasm',import.meta.url))));
async function fixture(angle=0,unit=1,masked=false){
  const doc=await PDFDocument.create(),p=doc.addPage([600,800]),font=await doc.embedFont(StandardFonts.Helvetica);p.setRotation(degrees(angle));p.setCropBox(20,30,500,700);p.node.set(PDFName.of('UserUnit'),PDFNumber.of(unit));p.drawRectangle({x:20,y:30,width:500,height:700,color:rgb(.2,.6,.8)});
  if(masked)p.pushOperators(pushGraphicsState(),rectangle(35,694,280,12),clip(),endPath());
  let x=40;for(const t of ['Texto ','dividido ','original']){p.drawText(t,{x,y:700,size:18,font});x+=font.widthOfTextAtSize(t,18);}
  if(masked)p.pushOperators(popGraphicsState());p.drawText('Conservar',{x:40,y:650,size:14,font});return doc.save();
}
async function request(bytes,text='Texto unido',extra={}){const info=await engine.inspect(bytes,1),line=info.lines[0];return {source:info.source,page:1,index:line.index,indices:line.indices,originals:line.originals,original:line.text,text,font:'original',fontSize:line.fontSize,color:line.color,checkFit:true,previewWidth:500,...extra};}
function sameImage(a,b){assert.equal(a.width,b.width);assert.equal(a.height,b.height);let total=0,changed=0;for(let i=0;i<a.data.length;i++){const diff=Math.abs(a.data[i]-b.data[i]);total+=diff;if(diff>8)changed++;}assert.ok(total/a.data.length<.08,'render differences are rounding only');assert.ok(changed/a.data.length<.002);}

test('live preview renders the entire replacement and matches a committed page across rotations, shifted crop and UserUnit without changing source bytes',async()=>{
  for(const angle of [0,90,180,270])for(const unit of [1,2]){const bytes=await fixture(angle,unit),copy=bytes.slice(),plan=await request(bytes),preview=await engine.preview(bytes,plan);assert.equal(preview.fits,true);assert.deepEqual(bytes,copy);assert.equal((await engine.inspect(bytes,1)).objects.length,4);const out=await engine.edit(bytes,plan),info=await engine.inspect(out,1);assert.equal(info.objects.length,2);sameImage(preview.image,(await engine.preview(out,await request(out,'Texto unido'))).image);const rgba=Array.from(preview.image.data.slice(0,4));assert.deepEqual(rgba,[51,153,204,255]);}
});

test('clipped and deletion previews match their saved PDF, while overflow remains a temporary preview until explicitly permitted',async()=>{
  const bytes=await fixture(0,1,true),copy=bytes.slice(),plan=await request(bytes),preview=await engine.preview(bytes,plan),saved=await engine.edit(bytes,plan);assert.equal((await engine.inspect(saved,1)).objects[0].clipped,true);sameImage(preview.image,(await engine.preview(saved,await request(saved))).image);
  const deletion=await request(bytes,''),removed=await engine.preview(bytes,deletion),out=await engine.edit(bytes,deletion),info=await engine.inspect(out,1);assert.deepEqual(info.objects.map(o=>o.text),['Conservar']);sameImage(removed.image,(await engine.preview(out,await request(out,'Conservar'))).image);
  const long=await request(bytes,'Texto muy largo '.repeat(20)),overflow=await engine.preview(bytes,long);assert.equal(overflow.fits,false);await assert.rejects(()=>engine.edit(bytes,long),/área/);assert.deepEqual(bytes,copy);
});

test('preview limits raster memory and checks stale documents and unavailable embedded glyphs',async()=>{
  const bytes=await fixture(),plan=await request(bytes,'Texto',{previewWidth:1e9}),preview=await engine.preview(bytes,plan);assert.ok(preview.image.width<=2400);assert.ok(preview.image.width*preview.image.height<=1800000);assert.equal(preview.image.data.byteLength,preview.image.width*preview.image.height*4);await assert.rejects(()=>engine.preview(bytes,{...plan,source:'stale'}),/cambió/);
  const embedded=new Uint8Array(await readFile(new URL('./fixtures/original-subset.pdf',import.meta.url)));await assert.rejects(async()=>engine.preview(embedded,await request(embedded,'Niño nuevo áéíóú')),/fuente alternativa/);
});

test('reducing size with a different font retains the insertion point and does not falsely overflow its original side bearing',async()=>{
  const doc=await PDFDocument.create(),p=doc.addPage([600,800]);p.drawText('Documento 1',{x:40,y:755,size:20});const bytes=await doc.save(),plan=await request(bytes,'Documento editado',{font:'Courier',fontSize:9}),preview=await engine.preview(bytes,plan);assert.equal(preview.fits,true);assert.equal(preview.area[0],40);const saved=await engine.edit(bytes,plan),run=(await engine.inspect(saved,1)).objects[0];assert.equal(run.fontSize,9);assert.equal(run.fontName,'Courier');assert.deepEqual(run.matrix,[1,0,0,1,40,755]);
});
