import{tr}from'./i18n';
import { useEffect, useRef, useState } from 'react';
import type { PDFProxy } from './types';
export function Thumbnail({pdf,number,active,onClick,marks=0}:{pdf:PDFProxy;number:number;active:boolean;onClick:()=>void;marks?:number}){
  const root=useRef<HTMLButtonElement>(null),canvas=useRef<HTMLCanvasElement>(null),[visible,setVisible]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState(false);
  useEffect(()=>{const observer=new IntersectionObserver(([e])=>setVisible(e.isIntersecting),{root:root.current?.closest('.side-content,.organizer-grid'),rootMargin:'150px'});if(root.current)observer.observe(root.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(!visible)return;let stopped=false,task:any;setReady(false);setError(false);pdf.getPage(number).then(async p=>{if(stopped)return;const base=p.getViewport({scale:1}),viewport=p.getViewport({scale:132/base.width}),c=canvas.current!;c.width=viewport.width;c.height=viewport.height;task=p.render({canvas:c,viewport});await task.promise;if(!stopped)setReady(true);}).catch(()=>{if(!stopped)setError(true);});return()=>{stopped=true;task?.cancel();};},[pdf,number,visible]);
  return <button ref={root} className={`thumbnail ${active?'current':''}`} data-rendered={ready} title={tr("Ir a la página {0}",[number])} onClick={onClick}><span className="thumbnail-sheet"><canvas ref={canvas}/>{error&&<span className="thumbnail-error">{tr("No se pudo mostrar la página")}</span>}{marks>0&&<span className="thumbnail-marks">{marks}</span>}</span><span>{number}</span></button>;
}
