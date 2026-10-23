import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, beginMarkedContent, endMarkedContent } from 'pdf-lib';
import { createOriginalTextEngine } from '../src/original-text-engine.mjs';
import { snapOriginalMove, pdfMoveDelta, viewportBox, textBaseline } from '../src/original-move-geometry.mjs';
import { designForm, getFields, exportPdf } from '../src/pdf-engine.mjs';
import { prepareEditablePdf } from '../src/native-annotations.mjs';

const engine=await createOriginalTextEngine(new Uint8Array(await readFile(new URL('../node_modules/@embedpdf/pdfium/dist/pdfium.wasm',import.meta.url))));
async function fixture(angle=0,unit=1,masked=false,tagged=false){
  const doc=await PDFDocument.create(),p=doc.addPage([600,800]),font=await doc.embedFont(StandardFonts.Helvetica);p.setRotation(degrees(angle));p.setCropBox(20,30,500,700);p.node.set(PDFName.of('UserUnit'),PDFNumber.of(unit));p.drawRectangle({x:20,y:400,width:480,height:330,color:rgb(.8,.94,.86)});
  if(masked)p.pushOperators(pushGraphicsState(),rectangle(45,645,300,12),clip(),endPath());if(tagged)p.pushOperators(beginMarkedContent('Span'));let x=60;for(const text of ['Texto ','en ','partes']){p.drawText(text,{x,y:650,size:20,font,color:rgb(.1,.2,.3),opacity:.7});x+=font.widthOfTextAtSize(text,20);}if(tagged)p.pushOperators(endMarkedContent());if(masked)p.pushOperators(popGraphicsState());p.drawText('Conservar esta frase',{x:40,y:500,size:14,font});return doc.save();
}
async function request(bytes,extra={}){const info=await engine.inspect(bytes,1),run=info.lines[0];return {source:info.source,page:1,index:run.index,indices:run.indices,originals:run.originals,original:run.text,dx:30,dy:-50,...extra};}
const near=(a,b,tolerance=.001)=>assert.ok(Math.abs(a-b)<tolerance,`${a} vs ${b}`);

test('moving a line preserves individual fragments, spacing, fonts and styling in raw PDF coordinates on every rotation and UserUnit',async()=>{
  for(const angle of [0,90,180,270])for(const unit of [1,2]){const bytes=await fixture(angle,unit),copy=bytes.slice(),before=(await engine.inspect(bytes,1)).objects,plan=await request(bytes),saved=await engine.move(bytes,plan),after=(await engine.inspect(saved,1)).objects;assert.equal(after.length,before.length);for(let n=0;n<3;n++){assert.equal(after[n].text,before[n].text);assert.equal(after[n].fontName,before[n].fontName);assert.equal(after[n].fontSize,before[n].fontSize);assert.equal(after[n].color,before[n].color);assert.equal(after[n].opacity,before[n].opacity);assert.deepEqual(after[n].matrix.slice(0,4),before[n].matrix.slice(0,4));near(after[n].matrix[4],before[n].matrix[4]+30);near(after[n].matrix[5],before[n].matrix[5]-50);}assert.deepEqual(after[3],before[3]);assert.deepEqual(bytes,copy);const doc=await PDFDocument.load(saved);assert.equal(doc.getPage(0).getRotation().angle,angle);assert.equal(doc.getPage(0).node.get(PDFName.of('UserUnit')).asNumber(),unit);assert.deepEqual(doc.getPage(0).getCropBox(),{x:20,y:30,width:500,height:700});}
});

test('embedded characters and ordinary structural tags are retained without text reconstruction',async()=>{
  const embedded=new Uint8Array(await readFile(new URL('./fixtures/original-subset.pdf',import.meta.url))),before=(await engine.inspect(embedded,1)).objects[0],saved=await engine.move(embedded,await request(embedded,{dx:10,dy:-20})),after=(await engine.inspect(saved,1)).objects[0];assert.equal(after.text,before.text);assert.equal(after.embedded,true);assert.equal(after.fontName,before.fontName);const tagged=await fixture(0,1,false,true),out=await engine.move(tagged,await request(tagged));assert.deepEqual((await engine.inspect(out,1)).objects.map(o=>o.marks),(await engine.inspect(tagged,1)).objects.map(o=>o.marks));
});

test('stale, forged, nonfinite and out-of-crop movements are rejected while zero movement leaves exact bytes untouched',async()=>{
  const bytes=await fixture(),copy=bytes.slice(),plan=await request(bytes);for(const patch of [{source:'stale'},{index:-1},{index:0},{original:'otra'},{indices:[1,2,3,4]},{originals:['otra']},{dx:NaN},{dy:Infinity},{dx:-1000},{dy:1000}])await assert.rejects(()=>engine.move(bytes,{...plan,...patch}));assert.deepEqual(await engine.move(bytes,{...plan,dx:0,dy:0}),bytes);assert.deepEqual(bytes,copy);const doc=await PDFDocument.create();doc.addPage([600,800]).drawText('Texto',{x:40,y:700,size:20});const plain=await doc.save();await engine.move(plain,await request(plain,{dx:20,dy:-20}));
});

test('movement preview matches a saved page without changing the original PDF or covering its background',async()=>{
  const bytes=await fixture(),copy=bytes.slice(),plan=await request(bytes),preview=await engine.previewMove(bytes,{...plan,previewWidth:500}),saved=await engine.move(bytes,plan),control=await engine.previewMove(saved,await request(saved,{dx:0,dy:0,previewWidth:500}));assert.equal(preview.image.width,control.image.width);assert.equal(preview.image.height,control.image.height);let difference=0;for(let i=0;i<preview.image.data.length;i++)difference+=Math.abs(preview.image.data[i]-control.image.data[i]);assert.ok(difference/preview.image.data.length<.08);assert.deepEqual(bytes,copy);assert.equal((await engine.inspect(bytes,1)).objects.length,4);
});

test('moving a fragment only moves that object and repeated moves do not grow the document graph',async()=>{
  let bytes=await fixture(),info=await engine.inspect(bytes,1),run=info.objects[1];const plan={source:info.source,page:1,index:run.index,original:run.text,dx:0,dy:-30},out=await engine.move(bytes,plan),after=await engine.inspect(out,1);const visible=({separatorBefore,...run})=>({...run,text:run.text.trimEnd()});assert.deepEqual(visible(after.objects[0]),visible(info.objects[0]));near(after.objects[1].matrix[5],run.matrix[5]-30);assert.deepEqual(visible(after.objects[2]),visible(info.objects[2]));const sizes=[];for(let n=0;n<8;n++){bytes=await engine.move(bytes,await request(bytes,{dx:n%2?-5:5,dy:0}));sizes.push((await PDFDocument.load(bytes)).context.enumerateIndirectObjects().length);}assert.ok(Math.max(...sizes)-Math.min(...sizes)<4);
});

test('moving source text retains native annotations, fields and document metadata',async()=>{
  let bytes=await fixture();bytes=(await designForm(bytes,{}, {action:'create',kind:'text',page:1,rect:{x:.2,y:.4,w:.3,h:.05}})).bytes;const doc=await PDFDocument.load(bytes);doc.setTitle('Metadatos retenidos');doc.getForm().getTextField('Texto_1').setText('Valor intacto');bytes=await doc.save();const note={id:'move-note',page:1,tool:'note',x:.7,y:.4,w:.04,h:.03,size:2,color:'#ffdf60',text:'Comentario conservado'};bytes=await exportPdf(bytes,{marks:[note],forms:{}});const saved=await engine.move(bytes,await request(bytes));assert.equal((await PDFDocument.load(saved)).getTitle(),'Metadatos retenidos');assert.equal((await getFields(saved))[0].value,'Valor intacto');assert.deepEqual((await prepareEditablePdf(saved)).marks,[note]);
});

test('snap guides align matching text edges and baselines; Alt-style free movement and boundary clamps stay exact',()=>{
  const box={x:10,y:10,w:40,h:20},baseline={axis:'y',value:27},neighbors=[{box:{x:100,y:200,w:60,h:25},baseline:{axis:'y',value:224}}],snap=snapOriginalMove(box,baseline,88,196.8,neighbors,600,800);assert.equal(snap.dx,90);assert.equal(snap.dy,197);assert.equal(snap.guides.find(g=>g.axis==='y').value,224);const free=snapOriginalMove(box,baseline,88,196.8,neighbors,600,800,false);assert.equal(free.dx,88);assert.equal(free.dy,196.8);assert.deepEqual(free.guides,[]);const clamped=snapOriginalMove(box,baseline,-999,999,[],600,800);assert.equal(clamped.dx,-10);assert.equal(clamped.dy,770);
});

test('screen deltas convert through rotated, scaled and translated viewports and baseline detection follows displayed text direction',()=>{
  for(const [a,b,c,d]of [[2,0,0,-2],[0,4,4,0],[-2,0,0,2],[0,-4,-4,0]]){const e=70,f=900,det=a*d-b*c,viewport={convertToViewportPoint:(x,y)=>[a*x+c*y+e,b*x+d*y+f],convertToPdfPoint:(x,y)=>[(d*(x-e)-c*(y-f))/det,(-b*(x-e)+a*(y-f))/det]};const move=pdfMoveDelta(viewport,11,-7),screen=viewport.convertToViewportPoint(move.dx,move.dy);near(screen[0]-e,11);near(screen[1]-f,-7);const box=viewportBox(viewport,[10,20,40,50]);assert.ok(box.w>0&&box.h>0);assert.equal(textBaseline(viewport,[1,0,0,1,10,20]).axis,b?'x':'y');}
});
