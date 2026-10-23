import{tr}from'./i18n';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { PageViewport } from 'pdfjs-dist';
import type { OriginalEditorState } from './OriginalTextEditor';
import { previewOriginalMove, type OriginalMove, type OriginalMovePreview, type OriginalRun } from './original-text-client';
import { viewportBox, textBaseline, snapOriginalMove, pdfMoveDelta } from './original-move-geometry.mjs';

type Box={x:number;y:number;w:number;h:number};
type Guide={axis:string;value:number;neighbor:Box};
type Ghost={index:number;box:Box;dx:number;dy:number;guides:Guide[]};
type Gesture={kind:'pointer'|'keyboard';pointerId?:number;button:HTMLButtonElement;run:OriginalRun;source:string;origin:[number,number];box:Box;baseline:ReturnType<typeof textBaseline>;neighbors:any[];dx:number;dy:number;moved:boolean;bytes:Uint8Array;width:number;abort:AbortController};
export function useOriginalMove(editor:OriginalEditorState,number:number,viewport:PageViewport,container:HTMLElement){
  const gesture=useRef<Gesture|null>(null),epoch=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null),queued=useRef<OriginalMove|null>(null),flight=useRef(false),alive=useRef(true),suppress=useRef(0),canvas=useRef<HTMLCanvasElement>(null);
  const [ghost,setGhost]=useState<Ghost|null>(null),[raster,setRaster]=useState<OriginalMovePreview|null>(null),[error,setError]=useState('');
  const geometry=viewport.transform.join(','),neighbors=useMemo(()=>editor.analysis?.page===number?editor.analysis.objects.filter(run=>run.opacity>0).map(run=>({index:run.index,box:viewportBox(viewport,run.bounds),baseline:textBaseline(viewport,run.matrix)})):[],[editor.analysis,number,geometry]);
  const reset=()=>{const old=gesture.current;gesture.current=null;epoch.current++;queued.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;old?.abort.abort();setGhost(null);setRaster(null);setError('');if(old){editor.onGesture(false);if(old.pointerId!==undefined&&old.button.hasPointerCapture(old.pointerId))old.button.releasePointerCapture(old.pointerId);}};
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;const old=gesture.current;gesture.current=null;epoch.current++;old?.abort.abort();if(timer.current)clearTimeout(timer.current);queued.current=null;if(old)editor.onGesture(false);};},[]);
  useEffect(()=>{const leave=()=>{if(gesture.current)reset();},hide=()=>{if(document.hidden)leave();};window.addEventListener('blur',leave);document.addEventListener('visibilitychange',hide);return()=>{window.removeEventListener('blur',leave);document.removeEventListener('visibilitychange',hide);};},[]);
  useLayoutEffect(()=>{if(gesture.current)reset();},[geometry,editor.analysis?.source,editor.analysis?.page,editor.busy,editor.session]);
  useEffect(()=>{if(!editor.focus||editor.focus.page!==number||editor.focus.source!==editor.analysis?.source||editor.busy)return;const button=container.querySelector<HTMLButtonElement>(`[data-original-index="${editor.focus.index}"]`);if(button&&!button.disabled){button.focus({preventScroll:true});editor.onFocused();}},[editor.focus,editor.analysis,editor.busy,container,number]);
  useEffect(()=>{if(!raster||!canvas.current)return;const c=canvas.current;c.width=raster.image.width;c.height=raster.image.height;c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(raster.image.data),c.width,c.height),0,0);},[raster]);
  const schedule=()=>{if(timer.current||!gesture.current)return;timer.current=setTimeout(pump,65);};
  const pump=async()=>{
    timer.current=null;if(flight.current||!gesture.current||!queued.current)return;const g=gesture.current,move=queued.current,version=epoch.current;queued.current=null;flight.current=true;
    try{const result=await previewOriginalMove(g.bytes,move,g.width,{signal:g.abort.signal});if(alive.current&&epoch.current===version&&gesture.current)setRaster(result);}
    catch(error){if(alive.current&&epoch.current===version&&!(error instanceof DOMException&&error.name==='AbortError'))setError(error instanceof Error?error.message:String(error));}
    finally{flight.current=false;if(alive.current&&gesture.current&&queued.current)schedule();}
  };
  const request=(g:Gesture):OriginalMove=>({source:g.source,page:number,index:g.run.index,indices:g.run.indices,originals:g.run.originals,original:g.run.text,paragraph:g.run.paragraph,...pdfMoveDelta(viewport,g.dx,g.dy)});
  const point=(e:PointerEvent):[number,number]=>{const r=container.getBoundingClientRect();return [(e.clientX-r.left)*viewport.width/r.width,(e.clientY-r.top)*viewport.height/r.height];};
  const begin=(run:OriginalRun,button:HTMLButtonElement,kind:Gesture['kind'],origin:[number,number],pointerId?:number)=>{
    if(editor.busy||editor.session||!run.movable||!editor.analysis||gesture.current)return false;
    const box=viewportBox(viewport,run.bounds);if(box.w>viewport.width+.01||box.h>viewport.height+.01){editor.onMoveBlocked('Este texto es más grande que el área visible y no se puede mover dentro de ella.');return false;}
    const ids=new Set(run.indices||[run.index]);epoch.current++;setError('');gesture.current={kind,pointerId,button,run,source:editor.analysis.source,origin,box,baseline:textBaseline(viewport,run.matrix),neighbors:neighbors.filter(n=>!ids.has(n.index)),dx:0,dy:0,moved:false,bytes:editor.bytes,width:viewport.width,abort:new AbortController()};
    editor.onPick(run,number,'select');return true;
  };
  const update=(dx:number,dy:number,snap:boolean)=>{
    const g=gesture.current;if(!g)return;const result=snapOriginalMove(g.box,g.baseline,dx,dy,g.neighbors,viewport.width,viewport.height,snap);g.dx=result.dx;g.dy=result.dy;
    if(!g.moved){g.moved=true;editor.onGesture(true);}setGhost({index:g.run.index,box:g.box,dx:g.dx,dy:g.dy,guides:result.guides});queued.current=request(g);schedule();
  };
  const finish=()=>{const g=gesture.current;if(!g)return;const move=request(g),moved=g.moved;reset();if(moved){suppress.current=performance.now()+350;if(Math.abs(move.dx)+Math.abs(move.dy)>1e-7)void editor.onMove(move);}};
  const down=(e:PointerEvent<HTMLButtonElement>,run:OriginalRun)=>{if(e.button!==0||!begin(run,e.currentTarget,'pointer',point(e),e.pointerId))return;e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);};
  const move=(e:PointerEvent<HTMLButtonElement>)=>{const g=gesture.current;if(!g||g.kind!=='pointer'||g.pointerId!==e.pointerId)return;const p=point(e),dx=p[0]-g.origin[0],dy=p[1]-g.origin[1];if(!g.moved&&Math.hypot(dx,dy)<4)return;e.preventDefault();e.stopPropagation();update(dx,dy,!e.altKey);};
  const up=(e:PointerEvent<HTMLButtonElement>)=>{if(gesture.current?.kind!=='pointer'||gesture.current.pointerId!==e.pointerId)return;move(e);finish();};
  const keyDown=(e:KeyboardEvent<HTMLButtonElement>,run:OriginalRun)=>{
    if(e.nativeEvent.isComposing)return false;
    if(e.key==='Escape'&&gesture.current){e.preventDefault();e.stopPropagation();suppress.current=performance.now()+350;reset();return true;}
    const keys:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(!keys[e.key]||e.ctrlKey||e.metaKey||e.altKey)return !!gesture.current;
    e.preventDefault();e.stopPropagation();if(!run.movable){editor.onMoveBlocked(run.moveReason);return true;}
    if(!gesture.current&&!begin(run,e.currentTarget,'keyboard',[0,0]))return true;const g=gesture.current;if(g?.kind!=='keyboard')return true;
    const step=e.shiftKey?10:1;update(g.dx+keys[e.key][0]*step,g.dy+keys[e.key][1]*step,false);return true;
  };
  const keyUp=(e:KeyboardEvent<HTMLButtonElement>)=>{if(gesture.current?.kind==='keyboard'&&e.key.startsWith('Arrow')){e.preventDefault();e.stopPropagation();finish();}};
  const cancel=()=>{if(gesture.current)reset();};
  const style=(run:OriginalRun)=>{const b=ghost?.index===run.index?{x:ghost.box.x+ghost.dx,y:ghost.box.y+ghost.dy,w:ghost.box.w,h:ghost.box.h}:viewportBox(viewport,run.bounds);return {left:b.x-2,top:b.y-2,width:Math.max(8,b.w+4),height:Math.max(8,b.h+4)};};
  const overlay=<>{raster&&createPortal(<canvas className="original-live-preview original-move-preview" aria-label={tr("Vista previa del movimiento")} ref={canvas}/>,container)}{ghost&&<><svg className="original-move-guides" width={viewport.width} height={viewport.height} aria-label={tr("Guías de alineación del texto original")}>{ghost.guides.map((guide,i)=>guide.axis==='x'?<line key={i} data-guide="x" x1={guide.value} x2={guide.value} y1={Math.min(ghost.box.y+ghost.dy,guide.neighbor.y)-8} y2={Math.max(ghost.box.y+ghost.dy+ghost.box.h,guide.neighbor.y+guide.neighbor.h)+8}/>:<line key={i} data-guide="y" y1={guide.value} y2={guide.value} x1={Math.min(ghost.box.x+ghost.dx,guide.neighbor.x)-8} x2={Math.max(ghost.box.x+ghost.dx+ghost.box.w,guide.neighbor.x+guide.neighbor.w)+8}/>)}</svg><span className="original-move-hint" role={error?'alert':'status'} style={{left:Math.max(4,Math.min(viewport.width-310,ghost.box.x+ghost.dx)),top:Math.min(viewport.height-28,ghost.box.y+ghost.dy+ghost.box.h+10)}}>{error||tr("Vista previa · Suelta para aplicar · Escape cancela · Alt desactiva guías")}</span></>}</>;
  return {style,overlay,down,move,up,keyDown,keyUp,cancel,dragging:ghost?.index,suppressed:()=>!!gesture.current?.moved||performance.now()<suppress.current};
}
