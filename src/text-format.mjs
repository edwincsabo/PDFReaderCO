import{editSpans,sliceSpans,styleSpanRange}from'./text-spans.mjs';
const standard=['Helvetica','Helvetica-Bold','Helvetica-Oblique','Helvetica-BoldOblique','Times-Roman','Times-Bold','Times-Italic','Times-BoldItalic','Courier','Courier-Bold','Courier-Oblique','Courier-BoldOblique'];
const nameKey=name=>String(name||'').replace(/^[A-Z]{6}\+/,'').replace(/-Identity-[HV]$/i,'').normalize('NFKC').replace(/[^\p{L}\p{M}\p{N}]/gu,'').toLowerCase();
const factor=d=>d.unit*Math.hypot(d.matrix[2],d.matrix[3]);
export function validateCopiedFormat(copied){
  const name=v=>typeof v==='string'&&v.length>0&&v.length<=2000;
  if(!copied||copied.version!==1||!name(copied.fontName)||!name(copied.faceName)||!Number.isFinite(copied.pointSize)||copied.pointSize<=0||typeof copied.color!=='string'||!/^#[a-f0-9]{6}$/i.test(copied.color)||typeof copied.mixed!=='boolean'||copied.fontId!==null&&(typeof copied.fontId!=='string'||!standard.includes(copied.fontId)&&!/^local:[a-f0-9]{64}$/.test(copied.fontId)))throw new Error('El formato copiado no es válido. Copia de nuevo el formato de origen.');
  const ref=copied.originalRef;if(ref!==null&&(!ref||typeof ref.source!=='string'||!/^[a-f0-9]{64}$/.test(ref.source)||!Number.isSafeInteger(ref.page)||ref.page<1||!Number.isSafeInteger(ref.index)||ref.index<0))throw new Error('La referencia de la fuente copiada no es válida.');
}
export function formatRange(edit,partial=true){const r=edit.selection;return partial&&r&&Number.isInteger(r.start)&&Number.isInteger(r.end)&&r.start>=0&&r.end<=edit.text.length&&r.end>r.start?r:{start:0,end:edit.text.length};}
export function copyTextFormat(draft,edit,fonts=[],partial=true){
  const range=formatRange(edit,partial),pieces=sliceSpans(editSpans(edit),range.start,range.end),s=pieces[0];if(!s)throw new Error('Selecciona texto para copiar su formato.');
  const pointSize=s.fontSize*factor(draft);if(!Number.isFinite(pointSize)||pointSize<=0||!/^#[a-f0-9]{6}$/i.test(s.color))throw new Error('El tamaño o color del formato no es válido.');
  const original=s.font==='original',sourceName=original?(s.fontName||draft.fontName):s.font,canonical=standard.find(n=>nameKey(n)===nameKey(sourceName)),local=fonts.find(f=>f.id===s.font)||fonts.find(f=>[f.name,f.postscript].some(n=>n&&nameKey(sourceName)&&nameKey(n)===nameKey(sourceName)));
  const fontId=canonical||local?.id||null,fontName=canonical||local?.name||(original?sourceName:'Fuente local no disponible');
  const signature=p=>JSON.stringify([p.font==='original'?nameKey(p.fontName||draft.fontName):p.font,p.fontSize,p.color.toLowerCase()]);
  return {version:1,fontId,fontName,faceName:canonical||local?.postscript||sourceName,pointSize,color:s.color.toLowerCase(),mixed:pieces.some(p=>signature(p)!==signature(s)),originalRef:original?{source:edit.source,page:edit.page,index:s.sourceIndex??edit.index}:null};
}
/** @param {any} copied @param {any} edit @param {any} [draft] */
export function reusableFormatFont(copied,edit,draft=null){
  const ref=copied?.originalRef;if(ref&&ref.source===edit.source&&ref.page===edit.page&&(edit.indices||[edit.index]).includes(ref.index))return{font:'original',sourceIndex:ref.index,fontName:copied.fontName};
  const candidates=[...(edit.spans||[]).filter(s=>s.font==='original'),...(draft?[{font:'original',sourceIndex:edit.index,fontName:draft.fontName}]:[])];
  const native=candidates.find(s=>nameKey(copied?.faceName)&&nameKey(s.fontName)===nameKey(copied?.faceName)&&(edit.indices||[edit.index]).includes(s.sourceIndex??edit.index));if(native)return{font:'original',sourceIndex:native.sourceIndex??edit.index,fontName:native.fontName};
  if(copied?.fontId)return{font:copied.fontId,sourceIndex:undefined,fontName:copied.fontName};
  throw new Error('La fuente copiada no tiene una coincidencia exacta reutilizable en este destino. Desmarca Incluir fuente para pegar solo tamaño o color, o elige otra fuente compatible.');
}
export function pasteTextFormat(draft,edit,copied,options={font:true,size:true,color:true},partial=true){
  if(!copied||copied.version!==1)throw new Error('Primero copia el formato de un texto compatible.');
  if(!options.font&&!options.size&&!options.color)throw new Error('Selecciona al menos un atributo del formato.');
  const patch={};if(options.font)Object.assign(patch,reusableFormatFont(copied,edit,draft));
  if(options.size){const size=copied.pointSize/factor(draft);if(!Number.isFinite(size)||size<1||size>400)throw new Error('El tamaño copiado no es compatible con la escala de este texto. Desmarca Incluir tamaño para conservar el tamaño actual.');patch.fontSize=size;}
  if(options.color){if(!/^#[a-f0-9]{6}$/i.test(copied.color))throw new Error('El color copiado no es válido.');patch.color=copied.color;}
  const range=formatRange(edit,partial);if(range.end<=range.start)throw new Error('Selecciona texto de destino para pegar el formato.');
  return styleSpanRange(edit,range.start,range.end,patch);
}
export const formatKey=edit=>JSON.stringify([edit.source,edit.page,edit.index,edit.text,edit.font,edit.fontSize,edit.color,edit.spans?.map(s=>[s.text,s.font,s.fontSize,s.color,s.sourceIndex])]);
export function withFormatUndo(before,after){return{...after,formatUndo:{text:before.text,after:formatKey(after),font:before.font,fontSize:before.fontSize,color:before.color,spans:before.spans}};}
export const canUndoFormat=edit=>!!edit.formatUndo&&edit.formatUndo.text===edit.text&&edit.formatUndo.after===formatKey(edit);
export function undoTextFormat(edit){if(!canUndoFormat(edit))throw new Error('El borrador cambió después de pegar el formato. Puedes cancelar el borrador o deshacer tras aplicar.');const u=edit.formatUndo;return{...edit,font:u.font,fontSize:u.fontSize,color:u.color,spans:u.spans,formatUndo:undefined};}
export function validateFormatUndo(value){
  if(value===undefined)return;
  if(!value||typeof value.text!=='string'||value.text.length>12000||typeof value.after!=='string'||value.after.length>100000||typeof value.font!=='string'||value.font.length>100||!Number.isFinite(value.fontSize)||value.fontSize<1||value.fontSize>400||!/^#[a-f0-9]{6}$/i.test(value.color)||value.spans!==undefined&&(!Array.isArray(value.spans)||value.spans.length>256||value.spans.some(s=>!s||typeof s.text!=='string'||typeof s.font!=='string'||s.font.length>100||!Number.isFinite(s.fontSize)||s.fontSize<1||s.fontSize>400||!/^#[a-f0-9]{6}$/i.test(s.color)||s.sourceIndex!==undefined&&(!Number.isInteger(s.sourceIndex)||s.sourceIndex<0))||value.spans.map(s=>s.text).join('')!==value.text))throw new Error('El borrador para deshacer formato no es válido.');
}
