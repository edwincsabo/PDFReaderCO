import{tr,translateMessage}from'./i18n';
import {useCallback,useEffect,useRef,useState,useId}from'react';
import {ArrowLeftRight,ChevronLeft,ChevronRight,FolderOpen,Link2,Unlink,Columns2,X,ExternalLink}from'lucide-react';
import {ComparisonAnalysis}from'./ComparisonAnalysis';
import {PageView}from'./PageView';
import {Button}from'./ui';
import {comparisonLocation,pairedLocation,pageAtOffset,offsetForLocation}from'./comparison-position.mjs';
import type {Model,PDFProxy,OpenFile}from'./types';

export type ComparisonSource={id:string;name:string;pdf:PDFProxy|null;bytes:Uint8Array;encrypted?:boolean;model:Model;page:number;message:string;blocked:boolean};
type Location={page:number;y:number;x:number};
type Side='left'|'right';
const noop=()=>{};
const start=(source?:ComparisonSource):Location=>({page:source?.page||1,y:0,x:0});

export function ComparisonView({active,tabs,sources,pair,onPair,onOpen,onDocument,onClose}:{active:boolean;tabs:OpenFile[];sources:Record<string,ComparisonSource>;pair:[string,string];onPair:(pair:[string,string])=>void;onOpen:(side:Side)=>Promise<void>;onDocument:(id:string)=>void;onClose:()=>void}){
  const left=sources[pair[0]],right=sources[pair[1]],initialLeft=start(left);
  const [locations,setLocations]=useState<Record<string,Location>>(()=>({[pair[0]]:initialLeft,...(right?{[right.id]:comparisonLocation(initialLeft,right.pdf?.numPages||1)}:{})}));
  const[analysis,setAnalysis]=useState<any>(null),[activeDifference,setActiveDifference]=useState<any>(null);
  const [linked,setLinked]=useState(true),[offset,setOffset]=useState(0),[zoom,setZoom]=useState('width'),[opening,setOpening]=useState(false);
  const locationsRef=useRef(locations);locationsRef.current=locations;
  const initialized=useRef(new Set<string>());
  useEffect(()=>{if(left?.pdf&&!initialized.current.has(left.id)){const followRight=linked&&right?.pdf&&initialized.current.has(right.id);initialized.current.add(left.id);setLocations(current=>({...current,[left.id]:followRight?pairedLocation(current[right!.id]||start(right),left.pdf!.numPages,offset,-1):current[left.id]||start(left)}));}if(right?.pdf&&!initialized.current.has(right.id)){initialized.current.add(right.id);setLocations(current=>({...current,[right.id]:linked&&left?.pdf?pairedLocation(current[left.id]||start(left),right.pdf!.numPages,offset):current[right.id]||start(right)}));}},[left?.id,left?.pdf,right?.id,right?.pdf,linked,offset]);
  const location=(source?:ComparisonSource)=>comparisonLocation(source?locations[source.id]||start(source):start(),source?.pdf?.numPages||1);
  const leftLocation=location(left),rightLocation=location(right);
  const navigate=useCallback((side:Side,value:Location)=>{
    const source=side==='left'?left:right,target=side==='left'?right:left;if(!source?.pdf)return;
    const next=comparisonLocation(value,source.pdf.numPages);setLocations(current=>({...current,[source.id]:next,...(linked&&target?.pdf?{[target.id]:pairedLocation(next,target.pdf.numPages,offset,side==='left'?1:-1)}:{})}));
  },[left,right,linked,offset]);
  const select=(side:Side,id:string)=>{
    const next=sources[id],other=side==='left'?right:left,otherPosition=other?locationsRef.current[other.id]||start(other):start();
    setLocations(current=>({...current,[id]:linked&&other?.pdf?pairedLocation(otherPosition,next?.pdf?.numPages||1,offset,side==='right'?1:-1):start(next)}));
    onPair(side==='left'?[id,pair[1]]:[pair[0],id]);
  };
  const toggle=()=>{const value=!linked;setLinked(value);if(value&&left?.pdf&&right?.pdf)setLocations(current=>({...current,[right.id]:pairedLocation(leftLocation,right.pdf!.numPages,offset)}));};
  const align=()=>{setOffset(rightLocation.page-leftLocation.page);if(left&&right)setLocations(current=>({...current,[right.id]:{...rightLocation,y:leftLocation.y,x:leftLocation.x}}));};
  const reset=()=>{setOffset(0);if(linked&&left?.pdf&&right?.pdf)setLocations(current=>({...current,[right.id]:pairedLocation(leftLocation,right.pdf!.numPages)}));};
  const open=async(side:Side)=>{if(opening)return;setOpening(true);try{await onOpen(side);}finally{setOpening(false);}};
  const limited=linked&&left?.pdf&&right?.pdf&&(leftLocation.page+offset!==rightLocation.page);
  return <section className="comparison-view" aria-label={tr("Comparación de documentos")}>
    <header className="comparison-toolbar"><h1><Columns2 size={18}/>{tr(" Comparar documentos")}</h1><Button icon={linked?Link2:Unlink} active={linked} onClick={toggle}>{tr("Sincronizar navegación")}</Button><Button onClick={align} disabled={!left?.pdf||!right?.pdf}>{tr("Alinear páginas actuales")}</Button>{offset!==0&&<Button onClick={reset} title={tr("Volver a relacionar páginas con el mismo número")}>{tr("Desfase ")}{offset>0?'+':''}{offset}{tr(" · Restablecer")}</Button>}<label>{tr("Zoom ")}<select aria-label={tr("Zoom de comparación")} value={zoom} onChange={e=>setZoom(e.target.value)}><option value="width">{tr("Ajustar ancho")}</option><option value="page">{tr("Página completa")}</option>{[.25,.5,.75,1,1.5,2,3,4].map(z=><option value={z} key={z}>{z*100}%</option>)}</select></label><Button icon={ArrowLeftRight} title={tr("Intercambiar documentos")} disabled={!pair[0]||!pair[1]} onClick={()=>{setOffset(value=>-value);onPair([pair[1],pair[0]]);}}/><Button icon={X} onClick={onClose}>{tr("Salir de comparación")}</Button></header>
    <ComparisonAnalysis left={left} right={right} offset={offset} active={active} report={analysis} onReport={setAnalysis} onPick={(pair,mark)=>{setActiveDifference({left:pair.left,right:pair.right,mark});setLocations(current=>({...current,...(left&&pair.left?{[left.id]:{page:pair.left,y:Math.max(0,(pair.changes[mark]?.left[0]?.y||0)-.1),x:0}}:{}),...(right&&pair.right?{[right.id]:{page:pair.right,y:Math.max(0,(pair.changes[mark]?.right[0]?.y||0)-.1),x:0}}:{})}));}}/>
    <div className="comparison-panes">{(['left','right']as Side[]).map((side,i)=>{const source=side==='left'?left:right,id=pair[i],other=pair[1-i],value=side==='left'?leftLocation:rightLocation;return <section className="comparison-pane" aria-label={i?tr("Documento derecho"):tr("Documento izquierdo")} key={side}>
      <div className="comparison-document"><label>{i?tr("Derecha"):tr("Izquierda")}<select aria-label={i?tr("Documento derecho"):tr("Documento izquierdo")} value={id} onChange={e=>select(side,e.target.value)}><option value="" disabled>{tr("Selecciona un documento")}</option>{tabs.filter(tab=>tab.id!==other).map(tab=><option key={tab.id} value={tab.id}>{tab.name}</option>)}</select></label><Button icon={FolderOpen} title={i?tr("Abrir documento derecho"):tr("Abrir documento izquierdo")} disabled={opening} onClick={()=>open(side)}/>{id&&<Button icon={ExternalLink} title={i?tr("Ir a la pestaña derecha"):tr("Ir a la pestaña izquierda")} onClick={()=>onDocument(id)}/>}</div>
      {source?.pdf&&!source.blocked?<ComparisonPane key={id} source={source} location={value} zoom={zoom} active={active} onLocation={next=>navigate(side,next)} differences={analysis?.pages||[]} selectedDifference={activeDifference} side={side}/>:<div className="comparison-empty"><Columns2 size={34}/><p>{source?.message||tr("Selecciona otro documento abierto o abre un PDF para compararlo.")}</p>{id&&source?.blocked&&<Button onClick={()=>onDocument(id)}>{tr("Abrir su pestaña")}</Button>}{!id&&<Button icon={FolderOpen} disabled={opening} onClick={()=>open(side)}>{tr("Abrir otro PDF")}</Button>}</div>}
    </section>;})}</div>
    <footer className="comparison-status" role="status"><span>{linked?tr("Navegación y desplazamiento sincronizados"):tr("Paneles independientes")}{offset!==0?tr(" · Desfase derecho {0}{1}",[(offset>0?'+':''),offset]):''}{limited?tr(" · Sin página equivalente: se muestra el extremo disponible"):''}</span><span>{tr("Lectura · Para editar o guardar, abre la pestaña del documento.")}</span></footer>
  </section>;
}

function ComparisonPane({source,location,zoom,active,onLocation,differences,selectedDifference,side}:{source:ComparisonSource;location:Location;zoom:string;active:boolean;onLocation:(location:Location)=>void;differences:any[];selectedDifference:any;side:Side}){
  const fieldScope=useId();
  const pdf=source.pdf!,root=useRef<HTMLDivElement>(null),pages=useRef<HTMLDivElement>(null),position=useRef(location),callback=useRef(onLocation),expected=useRef<{top:number;left:number}|null>(null),frame=useRef(0),[scale,setScale]=useState(.5),[dimensions,setDimensions]=useState({width:595.28,height:841.89}),[error,setError]=useState('');
  position.current=location;callback.current=onLocation;
  useEffect(()=>{let stopped=false;Promise.all(Array.from({length:pdf.numPages},(_,i)=>pdf.getPage(i+1).then(page=>page.getViewport({scale:1})))).then(viewports=>{if(!stopped)setDimensions({width:Math.max(...viewports.map(v=>v.width)),height:Math.max(...viewports.map(v=>v.height))});}).catch(e=>{if(!stopped)setError(String(e.message||e));});return()=>{stopped=true;};},[pdf]);
  const apply=useCallback(()=>{
    if(!active)return;const el=root.current,target=el?.querySelector<HTMLElement>(`.pdf-page[data-page="${position.current.page}"]`);if(!el||!target||target.dataset.layoutReady!=='true')return;
    const box=el.getBoundingClientRect(),rect=target.getBoundingClientRect(),padding=parseFloat(getComputedStyle(el).paddingTop)||0;
    const result=offsetForLocation({top:el.scrollTop+rect.top-box.top-el.clientTop,height:rect.height},position.current,padding,Math.max(0,el.scrollHeight-el.clientHeight),el.scrollWidth-el.clientWidth);
    if(Math.abs(result.top-el.scrollTop)<.75&&Math.abs(result.left-el.scrollLeft)<.75)return;
    el.scrollTop=result.top;el.scrollLeft=result.left;expected.current={top:el.scrollTop,left:el.scrollLeft};
  },[active]);
  useEffect(()=>{if(!active)return;const update=()=>{if(!root.current)return;const w=Math.max(80,root.current.clientWidth-40),h=Math.max(80,root.current.clientHeight-40);setScale(zoom==='width'?Math.min(4,w/dimensions.width):zoom==='page'?Math.min(4,w/dimensions.width,h/dimensions.height):Number(zoom));};const observer=new ResizeObserver(()=>{update();apply();});if(root.current)observer.observe(root.current);update();return()=>observer.disconnect();},[dimensions,zoom,apply,active]);
  useEffect(()=>{apply();},[location.page,location.y,location.x,scale,apply]);
  useEffect(()=>{const observer=new ResizeObserver(apply),layout=new MutationObserver(apply);if(pages.current){observer.observe(pages.current);layout.observe(pages.current,{subtree:true,attributes:true,attributeFilter:['data-layout-ready']});}return()=>{observer.disconnect();layout.disconnect();};},[apply]);
  useEffect(()=>()=>cancelAnimationFrame(frame.current),[]);
  const scroll=()=>{cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>{
    const el=root.current;if(!el||!active)return;
    if(expected.current){const previous=expected.current;expected.current=null;if(Math.abs(previous.top-el.scrollTop)<1&&Math.abs(previous.left-el.scrollLeft)<1)return;}
    const rect=el.getBoundingClientRect(),padding=parseFloat(getComputedStyle(el).paddingTop)||0,boxes=Array.from(el.querySelectorAll<HTMLElement>('.pdf-page')).map(page=>{const r=page.getBoundingClientRect();return {page:Number(page.dataset.page),top:el.scrollTop+r.top-rect.top-el.clientTop,height:r.height};});
    const next={...pageAtOffset(boxes,el.scrollTop+padding),x:el.scrollWidth>el.clientWidth?el.scrollLeft/(el.scrollWidth-el.clientWidth):0};position.current=next;callback.current(next);
  });};
  const go=(number:number)=>{if(Number.isInteger(number)&&number>=1&&number<=pdf.numPages)onLocation({page:number,y:0,x:location.x});};
  return <>{error&&<p className="error-banner" role="alert">{translateMessage(error)}</p>}<div className="pane-navigation"><Button icon={ChevronLeft} title={tr("Página anterior del documento")} disabled={location.page<=1} onClick={()=>go(location.page-1)}/><label>{tr("Página ")}<input aria-label={tr("Página del documento")} type="number" min="1" max={pdf.numPages} value={location.page} onChange={e=>go(Number(e.target.value))}/> / {pdf.numPages}</label><Button icon={ChevronRight} title={tr("Página siguiente del documento")} disabled={location.page>=pdf.numPages} onClick={()=>go(location.page+1)}/><span>{Math.round(scale*100)}{tr("% · Lectura")}</span></div>
    <div className="document-scroll comparison-scroll" ref={root} onScroll={scroll} tabIndex={0} aria-label={tr("Páginas del documento")}><div ref={pages} className="comparison-pages">{Array.from({length:pdf.numPages},(_,i)=><PageView fieldScope={fieldScope} key={i+1} differences={differences.filter(p=>p[side]===i+1).flatMap(p=>p.changes.flatMap((c:any,index:number)=>(c[side]||[]).map((rect:any)=>({rect,type:c.type||'page',active:selectedDifference?.[side]===i+1&&selectedDifference?.mark===index}))))} pdf={pdf} number={i+1} scale={scale} tool="select" color="#008577" size={2} marks={source.model.marks.filter(mark=>mark.page===i+1)} forms={source.model.forms} selected={[]} onSelect={noop} onMark={noop} onText={noop} onChange={noop} onChanges={noop} onEdit={noop} onDelete={noop} onField={noop} onPage={go} onVisible={noop} image="" active={active} readOnly/>)}</div></div>
  </>;
}
