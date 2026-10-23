import{useRef,useState,type PointerEvent}from'react';
import type{PageViewport}from'pdfjs-dist';
import type{OriginalRun,TextRange}from'./original-text-client';
import{wordRange}from'./text-spans.mjs';
export function useOriginalWordSelection(viewport:PageViewport,container:HTMLElement,onPick:(run:OriginalRun,range:TextRange)=>void){
  const gesture=useRef<{run:OriginalRun;first:number;last:number;pointer:number;startX:number;startY:number;dragged:boolean}|null>(null),[range,setRange]=useState<{run:OriginalRun;range:TextRange}|null>(null);
  function nearest(run:OriginalRun,e:PointerEvent){const rect=container.getBoundingClientRect(),[x,y]=viewport.convertToPdfPoint(e.clientX-rect.left,e.clientY-rect.top);let distance=Infinity,start=0;for(const c of run.characters||[]){const b=c.bounds,dx=Math.max(b[0]-x,0,x-b[2]),dy=Math.max(b[1]-y,0,y-b[3]),d=dx*dx+dy*dy;if(d<distance){distance=d;start=c.start;}}return start;}
  const down=(e:PointerEvent<HTMLButtonElement>,run:OriginalRun)=>{if(e.button!==0||!run.editable)return;e.preventDefault();e.stopPropagation();const at=nearest(run,e);gesture.current={run,first:at,last:at,pointer:e.pointerId,startX:e.clientX,startY:e.clientY,dragged:false};e.currentTarget.setPointerCapture(e.pointerId);setRange({run,range:wordRange(run.text,at)});};
  const move=(e:PointerEvent<HTMLButtonElement>)=>{const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;e.preventDefault();g.last=nearest(g.run,e);g.dragged||=Math.hypot(e.clientX-g.startX,e.clientY-g.startY)>4;const a=wordRange(g.run.text,Math.min(g.first,g.last)),b=wordRange(g.run.text,Math.max(g.first,g.last));setRange({run:g.run,range:{start:a.start,end:b.end}});};
  const up=(e:PointerEvent<HTMLButtonElement>)=>{const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;e.preventDefault();e.stopPropagation();gesture.current=null;const a=wordRange(g.run.text,Math.min(g.first,g.last)),b=wordRange(g.run.text,Math.max(g.first,g.last));setRange(null);onPick(g.run,{start:a.start,end:b.end});};
  const cancel=()=>{gesture.current=null;setRange(null);};
  const boxes=range?(range.run.characters||[]).filter(c=>c.start<range.range.end&&c.end>range.range.start).map(c=>{const a=viewport.convertToViewportPoint(c.bounds[0],c.bounds[1]),b=viewport.convertToViewportPoint(c.bounds[2],c.bounds[3]);return{left:Math.min(a[0],b[0]),top:Math.min(a[1],b[1]),width:Math.max(2,Math.abs(a[0]-b[0])),height:Math.max(2,Math.abs(a[1]-b[1]))};}):[];
  return{down,move,up,cancel,boxes};
}
