import {createWorker,OEM,PSM,type Worker as TesseractWorker}from'tesseract.js';
const scope=self as unknown as {onmessage:(event:MessageEvent)=>void;postMessage:(message:unknown,transfer?:Transferable[])=>void};
let engine:TesseractWorker|null=null,current=0;
scope.onmessage=async({data})=>{current=data.id;try{
  if(data.type==='initialize'){
    engine=await createWorker(data.language,OEM.LSTM_ONLY,{workerPath:data.assets+'worker.min.js',corePath:data.assets+'core',langPath:data.assets+'langs',workerBlobURL:false,cacheMethod:'none',gzip:true,logger:progress=>scope.postMessage({id:current,progress}),errorHandler:error=>scope.postMessage({id:current,error:String(error)})});
    await engine.setParameters({tessedit_pageseg_mode:({auto:PSM.AUTO,column:PSM.SINGLE_COLUMN,block:PSM.SINGLE_BLOCK,sparse:PSM.SPARSE_TEXT}as const)[data.layout as 'auto'|'column'|'block'|'sparse']||PSM.AUTO,preserve_interword_spaces:'1'});scope.postMessage({id:data.id,result:{ready:true}});
  }else if(data.type==='skew'){
    if(!engine)throw new Error('El motor OCR no está preparado.');
    const result=await engine.recognize(data.image as any,{rotateAuto:true,user_defined_dpi:String(data.dpi)}as any,{text:false,blocks:false,pdf:false});
    scope.postMessage({id:data.id,result:{radians:result.data.rotateRadians||0}});
  }else if(data.type==='recognize'){
    if(!engine)throw new Error('El motor OCR no está preparado.');
    const result=await engine.recognize(data.image as any,{pdfTextOnly:true,rotateAuto:false,rotateRadians:0,user_defined_dpi:String(data.dpi)}as any,{text:true,pdf:true,blocks:true});
    const lines=(result.data.blocks||[]).flatMap(block=>block.paragraphs||[]).flatMap(paragraph=>paragraph.lines||[]).map(line=>(line.words||[]).map(word=>({text:word.text,confidence:word.confidence,baseline:line.baseline?[line.baseline.x0,line.baseline.y0,line.baseline.x1,line.baseline.y1]:undefined,box:[word.bbox.x0,word.bbox.y0,word.bbox.x1,word.bbox.y1]})));
    const pdf=new Uint8Array(result.data.pdf||[]),text=result.data.text||'',confidence=Math.max(0,Math.min(100,result.data.confidence||0));scope.postMessage({id:data.id,result:{pdf,text,confidence,lines,engineLayout:result.data.psm}},[pdf.buffer as ArrayBuffer]);
  }else throw new Error('Solicitud OCR no compatible.');
}catch(error){scope.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});}};
