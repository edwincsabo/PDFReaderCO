import{tr}from'./i18n';
import { useEffect, useRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';
export function Button({icon:Icon,children,onClick,active,disabled,title,className='',...rest}:{icon?:LucideIcon;children?:ReactNode;onClick?:()=>void;active?:boolean;disabled?:boolean;title?:string;className?:string;'aria-label'?:string}) {
  return <button type="button" className={`btn ${active?'active':''} ${className}`} onClick={onClick} disabled={disabled} title={title} aria-label={rest['aria-label']||title||(typeof children==='string'?children:undefined)} aria-pressed={active===undefined?undefined:active}>{Icon&&<Icon size={17} strokeWidth={1.8}/>} {children}</button>;
}
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement;const root=ref.current!;const focusable=()=>Array.from(root.querySelectorAll<HTMLElement>('button,input,textarea,select,[tabindex="0"]')).filter(x=>!x.hasAttribute('disabled'));const initialFocus=focusable();(initialFocus[1]||initialFocus[0])?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();onClose();}if(e.key==='Tab'){const all=focusable(),first=all[0],last=all[all.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};root.addEventListener('keydown',key);return()=>{root.removeEventListener('keydown',key);previous?.focus();};},[]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} className={`modal ${wide?'wide':''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><Button icon={X} title={tr("Cerrar diálogo")} onClick={onClose}/></header>{children}</div></div>;
}
