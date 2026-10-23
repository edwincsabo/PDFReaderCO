import * as pdfjs from'pdfjs-dist';

import workerUrl from'./ocr-recognizer.worker.ts?worker&url';

import imageWorkerUrl from'./ocr-image.worker.ts?worker&url';

import {normalizeOcrWords}from'./ocr-review.mjs';

import {inspectOcrSource,ocrOptions}from'./ocr-engine.mjs';

import {regionTextConflict,regionsIntersect}from'./ocr-region.mjs';

import{ocrJobs}from'./ocr-jobs.mjs';

export type OcrRegion={page:number;x:number;y:number;w:number;h:number};

export type OcrPreparation={contrast:boolean;denoise:boolean;deskew:'none'|'auto'|'manual';angle:number;orientation?:'none'|'auto'|0|90|180|270;lighting?:boolean;perspective?:number[]};

export type OcrGeometry={width:number;height:number;processedWidth:number;processedHeight:number;degrees:number;perspective?:number[]};

export type OcrWord={id:number;line:number;start:number;length:number;text:string;confidence:number;box:number[];baseline?:number[];correction?:string;reviewed?:boolean};

export type OcrOptions={language:string;dpi:150|200|300;range:string;regions?:OcrRegion[];region?:OcrRegion;layout?:'auto'|'column'|'block'|'sparse';preparation?:OcrPreparation};

export type OcrPage={comparison?:any;id?:number;source?:string;region?:OcrRegion;page:number;status:'recognized'|'existing'|'empty';text:string;confidence:number;language:string;pdf?:Uint8Array;words?:OcrWord[];reviewable?:boolean;geometry?:OcrGeometry;preview?:string;preparation?:OcrPreparation;layout?:OcrOptions['layout'];engineLayout?:string;message:string};

export type OcrReport={source:string;pages:OcrPage[];options?:OcrOptions};

export async function recognizePdf(bytes:Uint8Array,input:OcrOptions,signal:AbortSignal,onProgress:(progress:{message:string;fraction:number})=>void,continuation?:{remaining?:number[];initialPixels?:number;initialPreviewBytes?:number;initialCharacters?:number;onPage?:(page:OcrPage,remaining:number[],pixels:number)=>void}):Promise<OcrReport>{

  const check=()=>{if(signal.aborted)throw new DOMException('Reconocimiento cancelado.','AbortError');};check();

  const options=ocrOptions(input),{source:sourceId,pages:sourcePages}=await inspectOcrSource(bytes),source={source:sourceId,pages:sourcePages};check();const allJobs=ocrJobs(options,source.pages.length),jobs=continuation?.remaining?allJobs.filter((j:any)=>continuation.remaining!.includes(j.id)):allJobs,indices=jobs.map((j:any)=>j.page-1);if(!jobs.length)throw new Error('No hay zonas o páginas pendientes.');

  const loading=pdfjs.getDocument({data:bytes.slice(),standardFontDataUrl:new URL('./pdf-assets/standard_fonts/',location.href).href,cMapUrl:new URL('./pdf-assets/cmaps/',location.href).href,cMapPacked:true,wasmUrl:new URL('./pdf-assets/wasm/',location.href).href,enableXfa:false});

  const imageWorker=new Worker(imageWorkerUrl,{type:'module'});let previewBytes=continuation?.initialPreviewBytes||0,imagePending:{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}|null=null;

  const engine=new Worker(workerUrl,{type:'module'}),pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();let serial=0,render:any=null,pixelTotal=continuation?.initialPixels||0,characters=continuation?.initialCharacters||0,initialized=false,position=0,closed=false,lastFraction=0;

  const progress=(value:{message:string;fraction:number})=>{if(closed||signal.aborted)return;lastFraction=Math.max(lastFraction,Math.min(1,value.fraction));onProgress({...value,fraction:lastFraction});};

  const fail=(error:Error)=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}pending.clear();if(imagePending){clearTimeout(imagePending.timer);imagePending.reject(error);imagePending=null;}};

  const abort=()=>{closed=true;render?.cancel();engine.terminate();imageWorker.terminate();fail(new DOMException('Reconocimiento cancelado.','AbortError'));void loading.destroy();};signal.addEventListener('abort',abort,{once:true});

  engine.onerror=()=>fail(new Error('No se pudo ejecutar el motor OCR local.'));

  engine.onmessage=({data})=>{if(signal.aborted||closed)return;if(data.progress){const value=data.progress;progress({message:`Página ${indices[position]+1}: ${value.status==='recognizing text'?'reconociendo texto':'preparando el motor local'}`,fraction:(position+.2+.7*(value.progress||0))/indices.length});return;}const item=pending.get(data.id);if(item){pending.delete(data.id);clearTimeout(item.timer);data.error?item.reject(new Error(data.error)):item.resolve(data.result);}};

  const request=(type:string,payload:any={})=>new Promise<any>((resolve,reject)=>{check();const id=++serial,timer=setTimeout(()=>{fail(new Error('El OCR tardó más de dos minutos en una página. Prueba menor resolución o menos páginas.'));engine.terminate();},120000);pending.set(id,{resolve,reject,timer});try{engine.postMessage({id,type,...payload});}catch(e){clearTimeout(timer);pending.delete(id);reject(e);}});

  imageWorker.onmessage=({data})=>{const request=imagePending;if(!request||signal.aborted||closed)return;imagePending=null;clearTimeout(request.timer);data.error?request.reject(new Error(data.error)):request.resolve(data);};imageWorker.onerror=()=>fail(new Error('No se pudo preparar la imagen de análisis.'));

  const prepareImage=(payload:any,transfer:Transferable[]=[])=>new Promise<any>((resolve,reject)=>{check();const timer=setTimeout(()=>{imagePending=null;reject(new Error('La preparación de imagen tardó demasiado. Reduce la resolución.'));imageWorker.terminate();},120000);imagePending={resolve,reject,timer};try{imageWorker.postMessage(payload,transfer);}catch(e){clearTimeout(timer);imagePending=null;reject(e);}});

  const pages:OcrPage[]=[];const completed=()=>{check();pages[pages.length-1].source=source.source;pages[pages.length-1].id=jobs[position].id;continuation?.onPage?.(pages[pages.length-1],jobs.slice(position+1).map((j:any)=>j.id),pixelTotal);};

  try{

    const document=await loading.promise;

    for(position=0;position<indices.length;position++){

      check();const index=indices[position],page=await document.getPage(index+1);progress({message:`Revisando página ${index+1}`,fraction:position/indices.length});const text=await page.getTextContent();check();

      const region=jobs[position].region as OcrRegion|undefined;if(region){const info=source.pages[index];if(info.hasOcr&&!info.ocrRegions)throw new Error('Esta página ya tiene una capa OCR completa o incompatible. Usa una copia anterior al OCR.');if(info.ocrRegions?.some((r:OcrRegion)=>regionsIntersect(region,r)))throw new Error('La zona se superpone a una zona OCR ya aplicada.');if(regionTextConflict(region,text,page.getViewport({scale:1})))throw new Error('La zona incluye texto seleccionable. Dibuja solo el área escaneada para evitar duplicarlo.');}

      if(!region&&(source.pages[index].hasOcr||text.items.some(item=>'str'in item&&item.str.trim()))){pages.push({page:index+1,status:'existing',text:'',confidence:0,language:options.language,message:'Omitida: ya contiene texto seleccionable.'});completed();continue;}

      const reserve=options.preparation.deskew!=='none',base=page.getViewport({scale:1}),rw=region?.w||1,rh=region?.h||1,scale=Math.min(options.dpi/72,6000/(Math.max(base.width*rw,base.height*rh)*(reserve?1.1:1)),Math.sqrt(16000000/(base.width*rw*base.height*rh*(reserve?1.2:1)))),viewport=page.getViewport({scale}),width=Math.ceil(viewport.width*rw-1e-8),height=Math.ceil(viewport.height*rh-1e-8);

      const canvas=documentCanvas(width,height);try{

        progress({message:`Preparando imagen de página ${index+1}`,fraction:(position+.1)/indices.length});render=page.render({canvas,canvasContext:canvas.getContext('2d')!,viewport,...(region?{transform:[1,0,0,1,-region.x*viewport.width,-region.y*viewport.height]}:{}),annotationMode:pdfjs.AnnotationMode.DISABLE,background:'#ffffff'});await render.promise;check();

        const rgba=canvas.getContext('2d')!.getImageData(0,0,width,height).data;

        let prepared=await prepareImage({type:'prepare',width,height,rgba:rgba.buffer,options:options.preparation,degrees:(typeof options.preparation.orientation==='number'?options.preparation.orientation:0)+(options.preparation.deskew==='manual'?options.preparation.angle:0)},[rgba.buffer]);check();

        if(!initialized){await request('initialize',{language:options.language,layout:options.layout,assets:new URL('./ocr-assets/',location.href).href});initialized=true;}check();

        let orientation=typeof options.preparation.orientation==='number'?options.preparation.orientation:0;let orientationResult:any=null;

        if(options.preparation.orientation==='auto'){let best=-Infinity;for(const angle of[0,90,180,270]){const candidate=await prepareImage({type:'rotate',degrees:angle+(options.preparation.deskew==='manual'?options.preparation.angle:0)});pixelTotal+=candidate.geometry.processedWidth*candidate.geometry.processedHeight;if(pixelTotal>200000000)throw new Error('El análisis de orientación supera el presupuesto de píxeles. Reduce páginas o resolución.');const reading=await request('recognize',{image:candidate.image,dpi:Math.round(scale*72)});check();const count=(reading.text.match(/[\p{L}\p{N}]/gu)||[]).length,score=count?reading.confidence+Math.min(10,Math.log2(count+1)):-1;if(score>best){best=score;prepared=candidate;orientation=angle;orientationResult=reading;}}}

        let angleNote='';if(options.preparation.deskew==='auto'){

          progress({message:`Estimando inclinación de página ${index+1}`,fraction:(position+.2)/indices.length});const skew=await request('skew',{image:prepared.image,dpi:Math.round(scale*72)});check();const degrees=Number(skew.radians)*180/Math.PI;

          if(!Number.isFinite(degrees)||Math.abs(degrees)>5)angleNote=' La inclinación estimada queda fuera de ±5°; no se enderezó.';

          else if(Math.abs(degrees)>=.286)prepared=await prepareImage({type:'rotate',degrees:orientation+degrees});orientationResult=null;

        }

        pixelTotal+=prepared.geometry.processedWidth*prepared.geometry.processedHeight;if(pixelTotal>200000000)throw new Error('El rango supera 200 millones de píxeles. Elige menos páginas o menor resolución.');

        const result=orientationResult||await request('recognize',{image:prepared.image,dpi:Math.round(scale*72)});check();characters+=result.text.length;if(result.text.length>100000||characters>1000000)throw new Error('El texto reconocido supera los límites. Elige menos páginas.');

        const details=normalizeOcrWords(result.text,result.lines,prepared.geometry.processedWidth,prepared.geometry.processedHeight);let preview:string|undefined;

        if(prepared.thumbnail.length<=1024*1024&&previewBytes+prepared.thumbnail.length<=24*1024*1024){previewBytes+=prepared.thumbnail.length;let binary='';for(let at=0;at<prepared.thumbnail.length;at+=32768)binary+=String.fromCharCode(...prepared.thumbnail.subarray(at,at+32768));preview='data:image/jpeg;base64,'+btoa(binary);}

        pages.push({...(region?{region}:{}),page:index+1,status:result.text.trim()?'recognized':'empty',text:result.text,confidence:result.confidence,language:options.language,pdf:result.text.trim()?result.pdf:undefined,...details,geometry:prepared.geometry,preview,preparation:options.preparation,layout:options.layout as OcrOptions['layout'],engineLayout:result.engineLayout,message:(result.text.trim()?(region?'Zona reconocida. Revisa el resultado.':'Texto reconocido. Revisa el resultado.'):'No se detectó texto.')+angleNote+(prepared.geometry.degrees?' Enderezado de análisis: '+prepared.geometry.degrees.toFixed(2)+'°.':'')+(!details.reviewable&&result.text.trim()?' No se pudieron posicionar todas las palabras; esta página conserva revisión de solo lectura.':'')+(!preview?' No se conservó la miniatura de análisis por su límite de memoria.':'')});

        completed();

      }finally{canvas.width=canvas.height=1;render=null;page.cleanup();}

    }

    check();progress({message:'Reconocimiento terminado. Revisa las páginas antes de aplicar.',fraction:1});return{source:source.source,pages,options:options as OcrOptions};

  }finally{closed=true;signal.removeEventListener('abort',abort);engine.terminate();imageWorker.terminate();fail(new Error('El reconocimiento ha terminado.'));await loading.destroy();}

}

function documentCanvas(width:number,height:number){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;}

