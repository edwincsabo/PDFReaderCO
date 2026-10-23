import{tr,translateMessage}from'./i18n';
import{OriginalDirectText}from'./OriginalDirectText';
import{textCaretGeometry}from'./text-caret.mjs';
import{TextBlockerOverlay,TextBlockerPreview}from'./TextBlocker';
import{EditableOriginalText,TextStyleControls}from'./TextStyleControls';
import{editContent}from'./text-spans.mjs';
import{ParagraphArea}from'./ParagraphArea';
import{TextGrowthControl}from'./TextGrowthControl';
import{textFitMessage}from'./original-text-space.mjs';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PageViewport } from 'pdfjs-dist';
import { previewOriginalText, type OriginalPreview, type OriginalSession } from './original-text-client';
import type { OriginalEditorState } from './OriginalTextEditor';
import { Button } from './ui';
import { AutoFitText } from './AutoFitText';
import { ParagraphControls } from './ParagraphControls';

function box(viewport:PageViewport,bounds:number[]){
  const points=[[bounds[0],bounds[1]],[bounds[0],bounds[3]],[bounds[2],bounds[1]],[bounds[2],bounds[3]]].map(([x,y])=>viewport.convertToViewportPoint(x,y));
  const left=Math.min(...points.map(p=>p[0])),top=Math.min(...points.map(p=>p[1]));
  return {left,top,width:Math.max(1,Math.max(...points.map(p=>p[0]))-left),height:Math.max(1,Math.max(...points.map(p=>p[1]))-top)};
}
export function OriginalInlineEditor({editor,session,viewport,container}:{editor:OriginalEditorState;session:OriginalSession;viewport:PageViewport;container:HTMLElement}){
  const {draft,edit}=session,input=useRef<HTMLInputElement|HTMLTextAreaElement|null>(null),panel=useRef<HTMLFormElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const [preview,setPreview]=useState<OriginalPreview|null>(null),[checking,setChecking]=useState(true),[error,setError]=useState(''),[position,setPosition]=useState({left:0,top:0});
  const [fitting,setFitting]=useState(false);
  const area=box(viewport,draft.bounds),placement=preview&&edit.text?box(viewport,[Math.min(preview.area[0],preview.bounds[0]),Math.min(preview.area[1],preview.bounds[1]),Math.max(preview.area[2],preview.bounds[2]),Math.max(preview.area[3],preview.bounds[3])]):area;
  useLayoutEffect(()=>{
    const update=()=>{const rect=container.getBoundingClientRect(),el=panel.current;if(!el)return;const scroller=container.closest('.document-scroll')?.getBoundingClientRect(),minX=Math.max(8,scroller?.left??8),minY=Math.max(8,scroller?.top??8),maxY=Math.min(window.innerHeight-24,scroller?.bottom??window.innerHeight-24),anchorTop=rect.top+placement.top,anchorBottom=anchorTop+placement.height;
      el.style.maxHeight=Math.max(160,maxY-minY-8)+'px';
      let top=anchorBottom+el.offsetHeight+12<maxY?anchorBottom+8:anchorTop-el.offsetHeight-8,left=rect.left+placement.left;
      if(top<minY||top+el.offsetHeight>maxY){const right=rect.left+placement.left+placement.width,maxX=Math.min(window.innerWidth-12,scroller?.right??window.innerWidth-12);if(right+el.offsetWidth+12<=maxX){left=right+8;top=anchorTop;}else if(rect.left+placement.left-el.offsetWidth-8>=minX){left=rect.left+placement.left-el.offsetWidth-8;top=anchorTop;}}
      setPosition({left:Math.max(minX,Math.min(left,window.innerWidth-el.offsetWidth-12)),top:Math.max(minY,Math.min(top,maxY-el.offsetHeight))});};
    update();const scroller=container.closest('.document-scroll');scroller?.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);const observer=new ResizeObserver(update);if(panel.current)observer.observe(panel.current);return()=>{scroller?.removeEventListener('scroll',update);window.removeEventListener('resize',update);observer.disconnect();};
  },[container,placement.left,placement.top,placement.height,placement.width]);
  useEffect(()=>{
    let canceled=false;setChecking(true);setError('');
    const timer=setTimeout(()=>{previewOriginalText(editor.bytes,{...edit,caretGeometry:!!draft.directEditing},viewport.width).then(result=>{if(!canceled)setPreview(result);}).catch(error=>{if(!canceled){setError(error instanceof Error?error.message:String(error));setPreview(null);}}).finally(()=>{if(!canceled)setChecking(false);});},260);
    return()=>{canceled=true;clearTimeout(timer);};
  },[editor.bytes,JSON.stringify(editContent(edit)),viewport.width]);
  useEffect(()=>{if(!preview||!canvas.current)return;const c=canvas.current;c.width=preview.image.width;c.height=preview.image.height;c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(preview.image.data),c.width,c.height),0,0);},[preview]);
  const blocked=editor.busy||fitting||checking||!!error||!preview||!preview.fits&&(draft.clipped||!edit.allowOverflow);
  const apply=()=>{if(!blocked)editor.onApply(edit);};
  const change=(text:string)=>editor.onChange({...edit,text});
  const cancel=()=>{if(editor.busy)return;editor.onCancel();requestAnimationFrame(()=>container.querySelector<HTMLButtonElement>(`[data-original-index="${draft.index}"]`)?.focus({preventScroll:true}));};
  const sourceGeometry=useMemo(()=>{const ids=draft.indices||[draft.index];return textCaretGeometry(draft.text,(editor.analysis?.objects||[]).filter(r=>ids.includes(r.index)),draft);},[draft,editor.analysis]);
  const geometry=preview?.geometry?.text===edit.text?preview.geometry:edit.text===draft.text?sourceGeometry:null;
  const resultBox=preview?box(viewport,preview.bounds):null;
  return <>
    {draft.paragraph&&!draft.directEditing&&<ParagraphArea draft={draft} edit={edit} fit={preview} viewport={viewport} disabled={editor.busy||fitting} onChange={editor.onChange}/>}
    {preview&&createPortal(<canvas ref={canvas} className="original-live-preview" aria-label={tr("Vista previa PDF del borrador")}/>,container)}
    {draft.directEditing&&<OriginalDirectText draft={draft} edit={edit} geometry={geometry} viewport={viewport} container={container} disabled={editor.busy||fitting} onChange={editor.onChange} onHistory={editor.onDraftHistory} onApply={apply} onCancel={cancel}/>}
    <TextBlockerOverlay fit={preview} viewport={viewport}/>
    <div className="original-live-area" style={preview?box(viewport,preview.area):area}/>{resultBox&&edit.text&&<div className={'original-live-bounds '+(!preview?.fits?'overflow':'')} style={resultBox}/>}
    {createPortal(<form className="original-inline-editor" ref={panel} role="region" aria-label={tr("Edición de texto en página")} style={position} onSubmit={e=>{e.preventDefault();apply();}} onKeyDown={e=>{
      if(e.nativeEvent.isComposing)return;
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();}
      else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();e.stopPropagation();apply();}
      else if((e.ctrlKey||e.metaKey)&&['s','p','f','o','n'].includes(e.key.toLowerCase())){e.preventDefault();e.stopPropagation();}
    }}>
      <div className="original-inline-heading"><strong>{tr("Texto en edición · Página ")}{draft.page}</strong><span>{tr("Borrador sin aplicar")}</span></div>
      {draft.directEditing&&<p id="original-direct-instructions" className="dialog-note">{tr("Escribe sobre la página. Clic coloca el cursor; arrastrar selecciona; doble clic selecciona una palabra. Ctrl+Enter aplica y Escape cancela. El cuadro de texto permite continuar si no se ubican los caracteres.")}</p>}
      <EditableOriginalText focusOnMount={!draft.directEditing} draft={draft} edit={edit} onChange={editor.onChange} disabled={editor.busy||fitting} label={tr("Texto en página")} inputRef={input}/>
      <div className="original-inline-status" aria-live="polite">{checking?tr("Actualizando vista previa…"):error?<span role="alert">{translateMessage(error)}</span>:preview&&!preview.fits?<span role="alert">{textFitMessage(preview)} Acórtalo, mueve la selección o ajusta el tamaño en Propiedades.{preview.blocker?` Naranja: límite u objeto que bloquea. ${preview.blocker.suggestion}`:draft.clipped?' La máscara puede ocultarlo.':''}</span>:<span>{preview?textFitMessage(preview):'El texto cabe en el área original.'}{!edit.text?' Se eliminará la selección.':''}</span>}{editor.error&&editor.error!==error&&<span role="alert">{translateMessage(editor.error)}</span>}</div>
      {draft.directEditing&&preview&&!checking&&!geometry&&<p role="status" className="dialog-note">{tr("No se pudo ubicar el cursor en este borrador. Continúa en el cuadro Texto en página; la edición y sus comprobaciones siguen disponibles.")}</p>}
      <TextBlockerPreview preview={preview}/>
      <TextStyleControls draft={draft} edit={edit} onChange={editor.onChange} disabled={editor.busy||fitting} compact/>
      <ParagraphControls calculatedHeight={preview?.paragraphHeight} draft={draft} edit={edit} disabled={editor.busy||fitting} onChange={editor.onChange}/>

      {!draft.clipped&&preview&&!preview.fits&&<label className="original-inline-overflow"><input type="checkbox" aria-label={tr("Permitir exceder el área en página")} checked={!!edit.allowOverflow} disabled={editor.busy||fitting} onChange={e=>editor.onChange({...edit,allowOverflow:e.target.checked})}/>{tr(" Permitir exceder el área original")}</label>}
      <TextGrowthControl draft={draft} edit={edit} disabled={editor.busy||fitting} onChange={editor.onChange}/>
      <AutoFitText draft={draft} edit={edit} bytes={editor.bytes} busy={editor.busy} onBusy={setFitting} onChange={editor.onChange}/>
      <div className="original-inline-actions"><small>{tr("Ctrl+Enter aplica · Escape cancela")}</small><Button disabled={editor.busy||fitting} onClick={()=>editor.onProperties(edit)}>{tr("Propiedades")}</Button><Button disabled={editor.busy} onClick={cancel}>{tr("Cancelar")}</Button><button className="btn primary" type="submit" disabled={blocked}>{tr("Aplicar texto en página")}</button></div>
    </form>,document.body)}
  </>;
}
