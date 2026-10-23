import{validateFormatUndo}from'./text-format.mjs';
import {validateMark}from'./mark-schema.mjs';
export const recoverySource=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export function readDrafts(value){
  if(value==null)return null;
  const data=JSON.stringify(value);if(data.length>1024*1024)throw new Error('Los borradores superan 1 MB.');
  const raw=JSON.parse(data),id=v=>typeof v==='string'&&v.length>0&&v.length<=100;
  let nodes=0;const visit=(v,depth=0)=>{if(++nodes>50000||depth>20)throw new Error('Borrador demasiado complejo.');if(typeof v==='string'&&v.length>100000)throw new Error('Texto de borrador demasiado largo.');if(v&&typeof v==='object')for(const[key,item]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(key))throw new Error('Propiedad de borrador inválida.');visit(item,depth+1);}};visit(raw);
  if(raw.version!==1||!/^[a-f0-9]{64}$/.test(raw.source)||!Array.isArray(raw.properties)||raw.properties.length>20)throw new Error('Formato de borradores no compatible.');
  for(const p of raw.properties)if(!['form','annotation'].includes(p.kind)||typeof p.key!=='string'||p.key.length>2200||typeof p.base!=='string'||!p.value||typeof p.value!=='object'||p.kind==='form'&&(!id(p.id)||typeof p.value.options!=='string'||!p.value.draft)||p.kind==='annotation'&&(!Array.isArray(p.ids)||!p.ids.length||p.ids.length>200||p.ids.some(v=>!id(v))))throw new Error('Propiedades recuperables inválidas.');
  if(new Set(raw.properties.map(p=>p.key)).size!==raw.properties.length)throw new Error('Borrador de propiedades repetido.');
  const fieldValue=v=>typeof v==='string'||typeof v==='boolean'||Array.isArray(v)&&v.every(s=>typeof s==='string');
  for(const p of raw.properties){
    if(p.kind==='form'){const f=p.value.draft;if(f.id!==p.id||!['text','checkbox','dropdown','radio','list'].includes(f.kind)||typeof f.name!=='string'||!Number.isInteger(f.page)||f.page<1||!['x','y','w','h'].every(k=>Number.isFinite(f[k]))||!Array.isArray(f.options)||f.options.some(v=>typeof v!=='string')||!fieldValue(f.defaultValue)||typeof f.required!=='boolean'||typeof f.multiline!=='boolean'||!Number.isFinite(f.fontSize))throw new Error('Borrador de campo incompatible.');}
    else{const allowed=['color','size','opacity','rotation','fontFamily','bold','italic','align','fill','fillOpacity'];if(Object.keys(p.value).some(k=>!allowed.includes(k))||['size','opacity','rotation','fillOpacity'].some(k=>p.value[k]!==undefined&&!Number.isFinite(p.value[k]))||['color','fill'].some(k=>p.value[k]!==undefined&&!/^#[a-f0-9]{6}$/i.test(p.value[k]))||p.value.fontFamily!==undefined&&!['sans','serif','mono'].includes(p.value.fontFamily)||p.value.align!==undefined&&!['left','center','right'].includes(p.value.align)||['bold','italic'].some(k=>p.value[k]!==undefined&&typeof p.value[k]!=='boolean'))throw new Error('Borrador de apariencia incompatible.');}
  }
  if(raw.original){const{draft,edit}=raw.original;if(!draft||!edit||!Number.isInteger(draft.page)||draft.page<1||typeof draft.text!=='string'||typeof edit.text!=='string'||edit.text.length>12000||!/^[a-f0-9]{64}$/.test(edit.source)||!['inline','dialog'].includes(raw.original.surface))throw new Error('Borrador de texto incompatible.');validateFormatUndo(edit.formatUndo);}
  if(raw.mark&&(!raw.mark.draft||!id(raw.mark.draft.id)||!['text','note'].includes(raw.mark.draft.tool)||typeof raw.mark.text!=='string'||raw.mark.text.length>100000))throw new Error('Borrador de anotación inválido.');
  if(raw.mark)validateMark(raw.mark.draft);
  return raw;
}
export function annotationDraftBase(marks){return JSON.stringify(marks.map(({image,points,...m})=>m));}
