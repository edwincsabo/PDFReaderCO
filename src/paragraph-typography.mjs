export const typographyKeys=['indentLeft','indentRight','firstLineIndent','spaceBefore','spaceAfter'];
export const typographyValues=(value={},base={})=>Object.fromEntries(typographyKeys.map(k=>[k,value[k]===undefined?(base[k]??0):value[k]]));
export function validateTypography(value,width){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('El formato de sangrías y espacios no es válido.');
  const p=typographyValues(value);
  if(typographyKeys.some(k=>!Number.isFinite(p[k])||Math.abs(p[k])>10000)||p.indentLeft<0||p.indentRight<0||p.spaceBefore<0||p.spaceAfter<0)throw new Error('Las sangrías y espacios deben ser valores finitos; solo la sangría de primera línea puede ser negativa.');
  if(!Number.isFinite(width)||width-p.indentLeft-p.indentRight<1||p.indentLeft+p.firstLineIndent<0||width-p.indentLeft-p.indentRight-p.firstLineIndent<1)throw new Error('Las sangrías no dejan ancho suficiente o la primera línea quedaría fuera del área. Amplía el ancho o reduce las sangrías.');
  return p;
}
export const hasTypography=value=>typographyKeys.some(k=>(value[k]??0)!==0);
export const paragraphLayout=edit=>({paragraphWidth:edit.paragraphWidth,paragraphHeight:edit.paragraphHeight,paragraphOffsetX:edit.paragraphOffsetX,paragraphOffsetY:edit.paragraphOffsetY,paragraphAutoGrow:edit.paragraphAutoGrow,lineSpacing:edit.lineSpacing,align:edit.align,...Object.fromEntries(typographyKeys.map(k=>[k,edit[k]]))});
const gaps=text=>[...text.matchAll(/[ \u2000-\u200a\u205f\u3000]+/gu)].filter(m=>m.index>0&&m.index+m[0].length<text.length).map(m=>m.index+m[0].length);
export function placeParagraphLine(line,align,measure){
  const text=line.parts.map(s=>s.text).join(''),ends=align==='justify'&&!line.paragraphEnd?gaps(text):[],extra=ends.length?Math.max(0,line.availableWidth-line.width)/ends.length:0;
  let x=line.left+(align==='center'?(line.availableWidth-line.width)/2:align==='right'?line.availableWidth-line.width:0),at=0;const out=[];
  for(const span of line.parts){const stop=at+span.text.length,boundaries=[...ends.filter(e=>e>at&&e<stop),stop];let local=0;
    for(const end of boundaries){const part={...span,text:span.text.slice(local,end-at)};if(part.text.trim())out.push({span:part,x,y:line.y});x+=measure(part).advance;if(ends.includes(end))x+=extra;local=end-at;}
    at=stop;
  }
  return out;
}
