import test from'node:test';
import assert from'node:assert/strict';
import {readFile}from'node:fs/promises';
import {PDFDocument,PDFName,PDFHexString,PDFRawStream,decodePDFRawStream,degrees,PDFNumber}from'pdf-lib';
import{normalizeOcrWords,reviewedText,reviewError,correctionError,rotationGeometry,reviewPoint,wordPolygon}from'../src/ocr-review.mjs';
import{cleanOcrPixels}from'../src/ocr-image.mjs';
import{applyOcr,inspectOcrSource,ocrOptions}from'../src/ocr-engine.mjs';
const N=PDFName.of,near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const native=new Uint8Array(await readFile('tests/fixtures/ocr-native-layer.pdf')),data=JSON.parse(await readFile('tests/fixtures/ocr-native-words.json','utf8'));
async function fixture(rotation=0,unit=1,angle=0){
  const doc=await PDFDocument.create(),p=doc.addPage(rotation%180?[840,660]:[640,860]);p.setCropBox(20,30,...(rotation%180?[800,600]:[600,800]));p.setRotation(degrees(rotation));p.node.set(N('UserUnit'),PDFNumber.of(unit));const image=await doc.embedPng(await readFile('tests/fixtures/ocr-scan.png'));p.drawImage(image,{x:20,y:30,width:600,height:800});const field=doc.getForm().createTextField('Dato');field.setText('Conservado');field.addToPage(p,{x:40,y:50,width:180,height:25});await doc.attach(new Uint8Array([1,2,3]),'dato.bin');
  const bytes=await doc.save(),geometry=rotationGeometry(1200,1600,angle),layer=await PDFDocument.load(native);if(angle)layer.getPage(0).setSize(geometry.processedWidth,geometry.processedHeight);const details=normalizeOcrWords(data.text,data.lines,1200,1600),item={page:1,status:'recognized',text:data.text,confidence:91,language:'spa+eng',pdf:await layer.save({updateFieldAppearances:false}),geometry,...details};
  const word=item.words.find(w=>w.text==='2026');word.correction='2031';return{bytes,item,report:{source:(await inspectOcrSource(bytes)).source,pages:[item]}};
}
test('OCR review preserves exact separators while mapping words, rejects partial mappings and supports reversible corrections',()=>{
  const r=normalizeOcrWords('Uno  dos\nTres\n',[[{text:'Uno',box:[1,1,10,10],confidence:90},{text:'dos',box:[12,1,22,10],confidence:40}],[{text:'Tres',box:[1,12,20,22],confidence:99}]],100,100);assert.equal(r.reviewable,true);const p={text:'Uno  dos\nTres\n',...r};p.words[1].correction='pingüino';assert.equal(reviewedText(p),'Uno  pingüino\nTres\n');assert.equal(reviewError(p),'');delete p.words[1].correction;assert.equal(reviewedText(p),p.text);
  assert.equal(normalizeOcrWords('Uno falta',[[{text:'Uno',box:[1,1,10,10]}]],100,100).reviewable,false);assert.equal(normalizeOcrWords('Otro',[[{text:'Uno',box:[1,1,10,10]}]],100,100).words.length,0);
});
test('OCR preparation geometry maps expanded rotation back to source without losing corner coordinates',()=>{
  for(const angle of[-5,-2.3,0,3,5]){const g=rotationGeometry(600,800,angle),c=Math.cos(angle*Math.PI/180),s=Math.sin(angle*Math.PI/180);for(const[x,y]of[[0,0],[1,0],[0,1],[1,1],[.2,.8]]){const px=(c*(x*600-300)-s*(y*800-400)+g.processedWidth/2)/g.processedWidth,py=(s*(x*600-300)+c*(y*800-400)+g.processedHeight/2)/g.processedHeight;const result=reviewPoint(px,py,g);near(result[0],x);near(result[1],y);}assert.equal(wordPolygon({box:[.1,.2,.3,.4]},g).length,4);}
  assert.throws(()=>rotationGeometry(6000,6000,0));assert.throws(()=>rotationGeometry(600,800,5.1));assert.throws(()=>ocrOptions({language:'spa',dpi:200,range:'',preparation:{deskew:'other'}}));
});
test('OCR image preparation stretches contrast, suppresses isolated noise and leaves an untouched input copy',()=>{
  const original=new Uint8ClampedArray(5*5*4);for(let i=0;i<25;i++)original.set([180,180,180,255],i*4);original.set([80,80,80,255],0);const prepared=cleanOcrPixels(original.slice(),5,5,{contrast:true});assert.equal(prepared[0],0);assert.equal(prepared[4],255);assert.equal(original[0],80);
  const noise=new Uint8ClampedArray(5*5*4).fill(255);noise.set([0,0,0,255],12*4);assert.equal(cleanOcrPixels(noise,5,5,{denoise:true})[12*4],255);assert.throws(()=>cleanOcrPixels(new Uint8ClampedArray(3),1,1));
});
test('OCR corrections reject unsupported characters, duplicate word identities and text with unmapped content',()=>{
  assert.equal(correctionError('áéíóú ñ ü €'),'');assert.ok(correctionError('una\nlínea'));assert.ok(correctionError(String.fromCodePoint(0x1D11E)));assert.ok(correctionError('x'.repeat(501)));
  const p={text:data.text,...normalizeOcrWords(data.text,data.lines,1200,1600)};p.words[1].id=p.words[0].id;assert.throws(()=>reviewError(p),/posición/);const partial={text:data.text,words:[normalizeOcrWords(data.text,data.lines,1200,1600).words[0]]};assert.throws(()=>reviewError(partial),/Falta texto/);
});
test('OCR corrected layer retains embedded font, original image bytes and fields across rotations, CropBox and UserUnit',async()=>{
  for(const rotation of[0,90,180,270])for(const unit of[1,2]){const f=await fixture(rotation,unit),original=f.bytes.slice(),output=await applyOcr(f.bytes,f.report,[1]),doc=await PDFDocument.load(output.bytes),before=await PDFDocument.load(f.bytes),images=d=>d.context.enumerateIndirectObjects().filter(([,o])=>o instanceof PDFRawStream&&o.dict.get(N('Subtype'))===N('Image')).map(([,o])=>Buffer.from(o.contents).toString('hex'));
    assert.deepEqual(f.bytes,original);assert.deepEqual(images(doc),images(before));assert.equal(doc.getForm().getTextField('Dato').getText(),'Conservado');assert.ok(doc.catalog.has(N('Names')));const marker=JSON.parse(doc.getPage(0).node.get(N('PDFReaderCOOCR')).decodeText());assert.equal(marker.correctedWords,1);assert.equal(marker.characters,reviewedText(f.item).length);
    const forms=doc.context.enumerateIndirectObjects().filter(([,o])=>o instanceof PDFRawStream&&o.dict.get(N('Subtype'))===N('Form')),streams=forms.map(([,s])=>new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n');assert.ok(streams.includes('0032003000330031'));assert.ok(!streams.includes('0032003000320036'));assert.match(streams,/3 Tr/);
  }
});
test('OCR deskew uses the inverse image transform and blocks invalid geometry or corrections without changing the source',async()=>{
  const f=await fixture(90,2,3),output=await applyOcr(f.bytes,f.report,[1]),doc=await PDFDocument.load(output.bytes),last=doc.context.lookup(doc.getPage(0).node.Contents().asArray().at(-1)),body=new TextDecoder().decode(decodePDFRawStream(last).decode()),matrix=body.match(/([-\d.e+ ]+) cm/)[1].trim().split(/\s+/).map(Number);assert.ok(Math.abs(matrix[0])>0);assert.ok(Math.abs(matrix[1])>0);assert.equal(JSON.parse(doc.getPage(0).node.get(N('PDFReaderCOOCR')).decodeText()).deskewDegrees,3);
  const original=f.bytes.slice();f.item.geometry.processedWidth++;await assert.rejects(applyOcr(f.bytes,f.report,[1]),/geometría/);assert.deepEqual(f.bytes,original);
});
test('OCR refuses invalid replacements and removal of all searchable words, while untouched native layers still work',async()=>{
  const f=await fixture();f.item.words.find(w=>w.correction).correction=String.fromCodePoint(0x1D11E);await assert.rejects(applyOcr(f.bytes,f.report,[1]),/corrección/);for(const w of f.item.words)w.correction='';await assert.rejects(applyOcr(f.bytes,f.report,[1]),/conservar texto/);for(const w of f.item.words)delete w.correction;assert.equal((await applyOcr(f.bytes,f.report,[1])).pages,1);const wrong=await fixture(),layer=await PDFDocument.load(wrong.item.pdf),font=layer.context.lookup(layer.getPage(0).node.Resources().lookup(N('Font')).entries()[0][1]),desc=font.lookup(N('DescendantFonts')).lookup(0);desc.set(N('DW'),PDFNumber.of(600));wrong.item.pdf=await layer.save({updateFieldAppearances:false});await assert.rejects(applyOcr(wrong.bytes,wrong.report,[1]),/fuente invisible/);
});
