import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonLocation,pairedLocation,pageAtOffset,offsetForLocation}from'../src/comparison-position.mjs';

test('comparison anchors follow the page and its fraction across different paper sizes, zooms and gaps',()=>{
  const a=[{page:1,top:20,height:800},{page:2,top:850,height:1200},{page:3,top:2080,height:600}];
  assert.deepEqual(pageAtOffset(a,0),{page:1,y:0});assert.deepEqual(pageAtOffset(a,830),{page:1,y:1});
  const anchor=pageAtOffset(a,1150);assert.deepEqual(anchor,{page:2,y:.25});
  const b={page:2,top:1240,height:1600},target=offsetForLocation(b,{...anchor,x:.4},20,9000,500);
  assert.deepEqual(target,{top:1620,left:200});assert.deepEqual(pageAtOffset([{page:1,top:20,height:1190},b],target.top+20),anchor);
  assert.deepEqual(offsetForLocation(b,{...anchor,y:1,x:1},20,1700,0),{top:1700,left:0});
});
test('comparison page pairing preserves cover offsets in either direction and clamps unequal documents explicitly',()=>{
  const value={page:4,y:.6,x:.3};assert.deepEqual(pairedLocation(value,10,2),{page:6,y:.6,x:.3,limited:false});
  assert.deepEqual(pairedLocation({page:6,y:.6,x:.3},10,2,-1),{...value,limited:false});
  assert.deepEqual(pairedLocation(value,3,2),{page:3,y:.6,x:.3,limited:true});
  assert.deepEqual(pairedLocation(value,8,5,-1),{page:1,y:.6,x:.3,limited:true});
});
test('comparison anchors reject nonfinite geometry and keep page, scroll and empty-document bounds valid',()=>{
  assert.deepEqual(comparisonLocation({page:Infinity,y:NaN,x:-5},0),{page:1,y:0,x:0});
  assert.deepEqual(comparisonLocation({page:20.8,y:3,x:Infinity},4),{page:4,y:1,x:0});
  assert.deepEqual(pageAtOffset([],100),{page:1,y:0});
  assert.deepEqual(offsetForLocation({top:10,height:100},{y:-2,x:4},20,100,80),{top:0,left:80});
});
