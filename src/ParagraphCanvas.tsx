import{tr,translateMessage}from'./i18n';
import{useEffect,useRef,useState}from'react';
import type{PageViewport}from'pdfjs-dist';
import type{PDFProxy}from'./types';
import type{OriginalDraft,OriginalEdit,OriginalFit,OriginalPreview}from'./original-text-client';
import{ParagraphArea}from'./ParagraphArea';
export function ParagraphCanvas({pdf,draft,edit,preview,fit,disabled,onChange}:{pdf:PDFProxy|null;draft:OriginalDraft;edit:OriginalEdit;preview:OriginalPreview|null;fit:OriginalFit|null;disabled:boolean;onChange:(e:OriginalEdit)=>void}){
  const canvas=useRef<HTMLCanvasElement>(null),[viewport,setViewport]=useState<PageViewport|null>(null),[error,setError]=useState('');
  useEffect(()=>{let canceled=false;if(!pdf)return;pdf.getPage(draft.page).then(page=>{if(!canceled){const base=page.getViewport({scale:1});setViewport(page.getViewport({scale:Math.min(1,600/base.width)}));}}).catch(e=>{if(!canceled)setError(e.message);});return()=>{canceled=true;};},[pdf,draft.page]);
  useEffect(()=>{if(!preview||!canvas.current)return;const c=canvas.current;c.width=preview.image.width;c.height=preview.image.height;c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(preview.image.data),c.width,c.height),0,0);},[preview,viewport]);
  return <section aria-label={tr("Vista previa ajustable del párrafo")}><p>{tr("Arrastra las esquinas o los lados para cambiar el área. La vista previa redistribuye el texto conservando la letra.")}</p>{viewport&&<div className="paragraph-canvas-scroll"><div className="paragraph-canvas" style={{width:viewport.width,height:viewport.height}}><canvas ref={canvas} role="img" aria-label={tr("PDF con el párrafo propuesto")}/><ParagraphArea draft={draft} edit={edit} fit={fit} viewport={viewport} disabled={disabled} onChange={onChange}/></div></div>}{error&&<p role="alert">{translateMessage(error)}</p>}</section>;
}
