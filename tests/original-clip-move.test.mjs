import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {PDFDocument,PDFName,PDFNumber,StandardFonts,degrees,pushGraphicsState,popGraphicsState,rectangle,clip,endPath,moveTo,lineTo,closePath,appendBezierCurve,beginMarkedContent,endMarkedContent,setTextRenderingMode} from 'pdf-lib';
import {createOriginalTextEngine} from '../src/original-text-engine.mjs';
import {rectangleClipBounds} from '../src/original-clip.mjs';
import {designForm,getFields} from '../src/pdf-engine.mjs';
const engine=await createOriginalTextEngine(new Uint8Array(await readFile('node_modules/@embedpdf/pdfium/dist/pdfium.wasm')));
async function fixture(angle=0,unit=1,shape='rectangle'){
  const doc=await PDFDocument.create(),p=doc.addPage([600,800]),font=await doc.embedFont(StandardFonts.Helvetica);doc.setTitle('Movimiento con máscara');p.setRotation(degrees(angle));p.setCropBox(20,30,500,700);p.node.set(PDFName.of('UserUnit'),PDFNumber.of(unit));
  p.pushOperators(pushGraphicsState());
  if(shape==='rectangle')p.pushOperators(rectangle(65,655,80,55));
  if(shape==='curve')p.pushOperators(moveTo(65,655),appendBezierCurve(60,740,150,740,145,655),closePath());
  if(shape==='triangle')p.pushOperators(moveTo(65,655),lineTo(145,655),lineTo(100,710),closePath());
  if(shape==='compound')p.pushOperators(rectangle(65,655,35,55),rectangle(115,655,30,55));
  if(shape==='intersection')p.pushOperators(rectangle(65,640,180,70),clip(),endPath(),rectangle(50,655,120,65));
  p.pushOperators(clip(),endPath(),beginMarkedContent('Span'));
  let x=60;for(const text of ['Texto ','en ','partes']){p.drawText(text,{x,y:650,size:20,font});x+=font.widthOfTextAtSize(text,20);}
  p.drawText('Vecino intacto',{x:60,y:690,size:20,font});p.pushOperators(endMarkedContent(),popGraphicsState());p.drawText('Fuera del recorte',{x:40,y:500,size:16,font});return doc.save();
}
async function plan(bytes,extra={}){const info=await engine.inspect(bytes,1),r=info.lines[0];return {source:info.source,page:1,index:r.index,indices:r.indices,originals:r.originals,original:r.text,dx:220,dy:-200,...extra};}
const near=(a,b)=>assert.ok(Math.abs(a-b)<.002,`${a} vs ${b}`);
const visible=({separatorBefore,...r})=>({...r,text:r.text.trimEnd()});

test('rectangle classifier rejects curves, extra contours, crossed corners, open and degenerate paths',()=>{
  const rect=[[2,false,10,20],[0,false,40,20],[0,false,40,60],[0,true,10,60]],signature=p=>JSON.stringify([p]);assert.deepEqual(rectangleClipBounds(signature(rect)),[10,20,40,60]);assert.deepEqual(rectangleClipBounds(signature([...rect.slice(0,3),[0,false,10,60],[0,true,10,20]])),[10,20,40,60]);
  for(const value of ['', 'individual:123',JSON.stringify([rect,rect]),signature(rect.map((s,i)=>i===2?[1,...s.slice(1)]:s)),signature([rect[0],rect[2],rect[1],rect[3]]),signature(rect.map(s=>[s[0],false,...s.slice(2)])),signature(rect.map(s=>[s[0],s[1],10,s[3]]))])assert.equal(rectangleClipBounds(value),null);
});

test('clipped line moves each text and its private rectangle exactly once on all rotations and UserUnits',async()=>{
  for(const angle of [0,90,180,270])for(const unit of [1,2]){
    const bytes=await fixture(angle,unit),copy=bytes.slice(),before=await engine.inspect(bytes,1),request=await plan(bytes),saved=await engine.move(bytes,request),after=await engine.inspect(saved,1),selected=new Set(request.indices);assert.equal(request.indices.length,3);assert.equal(after.objects.length,before.objects.length);
    for(let i=0;i<before.objects.length;i++){const a=before.objects[i],b=after.objects[i];assert.equal(a.movable,true);if(!selected.has(a.index)){assert.deepEqual(visible(b),visible(a));continue;}assert.equal(b.text.trimEnd(),a.text.trimEnd());assert.equal(b.marks,a.marks);assert.equal(b.fontName,a.fontName);assert.equal(b.fontSize,a.fontSize);assert.equal(b.color,a.color);assert.equal(b.opacity,a.opacity);assert.equal(b.clipped,true);assert.equal(b.clipCount,1);assert.equal(b.movable,true);assert.deepEqual(b.matrix.slice(0,4),a.matrix.slice(0,4));near(b.matrix[4],a.matrix[4]+request.dx);near(b.matrix[5],a.matrix[5]+request.dy);for(let j=0;j<4;j++)near(b.clipBounds[j],a.clipBounds[j]+(j%2?request.dy:request.dx));}
    assert.deepEqual(bytes,copy);const doc=await PDFDocument.load(saved);assert.equal(doc.getTitle(),'Movimiento con máscara');assert.equal(doc.getPage(0).getRotation().angle,angle);assert.equal(doc.getPage(0).node.get(PDFName.of('UserUnit')).asNumber(),unit);assert.deepEqual(doc.getPage(0).getCropBox(),{x:20,y:30,width:500,height:700});
  }
});

test('masked preview and saved raster retain exactly the same visible glyph slice without revealing hidden letters',async()=>{
  // CropBox covers 500x700, so width=500 gives one pixel per PDF unit.
  const bytes=await fixture(),request=await plan(bytes),before=await engine.previewMove(bytes,{...request,dx:0,dy:0,previewWidth:500}),preview=await engine.previewMove(bytes,{...request,previewWidth:500}),saved=await engine.move(bytes,request),after=await engine.previewMove(saved,{...await plan(saved),dx:0,dy:0,previewWidth:500});
  assert.equal(before.image.width,500);assert.equal(before.image.height,700);let ink=0,difference=0;
  for(let y=50;y<95;y++)for(let x=30;x<220;x++){const a=(y*500+x)*4,b=((y+200)*500+x+220)*4;for(let c=0;c<3;c++){difference+=Math.abs(before.image.data[a+c]-after.image.data[b+c]);if(before.image.data[a+c]<100)ink++;}}
  assert.ok(ink>50);assert.ok(difference<200,`glyph slice changed: ${difference}`);
  let delta=0;for(let i=0;i<preview.image.data.length;i++)delta+=Math.abs(preview.image.data[i]-after.image.data[i]);assert.ok(delta/preview.image.data.length<.01);
  await mkdir('tmp/pdfs/clip-move',{recursive:true});await writeFile('tmp/pdfs/clip-move/antes.pdf',bytes);await writeFile('tmp/pdfs/clip-move/despues.pdf',saved);
});

test('curved, polygonal, compound and intersected masks translate with the exact visible glyph slice',async()=>{
  for(const shape of ['curve','triangle','compound','intersection']){const bytes=await fixture(0,1,shape),copy=bytes.slice(),info=await engine.inspect(bytes,1);assert.equal(info.objects[0].movable,true,shape);const request=await plan(bytes),before=await engine.previewMove(bytes,{...request,dx:0,dy:0,previewWidth:500}),saved=await engine.move(bytes,request),after=await engine.previewMove(saved,{...await plan(saved),dx:0,dy:0,previewWidth:500});let delta=0,ink=0;for(let y=50;y<95;y++)for(let x=30;x<220;x++){const a=(y*500+x)*4,b=((y+200)*500+x+220)*4;for(let c=0;c<3;c++){delta+=Math.abs(before.image.data[a+c]-after.image.data[b+c]);if(before.image.data[a+c]<100)ink++;}}assert.ok(ink>10,shape);assert.ok(delta<300,shape+': '+delta);assert.deepEqual(bytes,copy);assert.deepEqual(visible((await engine.inspect(saved,1)).objects[3]),visible(info.objects[3]));}
});

test('moving one clipped fragment leaves shared masks on siblings unchanged and repeated round trips are stable',async()=>{
  let bytes=await fixture(),info=await engine.inspect(bytes,1),r=info.objects[1];bytes=await engine.move(bytes,{source:info.source,page:1,index:r.index,original:r.text,dx:40,dy:-80});let after=await engine.inspect(bytes,1);for(const i of [0,2,3,4])assert.deepEqual(visible(after.objects[i]),visible(info.objects[i]));near(after.objects[1].clipBounds[0],r.clipBounds[0]+40);
  const counts=[];for(let n=0;n<6;n++){info=await engine.inspect(bytes,1);r=info.objects[1];bytes=await engine.move(bytes,{source:info.source,page:1,index:r.index,original:r.text,dx:n%2?-5:5,dy:0});after=await engine.inspect(bytes,1);assert.equal(after.objects[1].movable,true);counts.push((await PDFDocument.load(bytes)).context.enumerateIndirectObjects().length);}assert.ok(Math.max(...counts)-Math.min(...counts)<4);
});

test('clipped movement retains form values and page limits; zero movement keeps original bytes',async()=>{
  let bytes=await fixture();bytes=(await designForm(bytes,{}, {action:'create',kind:'text',page:1,rect:{x:.2,y:.4,w:.3,h:.05}})).bytes;const doc=await PDFDocument.load(bytes);doc.getForm().getTextField('Texto_1').setText('Valor intacto');bytes=await doc.save();const request=await plan(bytes),saved=await engine.move(bytes,request);assert.equal((await getFields(saved))[0].value,'Valor intacto');assert.deepEqual(await engine.move(bytes,{...request,dx:0,dy:0}),bytes);await assert.rejects(()=>engine.move(bytes,{...request,dx:1000}),/página/);
});

test('text clipping modes cannot be mistaken for a simple rectangle or an unmasked object',async()=>{
  for(const mode of [4,5,6,7]){const doc=await PDFDocument.create(),p=doc.addPage([600,800]);p.pushOperators(pushGraphicsState(),setTextRenderingMode(mode));p.drawText('O',{x:60,y:650,size:70});p.pushOperators(setTextRenderingMode(0),rectangle(50,640,200,100),clip(),endPath());p.drawText('Texto con recorte',{x:60,y:670,size:20});p.pushOperators(popGraphicsState());const bytes=await doc.save(),info=await engine.inspect(bytes,1),r=info.objects.at(-1);assert.equal(r.editable,false);assert.equal(r.movable,false);assert.match(r.moveReason,/máscara formada por texto/);await assert.rejects(()=>engine.move(bytes,{source:info.source,page:1,index:r.index,original:r.text,dx:20,dy:-40}),/máscara formada por texto/);}
});
