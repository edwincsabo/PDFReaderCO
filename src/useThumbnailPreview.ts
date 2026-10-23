import {useEffect,useRef,useState}from'react';
import * as pdfjs from'pdfjs-dist';
import {exportPdf}from'./pdf-engine.mjs';
import {messageOf}from'./bridge';
import type{Model,PDFProxy}from'./types';

// One shared snapshot for all visible thumbnails; debounced and never saved.
export function useThumbnailPreview(bytes:Uint8Array,model:Model,base:PDFProxy|null,enabled:boolean,editable:boolean){
  const [preview,setPreview]=useState<{bytes:Uint8Array;marks:Model['marks'];forms:Model['forms'];pdf:PDFProxy}|null>(null),[error,setError]=useState('');
  const generation=useRef(0);
  const flight=useRef<Promise<void>|null>(null);
  const needs=editable&&(model.marks.length>0||Object.keys(model.forms).length>0);
  useEffect(()=>{
    if(!enabled||!base||!needs){setPreview(null);setError('');return;}
    const id=++generation.current;let stopped=false,task:ReturnType<typeof pdfjs.getDocument>|undefined;
    setError('');setPreview(null);
    const timer=setTimeout(()=>{const job=(async()=>{try{
      if(flight.current)await flight.current;if(stopped)return;
      const data=await exportPdf(bytes,model,{formsMode:'draft'});if(stopped)return;
      const assets=new URL('./pdf-assets/',window.location.href).href;
      task=pdfjs.getDocument({data,cMapUrl:assets+'cmaps/',cMapPacked:true,standardFontDataUrl:assets+'standard_fonts/',wasmUrl:assets+'wasm/',enableXfa:false});
      const pdf=await task.promise;if(stopped||generation.current!==id){await task.destroy();return;}
      setPreview({bytes,marks:model.marks,forms:model.forms,pdf});
    }catch(e){if(!stopped)setError('No se pudo actualizar la vista de miniaturas: '+messageOf(e));}})();flight.current=job;void job.finally(()=>{if(flight.current===job)flight.current=null;});},350);
    return()=>{stopped=true;clearTimeout(timer);void task?.destroy();};
  },[bytes,model.marks,model.forms,base,enabled,editable,needs]);
  const current=preview?.bytes===bytes&&preview.marks===model.marks&&preview.forms===model.forms?preview.pdf:null;
  return{pdf:needs?current:base,pending:enabled&&!!base&&needs&&!current&&!error,error};
}
