import{tr}from'./i18n';
import type{SearchState}from'./SearchHighlights';
import {searchMatches}from'./search-text.mjs';
import { useRef, useState, type PointerEvent as PointerEvent, type KeyboardEvent } from 'react';
import type { Mark, Tool } from './types';
import { translateMark, translateMarks, rotatePoint, rotatedBounds, resizeMark, unionBounds } from './annotation-geometry.mjs';
import { annotationBox, textLayout } from './text-layout.mjs';
import { annotationPaintOrder } from './native-annotations.mjs';
import { noteColors } from './note-style.mjs';

type Point=[number,number];
type Bounds={x:number;y:number;w:number;h:number};
type Corner='nw'|'ne'|'sw'|'se';
type Gesture=
  | {kind:'create';pointerId:number;origin:Point;mark:Mark}
  | {kind:'move';pointerId:number;origin:Point;originals:Mark[];bounds:Bounds;moved:boolean}
  | {kind:'resize'|'rotate';pointerId:number;origin:Point;originals:Mark[];box:Bounds;corner:Corner;angle:number};
type Props={
  pageNumber:number;width:number;height:number;scale:number;tool:Tool;color:string;size:number;
  marks:Mark[];selected:string[];image:string;readOnly:boolean;
  search?:SearchState;
  onSelect:(id:string,additive?:boolean)=>void;onCreate:(mark:Mark)=>void;onText:(mark:Mark)=>void;
  onChange:(mark:Mark)=>void;onChanges:(marks:Mark[])=>void;onEdit:(mark:Mark)=>void;onDelete:(id:string)=>void;
};

export function AnnotationLayer(props:Props){
  const {pageNumber,width,height,scale,tool,color,size,marks,selected,image,readOnly,onSelect,onCreate,onText,onChange,onChanges,onEdit,onDelete}=props;
  const root=useRef<SVGSVGElement>(null),gesture=useRef<Gesture|null>(null),preview=useRef<Mark[]>([]);
  const [draft,setDraft]=useState<Mark|null>(null),[moving,setMoving]=useState<Mark[]>([]);
  const pageWidth=width/scale,pageHeight=height/scale;
  const boxOf=(mark:Mark)=>annotationBox(mark,pageWidth,pageHeight);
  const boundsOf=(mark:Mark)=>rotatedBounds(boxOf(mark),mark.rotation||0,width,height);
  const point=(event:PointerEvent):Point=>{const r=root.current!.getBoundingClientRect();return [(event.clientX-r.left)/r.width,(event.clientY-r.top)/r.height];};
  const clear=()=>{gesture.current=null;preview.current=[];setDraft(null);setMoving([]);};
  const create=(event:PointerEvent<SVGSVGElement>)=>{
    if(readOnly||event.button!==0||gesture.current)return;
    if(tool==='select'){onSelect('');return;}
    const [x,y]=point(event);event.preventDefault();
    const mark:Mark={id:crypto.randomUUID(),page:pageNumber,tool,x,y,w:0,h:0,color,size:tool==='text'?Math.max(10,size):size,...(tool==='pen'?{points:[[x,y]]}:{})};
    if(tool==='text'||tool==='note'){onText({...mark,w:tool==='note'?.035:.3,h:tool==='note'?.025:.07});return;}
    if(tool==='signature'||tool==='image'){if(!image)return;mark.image=image;}
    event.currentTarget.setPointerCapture(event.pointerId);gesture.current={kind:'create',pointerId:event.pointerId,origin:[x,y],mark};preview.current=[mark];setDraft(mark);
  };
  const startMove=(event:PointerEvent<SVGGElement>,mark:Mark)=>{
    if(readOnly||tool!=='select'||event.button!==0||gesture.current)return;
    event.preventDefault();event.stopPropagation();event.currentTarget.focus();
    if(event.shiftKey||event.ctrlKey||event.metaKey){onSelect(mark.id,true);return;}
    const originals=selected.includes(mark.id)?marks.filter(m=>selected.includes(m.id)):[mark];
    event.currentTarget.setPointerCapture(event.pointerId);gesture.current={kind:'move',pointerId:event.pointerId,origin:point(event),originals,bounds:unionBounds(originals.map(boundsOf)),moved:false};
    if(!selected.includes(mark.id))onSelect(mark.id);
  };
  const startTransform=(event:PointerEvent<SVGElement>,mark:Mark,kind:'resize'|'rotate',corner:Corner)=>{
    if(readOnly||event.button!==0||gesture.current)return;event.preventDefault();event.stopPropagation();
    const box=boxOf(mark),p=point(event);event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current={kind,pointerId:event.pointerId,origin:p,originals:[mark],box,corner,angle:Math.atan2((p[1]-box.y-box.h/2)*height,(p[0]-box.x-box.w/2)*width)*180/Math.PI};
  };
  const move=(event:PointerEvent)=>{
    const current=gesture.current;if(!current||event.pointerId!==current.pointerId)return;
    const raw=point(event);
    if(current.kind==='create'){
      const x=Math.max(0,Math.min(1,raw[0])),y=Math.max(0,Math.min(1,raw[1])),[sx,sy]=current.origin,points=current.mark.points,last=points?.[points.length-1];
      const mark=points?{...current.mark,x:Math.min(current.mark.x,x),y:Math.min(current.mark.y,y),w:Math.max(current.mark.x+current.mark.w,x)-Math.min(current.mark.x,x),h:Math.max(current.mark.y+current.mark.h,y)-Math.min(current.mark.y,y),points:last?.[0]===x&&last?.[1]===y?points:[...points,[x,y]]}:{...current.mark,x:Math.min(x,sx),y:Math.min(y,sy),w:Math.abs(x-sx),h:Math.abs(y-sy)};current.mark=mark;preview.current=[mark];setDraft(mark);return;
    }
    let next:Mark[];
    if(current.kind==='move'){
      const dx=raw[0]-current.origin[0],dy=raw[1]-current.origin[1];if(!current.moved&&Math.hypot(dx*width,dy*height)<3)return;current.moved=true;
      next=translateMarks(current.originals,dx,dy,current.bounds);
    }else{
      const mark=current.originals[0],b=current.box,cx=b.x+b.w/2,cy=b.y+b.h/2;
      if(current.kind==='rotate'){
        let angle=(mark.rotation||0)+Math.atan2((raw[1]-cy)*height,(raw[0]-cx)*width)*180/Math.PI-current.angle;
        angle=event.shiftKey?Math.round(angle/15)*15:Math.round(angle);
        const result={...mark,rotation:((angle%360)+360)%360};next=[translateMark(result,0,0,boundsOf(result))];
      }else{
        const [px,py]=rotatePoint(raw[0],raw[1],cx,cy,-(mark.rotation||0),width,height),[ox,oy]=rotatePoint(current.origin[0],current.origin[1],cx,cy,-(mark.rotation||0),width,height);
        const west=current.corner.includes('w'),north=current.corner.includes('n');
        let w=Math.max(8/width,b.w+(px-ox)*(west?-1:1)),h=Math.max(8/height,b.h+(py-oy)*(north?-1:1));
        if(event.shiftKey||mark.tool==='text'){const sx=w/b.w,sy=h/b.h,f=Math.abs(sx-1)>Math.abs(sy-1)?sx:sy;w=b.w*f;h=b.h*f;}
        w=Math.min(w,1);h=Math.min(h,1);
        const result=resizeMark(mark,b,{x:west?b.x+b.w-w:b.x,y:north?b.y+b.h-h:b.y,w,h},width,height);
        next=[translateMark(result,0,0,boundsOf(result))];
      }
    }
    preview.current=next;setMoving(next);
  };
  const finish=(event:PointerEvent)=>{
    const current=gesture.current;if(!current||event.pointerId!==current.pointerId)return;move(event);const next=preview.current;clear();
    if(current.kind==='create'){const mark=next[0];if(mark&&(mark.tool==='pen'?(mark.points?.length||0)>1:mark.w>.003&&mark.h>.002))onCreate(mark);}
    else if(next.length&&JSON.stringify(next)!==JSON.stringify(current.originals))onChanges(next);
  };
  const key=(event:KeyboardEvent,mark:Mark)=>{
    if(readOnly)return;if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(gesture.current)clear();else onSelect('');return;}if(gesture.current)return;
    if(event.key==='Enter'&&(mark.tool==='text'||mark.tool==='note')){event.preventDefault();onEdit(mark);return;}
    if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();event.stopPropagation();onDelete(mark.id);return;}
    const arrows:Record<string,Point>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(arrows[event.key]){event.preventDefault();event.stopPropagation();const group=selected.includes(mark.id)?marks.filter(m=>selected.includes(m.id)):[mark];const [dx,dy]=arrows[event.key],step=event.shiftKey?10:1;onChanges(translateMarks(group,dx*step/width,dy*step/height,unionBounds(group.map(boundsOf))));}
  };
  return <svg ref={root} className={`drawing-layer ${moving.length?'is-dragging':''}`} width={width} height={height} style={{pointerEvents:tool==='select'?'none':'auto'}} onPointerDown={create} onPointerMove={move} onPointerUp={finish} onPointerCancel={clear} onLostPointerCapture={clear} onKeyDown={event=>{if(event.key==='Escape'&&gesture.current){event.preventDefault();clear();}}}>
    {annotationPaintOrder(marks).map((mark:Mark)=><Annotation key={mark.id} mark={moving.find(m=>m.id===mark.id)||mark} width={width} height={height} scale={scale} selected={selected.includes(mark.id)} handles={selected.length===1&&mark.tool!=='note'} interactive={tool==='select'&&!readOnly} search={props.search} onPointerDown={startMove} onTransform={startTransform} onKeyDown={key} onDoubleClick={()=>{if(!readOnly&&(mark.tool==='text'||mark.tool==='note'))onEdit(mark);}}/>)}
    {draft&&<Annotation mark={draft} width={width} height={height} scale={scale} selected={false} handles={false} interactive={false}/>}
  </svg>;
}

function Annotation({mark:m,width,height,scale,selected,handles,interactive,search,onPointerDown,onTransform,onKeyDown,onDoubleClick}:{
  mark:Mark;width:number;height:number;scale:number;selected:boolean;handles:boolean;interactive:boolean;
  search?:SearchState;
  onPointerDown?:(e:PointerEvent<SVGGElement>,mark:Mark)=>void;onTransform?:(e:PointerEvent<SVGElement>,mark:Mark,kind:'resize'|'rotate',corner:Corner)=>void;
  onKeyDown?:(e:KeyboardEvent,mark:Mark)=>void;onDoubleClick?:()=>void;
}){
  const b=annotationBox(m,width/scale,height/scale),x=m.x*width,y=m.y*height,w=m.w*width,h=m.h*height,bx=b.x*width,by=b.y*height,bw=b.w*width,bh=b.h*height,sw=m.size*scale;
  const layout=m.tool==='text'?textLayout(m,width/scale,height/scale):null;
  const label=m.tool==='text'?`Texto: ${m.text}`:m.tool==='note'?`Comentario: ${m.text}`:'Anotación';
  const note=m.tool==='note'?noteColors(m.color):null;
  const hit=search?.enabled!==false&&!!search?.query.trim()&&(m.tool==='text'||m.tool==='note')&&searchMatches(m.text||'',search.query,search.caseSensitive,search.wholeWord).length>0;
  return <g className={`mark ${selected?'mark-selected':''}`} data-mark-id={m.id} data-mark-tool={m.tool} data-x={m.x} data-y={m.y} data-rotation={m.rotation||0} role={interactive?'button':undefined} aria-label={interactive?label:undefined} aria-pressed={interactive?selected:undefined} tabIndex={interactive?0:undefined}
    transform={`rotate(${m.rotation||0} ${bx+bw/2} ${by+bh/2})`} style={{pointerEvents:interactive?'all':'none'}} onPointerDown={e=>onPointerDown?.(e,m)} onKeyDown={e=>onKeyDown?.(e,m)} onClick={e=>{if(interactive)e.stopPropagation();}} onDoubleClick={e=>{if(interactive){e.preventDefault();e.stopPropagation();onDoubleClick?.();}}}>
    {hit&&<rect className={'mark-search-highlight '+(search?.active?.markId===m.id?'active':'')} x={bx-2} y={by-2} width={bw+4} height={bh+4} fill="#f3ce36" fillOpacity=".25" pointerEvents="none"/>}
    <g className="mark-content" pointerEvents="none" opacity={m.opacity??1}>
      {m.tool==='pen'||m.tool==='signature'&&!m.image?<polyline points={m.points?.map(p=>`${p[0]*width},${p[1]*height}`).join(' ')} fill="none" stroke={m.color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"/>:
      m.image?<image href={m.image} x={x} y={y} width={w} height={h} preserveAspectRatio="none"/>:
      layout?<g>{m.stamp&&<rect x={bx} y={by} width={bw} height={bh} fill="none" stroke={m.color} strokeWidth={1.5*scale}/>}<text fill={m.color} fontSize={m.size*scale} fontFamily={m.fontFamily==='serif'?'Times New Roman':m.fontFamily==='mono'?'Courier New':'Arial'} fontWeight={m.bold?'bold':'normal'} fontStyle={m.italic?'italic':'normal'}>{layout.lines.map((line:{text:string;x:number;y:number;width:number},i:number)=><tspan key={i} x={x+line.x*scale} y={y+line.y*scale} textLength={Math.max(.01,line.width*scale)} lengthAdjust="spacingAndGlyphs">{line.text}</tspan>)}</text></g>:
      note?<g><rect x={x} y={y} width={w} height={h} rx={3*scale} fill={note.fill} stroke={note.border} strokeWidth={scale}/><text x={x+w*.35} y={y+h*.75} fontSize={Math.min(w,h)*.7} fontFamily="Arial" fill={note.ink}>{tr("i")}</text><title>{m.text}</title></g>:
      m.tool==='ellipse'?<ellipse cx={x+w/2} cy={y+h/2} rx={w/2} ry={h/2} fill={m.fill||'none'} fillOpacity={m.fillOpacity??.3} stroke={m.color} strokeWidth={sw}/>:
      m.tool==='underline'||m.tool==='strike'?<line x1={x} x2={x+w} y1={y+h*(m.tool==='underline'?1:.5)} y2={y+h*(m.tool==='underline'?1:.5)} stroke={m.color} strokeWidth={sw}/>:
      <rect x={x} y={y} width={w} height={h} fill={m.tool==='highlight'?m.color:m.fill||'none'} fillOpacity={m.tool==='highlight'?.32:m.fillOpacity??.3} stroke={m.tool==='highlight'?'none':m.color} strokeWidth={sw}/>}
    </g>
    {interactive&&<rect className="mark-hitbox" x={bx-4} y={by-4} width={bw+8} height={bh+8} fill="transparent"/>}
    {selected&&<g className="mark-controls"><rect className="mark-selection" x={bx-4} y={by-4} width={bw+8} height={bh+8} fill="none" stroke="#0d9488" strokeDasharray="4 3" strokeWidth="1.5" pointerEvents="none"/>
      {interactive&&handles&&<><line x1={bx+bw/2} x2={bx+bw/2} y1={by-4} y2={by-26} stroke="#0d9488" pointerEvents="none"/><circle className="rotate-handle" aria-label={tr("Girar anotación")} cx={bx+bw/2} cy={by-29} r="6" fill="white" stroke="#0d9488" onPointerDown={e=>onTransform?.(e,m,'rotate','se')}/>{(['nw','ne','sw','se'] as Corner[]).map(c=><rect key={c} className={`resize-handle ${c}`} data-corner={c} aria-label={tr("Cambiar tamaño {0}",[c])} x={(c.includes('w')?bx-4:bx+bw+4)-4} y={(c.includes('n')?by-4:by+bh+4)-4} width="8" height="8" fill="white" stroke="#0d9488" onPointerDown={e=>onTransform?.(e,m,'resize',c)}/>)}</>}
    </g>}
  </g>;
}
