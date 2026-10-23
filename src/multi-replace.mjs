import{multiEdit,validateParts}from'./multi-text.mjs';
import{replaceSpanRange,styleSpanRange}from'./text-spans.mjs';
import{graphemeRanges}from'./text-caret.mjs';

export function validateMultiReplacement(request){
  const r=request.replacement;
  if(!r||typeof r.text!=='string'||r.text.length>100000||/[\u0000-\u0009\u000b-\u001f\u0590-\u08ff\u202a-\u202e\u2066-\u2069]/u.test(r.text)||[...r.text].some(c=>c.length===1&&c.charCodeAt(0)>=0xd800&&c.charCodeAt(0)<=0xdfff))throw new Error('Usa hasta 100000 caracteres Unicode válidos, con saltos de línea y sin controles ni texto bidireccional.');
  if(typeof r.font!=='string'||!r.font||r.font.length>100||request.paste!==undefined||request.options&&Object.keys(request.options).length)throw new Error('El reemplazo debe revisarse separado del formato conjunto.');
  if(r.chunks!==undefined){
    if(!Array.isArray(r.chunks)||r.chunks.length!==request.parts?.length||r.chunks.some(t=>typeof t!=='string')||r.chunks.join('')!==r.text)throw new Error('La distribución no coincide con el texto completo del reemplazo.');
    const boundaries=new Set([0,...graphemeRanges(r.text).map(g=>g.end)]);let at=0;
    for(const t of r.chunks){at+=t.length;if(!boundaries.has(at))throw new Error('La distribución corta un carácter combinado entre bloques.');}
  }
}

export function multiReplacementEdit(analysis,part,text,font='original'){
  const base=multiEdit(analysis,part,{font:'original'}),edit=replaceSpanRange(base,part.start,part.end,text);
  if(edit.text.length&&!edit.text.trim())throw new Error('Un bloque con solo espacios o saltos no puede conservarse como texto editable. Reparte esos caracteres con texto visible en otro bloque.');
  if(edit.text.length>12000)throw new Error('El bloque resultante supera 12000 caracteres. Reparte el texto entre más bloques.');
  const result=text&&font!=='original'?styleSpanRange(edit,part.start,part.start+text.length,{font,sourceIndex:undefined}):edit;
  if(result.spans.length>256)throw new Error('El bloque supera 256 fragmentos de estilo.');
  return result;
}

/** Distribute in the user-reviewed order. Every character is retained; the last
 * block receives any excess so overflow is visible and can never be truncated. */
export async function distributeReplacement(info,request,measure){
  validateMultiReplacement(request);const parts=validateParts(info,request.parts),r=request.replacement;
  if(r.chunks)return [...r.chunks];
  const chunks=[];let offset=0;
  const wordEnds=[...r.text.matchAll(/\S+\s*|\s+/gu)].map(m=>m.index+m[0].length),graphemes=graphemeRanges(r.text).map(g=>g.end);
  for(let i=0;i<parts.length;i++){
    if(i===parts.length-1){chunks.push(r.text.slice(offset));break;}
    const{part,run}=parts[i],limit=12000-(run.text.length-part.end+part.start),memo=new Map();
    const fits=async end=>{if(!memo.has(end)){try{memo.set(end,(await measure(multiReplacementEdit(info,part,r.text.slice(offset,end),r.font))).fits);}catch{memo.set(end,false);}}return memo.get(end);};
    const candidates=ends=>[offset,...ends.filter(n=>n>offset&&n-offset<=limit)];
    const largest=async ends=>{let lo=0,hi=ends.length-1,best=offset;while(lo<=hi){const mid=Math.floor((lo+hi)/2);if(await fits(ends[mid])){best=ends[mid];lo=mid+1;}else hi=mid-1;}return best;};
    let end=await largest(candidates(wordEnds));
    if(end===offset)end=await largest(candidates(graphemes));
    chunks.push(r.text.slice(offset,end));offset=end;
  }
  return chunks;
}
