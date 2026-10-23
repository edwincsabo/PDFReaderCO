import{graphemeRanges}from'./text-caret.mjs';
import{restoreLegacyParagraphSpans}from'./paragraph-text-data.mjs';
import{sliceSpans,compactSpans,styleSpanRange}from'./text-spans.mjs';
import{resolveFontVariant}from'./font-variants.mjs';
import{pasteTextFormat,validateCopiedFormat}from'./text-format.mjs';
export const compareReadingOrder=(a,b)=>{const x=a.readingOrder||[a.index],y=b.readingOrder||[b.index];for(let i=0;i<Math.max(x.length,y.length);i++){if(i>=x.length)return-1;if(i>=y.length)return 1;if(x[i]!==y[i])return x[i]-y[i];}return 0;};
/** @param {any} analysis @returns {import('./original-text-client').OriginalRun[]} */
export const rangeBlocks=analysis=>(analysis?.paragraphs||[]).filter(r=>r.visible!==false&&r.text.trim()&&!/[\u0000-\u0008\u000b-\u001f]/.test(r.text)).sort(compareReadingOrder);
export const blockPart=(r,start=0,end=r.text.length)=>({index:r.index,text:r.text,indices:r.indices||[r.index],originals:r.originals||[r.text],start,end});
/** @returns {{start:number,end:number,direction:'forward'|'backward'}|null} */
export function blockKeyboardSelection(text,range,key,shift=false,control=false){
  let at=range.direction==='backward'?range.start:range.end,anchor=range.direction==='backward'?range.end:range.start;
  if(control&&key.toLowerCase()==='a')return{start:0,end:text.length,direction:'forward'};
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(key))return null;
  if(!shift&&range.end>range.start&&(key==='ArrowLeft'||key==='ArrowRight'))at=key==='ArrowLeft'?range.start:range.end;
  else if(key==='Home')at=control||at===0?0:text.lastIndexOf('\n',at-1)+1;
  else if(key==='End'){const end=control?-1:text.indexOf('\n',at);at=end<0?text.length:end;}
  else if(control){const words=Array.from(text.matchAll(/[\p{L}\p{M}\p{N}_]+|[^\s]/gu));if(key==='ArrowLeft')at=words.filter(w=>w.index<at).at(-1)?.index??0;else{const next=words.find(w=>w.index+w[0].length>at);at=next?next.index+next[0].length:text.length;}}
  else{const edges=[0,...graphemeRanges(text).map(g=>g.end)];at=key==='ArrowLeft'?edges.filter(p=>p<at).at(-1)??0:edges.find(p=>p>at)??text.length;}
  if(!shift)anchor=at;return{start:Math.min(anchor,at),end:Math.max(anchor,at),direction:at<anchor?'backward':'forward'};
}
export function selectionBetween(blocks,a,b){
  let first=blocks.findIndex(r=>r.index===a.index),last=blocks.findIndex(r=>r.index===b.index),start=a.offset,end=b.offset;
  if(first<0||last<0)return[];if(first>last||first===last&&start>end){[first,last]=[last,first];[start,end]=[end,start];}
  return blocks.slice(first,last+1).map((r,i)=>blockPart(r,i===0?start:0,i===last-first?end:r.text.length)).filter(p=>p.end>p.start);
}
export function validateParts(analysis,parts){
  if(!Array.isArray(parts)||!parts.length||parts.length>50)throw new Error('Selecciona entre 1 y 50 bloques.');
  const ids=new Set(),members=new Set(),blocks=rangeBlocks(analysis),result=parts.map(p=>{
    const r=blocks.find(r=>r.index===p.index);if(!r||ids.has(p.index)||r.text!==p.text||JSON.stringify(r.indices||[r.index])!==JSON.stringify(p.indices)||JSON.stringify(r.originals||[r.text])!==JSON.stringify(p.originals))throw new Error('La selección cambió o contiene bloques repetidos. Selecciona de nuevo el texto.');ids.add(p.index);
    for(const id of p.indices){if(members.has(id))throw new Error('Los bloques seleccionados se superponen en sus objetos originales.');members.add(id);}
    const boundaries=new Set([0,...graphemeRanges(r.text).map(g=>g.end)]);if(!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start<0||p.end<=p.start||p.end>r.text.length||!boundaries.has(p.start)||!boundaries.has(p.end))throw new Error('El rango de caracteres no es válido o corta un carácter combinado.');
    return{run:r,part:p};
  });
  if(result.reduce((n,{part:p})=>n+p.end-p.start,0)>100000)throw new Error('La selección supera 100000 caracteres.');return result;
}
export function selectedBlockText(analysis,parts,separator='\n'){
  if(!['\n','\n\n',' '].includes(separator))throw new Error('El separador no es válido.');return validateParts(analysis,parts).map(({run:r,part:p})=>r.text.slice(p.start,p.end)).join(separator);
}
export function validateMultiOptions(options){
  if(!options||Object.keys(options).some(k=>!['font','size','color','bold','italic'].includes(k)))throw new Error('Las opciones de formato no son válidas.');
  if(options.font!==undefined&&(typeof options.font!=='string'||!options.font||options.font.length>100)||options.size!==undefined&&(!Number.isFinite(options.size)||options.size<1||options.size>400)||options.color!==undefined&&!/^#[0-9a-f]{6}$/i.test(options.color)||['bold','italic'].some(k=>options[k]!==undefined&&typeof options[k]!=='boolean'))throw new Error('Fuente, tamaño, color o variante no válidos.');
  if(!Object.keys(options).length)throw new Error('Elige al menos un atributo del formato.');
}
export function multiEdit(analysis,part,options,unit=1,catalog=[]){
  validateMultiOptions(options);const{run:r}=validateParts(analysis,[part])[0];if(!r.editable)throw new Error(r.reason||'Este bloque permite copiar, pero no modificar su formato.');if(/[\u0590-\u08ff\u202a-\u202e\u2066-\u2069]/u.test(r.text))throw new Error('El formato conjunto no admite texto de derecha a izquierda o bidireccional. Puedes copiarlo o revisarlo individualmente.');
  const members=new Map(analysis.objects.map(r=>[r.index,r])),spans=r.richSpans||restoreLegacyParagraphSpans(r.text,part.indices.map(id=>{const o=members.get(id);return{text:o.text,font:'original',sourceIndex:id,fontName:o.fontName,fontSize:o.fontSize,color:o.color};}));
  if(!spans)throw new Error('No se pudo conservar el formato lógico de este bloque.');
  let edit={source:analysis.source,page:analysis.page,index:r.index,indices:r.indices,originals:r.originals,original:r.text,text:r.text,font:'original',fontSize:r.fontSize,color:r.color,spans,paragraph:true,paragraphWidth:r.paragraphWidth,paragraphHeight:r.paragraphHeight,lineSpacing:r.lineSpacing,align:r.align,paragraphAutoGrow:false,paragraphSpace:false,inkFit:true,checkFit:true,allowOverflow:false,...Object.fromEntries(['indentLeft','indentRight','firstLineIndent','spaceBefore','spaceAfter'].map(k=>[k,r[k]||0]))};
  const patch={};if(options.font!==undefined&&options.font!=='original')Object.assign(patch,{font:options.font,sourceIndex:undefined});if(options.color!==undefined)patch.color=options.color;
  if(options.size!==undefined){patch.fontSize=options.size/(unit*Math.hypot(r.matrix[2],r.matrix[3]));if(!Number.isFinite(patch.fontSize)||patch.fontSize<1||patch.fontSize>400)throw new Error('El tamaño no es compatible con la escala de este bloque.');}
  if(Object.keys(patch).length)edit=styleSpanRange(edit,part.start,part.end,patch);
  const pieces=sliceSpans(edit.spans,part.start,part.end).map(s=>{
    let next=s;for(const kind of['bold','italic'])if(options[kind]!==undefined){const result=resolveFontVariant(next,r.fontName,catalog,kind,options[kind]);if(!result.font)throw new Error(result.reason);next={...next,font:result.font,sourceIndex:undefined};}return next;
  });
  edit.spans=compactSpans([...sliceSpans(edit.spans,0,part.start),...pieces,...sliceSpans(edit.spans,part.end,r.text.length)]);if(edit.spans.length>256)throw new Error('El bloque supera 256 fragmentos de estilo.');return edit;
}
export function validateMultiFormatRequest(request){
  if(request.paste===undefined){validateMultiOptions(request.options);return;}
  const paste=request.paste;if(!paste||typeof paste!=='object')throw new Error('El pegado de formato no es válido.');
  validateCopiedFormat(paste.format);const a=paste.attributes;
  if(!a||Object.keys(a).some(k=>!['font','size','color'].includes(k))||Object.entries(a).some(([,v])=>typeof v!=='boolean')||!Object.values(a).some(Boolean))throw new Error('Selecciona al menos un atributo del formato copiado.');
  if(request.options&&Object.keys(request.options).length)throw new Error('Retira el pegado antes de combinarlo con controles de formato manual.');
}
export function multiFormatEdit(analysis,part,request,unit=1){
  validateMultiFormatRequest(request);if(!request.paste)return multiEdit(analysis,part,request.options,unit,request.catalog);
  const edit=multiEdit(analysis,part,{font:'original'},unit,request.catalog),run=validateParts(analysis,[part])[0].run,paste=request.paste;
  // A staged edit changes the document hash. An exact source reference can be
  // rebased only inside its still-unmodified, verified destination membership.
  // References from other documents/pages or processed blocks are never borrowed.
  const ref=paste.format.originalRef,format=ref&&ref.source===request.source&&ref.page===analysis.page&&part.indices.includes(ref.index)?{...paste.format,originalRef:{...ref,source:analysis.source}}:paste.format;
  const result=pasteTextFormat({...run,unit},{...edit,selection:{start:part.start,end:part.end}},format,paste.attributes,true);
  if(result.spans.length>256)throw new Error('El bloque supera 256 fragmentos de estilo.');return result;
}
