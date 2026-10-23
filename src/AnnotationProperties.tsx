import{tr}from'./i18n';
import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';
import type { Mark } from './types';

export const propertiesOf=(mark:Mark|undefined):Partial<Mark>=>mark?{color:mark.color,size:mark.size,opacity:mark.opacity??1,rotation:mark.rotation??0,fontFamily:mark.fontFamily||'sans',bold:mark.bold||false,italic:mark.italic||false,align:mark.align||'left',fill:mark.fill,fillOpacity:mark.fillOpacity??.3}:{};

export function AnnotationProperties({marks,onPatch,initial,onDraft}:{marks:Mark[];onPatch:(patch:Partial<Mark>)=>void;initial?:Partial<Mark>;onDraft?:(patch:Partial<Mark>)=>void}){
  const mark=marks[marks.length-1];
  const [draft,setDraft]=useState<Partial<Mark>>(()=>initial||propertiesOf(mark));
  const reportDraft=useRef(onDraft);reportDraft.current=onDraft;useEffect(()=>{reportDraft.current?.(draft);},[draft]);
  if(!mark)return <p className="side-empty">{tr("Selecciona una anotación. Usa Shift + clic para seleccionar varias en la misma página.")}</p>;
  const text=marks.some(m=>m.tool==='text'),shape=marks.some(m=>m.tool==='rect'||m.tool==='ellipse');
  const set=(patch:Partial<Mark>)=>setDraft(d=>({...d,...patch}));
  return <form className="annotation-properties" onSubmit={e=>{e.preventDefault();onPatch(draft);}}><h3>{tr("Propiedades ")}{marks.length>1?tr("· {0} objetos",[marks.length]):''}</h3>
    <label>{tr("Color")}<input aria-label={tr("Color del objeto")} type="color" disabled={marks.every(m=>!!m.image)} value={draft.color||'#008577'} onChange={e=>set({color:e.target.value})}/></label>
    <label>{text?tr("Tamaño de texto / trazo"):tr("Grosor del trazo")}<input aria-label={tr("Tamaño del objeto")} type="number" min="1" max="200" step=".5" disabled={marks.every(m=>m.tool==='note'||!!m.image)} value={draft.size??2} onChange={e=>set({size:Math.min(200,Math.max(1,Number(e.target.value)||1))})}/></label>
    <label>{tr("Opacidad (%)")}<input aria-label={tr("Opacidad del objeto")} type="number" min="0" max="100" value={Math.round((draft.opacity??1)*100)} onChange={e=>set({opacity:Math.max(0,Math.min(100,Number(e.target.value)))/100})}/></label>
    <label>{tr("Giro (grados)")}<input aria-label={tr("Giro del objeto")} type="number" min="0" max="359" disabled={marks.every(m=>m.tool==='note')} value={draft.rotation??0} onChange={e=>set({rotation:((Number(e.target.value)%360)+360)%360})}/></label>
    {text&&<><label>{tr("Fuente")}<select aria-label={tr("Fuente del objeto")} value={draft.fontFamily||'sans'} onChange={e=>set({fontFamily:e.target.value as Mark['fontFamily']})}><option value="sans">{tr("Helvetica / Arial")}</option><option value="serif">{tr("Times")}</option><option value="mono">{tr("Courier")}</option></select></label>
      <div className="property-checkboxes"><label><input aria-label={tr("Negrita")} type="checkbox" checked={!!draft.bold} onChange={e=>set({bold:e.target.checked})}/>{tr(" Negrita")}</label><label><input aria-label={tr("Cursiva")} type="checkbox" checked={!!draft.italic} onChange={e=>set({italic:e.target.checked})}/>{tr(" Cursiva")}</label></div>
      <label>{tr("Alineación")}<select aria-label={tr("Alineación del texto")} value={draft.align||'left'} onChange={e=>set({align:e.target.value as Mark['align']})}><option value="left">{tr("Izquierda")}</option><option value="center">{tr("Centro")}</option><option value="right">{tr("Derecha")}</option></select></label></>}
    {shape&&<><label className="checkbox-label"><input type="checkbox" checked={!!draft.fill} onChange={e=>set({fill:e.target.checked?'#b4e7da':undefined})}/>{tr(" Rellenar figura")}</label>{draft.fill&&<><label>{tr("Color de relleno")}<input type="color" aria-label={tr("Color de relleno")} value={draft.fill} onChange={e=>set({fill:e.target.value})}/></label><label>{tr("Opacidad del relleno (%)")}<input type="number" aria-label={tr("Opacidad del relleno")} min="0" max="100" value={Math.round((draft.fillOpacity??.3)*100)} onChange={e=>set({fillOpacity:Math.max(0,Math.min(100,Number(e.target.value)))/100})}/></label></>}</>}
    <Button className="primary" onClick={()=>onPatch(draft)}>{tr("Aplicar propiedades")}</Button>
    <p className="side-empty">{marks.every(m=>m.tool==='note')?tr("Los comentarios conservan su tamaño de icono. Arrástralos para moverlos y haz doble clic para editar su texto."):tr("Arrastra una esquina para cambiar el tamaño. Shift conserva las proporciones; al girar, ajusta en pasos de 15°.")}</p>
  </form>;
}
