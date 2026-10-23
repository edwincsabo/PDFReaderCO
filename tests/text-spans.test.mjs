import test from'node:test';import assert from'node:assert/strict';
import{replaceSpanText,styleSpanRange,validateSpans,wordRange,scaleSpanSizes,editContent}from'../src/text-spans.mjs';
const base={text:'Uno Tres Cinco',font:'original',fontSize:14,color:'#000000'};
test('word ranges and partial replacements keep unaffected formatting and support accents and surrogate pairs',()=>{
  assert.deepEqual(wordRange('acción rápida',2),{start:0,end:6});assert.deepEqual(wordRange('a😀b',2),{start:1,end:3});
  const edit=styleSpanRange(base,4,8,{font:'Helvetica-Bold',color:'#990000'});assert.deepEqual(edit.spans.map(s=>s.text),['Uno ','Tres',' Cinco']);
  const changed=replaceSpanText(edit,'Uno Cuatro Cinco');assert.equal(changed.spans.map(s=>s.text).join(''),changed.text);assert.equal(changed.spans.at(-1).font,'original');assert.equal(changed.spans.find(s=>s.text.includes('Cuatro')).font,'Helvetica-Bold');assert.ok(validateSpans(changed));assert.equal(scaleSpanSizes(changed,7).spans[1].fontSize,7);assert.deepEqual(editContent({...base,selection:{start:1,end:3}}),base);
});
test('span validation refuses mismatched text, bad sizes, references and excessive fragments',()=>{
  for(const spans of[[{...base,text:'bad'}],[{...base,fontSize:NaN}],[{...base,sourceIndex:-1}],Array.from({length:257},()=>({...base,text:''}))])assert.throws(()=>validateSpans({...base,spans}));
});
