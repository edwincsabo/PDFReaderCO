import{tr}from'./i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, RotateCw, Trash2, Files, Scissors } from 'lucide-react';
import { Button, Modal } from './ui';
import { Thumbnail } from './PdfThumbnail';
import { OrganizerContextMenu, type OrganizerAction, type OrganizerMenuAnchor } from './OrganizerContextMenu';
import type { PDFProxy } from './types';

export function PageOrganizer({pdf,preview,current,busy,onClose,onApply}:{pdf:PDFProxy;preview?:PDFProxy|null;current:number;busy:boolean;onClose:()=>void;onApply:(order:number[],operation:string,indices:number[])=>void}){
  const [order,setOrder]=useState(()=>Array.from({length:pdf.numPages},(_,i)=>i)),[selected,setSelected]=useState<number[]>([current-1]),[hover,setHover]=useState<number|null>(null);
  const [menu,setMenu]=useState<OrganizerMenuAnchor|null>(null);
  const menuRef=useRef(menu);menuRef.current=menu;
  const closeMenu=useCallback((restore=true)=>{if(restore)menuRef.current?.trigger.focus({preventScroll:true});setMenu(null);},[]);
  useEffect(()=>{if(busy)closeMenu(false);},[busy,closeMenu]);
  const moveTo=(ids:number[],target:number)=>{
    if(busy||ids.includes(target))return;const moving=order.filter(n=>ids.includes(n)),rest=order.filter(n=>!ids.includes(n)),at=rest.indexOf(target);
    setOrder([...rest.slice(0,at),...moving,...rest.slice(at)]);
  };
  const nudge=(direction:number)=>{
    if(busy)return;const first=order.findIndex(n=>selected.includes(n)),last=Math.max(...order.map((n,i)=>selected.includes(n)?i:-1));
    if(direction<0&&first>0)moveTo(selected,order[first-1]);
    else if(direction>0&&last<order.length-1){const moving=order.filter(n=>selected.includes(n)),rest=order.filter(n=>!selected.includes(n)),at=rest.indexOf(order[last+1])+1;setOrder([...rest.slice(0,at),...moving,...rest.slice(at)]);}
  };
  const apply=(operation:string)=>{
    if(busy||operation!=='reorder'&&!selected.length||operation==='delete'&&selected.length===pdf.numPages)return;
    onApply(order,operation,order.map((n,i)=>selected.includes(n)?i:-1).filter(n=>n>=0));
  };
  const openMenu=(page:number,card:HTMLElement,x:number,y:number)=>{
    if(busy)return;if(!selected.includes(page))setSelected([page]);
    setMenu({x,y,trigger:card.querySelector<HTMLButtonElement>('.thumbnail')||card});
  };
  const contextAction=(action:OrganizerAction)=>{
    closeMenu();if(busy)return;
    if(action==='first'||action==='last'){
      const moving=order.filter(n=>selected.includes(n)),rest=order.filter(n=>!selected.includes(n));setOrder(action==='first'?[...moving,...rest]:[...rest,...moving]);
    }else apply(action);
  };
  const moving=order.filter(n=>selected.includes(n)),atStart=moving.every((n,i)=>n===order[i]),atEnd=moving.every((n,i)=>n===order[order.length-moving.length+i]);
  return <Modal title={tr("Organizar páginas")} onClose={()=>{if(!busy)onClose();}} wide>
    <p>{tr("Arrastra una miniatura para cambiar el orden. Marca varias páginas y haz clic derecho para ver sus acciones. También puedes usar Mayús + F10 sobre una miniatura.")}</p>
    <div className="organizer-actions">
      <Button onClick={()=>setSelected(selected.length===pdf.numPages?[]:[...order])} disabled={busy}>{selected.length===pdf.numPages?tr("Quitar selección"):tr("Seleccionar todas")}</Button><span>{selected.length}{tr(" seleccionadas")}</span>
      <Button icon={ArrowUp} title={tr("Mover páginas hacia el inicio")} onClick={()=>nudge(-1)} disabled={!selected.length||busy}/><Button icon={ArrowDown} title={tr("Mover páginas hacia el final")} onClick={()=>nudge(1)} disabled={!selected.length||busy}/>
      <Button icon={RotateCw} onClick={()=>apply('rotate')} disabled={!selected.length||busy}>{tr("Rotar")}</Button><Button icon={Files} onClick={()=>apply('duplicate')} disabled={!selected.length||busy}>{tr("Duplicar")}</Button><Button icon={Scissors} onClick={()=>apply('extract')} disabled={!selected.length||busy}>{tr("Extraer")}</Button><Button icon={Trash2} onClick={()=>apply('delete')} disabled={!selected.length||selected.length===pdf.numPages||busy}>{tr("Eliminar")}</Button>
    </div>
    <div className="organizer-grid" role="list" aria-label={tr("Orden de las páginas")}>
      {order.map((n,i)=><div key={n} role="listitem" data-source-page={n+1} className={`organizer-card ${selected.includes(n)?'selected':''} ${hover===n?'drop-target':''}`} draggable={!busy}
        onContextMenu={e=>{e.preventDefault();e.stopPropagation();openMenu(n,e.currentTarget,e.clientX,e.clientY);}}
        onKeyDown={e=>{if(e.key==='ContextMenu'||e.key==='F10'&&e.shiftKey){e.preventDefault();e.stopPropagation();const box=e.currentTarget.getBoundingClientRect();openMenu(n,e.currentTarget,box.left+24,box.top+32);}}}
        onDragStart={e=>{closeMenu(false);const ids=selected.includes(n)?selected:[n];setSelected(ids);e.dataTransfer.setData('application/x-pdfreader-pages',JSON.stringify(ids));e.dataTransfer.effectAllowed='move';}}
        onDragOver={e=>{if(!busy&&e.dataTransfer.types.includes('application/x-pdfreader-pages')){e.preventDefault();setHover(n);}}} onDragLeave={()=>setHover(null)}
        onDrop={e=>{e.preventDefault();setHover(null);try{const ids=JSON.parse(e.dataTransfer.getData('application/x-pdfreader-pages'));if(Array.isArray(ids)&&ids.every(p=>Number.isInteger(p)&&order.includes(p)))moveTo(ids,n);}catch{}}} onDragEnd={()=>setHover(null)}>
        <label><input type="checkbox" aria-label={tr("Seleccionar página {0}",[n+1])} disabled={busy} checked={selected.includes(n)} onChange={e=>setSelected(s=>e.target.checked?[...s,n]:s.filter(p=>p!==n))}/><span>{tr("Posición ")}{i+1}</span></label>
        {preview===null?<span className="thumbnail-pending">{tr("Preparando página ")}{n+1}…</span>:<Thumbnail pdf={preview||pdf} number={n+1} active={selected.includes(n)} onClick={()=>{if(!busy)setSelected([n]);}}/>}
      </div>)}
    </div>
    <p className="dialog-note">{tr("Los movimientos se confirman con Aplicar orden. Rotar, duplicar, extraer o eliminar aplican también el orden preparado. Puedes deshacer los cambios sobre este documento. El texto, las marcas, las figuras y la tinta nativa compatibles conservan su edición; las imágenes y firmas visuales se incorporan al contenido.")}</p>
    <div className="modal-actions"><Button onClick={onClose} disabled={busy}>{tr("Cancelar")}</Button><Button className="primary" onClick={()=>apply('reorder')} disabled={busy}>{tr("Aplicar orden")}</Button></div>
    {menu&&<OrganizerContextMenu anchor={menu} count={selected.length} all={selected.length===pdf.numPages} first={atStart} last={atEnd} busy={busy} onAction={contextAction} onClose={closeMenu}/>}
  </Modal>;
}
