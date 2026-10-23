import test from'node:test';
import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{PDFDocument,PDFName,PDFNumber,StandardFonts,degrees,decodePDFRawStream}from'pdf-lib';
import{ocrRegion,regionTextConflict,regionPoint,regionsIntersect}from'../src/ocr-region.mjs';
import{inspectOcrSource,applyOcr,ocrOptions}from'../src/ocr-engine.mjs';
import{rotationGeometry,wordPolygon,reviewPoint}from'../src/ocr-review.mjs';
import{encodeOcrSession,decodeOcrSession}from'../src/ocr-session.mjs';
import{pageGeometry,viewToPdf}from'../src/pdf-coordinates.mjs';
const N=PDFName.of,region={page:1,x:.2,y:.3,w:.4,h:.2};
test('OCR regions validate bounds, size, page and preserve legacy full-page options',()=>{
  const opts={language:'spa',dpi:300,range:'1'};assert.equal(ocrOptions(opts).region,undefined);assert.deepEqual(ocrOptions({...opts,region}).region,region);
  for(const r of[{...region,page:0},{...region,x:-.1},{...region,w:.01},{...region,y:.9},{...region,h:NaN},{...region,page:1.5}])assert.throws(()=>ocrRegion(r));
  assert.equal(regionsIntersect(region,{x:.6,y:.3,w:.1,h:.2}),false);assert.equal(regionsIntersect(region,{x:.59,y:.3,w:.1,h:.2}),true);
});
test('OCR text conflict respects transformed text bounds, rotation, padding and conservative unsupported text',()=>{
  const content={styles:{F:{ascent:.8,descent:-.2}},items:[{str:'Digital',fontName:'F',width:100,transform:[20,0,0,20,40,700]}]},vp={width:600,height:800,transform:[1,0,0,-1,0,800]};
  assert.equal(regionTextConflict({x:.05,y:.1,w:.3,h:.1},content,vp),true);assert.equal(regionTextConflict(region,content,vp),false);
  const rotated={width:800,height:600,transform:[0,1,1,0,0,0]};assert.equal(regionTextConflict({x:.84,y:.05,w:.06,h:.2},content,rotated),true);assert.equal(regionTextConflict({x:.1,y:.5,w:.1,h:.1},content,rotated),false);
  assert.equal(regionTextConflict(region,{...content,styles:{F:{vertical:true}}},vp),true);
});
test('OCR word review maps a deskewed region back to the original full page while analysis stays local',()=>{
  const g=rotationGeometry(600,400,3),word={box:[.2,.3,.6,.5]},actual=wordPolygon(word,g,false,region),local=wordPolygon(word,g,true,region);
  assert.deepEqual(local,[[.2,.3],[.6,.3],[.6,.5],[.2,.5]]);assert.deepEqual(actual,local.map(p=>regionPoint(...reviewPoint(...p,g),region)));
});
async function blank(rotation=0){const doc=await PDFDocument.create(),p=doc.addPage([600,800]);p.setCropBox(20,30,500,700);p.setRotation(degrees(rotation));p.node.set(N('UserUnit'),PDFNumber.of(2));return doc.save();}
async function layer(width,height){const doc=await PDFDocument.create(),p=doc.addPage([width,height]),font=await doc.embedFont(StandardFonts.Helvetica),f=p.node.newFontDictionary('OCR',font.ref);p.node.set(N('Contents'),doc.context.register(doc.context.flateStream(`BT 3 Tr ${f} 12 Tf 1 0 0 1 20 20 Tm ${font.encodeText('Zona')} Tj ET`)));return doc.save();}
async function report(bytes,r){const source=await inspectOcrSource(bytes),p=source.pages[0];return{source:source.source,options:ocrOptions({language:'spa',dpi:200,range:'1',region:r}),pages:[{page:1,status:'recognized',text:'Zona',language:'spa',confidence:90,region:r,pdf:await layer(p.width*r.w,p.height*r.h)}]};}
test('OCR region native matrices preserve CropBox, all rotations and UserUnit and record their scope',async()=>{
  for(const rotation of[0,90,180,270]){const bytes=await blank(rotation),r=await report(bytes,region),result=await applyOcr(bytes,r,[1]),doc=await PDFDocument.load(result.bytes),p=doc.getPage(0),g=pageGeometry(p),refs=p.node.Contents().asArray(),s=new TextDecoder().decode(decodePDFRawStream(doc.context.lookup(refs.at(-1))).decode()),matrix=s.match(/([-\d.e+ ]+) cm/)[1].trim().split(/\s+/).map(Number);
    const a=viewToPdf(...regionPoint(0,1,region),g.crop.width,g.crop.height,g.rotation,g.crop),b=viewToPdf(...regionPoint(1,1,region),g.crop.width,g.crop.height,g.rotation,g.crop),c=viewToPdf(...regionPoint(0,0,region),g.crop.width,g.crop.height,g.rotation,g.crop),expected=[(b[0]-a[0])/(g.width*region.w),(b[1]-a[1])/(g.width*region.w),(c[0]-a[0])/(g.height*region.h),(c[1]-a[1])/(g.height*region.h),...a];
    matrix.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-8));const saved=(await inspectOcrSource(result.bytes)).pages[0];assert.equal(saved.ocrRegions.length,1);assert.equal(saved.ocrRegions[0].x,region.x);assert.deepEqual(pageGeometry(p),g);
  }
});
test('OCR region layers can be added only outside prior regions; full layers and stale geometry remain protected',async()=>{
  const initial=await blank(),first=await applyOcr(initial,await report(initial,region),[1]);
  await assert.rejects(applyOcr(first.bytes,await report(first.bytes,region),[1]),/superpone/);
  const other={page:1,x:.2,y:.65,w:.4,h:.2},second=await applyOcr(first.bytes,await report(first.bytes,other),[1]);assert.equal((await inspectOcrSource(second.bytes)).pages[0].ocrRegions.length,2);
  const r=await report(second.bytes,other);delete r.pages[0].region;await assert.rejects(applyOcr(second.bytes,r,[1]),/ya tiene/);
  const doc=await PDFDocument.load(first.bytes);doc.getPage(0).setRotation(degrees(90));const bytes=await doc.save();await assert.rejects(applyOcr(bytes,await report(bytes,other),[1]),/incompatible/);
});
test('OCR region recovery preserves crop, corrections and review of high-confidence words without applying',async()=>{
  const bytes=await blank(),source=await inspectOcrSource(bytes),options=ocrOptions({language:'spa',dpi:300,range:'1',region}),pdf=new Uint8Array(await readFile('tests/fixtures/ocr-native-layer.pdf')),session={version:1,report:{source:source.source,options,pages:[{page:1,status:'recognized',text:'Texto',confidence:95,language:'spa',pdf,region,message:'Zona',words:[{id:0,start:0,length:5,line:0,text:'Texto',confidence:95,box:[.1,.1,.3,.3],correction:'Textó',reviewed:true}]}]},options,selected:[1],current:1,views:{1:{chosen:0,threshold:85,lowOnly:false,zoom:1,allPending:true}},remaining:[],pixels:10000};
  const recovered=await decodeOcrSession(await encodeOcrSession(session),source.source);assert.deepEqual(recovered.options.region,region);assert.deepEqual(recovered.report.pages[0].region,region);assert.equal(recovered.views[1].allPending,true);assert.equal(recovered.report.pages[0].words[0].correction,'Textó');
});

test('OCR narrow regions admit one raster rounding pixel but reject a distorted aspect',async()=>{
  const bytes=await blank(),r={page:1,x:.02,y:.37,w:.9,h:.12},result=await report(bytes,r),geometry=rotationGeometry(2250,421,0);result.pages[0].geometry=geometry;result.pages[0].pdf=await layer(2250,421);await applyOcr(bytes,result,[1]);
  result.pages[0].geometry=rotationGeometry(2250,440,0);result.pages[0].pdf=await layer(2250,440);await assert.rejects(applyOcr(bytes,result,[1]),/geometría/);
});
