import{tr}from'./i18n';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpToLine, ArrowDownToLine, RotateCw, Files, Scissors, Trash2 } from 'lucide-react';

export type OrganizerAction='rotate'|'duplicate'|'extract'|'delete'|'first'|'last';
export type OrganizerMenuAnchor={x:number;y:number;trigger:HTMLElement};
type Props={anchor:OrganizerMenuAnchor;count:number;all:boolean;first:boolean;last:boolean;busy:boolean;onAction:(action:OrganizerAction)=>void;onClose:(restore?:boolean)=>void};

export function OrganizerContextMenu({anchor,count,all,first,last,busy,onAction,onClose}:Props){
  const root=useRef<HTMLDivElement>(null),[position,setPosition]=useState({x:anchor.x,y:anchor.y});
  const actions=[
    {id:'rotate',label:'Rotar 90°',icon:RotateCw,disabled:busy},
    {id:'duplicate',label:'Duplicar',icon:Files,disabled:busy},
    {id:'extract',label:'Extraer a PDF…',icon:Scissors,disabled:busy},
    {id:'first',label:'Mover al principio',icon:ArrowUpToLine,disabled:busy||first,divider:true},
    {id:'last',label:'Mover al final',icon:ArrowDownToLine,disabled:busy||last},
    {id:'delete',label:'Eliminar',icon:Trash2,disabled:busy||all,divider:true,danger:true}
  ] as const;
  useLayoutEffect(()=>{
    const menu=root.current!;const box=menu.getBoundingClientRect();
    setPosition({x:Math.max(8,Math.min(anchor.x,window.innerWidth-box.width-8)),y:Math.max(8,Math.min(anchor.y,window.innerHeight-box.height-8))});
    menu.querySelector<HTMLButtonElement>('[role=menuitem]:not(:disabled)')?.focus({preventScroll:true});
  },[anchor]);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))onClose(false);};
    const dismiss=()=>onClose(false);
    const scroll=(event:Event)=>{if(!root.current?.contains(event.target as Node))onClose(false);};
    document.addEventListener('pointerdown',outside,true);document.addEventListener('scroll',scroll,true);window.addEventListener('resize',dismiss);window.addEventListener('blur',dismiss);
    return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',dismiss);window.removeEventListener('blur',dismiss);};
  },[onClose]);
  const keyboard=(event:KeyboardEvent<HTMLDivElement>)=>{
    // Capture Escape before the containing dialog's native keyboard listener.
    if(event.key==='Escape'||event.key==='Tab'){event.preventDefault();event.stopPropagation();onClose();return;}
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();const items=Array.from(root.current!.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)')),current=items.indexOf(document.activeElement as HTMLButtonElement);
    const index=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[index]?.focus();
  };
  return <div ref={root} role="menu" aria-label={tr("Acciones de páginas")} className="organizer-context-menu" style={{left:position.x,top:position.y}} onKeyDownCapture={keyboard} onContextMenu={e=>e.preventDefault()}>
    <div className="organizer-menu-summary">{count===1?tr("1 página seleccionada"):tr("{0} páginas seleccionadas",[count])}</div>
    {actions.map(action=>{const Icon=action.icon;return <button type="button" role="menuitem" key={action.id} disabled={action.disabled} className={`${'divider' in action?'menu-divider':''} ${'danger' in action?'menu-danger':''}`} title={action.id==='delete'&&all?tr("El documento debe conservar al menos una página."):undefined} onClick={()=>onAction(action.id)}><Icon size={16}/><span>{tr(action.label)}</span></button>;})}
    <div className="organizer-menu-hint">{tr("El orden se confirma con Aplicar orden.")}</div>
  </div>;
}
