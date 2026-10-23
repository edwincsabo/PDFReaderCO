import{tr}from'./i18n';
import {SearchHighlights,type SearchState}from'./SearchHighlights';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnnotationMode, TextLayer, type PDFPageProxy, type PDFDocumentProxy } from 'pdfjs-dist';
import type { Mark, Tool, FieldValue } from './types';
import { externalLink } from './bridge';
import { AnnotationLayer } from './AnnotationLayer';
import { selectionRects } from './selection-rects.mjs';
import { Highlighter, Underline, Strikethrough, MessageSquare } from 'lucide-react';
import { Button, Modal } from './ui';
import { noteColors } from './note-style.mjs';
import { FormDesignLayer, type DesignerState } from './FormDesigner';
import { OriginalTextLayer, type OriginalEditorState } from './OriginalTextEditor';
import {ChoiceInput}from'./ChoiceInput';
const radioDocuments=new WeakMap<PDFDocumentProxy,string>();let radioDocumentId=0;
function radioDocument(pdf:PDFDocumentProxy){if(!radioDocuments.has(pdf))radioDocuments.set(pdf,'pdfco-'+(++radioDocumentId));return radioDocuments.get(pdf)!;}

type Props={differences?:{rect:{x:number;y:number;w:number;h:number};active:boolean;type:string}[];formErrors?:Record<string,string>;fieldScope?:string;originalEditor?:OriginalEditorState;designer?:DesignerState;pdf:PDFDocumentProxy;number:number;scale:number;tool:Tool;color:string;size:number;marks:Mark[];forms:Record<string,FieldValue>;selected:string[];onSelect:(id:string,additive?:boolean)=>void;onMark:(mark:Mark)=>void;onText:(mark:Mark)=>void;onChange:(mark:Mark)=>void;onChanges:(marks:Mark[])=>void;onEdit:(mark:Mark)=>void;onDelete:(id:string)=>void;onSelectionMarks?:(marks:Mark[])=>void;onField:(name:string,value:FieldValue)=>void;onPage:(n:number)=>void;onVisible:(n:number)=>void;image:string;active:boolean;readOnly:boolean;search?:SearchState};
export function PageView(props:Props) {
  const {pdf,number,scale,tool,color,size,marks,forms,selected,onSelect,onMark,onText,onField,onPage,onVisible,image,active}=props;
  const root=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),text=useRef<HTMLDivElement>(null);
  const [visible,setVisible]=useState(false),[page,setPage]=useState<PDFPageProxy|null>(null),[annotations,setAnnotations]=useState<any[]>([]),[rendered,setRendered]=useState(false),[textReady,setTextReady]=useState(false),[error,setError]=useState('');
  const [selectedRects,setSelectedRects]=useState<{x:number;y:number;w:number;h:number}[]>([]);
  const [readOnlyNote,setReadOnlyNote]=useState<{text:string;author:string}|null>(null);
  useEffect(()=>{setReadOnlyNote(null);},[pdf,active]);
  const viewport=page?.getViewport({scale});const width=viewport?.width||595.28*scale,height=viewport?.height||841.89*scale;
  useEffect(()=>{let stop=false;pdf.getPage(number).then(p=>{if(!stop)setPage(p);}).catch(e=>setError(e.message));return()=>{stop=true;};},[pdf,number]);
  useEffect(()=>{const observer=new IntersectionObserver(entries=>{const entry=entries[0];setVisible(entry.isIntersecting);},{root:root.current?.closest('.document-scroll'),rootMargin:'700px 0px'});if(root.current)observer.observe(root.current);return()=>observer.disconnect();},[active]);
  useEffect(()=>{const observer=new IntersectionObserver(entries=>{if(entries[0].isIntersecting)onVisible(number);},{root:root.current?.closest('.document-scroll'),rootMargin:'-10% 0px -65% 0px'});if(root.current)observer.observe(root.current);return()=>observer.disconnect();},[number,onVisible,active]);
  useEffect(()=>{
    if(!page||!visible||!active)return;
    let cancelled=false;let layer:TextLayer|undefined;setRendered(false);setTextReady(false);setError('');
    const vp=page.getViewport({scale});
    const ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(10000000/(vp.width*vp.height)));
    const c=canvas.current!,ctx=c.getContext('2d')!;c.width=Math.floor(vp.width*ratio);c.height=Math.floor(vp.height*ratio);c.style.width=vp.width+'px';c.style.height=vp.height+'px';
    const task=page.render({canvas:c,canvasContext:ctx,viewport:vp,annotationMode:AnnotationMode.ENABLE_FORMS,transform:ratio!==1?[ratio,0,0,ratio,0,0]:undefined});
    task.promise.then(async()=>{if(cancelled)return;setRendered(true);text.current!.replaceChildren();layer=new TextLayer({textContentSource:page.streamTextContent(),container:text.current!,viewport:vp});await layer.render();if(cancelled)return;setTextReady(true);setAnnotations(await page.getAnnotations({intent:'display'}));}).catch(e=>{if(!cancelled&&e.name!=='RenderingCancelledException')setError(e.message);});
    return()=>{cancelled=true;task.cancel();layer?.cancel();};
  },[page,scale,visible,active]);
  useEffect(()=>{if((!visible||!active)&&canvas.current){canvas.current.width=0;canvas.current.height=0;text.current?.replaceChildren();setRendered(false);}},[visible,active]);
  useEffect(()=>{
    const update=()=>{const selection=window.getSelection();if(props.readOnly||tool!=='select'||!selection||selection.isCollapsed||!text.current?.contains(selection.anchorNode)||!text.current.contains(selection.focusNode)||!root.current){setSelectedRects([]);return;}const range=selection.getRangeAt(0);setSelectedRects(selectionRects(Array.from(range.getClientRects()),root.current.getBoundingClientRect()));};
    const hide=()=>setSelectedRects([]),scroller=root.current?.closest('.document-scroll');document.addEventListener('selectionchange',update);scroller?.addEventListener('scroll',hide);return()=>{document.removeEventListener('selectionchange',update);scroller?.removeEventListener('scroll',hide);};
  },[props.readOnly,tool,scale]);
  useEffect(()=>{if(!rendered||!props.search?.active?.markId||props.search.active.page!==number)return;const mark=Array.from(root.current?.querySelectorAll<HTMLElement>('[data-mark-id]')||[]).find(el=>el.dataset.markId===props.search?.active?.markId);mark?.scrollIntoView({block:'nearest',inline:'nearest'});},[rendered,props.search?.active,number]);
  const markSelection=(type:'highlight'|'underline'|'strike')=>{if(!props.onSelectionMarks)return;props.onSelectionMarks(selectedRects.map(r=>({...r,id:crypto.randomUUID(),page:number,tool:type,color:type==='highlight'?'#f3ce36':color,size:type==='highlight'?2:1.5})));window.getSelection()?.removeAllRanges();setSelectedRects([]);};
  return <div className={`pdf-page tool-${tool} ${rendered?'rendered':''}`} ref={root} data-page={number} data-layout-ready={!!page} style={{width,height,'--scale-factor':scale,'--user-unit':page?.userUnit||1,'--total-scale-factor':scale*(page?.userUnit||1),'--scale-round-x':'1px','--scale-round-y':'1px'} as React.CSSProperties}>
    <canvas ref={canvas} className="page-canvas"/><div ref={text} className="textLayer"/>
    {!rendered&&<div className="page-placeholder">{error||tr("Página {0}",[number])}</div>}
    {rendered&&viewport&&<div className="widget-layer" style={{pointerEvents:tool==='select'?'auto':'none'}}>{annotations.map(a=>{
      const r=[...viewport.convertToViewportPoint(a.rect[0],a.rect[1]),...viewport.convertToViewportPoint(a.rect[2],a.rect[3])],style:React.CSSProperties={left:Math.min(r[0],r[2]),top:Math.min(r[1],r[3]),width:Math.abs(r[2]-r[0]),height:Math.abs(r[3]-r[1]),fontSize:Math.max(9,Math.min(16*scale,Math.abs(r[3]-r[1])*.65))};
      if(a.subtype==='Link')return <button key={a.id} className="pdf-link" title={a.url||tr("Ir al destino del enlace")} style={style} onClick={async()=>{if(a.url)await externalLink(a.url);else if(a.dest){const dest=typeof a.dest==='string'?await pdf.getDestination(a.dest):a.dest;if(dest){const idx=typeof dest[0]==='number'?dest[0]:await pdf.getPageIndex(dest[0]);onPage(idx+1);}}}}/>;
      if(a.subtype==='Text'){
        const contents=String(a.contentsObj?.str||''),hex=a.color?.length===3?'#'+Array.from(a.color as Uint8Array).map(n=>n.toString(16).padStart(2,'0')).join(''):'#ffdf60',colors=noteColors(hex);
        return <button type="button" key={a.id} className="pdf-note" aria-label={tr("Leer comentario de solo lectura")} title={contents.slice(0,400)||tr("Comentario PDF")} tabIndex={tool==='select'?0:-1} style={{...style,...(!a.hasAppearance?{backgroundColor:colors.fill,color:colors.ink,borderColor:colors.border}:{})}} onClick={()=>setReadOnlyNote({text:contents,author:String(a.titleObj?.str||'')})}>{!a.hasAppearance&&<MessageSquare size={15}/>}</button>;
      }
      if(a.subtype!=='Widget')return null;
      const angle=((viewport.rotation-(a.rotation||0))%360+360)%360;
      const bw=Number(style.width),bh=Number(style.height);
      const fieldHeight=(angle%180?bw:bh);
      style.fontSize=Math.max(7,Math.min((a.defaultAppearanceData?.fontSize||12)*scale*(page?.userUnit||1),fieldHeight*.8));
      if(angle===90)Object.assign(style,{width:bh,height:bw,transformOrigin:'0 0',transform:`translateX(${bw}px) rotate(90deg)`});
      else if(angle===180)Object.assign(style,{transformOrigin:'0 0',transform:`translate(${bw}px,${bh}px) rotate(180deg)`});
      else if(angle===270)Object.assign(style,{width:bh,height:bw,transformOrigin:'0 0',transform:`translateY(${bh}px) rotate(270deg)`});
      const value=forms[a.fieldName]??a.fieldValue;
      const validationProps={'aria-invalid':props.formErrors?.[a.fieldName]?true:undefined,title:props.formErrors?.[a.fieldName]||undefined};
      if(a.fieldType==='Tx'&&a.multiLine)return <textarea key={a.id} className="pdf-field" aria-label={a.alternativeText||a.fieldName} {...validationProps} style={style} value={String(value||'')} readOnly={a.readOnly||props.readOnly||!!props.designer} maxLength={a.maxLen||undefined} required={a.required} onChange={e=>onField(a.fieldName,e.target.value)}/>;
      if(a.fieldType==='Tx')return <input key={a.id} className="pdf-field" aria-label={a.alternativeText||a.fieldName} {...validationProps} style={style} value={String(value||'')} readOnly={a.readOnly||props.readOnly||!!props.designer} maxLength={a.maxLen||undefined} required={a.required} onChange={e=>onField(a.fieldName,e.target.value)}/>;
      if(a.fieldType==='Btn'&&a.checkBox)return <input key={a.id} type="checkbox" aria-label={a.alternativeText||a.fieldName} className="pdf-field" {...validationProps} style={style} disabled={a.readOnly||props.readOnly||!!props.designer} checked={typeof value==='boolean'?value:value===a.exportValue} onChange={e=>onField(a.fieldName,e.target.checked)}/>;
      if(a.fieldType==='Btn'&&a.radioButton)return <input key={a.id} type="radio" name={`${props.fieldScope||radioDocument(pdf)}-${a.fieldName}`} aria-label={a.buttonValue||a.fieldName} className="pdf-field" {...validationProps} style={style} disabled={a.readOnly||props.readOnly||!!props.designer} checked={value===a.buttonValue} onChange={()=>onField(a.fieldName,a.buttonValue)}/>;
      if(a.fieldType==='Ch')return <ChoiceInput key={a.id} aria-label={a.alternativeText||a.fieldName} className={'pdf-field '+(!a.combo?'pdf-choice-list':'')} {...validationProps} style={style} disabled={a.readOnly||props.readOnly||!!props.designer} list={!a.combo} multiple={a.multiSelect} value={value??''} options={(a.options||[]).map((o:any)=>({value:o.exportValue,label:o.displayValue}))} onValue={v=>onField(a.fieldName,v)}/>;
      return null;
    })}</div>}
    {!!props.differences?.length&&<svg className="comparison-highlight-layer" viewBox="0 0 1 1" preserveAspectRatio="none" aria-label={tr("Marcas de diferencias de comparación")}>{props.differences!.map((d,i)=><rect key={i} data-comparison-difference={d.type} className={d.active?'active':''} x={d.rect.x} y={d.rect.y} width={d.rect.w} height={d.rect.h}/>)}</svg>}
    <AnnotationLayer pageNumber={number} width={width} height={height} scale={scale} tool={tool} color={color} size={size} marks={marks} selected={selected} image={image} readOnly={props.readOnly} onSelect={onSelect} onCreate={onMark} onText={onText} onChange={props.onChange} onChanges={props.onChanges} search={props.search} onEdit={props.onEdit} onDelete={props.onDelete}/>
    {selectedRects.length>0&&<div className="selection-actions" role="toolbar" aria-label={tr("Marcar texto seleccionado")} style={{left:Math.max(4,Math.min(width-160,selectedRects[0].x*width)),top:Math.max(3,selectedRects[0].y*height-38)}} onMouseDown={e=>e.preventDefault()}><Button icon={Highlighter} title={tr("Resaltar selección")} onClick={()=>markSelection('highlight')}/><Button icon={Underline} title={tr("Subrayar selección")} onClick={()=>markSelection('underline')}/><Button icon={Strikethrough} title={tr("Tachar selección")} onClick={()=>markSelection('strike')}/></div>}
    {page&&root.current&&text.current&&props.search&&<SearchHighlights page={page} number={number} root={root.current} text={text.current} ready={textReady} search={props.search} width={width} height={height}/>}
    {props.designer&&rendered&&<FormDesignLayer designer={props.designer} number={number} width={width} height={height} scale={scale}/>}{props.originalEditor&&rendered&&viewport&&root.current&&<OriginalTextLayer editor={props.originalEditor} number={number} viewport={viewport} container={root.current}/>}<span className="page-number-label">{number}</span>
    {readOnlyNote&&createPortal(<Modal title={tr("Comentario de solo lectura")} onClose={()=>setReadOnlyNote(null)}><p>{tr("Este comentario se conserva desde el PDF como solo lectura.")}</p>{readOnlyNote.author&&<p>{tr("Autor: ")}{readOnlyNote.author}</p>}<label className="dialog-field">{tr("Contenido")}<textarea aria-label={tr("Texto del comentario")} value={readOnlyNote.text} rows={7} readOnly/></label><div className="modal-actions"><Button onClick={()=>setReadOnlyNote(null)}>{tr("Cerrar")}</Button></div></Modal>,document.body)}
  </div>;
}






