import{tr}from'./i18n';
import { useEffect, useRef, useState, useId } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PageView } from './PageView';
import { Button } from './ui';
import type { Model, PDFProxy } from './types';
const noop=()=>{};
export function SplitReader({pdf,model,page,onPage,linked,active}:{pdf:PDFProxy;model:Model;page:number;onPage:(n:number)=>void;linked:boolean;active:boolean}){
  const [right,setRight]=useState(Math.min(page+1,pdf.numPages));
  return <div className="split-reader"><ReadPane pdf={pdf} model={model} page={page} onPage={onPage} active={active}/>{linked&&page===pdf.numPages?<div className="split-end">{tr("Fin del documento")}</div>:<ReadPane pdf={pdf} model={model} page={linked?Math.min(page+1,pdf.numPages):right} onPage={linked?n=>onPage(Math.max(1,n-1)):setRight} active={active}/>}</div>;
}
function ReadPane({pdf,model,page,onPage,active}:{pdf:PDFProxy;model:Model;page:number;onPage:(n:number)=>void;active:boolean}){
  const fieldScope=useId();
  const root=useRef<HTMLDivElement>(null),[scale,setScale]=useState(.5);
  useEffect(()=>{let canceled=false;const update=async()=>{const p=await pdf.getPage(page),vp=p.getViewport({scale:1});if(!canceled&&root.current)setScale(Math.max(.1,(root.current.clientWidth-32)/vp.width));};const observer=new ResizeObserver(update);if(root.current)observer.observe(root.current);update();return()=>{canceled=true;observer.disconnect();};},[pdf,page]);
  return <div className="read-pane"><div className="pane-navigation"><Button icon={ChevronLeft} title={tr("Página anterior del panel")} onClick={()=>onPage(page-1)} disabled={page===1}/><label>{tr("Página ")}<input aria-label={tr("Página del panel")} type="number" min="1" max={pdf.numPages} value={page} onChange={e=>{const n=Number(e.target.value);if(n>=1&&n<=pdf.numPages)onPage(n);}}/> / {pdf.numPages}</label><Button icon={ChevronRight} title={tr("Página siguiente del panel")} onClick={()=>onPage(page+1)} disabled={page===pdf.numPages}/><span>{tr("Lectura")}</span></div><div className="document-scroll" ref={root}><PageView fieldScope={fieldScope} pdf={pdf} number={page} scale={scale} tool="select" color="#008577" size={2} marks={model.marks.filter(m=>m.page===page)} forms={model.forms} selected={[]} onSelect={noop} onMark={noop} onText={noop} onChange={noop} onChanges={noop} onEdit={noop} onDelete={noop} onField={noop} onPage={onPage} onVisible={noop} image="" active={active} readOnly/></div></div>;
}
