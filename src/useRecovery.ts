import { useEffect, useState } from 'react';
import { encodeProject } from './pdf-engine.mjs';
import { messageOf } from './bridge';
import type { Model } from './types';
import {encodeOcrSession}from'./ocr-session.mjs';
import {recoverySource}from'./recovery-drafts.mjs';
export function useRecovery(id:string,name:string,bytes:Uint8Array,model:Model,changed:boolean,editable:boolean,historyId?:string,drafts?:any,ocrReview?:any,tableDraft?:any){
  const [enabled,setEnabled]=useState(()=>localStorage.getItem('pdfco-auto-recovery')!=='false'),[status,setStatus]=useState('Sin cambios');
  useEffect(()=>{const sync=()=>setEnabled(localStorage.getItem('pdfco-auto-recovery')!=='false');window.addEventListener('pdfco-recovery-setting',sync);return()=>window.removeEventListener('pdfco-recovery-setting',sync);},[]);
  useEffect(()=>{
    let canceled=false;const desktop=window.desktop;
    if(!desktop){setStatus('Disponible en escritorio');return;}
    if(!enabled||!changed){desktop.discardRecovery(id).then(()=>window.dispatchEvent(new Event('pdfco-history-changed'))).catch(()=>{});setStatus(enabled?'Sin cambios':'Desactivada');return;}
    if(!editable||bytes.byteLength>32*1024*1024){setStatus(bytes.byteLength>32*1024*1024?'Archivo mayor de 32 MB':'Solo lectura');return;}
    setStatus('Pendiente…');const timer=setTimeout(async()=>{try{const source=drafts?await recoverySource(bytes):'',packed=ocrReview?await encodeOcrSession(ocrReview):undefined,snapshot=encodeProject(bytes,model,drafts?{...drafts,version:1,source}:undefined,packed,tableDraft);if(canceled)return;const result=await desktop.saveRecovery(id,name,snapshot,historyId);window.dispatchEvent(new Event('pdfco-history-changed'));if(!canceled)setStatus(result.warning||(ocrReview?'Copia local con revisión OCR guardada':tableDraft?'Copia local con tabla guardada':drafts?'Copia local con borradores guardada':'Copia local guardada'));}catch(error){if(!canceled)setStatus('Sin copia nueva: '+(messageOf(error).split('Error: ').pop()||messageOf(error)));}},ocrReview?.remaining?.length?350:1500);
    return()=>{canceled=true;clearTimeout(timer);};
  },[id,name,bytes,model,changed,editable,enabled,historyId,drafts,ocrReview,tableDraft]);
  const toggle=()=>{const next=!enabled;localStorage.setItem('pdfco-auto-recovery',String(next));window.dispatchEvent(new Event('pdfco-recovery-setting'));};
  const checkpoint=async()=>{
    if(!window.desktop||!enabled||!editable||bytes.byteLength>32*1024*1024)return;
    const result=await window.desktop.saveRecovery(id,name,encodeProject(bytes,model,undefined,undefined,tableDraft),historyId);if(!tableDraft)await window.desktop.discardRecovery(id);window.dispatchEvent(new Event('pdfco-history-changed'));return result.warning;
  };
  return {enabled,status,toggle,checkpoint};
}
