import{groupOriginalParagraphs}from'./original-paragraphs.mjs';
import{groupOriginalLines}from'./original-text-lines.mjs';
import{restoreLegacyParagraphSpans}from'./paragraph-text-data.mjs';
import{multiply,transformBounds}from'./original-groups.mjs';
const union=items=>[Math.min(...items.map(r=>r.bounds[0])),Math.min(...items.map(r=>r.bounds[1])),Math.max(...items.map(r=>r.bounds[2])),Math.max(...items.map(r=>r.bounds[3]))];
const inverse=m=>{const d=m[0]*m[3]-m[1]*m[2];return[m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];};
const semantic=r=>{try{return JSON.stringify(JSON.parse(r.markKey).filter(([name])=>name!=='PDFCOParagraph'&&!name.startsWith('PDFCORich_')));}catch{throw new Error('Las etiquetas de este texto no permiten reorganizar sus bloques.');}};
// Structural edits only: keep every glyph, painting order, font and graphics
// state in place. Reflow happens later, through the regular paragraph editor.
export function planOriginalBlocks(items,request){
  if(!['join','split'].includes(request.action)||!Array.isArray(request.groups)||!request.groups.length||request.groups.length>200)throw new Error('Selecciona los bloques que quieres organizar.');
  const paragraphs=groupOriginalParagraphs(items),selected=request.groups.map(g=>{
    const p=paragraphs.find(p=>p.index===g.index);
    if(!p||p.text!==g.text||JSON.stringify(p.indices)!==JSON.stringify(g.indices)||JSON.stringify(p.originals)!==JSON.stringify(g.originals))throw new Error('La selección cambió. Selecciona de nuevo los bloques completos.');
    return p;
  }).sort((a,b)=>a.index-b.index);
  const ids=selected.flatMap(p=>p.indices),chosen=ids.map(id=>items.find(r=>r.index===id));
  if(new Set(ids).size!==ids.length||chosen.some(r=>!r?.editable)||ids.some((id,i)=>i&&id!==ids[i-1]+1))throw new Error('Selecciona bloques consecutivos, sin imágenes, figuras ni otros objetos intercalados.');
  if(ids.length>4096)throw new Error('La selección supera 4096 fragmentos.');
  const first=chosen[0],key=semantic(first);
  if(chosen.some(r=>r.clipKey!==first.clipKey||Math.abs(r.opacity-first.opacity)>.001||semantic(r)!==key||r.matrix.slice(0,4).some((v,i)=>Math.abs(v-first.matrix[i])>.0001)))throw new Error('Los bloques deben compartir orientación, transparencia, máscara y etiquetas de estructura.');
  const inv=inverse(first.matrix);let previous=null;
  for(const r of chosen){const m=multiply(inv,r.matrix);if(previous&&(m[5]>previous[5]+.5||Math.abs(m[5]-previous[5])<=.5&&m[4]<previous[4]-.5))throw new Error('El orden de pintado no coincide con la lectura. Estos bloques se conservan separados.');previous=m;}
  let groups;
  if(request.action==='join'){
    if(selected.length<2)throw new Error('Selecciona al menos dos bloques para unir.');
    if(!['line','space','none'].includes(request.separator))throw new Error('El separador no es válido.');
    groups=[{items:chosen,text:selected.map(p=>p.text).join({line:'\n',space:' ',none:''}[request.separator])}];
  }else{
    if(selected.length!==1)throw new Error('Selecciona un solo bloque para separarlo.');
    if(!['lines','fragments','after-line'].includes(request.split))throw new Error('El modo de separación no es válido.');
    const lines=groupOriginalLines(chosen),parts=request.split==='fragments'?chosen.map(r=>[r]):lines.map(l=>l.indices.map(id=>chosen.find(r=>r.index===id)));
    if(parts.length<2)throw new Error(request.split==='fragments'?'Este bloque solo contiene un fragmento original.':'Este bloque solo contiene una línea. Prueba separar por fragmentos.');
    if(request.split==='after-line'){
      if(!Number.isInteger(request.after)||request.after<1||request.after>=parts.length)throw new Error(`Elige una línea entre 1 y ${parts.length-1}.`);
      parts.splice(0,parts.length,parts.slice(0,request.after).flat(),parts.slice(request.after).flat());
    }
    // Map physical boundaries back to logical text, retaining whitespace and
    // explicit blank paragraphs rather than replacing them with painted wraps.
    const logical=selected[0].text,ink=[...logical.matchAll(/\S/gu)].map(m=>m.index);let at=0,start=0;
    groups=parts.map((part,i)=>{at+=Array.from(part.map(r=>r.text).join('')).filter(c=>! /\s/u.test(c)).length;const end=i===parts.length-1?logical.length:ink[at];if(end===undefined)throw new Error('El texto lógico no coincide con las líneas originales.');const g={items:part,text:logical.slice(start,end)};start=end;return g;});
  }
  const blocks=groups.map(({items:members,text})=>{
    if(!text.trim()||text.length>12000||text.split('\n').length>200)throw new Error('Cada bloque admite hasta 12000 caracteres y 200 saltos de línea.');
    const spans=restoreLegacyParagraphSpans(text,members.map(r=>({text:r.text,font:'original',sourceIndex:r.index,fontName:r.fontName,fontSize:r.fontSize,color:r.color})));
    if(!spans||spans.length>256)throw new Error('No se puede conservar el formato de esta selección dentro de 256 fragmentos de estilo.');
    const bounds=union(members),m=members[0].matrix,inv=inverse(m),local=transformBounds(inv,bounds),left=Math.min(0,local[0]),anchor=[m[4]+m[0]*left,m[5]+m[1]*left],frame=[...m.slice(0,4),...anchor],frameInv=inverse(frame),box=transformBounds(frameInv,bounds);
    const paint=members.map(r=>({text:r.text,fontName:r.fontName,fontSize:r.fontSize,color:r.color,matrix:multiply(frameInv,r.matrix),bounds:transformBounds(frameInv,r.bounds)}));
    const data={v:1,spans:spans.map(s=>({text:s.text,slot:members.findIndex(r=>r.index===s.sourceIndex),fontSize:s.fontSize,color:s.color})),paint};
    if(JSON.stringify(data).length*2+2>3*1024*1024)throw new Error('Los datos de edición del bloque superan 3 MB.');
    const properties={manualBlock:crypto.randomUUID(),paragraphWidth:Math.max(1,box[2]),paragraphHeight:Math.max(1,box[3]-box[1]),paragraphTop:box[3],paragraphAnchor:anchor,lineSpacing:1.2,align:'left',paragraphAutoGrow:true,paragraphSourceText:text,paragraphPaint:groupOriginalLines(members).map(l=>l.text).join('\n'),paragraphTextData:data};
    if(properties.paragraphWidth>10000||properties.paragraphHeight>10000)throw new Error('El área del bloque supera el tamaño admitido.');
    return{indices:members.map(r=>r.index),bounds,text,properties};
  });
  return{blocks,lines:groupOriginalLines(chosen).map(l=>l.text),fragments:chosen.length};
}
