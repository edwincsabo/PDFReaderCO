const same=(a,b)=>a.font===b.font&&a.fontSize===b.fontSize&&a.color===b.color&&a.sourceIndex===b.sourceIndex;
export function compactSpans(spans){const out=[];for(const span of spans){if(!span.text)continue;const last=out.at(-1);if(last&&same(last,span))last.text+=span.text;else out.push({...span});}return out;}
export const editSpans=edit=>edit.spans?.length?edit.spans:[{text:edit.text,font:edit.font,fontSize:edit.fontSize,color:edit.color}];
export function sliceSpans(spans,start,end){let at=0;const out=[];for(const s of spans){const a=Math.max(start,at),b=Math.min(end,at+s.text.length);if(b>a)out.push({...s,text:s.text.slice(a-at,b-at)});at+=s.text.length;}return out;}
export function replaceSpanText(edit,text){
  if(!edit.spans?.length)return{...edit,text};
  let a=0,b=0;while(a<edit.text.length&&a<text.length&&edit.text[a]===text[a])a++;while(b<edit.text.length-a&&b<text.length-a&&edit.text.at(-1-b)===text.at(-1-b))b++;
  // Never split a UTF-16 surrogate pair at the replacement boundaries.
  if(a&&/[\uDC00-\uDFFF]/.test(edit.text[a]||text[a]||''))a--;
  if(b&&/[\uDC00-\uDFFF]/.test(edit.text[edit.text.length-b]||text[text.length-b]||''))b--;
  const styleAt=edit.text.length-b>a?a:Math.max(0,a-1);const style=sliceSpans(edit.spans,styleAt,styleAt+1)[0]||edit.spans[0];
  return{...edit,text,spans:compactSpans([...sliceSpans(edit.spans,0,a),{...style,text:text.slice(a,text.length-b)},...sliceSpans(edit.spans,edit.text.length-b,edit.text.length)])};
}
export function styleSpanRange(edit,start,end,patch){
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>edit.text.length||end<=start)throw new Error('Selecciona una palabra o un fragmento del texto.');
  const spans=editSpans(edit);return{...edit,spans:compactSpans([...sliceSpans(spans,0,start),...sliceSpans(spans,start,end).map(s=>({...s,...patch,...(patch.font&&patch.font!=='original'?{sourceIndex:undefined}:{})})),...sliceSpans(spans,end,edit.text.length)])};
}
export function validateSpans(edit){
  if(edit.spans===undefined)return null;
  if(!Array.isArray(edit.spans)||edit.spans.length>256||edit.spans.some(s=>!s||typeof s.text!=='string'||typeof s.font!=='string'||!Number.isFinite(s.fontSize)||s.fontSize<1||s.fontSize>400||!/^#[a-f0-9]{6}$/i.test(s.color)||s.sourceIndex!==undefined&&(!Number.isInteger(s.sourceIndex)||s.sourceIndex<0))||edit.spans.map(s=>s.text).join('')!==edit.text)throw new Error('El formato por fragmentos no coincide con el texto o supera 256 fragmentos.');
  return compactSpans(edit.spans);
}
export function wordRange(text,index){
  const at=Math.max(0,Math.min(text.length-1,index));
  for(const m of text.matchAll(/[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*|[^\s]/gu))if(at>=m.index&&at<m.index+m[0].length)return{start:m.index,end:m.index+m[0].length};
  return{start:at,end:Math.min(text.length,at+1)};
}
export const scaleSpanSizes=(edit,size)=>({...edit,fontSize:size,...(edit.spans?{spans:edit.spans.map(s=>({...s,fontSize:s.fontSize*size/edit.fontSize}))}:{})});
export const editContent=value=>{const edit={...value};delete edit.selection;return edit;};

export function replaceSpanRange(edit,start,end,text){
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>edit.text.length)throw new Error('Rango de texto inválido.');
  const spans=editSpans(edit),styleAt=end>start?start:Math.max(0,start-1),style=sliceSpans(spans,styleAt,styleAt+1)[0]||spans[0]||{font:edit.font,fontSize:edit.fontSize,color:edit.color};
  return{...edit,text:edit.text.slice(0,start)+text+edit.text.slice(end),...(edit.spans?{spans:compactSpans([...sliceSpans(spans,0,start),{...style,text},...sliceSpans(spans,end,edit.text.length)])}:{})};
}
