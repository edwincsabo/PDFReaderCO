import{tr,translateMessage}from'./i18n';
import{scaleSpanSizes}from'./text-spans.mjs';
import { useEffect, useRef, useState } from 'react';
import { fitOriginalText, type OriginalDraft, type OriginalEdit } from './original-text-client';
import { Button } from './ui';

const key=(edit:OriginalEdit)=>JSON.stringify([edit.source,edit.page,edit.index,edit.indices,edit.originals,edit.original,edit.text,edit.font,edit.spans,edit.fontSize,edit.color,edit.fitMinimum??8,edit.expandToSpace,edit.paragraph,edit.paragraphWidth,edit.paragraphHeight,edit.paragraphOffsetX,edit.paragraphOffsetY,edit.paragraphAutoGrow,edit.lineSpacing,edit.align,edit.indentLeft,edit.indentRight,edit.firstLineIndent,edit.spaceBefore,edit.spaceAfter]);
const contentKey=(edit:OriginalEdit)=>JSON.stringify([edit.source,edit.page,edit.index,edit.text,edit.font,edit.spans,edit.color,edit.expandToSpace,edit.paragraphWidth,edit.paragraphHeight,edit.paragraphOffsetX,edit.paragraphOffsetY,edit.paragraphAutoGrow,edit.lineSpacing,edit.align,edit.indentLeft,edit.indentRight,edit.firstLineIndent,edit.spaceBefore,edit.spaceAfter]);
export function AutoFitText({draft,edit,bytes,busy,onChange,onBusy}:{draft:OriginalDraft;edit:OriginalEdit;bytes:Uint8Array;busy:boolean;onChange:(edit:OriginalEdit)=>void;onBusy:(busy:boolean)=>void}){
  const [fitting,setFitting]=useState(false),[status,setStatus]=useState({key:'',message:'',error:false}),[undo,setUndo]=useState<{content:string;size:number;previous:number;overflow?:boolean}|null>(null);
  const alive=useRef(true),running=useRef(false),current=useRef(key(edit));current.current=key(edit);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const minimum=edit.fitMinimum??8,validMinimum=Number.isFinite(minimum)&&minimum>=6&&minimum<=72,disabled=busy||fitting||!edit.text.trim()||!validMinimum;
  const fit=async()=>{
    if(disabled||running.current)return;running.current=true;const snapshot=edit,signature=key(edit);setFitting(true);onBusy(true);setStatus({key:signature,message:'Buscando el mayor tamaño que quepa…',error:false});
    try{
      const result=await fitOriginalText(bytes,snapshot);if(!alive.current||current.current!==signature)return;
      if(!result.fits){setStatus({key:signature,error:true,message:result.reason==='below-minimum'?`El tamaño actual es menor que el mínimo de ${minimum} pt. Elige un mínimo menor para ajustar.`:`El texto no cabe con el mínimo de ${minimum} pt. Acórtalo o elige otro mínimo; el tamaño se conserva.`});return;}
      if(result.fontSize===undefined||result.pointSize===undefined)throw new Error('No se pudo determinar un tamaño válido.');
      if(result.changed){const next={...scaleSpanSizes(snapshot,result.fontSize),allowOverflow:false};setUndo({content:contentKey(next),size:next.fontSize,previous:snapshot.fontSize,overflow:snapshot.allowOverflow});setStatus({key:key(next),error:false,message:`Tamaño ajustado a ${result.pointSize.toFixed(1)} pt. Revisa la vista previa antes de aplicar.`});onChange(next);}
      else setStatus({key:signature,error:false,message:`El texto ya cabe; se conserva el tamaño de ${result.pointSize.toFixed(1)} pt.`});
    }catch(error){if(alive.current&&current.current===signature)setStatus({key:signature,error:true,message:error instanceof Error?error.message:String(error)});}
    finally{running.current=false;if(alive.current){setFitting(false);onBusy(false);}}
  };
  const canUndo=!!undo&&undo.content===contentKey(edit)&&undo.size===edit.fontSize;
  return <div className="auto-fit-text">
    <div className="auto-fit-controls"><label>{tr("Mínimo (pt)")}<input aria-label={tr("Tamaño mínimo del ajuste")} type="number" min="6" max="72" step="any" value={Number.isFinite(minimum)?minimum:''} disabled={busy||fitting} onChange={e=>onChange({...edit,fitMinimum:e.target.value===''?NaN:Number(e.target.value)})}/></label><Button disabled={disabled} onClick={fit}>{fitting?tr("Ajustando tamaño…"):tr("Ajustar para que quepa")}</Button>{canUndo&&<Button disabled={busy||fitting} onClick={()=>{if(!undo)return;onChange({...scaleSpanSizes(edit,undo.previous),allowOverflow:undo.overflow});setUndo(null);setStatus({key:'',message:'',error:false});}}>{tr("Deshacer ajuste")}</Button>}</div>
    <p>{tr("Reduce el tamaño hasta el mínimo elegido (6–72 pt). Conserva el tamaño actual si ya cabe. Precisión: 0,1 pt.")}</p>
    {!validMinimum&&<p role="alert">{tr("Indica un mínimo entre 6 y 72 puntos.")}</p>}
    {status.key===key(edit)&&status.message&&<p className="auto-fit-status" role={status.error?'alert':'status'}>{translateMessage(status.message)}</p>}
  </div>;
}
