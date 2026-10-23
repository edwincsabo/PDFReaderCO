import{tr,translateMessage}from'./i18n';
import{useState}from'react';
import type{OriginalDraft,OriginalEdit}from'./original-text-client';
import{copyTextFormat,pasteTextFormat,withFormatUndo,canUndoFormat,undoTextFormat,reusableFormatFont}from'./text-format.mjs';
import{textFormatClipboard,useTextFormatClipboard}from'./text-format-clipboard';
type Font={id:string;name:string;postscript?:string};
export function CopySelectedFormat({draft,disabled}:{draft:OriginalDraft|null;disabled:boolean}){
  const[status,setStatus]=useState(''),[copying,setCopying]=useState(false);
  return <><button type="button" className="btn" disabled={disabled||!draft?.editable||copying} onClick={async()=>{if(!draft)return;setCopying(true);try{const{originalEdit}=await import('./original-text-client');const fonts=await window.desktop?.listFonts?.()||[],format=copyTextFormat(draft,originalEdit(draft),fonts);textFormatClipboard.set(format);setStatus(tr(format.mixed?'Formato copiado del primer fragmento.':'Formato copiado.'));}catch(e){setStatus(e instanceof Error?e.message:String(e));}finally{setCopying(false);}}}>{tr("Copiar formato seleccionado")}</button>{status&&<small className="format-ribbon-status" role="status">{translateMessage(status)}</small>}</>;
}
export function FormatTransferControls({draft,edit,onChange,disabled,fonts,partial}:{draft:OriginalDraft;edit:OriginalEdit;onChange:(edit:OriginalEdit)=>void;disabled:boolean;fonts:Font[];partial:boolean}){
  const[copying,setCopying]=useState(false);
  const copied=useTextFormatClipboard(),[options,setOptions]=useState({font:true,size:true,color:true}),[status,setStatus]=useState({text:'',error:false});
  let fontReason='';if(copied){try{reusableFormatFont(copied,edit,draft);}catch(e){fontReason=e instanceof Error?e.message:String(e);}}
  const act=(action:()=>void)=>{try{action();}catch(e){setStatus({text:e instanceof Error?e.message:String(e),error:true});}};
  return <div className="format-transfer" aria-label={tr("Copiar y pegar formato")}><div className="text-selection-actions"><button type="button" className="btn" disabled={disabled||!edit.text||copying} onClick={async()=>{setCopying(true);try{const catalog=window.desktop?.listFonts?await window.desktop.listFonts():fonts,format=copyTextFormat(draft,edit,catalog,partial);textFormatClipboard.set(format);setStatus({text:format.mixed?'Se copió el formato del primer carácter del rango; la selección contiene varios formatos.':'Formato copiado. Puedes usarlo en otro texto o documento.',error:false});}catch(e){setStatus({text:e instanceof Error?e.message:String(e),error:true});}finally{setCopying(false);}}}>{tr("Copiar formato")}</button><button type="button" className="btn" disabled={disabled||!copied||!edit.text||!Object.values(options).some(Boolean)} onClick={()=>act(()=>{const next=pasteTextFormat(draft,edit,copied,options,partial);onChange(withFormatUndo(edit,next));setStatus({text:'Formato pegado en el borrador. Revisa la vista previa antes de aplicar.',error:false});})}>{tr("Pegar formato")}</button><button type="button" className="btn" disabled={disabled||!canUndoFormat(edit)} onClick={()=>act(()=>{onChange(undoTextFormat(edit));setStatus({text:'Pegado deshecho en el borrador.',error:false});})}>{tr("Deshacer pegado")}</button>{copied&&<button type="button" className="btn" disabled={disabled} onClick={()=>{textFormatClipboard.clear();setStatus({text:'Formato copiado eliminado.',error:false});}}>{tr("Vaciar formato copiado")}</button>}</div>
    {copied&&<><p className="format-transfer-summary">{tr("Copiado: ")}{copied.fontName} · {Number(copied.pointSize.toFixed(2))}{tr(" pt · ")}<span className="format-color-sample" style={{background:copied.color}}/>{copied.color}{copied.mixed?tr(" · Primer formato del rango."):''}</p><div className="format-transfer-options">{(['font','size','color']as const).map(key=><label key={key}><input type="checkbox" checked={options[key]} onChange={e=>{setOptions({...options,[key]:e.target.checked});setStatus({text:'',error:false});}}/>{tr(" Incluir ")}{key==='font'?tr("fuente"):key==='size'?tr("tamaño"):tr("color")}</label>)}</div>{fontReason&&options.font&&<p className="dialog-note">{translateMessage(fontReason)}</p>}</>}
    {status.text&&<p className="dialog-note" role={status.error?'alert':'status'}>{translateMessage(status.text)}</p>}
  </div>;
}


