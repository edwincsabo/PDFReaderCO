import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName, PDFOperator, decodePDFRawStream, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, rectangle, clip, endPath, beginMarkedContent, endMarkedContent } from 'pdf-lib';
import { createOriginalTextEngine } from '../src/original-text-engine.mjs';
import { groupOriginalLines } from '../src/original-text-lines.mjs';

const engine=await createOriginalTextEngine(new Uint8Array(await readFile(new URL('../node_modules/@embedpdf/pdfium/dist/pdfium.wasm',import.meta.url))));
async function fixture({clipped=false,tagged=false,angle=0}={}){
  const doc=await PDFDocument.create(),p=doc.addPage([600,800]),font=await doc.embedFont(StandardFonts.Helvetica);p.setRotation(degrees(angle));
  p.drawText('Conservar antes',{x:40,y:740,size:14,font});
  if(clipped)p.pushOperators(pushGraphicsState(),rectangle(35,707,270,5),clip(),endPath());
  if(tagged)p.pushOperators(beginMarkedContent('Span'));
  let x=40;for(const text of ['Texto ','dividido ','original']){p.drawText(text,{x,y:700,size:18,font});x+=font.widthOfTextAtSize(text,18);}
  if(tagged)p.pushOperators(endMarkedContent());
  if(clipped)p.pushOperators(popGraphicsState());
  p.drawText('Columna aparte',{x:390,y:700,size:18,font});p.drawText('Conservar debajo',{x:40,y:650,size:14,font,color:rgb(.1,.3,.6)});
  return doc.save();
}
async function request(bytes,text='Texto unido',extra={}){const info=await engine.inspect(bytes,1),line=info.lines.find(l=>l.indices.length===3);assert.ok(line,'three compatible fragments');return {source:info.source,page:1,index:line.index,indices:line.indices,originals:line.originals,original:line.text,text,font:'original',fontSize:line.fontSize,color:line.color,checkFit:true,...extra};}

test('compatible fragments form one line without joining columns or other baselines',async()=>{
  const info=await engine.inspect(await fixture(),1),line=info.lines.find(l=>l.indices.length===3);assert.equal(line.text,'Texto dividido original');assert.deepEqual(line.originals,['Texto ','dividido ','original']);assert.equal(info.objects.length,6);assert.equal(info.lines.length,4);assert.equal(info.lines[2].text,'Columna aparte');
});

test('line editing is atomic, preserves other objects and geometry for each page rotation, and remains editable after reopening',async()=>{
  for(const angle of [0,90,180,270]){const bytes=await fixture({angle}),copy=bytes.slice(),before=await engine.inspect(bytes,1),plan=await request(bytes),out=await engine.edit(bytes,plan),after=await engine.inspect(out,1);assert.deepEqual(bytes,copy);assert.deepEqual(after.objects.map(o=>o.text),['Conservar antes','Texto unido','Columna aparte','Conservar debajo']);assert.deepEqual(after.objects[1].matrix,before.objects[1].matrix);assert.deepEqual(after.objects[2].matrix,before.objects[4].matrix);assert.equal((await PDFDocument.load(out)).getPage(0).getRotation().angle,angle);const next={...plan,...{source:after.source,index:after.lines[1].index,indices:after.lines[1].indices,originals:after.lines[1].originals,original:after.lines[1].text,text:'Unido'}};assert.equal((await engine.inspect(await engine.edit(out,next),1)).objects[1].text,'Unido');}
});

test('deleting a complete line removes all its members and retains later object identities and colors',async()=>{
  const bytes=await fixture(),out=await engine.edit(bytes,await request(bytes,'')),after=await engine.inspect(out,1);assert.deepEqual(after.objects.map(o=>o.text),['Conservar antes','Columna aparte','Conservar debajo']);assert.equal(after.objects[2].color,'#1a4d99');
});

test('actual font measurements detect overflow, enforce fit on commit and allow explicit overflow only without a mask',async()=>{
  const bytes=await fixture(),copy=bytes.slice(),plan=await request(bytes,'Texto mucho mas largo que toda el area disponible');const fit=await engine.measure(bytes,plan);assert.equal(fit.fits,false);assert.ok(fit.width>fit.availableWidth);assert.deepEqual(bytes,copy);await assert.rejects(()=>engine.edit(bytes,plan),/supera el área/);const out=await engine.edit(bytes,{...plan,allowOverflow:true});assert.equal((await engine.inspect(out,1)).objects[1].text,plan.text);const smaller={...plan,fontSize:7};assert.equal((await engine.measure(bytes,smaller)).fits,true);await engine.edit(bytes,smaller);
});

test('compatible clipped or identically tagged spans join while keeping their masks and tags',async()=>{
  for(const options of [{clipped:true},{tagged:true},{clipped:true,tagged:true}]){const bytes=await fixture(options),out=await engine.edit(bytes,await request(bytes)),line=(await engine.inspect(out,1)).objects[1];assert.equal(line.clipped,!!options.clipped);assert.equal(line.marks,options.tagged?1:0);if(options.clipped)await assert.rejects(async()=>engine.edit(bytes,await request(bytes,'Texto demasiado largo '.repeat(5),{allowOverflow:true})),/máscara/);}
});

test('forged line membership, original strings and stale sources cannot remove unrelated content',async()=>{
  const bytes=await fixture(),copy=bytes.slice(),plan=await request(bytes);for(const patch of [{indices:[...plan.indices,4]},{indices:plan.indices.slice(1)},{originals:['incorrecto']},{original:'incorrecto'},{source:'incorrecto'}])await assert.rejects(()=>engine.edit(bytes,{...plan,...patch}));assert.deepEqual(bytes,copy);
});

test('grouping rejects changes in style, mask, semantic span, overlap, baseline, direction and intervening graphics',()=>{
  const a={index:1,text:'Texto',bounds:[10,20,40,30],matrix:[1,0,0,1,10,20],fontSize:14,fontKey:1,clipKey:'same',markKey:'same',color:'#000000',opacity:1,editable:true};
  const b={...a,index:2,text:'nuevo',bounds:[43,20,70,30],matrix:[1,0,0,1,43,20]};assert.equal(groupOriginalLines([a,b]).length,1);assert.equal(groupOriginalLines([a,b])[0].text,'Texto nuevo');
  for(const patch of [{fontKey:2},{fontSize:16},{color:'#ff0000'},{opacity:.5},{clipKey:'other'},{markKey:'other'},{editable:false},{index:3},{bounds:[200,20,240,30]},{bounds:[35,20,60,30]},{matrix:[1,0,0,1,42,23]},{matrix:[0,1,-1,0,42,20]}])assert.equal(groupOriginalLines([a,{...b,...patch}]).length,2,JSON.stringify(patch));
});

test('line font fallback and empty preview use the same geometry checks as the saved result',async()=>{
  const bytes=await fixture(),plan=await request(bytes,'Ajustado',{font:'Times-Bold',fontSize:16,color:'#aa2244'}),fit=await engine.measure(bytes,plan);assert.equal(fit.fits,true);const out=await engine.edit(bytes,plan),run=(await engine.inspect(out,1)).objects[1];assert.equal(run.fontName,'Times-Bold');assert.equal(run.fontSize,16);assert.equal(run.color,'#aa2244');assert.deepEqual(run.bounds,fit.bounds);assert.equal((await engine.measure(bytes,{...plan,text:''})).fits,true);
});

test('word-internal splits keep their characters together and semantic MCIDs never cross between groups',async()=>{
  const doc=await PDFDocument.create(),p=doc.addPage([600,800]),font=await doc.embedFont(StandardFonts.Helvetica);let x=40;
  for(const [text,mcid] of [['Pala',7],['bra',7],['aparte',8]]){p.pushOperators(PDFOperator.of('BDC',[PDFName.of('Span'),doc.context.obj({MCID:mcid})]));p.drawText(text,{x,y:700,size:18,font});p.pushOperators(endMarkedContent());x+=font.widthOfTextAtSize(text,18);}
  const bytes=await doc.save(),info=await engine.inspect(bytes,1);assert.equal(info.lines.length,2);assert.equal(info.lines[0].text,'Palabra');assert.deepEqual(info.lines[0].indices,[0,1]);
  const line=info.lines[0],out=await engine.edit(bytes,{source:info.source,page:1,index:line.index,indices:line.indices,originals:line.originals,original:line.text,text:'Pala',font:'original',fontSize:18,color:'#000000',checkFit:true});const after=await engine.inspect(out,1);assert.deepEqual(after.objects.map(o=>o.text),['Pala','aparte']);const saved=await PDFDocument.load(out),content=saved.getPage(0).node.Contents();const raw=(content.asArray?content.asArray():[content]).map(ref=>new TextDecoder().decode(decodePDFRawStream(saved.context.lookup(ref)).decode())).join('');assert.match(raw,/\/MCID 7/);assert.match(raw,/\/MCID 8/);
});
