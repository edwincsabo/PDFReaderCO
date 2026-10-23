import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts, degrees, PDFName } from 'pdf-lib';
import { exportPdf, manipulate, encodeProject, decodeProject } from '../src/pdf-engine.mjs';
import { translateMarks, unionBounds, rotatedBounds, resizeMark, rotatePoint } from '../src/annotation-geometry.mjs';
import { annotationBox, fontName } from '../src/text-layout.mjs';
import { pageMap, remapBookmarks } from '../src/page-map.mjs';
import { selectionRects } from '../src/selection-rects.mjs';

test('styled and rotated text, image and shape survive export and project roundtrip',async()=>{
  const doc=await PDFDocument.create();for(const angle of [0,90,180,270])doc.addPage([600,800]).setRotation(degrees(angle));const source=await doc.save();
  const marks=Array.from({length:4},(_,i)=>({id:'text-'+i,page:i+1,tool:'text',x:.1,y:.2,w:.4,h:.1,size:20,text:'Texto áéíóú',fontFamily:'serif',bold:true,italic:true,rotation:30,align:'right',opacity:.45,color:'#258166',stamp:true}));
  marks.push({id:'shape',page:1,tool:'rect',x:.2,y:.5,w:.3,h:.1,size:2,color:'#008577',rotation:45,fill:'#ffdddd',fillOpacity:.25,opacity:.6});
  marks.push({id:'image',page:2,tool:'image',x:.1,y:.1,w:.2,h:.1,size:2,color:'#008577',rotation:270,opacity:.5,image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='});
  const model={marks,forms:{},bookmarks:[{id:'b',page:2,label:'Capítulo'}]},out=await exportPdf(source,model),reopened=await PDFDocument.load(out);
  assert.equal(reopened.getPageCount(),4);assert.equal(fontName(marks[0]),'Times-BoldItalic');
  const annotation=reopened.context.lookup(reopened.getPage(0).node.Annots().get(0)),appearance=annotation.lookup(PDFName.of('AP')).lookup(PDFName.of('N'));
  const fontDict=appearance.dict.lookup(PDFName.of('Resources')).lookup(PDFName.of('Font'));assert.ok(fontDict.entries().some(([,ref])=>reopened.context.lookup(ref).get(PDFName.of('BaseFont'))?.toString()==='/Times-BoldItalic'));
  assert.deepEqual(decodeProject(encodeProject(source,model)).model,model);
});
test('resizing rotated objects preserves the opposite corner; grouped movement preserves all point deltas',()=>{
  const m={id:'p',tool:'pen',x:.2,y:.3,w:.2,h:.1,rotation:30,points:[[.2,.3],[.4,.4]]};
  const resized=resizeMark(m,m,{x:.2,y:.3,w:.4,h:.2},600,800);assert.ok(resized.points[1][0]>resized.points[0][0]);assert.ok(Math.abs(resized.points[1][0]-resized.points[0][0]-.4)<1e-9);
  const before=rotatePoint(m.x,m.y,m.x+m.w/2,m.y+m.h/2,30,600,800),after=rotatePoint(resized.x,resized.y,resized.x+resized.w/2,resized.y+resized.h/2,30,600,800);assert.ok(Math.abs(before[0]-after[0])<1e-9&&Math.abs(before[1]-after[1])<1e-9);
  const marks=[m,{id:'r',x:.7,y:.7,w:.2,h:.1}],bounds=unionBounds(marks.map(m=>rotatedBounds(m,m.rotation||0,600,800))),moved=translateMarks(marks,.7,.7,bounds);
  assert.ok(moved[1].x+moved[1].w<=1.000001);assert.ok(Math.abs((moved[0].x-m.x)-(moved[1].x-marks[1].x))<1e-9);assert.ok(Math.abs((moved[0].points[1][1]-m.points[1][1])-(moved[0].y-m.y))<1e-9);
});
test('visual crop uses the rotated CropBox; duplicate pages and bookmark maps retain source order',async()=>{
  const doc=await PDFDocument.create(),p=doc.addPage([600,800]);p.setCropBox(20,30,500,700);p.setRotation(degrees(90));doc.addPage([600,800]);
  const cropped=await manipulate(await doc.save(),'crop-visual',{indices:[0],rect:{x:.1,y:.2,w:.6,h:.5}}),out=await PDFDocument.load(cropped);
  assert.deepEqual(out.getPage(0).getCropBox(),{x:120,y:100,width:250,height:420});
  assert.equal((await PDFDocument.load(await manipulate(cropped,'duplicate',{indices:[0]}))).getPageCount(),3);
  assert.deepEqual(pageMap(3,'duplicate',{indices:[0,2]}),[0,0,1,2,2]);assert.deepEqual(remapBookmarks([{id:'x',page:1,label:'Inicio'}],[2,0,1]),[{id:'x',page:2,label:'Inicio'}]);
  await assert.rejects(()=>manipulate(cropped,'crop-visual',{indices:[0],rect:{x:.9,y:0,w:.5,h:1}}));
});
test('selection rectangles clip to the page and merge overlapping fragments without merging separate lines',()=>{
  const page={left:10,top:20,right:610,bottom:820,width:600,height:800};const result=selectionRects([{left:30,top:50,right:80,bottom:70},{left:70,top:50,right:150,bottom:70},{left:30,top:80,right:110,bottom:100}],page);
  assert.equal(result.length,2);assert.equal(result[0].w,120/600);assert.equal(result[1].y,60/800);
});
