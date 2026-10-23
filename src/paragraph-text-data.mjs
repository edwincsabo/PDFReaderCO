import{compactSpans}from'./text-spans.mjs';
import{multiply,transformBounds}from'./original-groups.mjs';
const equal=(a,b,t=.025)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>Number.isFinite(v)&&Math.abs(v-b[i])<=t);
const color=v=>typeof v==='string'&&/^#[a-f0-9]{6}$/i.test(v);
export const paragraphBasic=({paragraphSourceText,paragraphPaint,paragraphTextData,paragraphTextDataInvalid,...properties})=>properties;
export function validateParagraphTextData(data,source){
  if(!data||data.v!==1||!Array.isArray(data.spans)||!data.spans.length||data.spans.length>256||!Array.isArray(data.paint)||!data.paint.length||data.paint.length>4096)return null;
  if(data.spans.some(s=>!s||typeof s.text!=='string'||s.text.length>12000||!Number.isInteger(s.slot)||s.slot<0||s.slot>=data.paint.length||!Number.isFinite(s.fontSize)||s.fontSize<1||s.fontSize>400||!color(s.color))||data.spans.map(s=>s.text).join('')!==source)return null;
  if(data.paint.some(s=>!s||typeof s.text!=='string'||s.text.length>12000||typeof s.fontName!=='string'||s.fontName.length>2000||!Number.isFinite(s.fontSize)||s.fontSize<1||s.fontSize>400||!color(s.color)||!Array.isArray(s.bounds)||s.bounds.length!==4||s.bounds.some(v=>!Number.isFinite(v))||!Array.isArray(s.matrix)||s.matrix.length!==6||s.matrix.some(v=>!Number.isFinite(v)||Math.abs(v)>20000)))return null;
  const painted=data.paint.map(s=>s.text).join('');if(painted.length>12000||painted.replace(/\s/gu,'')!==source.replace(/\s/gu,''))return null;
  return data;
}
export function restoreParagraphSpans(paragraph,items){
  const data=validateParagraphTextData(paragraph.paragraphTextData,paragraph.paragraphSourceText);if(!data||items.length!==data.paint.length||items.some(r=>!r))return null;
  const m=[...paragraph.matrix.slice(0,4),...paragraph.paragraphAnchor],det=m[0]*m[3]-m[1]*m[2];if(Math.abs(det)<1e-8)return null;
  const inv=[m[3]/det,-m[1]/det,-m[2]/det,m[0]/det,(m[2]*m[5]-m[3]*m[4])/det,(m[1]*m[4]-m[0]*m[5])/det];
  for(let i=0;i<items.length;i++){const a=items[i],b=data.paint[i];if(a.text.replace(/\s/gu,'')!==b.text.replace(/\s/gu,'')||!equal(a.bounds,transformBounds(m,b.bounds),.075)||a.fontName!==b.fontName||Math.abs(a.fontSize-b.fontSize)>.001||a.color.toLowerCase()!==b.color.toLowerCase()||!equal(multiply(inv,a.matrix),b.matrix))return null;}
  const ink=[];for(const item of items)for(const ch of item.text)if(!/\s/u.test(ch))ink.push({ch,item});let at=0;
  for(const span of data.spans)for(const ch of span.text)if(!/\s/u.test(ch)){const painted=ink[at++];if(!painted||painted.ch!==ch||painted.item.fontKey!==items[span.slot].fontKey||Math.abs(span.fontSize-painted.item.fontSize)>.001||span.color.toLowerCase()!==painted.item.color.toLowerCase())return null;}
  return compactSpans(data.spans.map(s=>({text:s.text,font:'original',sourceIndex:items[s.slot].index,fontName:items[s.slot].fontName,fontSize:s.fontSize,color:s.color})));
}
// Older mixed paragraphs already store their logical text but not style slots.
// Upgrade only when their painted lines and every non-whitespace character
// agree. Whitespace has no ink; it inherits the neighboring painted style.
export function restoreLegacyParagraphSpans(source,spans){
  if(typeof source!=='string'||source.length>12000)return null;
  const chars=[];for(const s of spans)for(const ch of s.text)if(!/\s/u.test(ch))chars.push({ch,style:s});
  if(Array.from(source).filter(ch=>!/\s/u.test(ch)).join('')!==chars.map(c=>c.ch).join(''))return null;
  let at=0,previous=chars[0]?.style;if(!previous)return null;const out=[];
  for(const ch of source){const s=/\s/u.test(ch)?previous:chars[at++]?.style;if(!s)return null;out.push({...s,text:ch});previous=s;}
  return compactSpans(out);
}
