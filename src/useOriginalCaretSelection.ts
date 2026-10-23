import{useRef,type PointerEvent}from'react';import type{PageViewport}from'pdfjs-dist';
import type{OriginalRun,OriginalAnalysis,CaretGeometry,TextRange}from'./original-text-client';import{textCaretGeometry,nearestCaret}from'./text-caret.mjs';
export function useOriginalCaretSelection(analysis:OriginalAnalysis|null,viewport:PageViewport,container:HTMLElement,onPick:(run:OriginalRun,range:TextRange)=>void,onError:(message:string)=>void){
  const gesture=useRef<{run:OriginalRun;geometry:CaretGeometry;anchor:number;id:number}|null>(null);
  const nearest=(g:CaretGeometry,e:PointerEvent)=>{const r=container.getBoundingClientRect(),[x,y]=viewport.convertToPdfPoint(e.clientX-r.left,e.clientY-r.top);return nearestCaret(g,x,y);};
  const down=(e:PointerEvent<HTMLButtonElement>,run:OriginalRun)=>{if(e.button!==0||!run.editable)return;e.preventDefault();e.stopPropagation();const ids=run.indices||[run.index],geometry=textCaretGeometry(run.text,(analysis?.objects||[]).filter(o=>ids.includes(o.index)),run);if(!geometry){onError('No se pudieron ubicar todos los caracteres de esta selección. Usa Líneas o Párrafos compatibles y el cuadro de texto.');return;}const s=nearest(geometry,e);if(!s)return;gesture.current={run,geometry,anchor:s.offset,id:e.pointerId};e.currentTarget.setPointerCapture(e.pointerId);};
  const up=(e:PointerEvent<HTMLButtonElement>)=>{const g=gesture.current;if(!g||g.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();gesture.current=null;const s=nearest(g.geometry,e);if(s)onPick(g.run,{start:Math.min(g.anchor,s.offset),end:Math.max(g.anchor,s.offset),direction:s.offset<g.anchor?'backward':'forward',row:s.row});};
  const cancel=()=>gesture.current=null;
  return{down,up,cancel};
}
