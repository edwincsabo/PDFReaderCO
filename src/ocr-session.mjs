import{perspectiveQuad}from'./ocr-perspective.mjs';
import{ocrLanguage}from'./ocr-languages.mjs';
import{ocrRegion}from'./ocr-region.mjs';
import{ocrOptions}from'./ocr-engine.mjs';
import{rotationGeometry}from'./ocr-review.mjs';
import{ocrEntryId}from'./ocr-jobs.mjs';
const RAW_LIMIT=32*1024*1024,PACKED_LIMIT=8*1024*1024,PDF_LIMIT=8*1024*1024,cache=new WeakMap();
const base64=bytes=>{if(cache.has(bytes))return cache.get(bytes);let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));const value=btoa(s);cache.set(bytes,value);return value;};
const unbase64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
export function packedOcrSession(value){return !!value&&value.version===1&&value.encoding==='gzip-base64'&&/^[a-f0-9]{64}$/.test(value.source)&&Number.isSafeInteger(value.rawBytes)&&value.rawBytes>0&&value.rawBytes<=RAW_LIMIT&&typeof value.data==='string'&&value.data.length<=Math.ceil(PACKED_LIMIT/3)*4&&/^[a-zA-Z0-9+/]*={0,2}$/.test(value.data);}
async function transform(bytes,compress,limit){
  const stream=new Blob([bytes]).stream().pipeThrough(compress?new CompressionStream('gzip'):new DecompressionStream('gzip')),reader=stream.getReader(),parts=[];let size=0;
  try{while(true){const{done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('La revisión OCR supera el límite de recuperación. Aplica y guarda, o reconoce menos páginas.');}parts.push(value);}}finally{reader.releaseLock();}
  const result=new Uint8Array(size);let at=0;for(const p of parts){result.set(p,at);at+=p.length;}return result;
}
function validate(value){
  if(!value||value.version!==1||!value.report||!/^[a-f0-9]{64}$/.test(value.report.source)||!Array.isArray(value.report.pages)||!value.report.pages.length||value.report.pages.length>50||!Array.isArray(value.selected)||value.selected.length>50||new Set(value.selected).size!==value.selected.length)throw new Error('La revisión OCR guardada no es compatible.');
  ocrOptions(value.report.options||value.options);ocrOptions(value.options);
  let pdfBytes=0,characters=0;const pages=new Set();
  for(const p of value.report.pages){
    if(!Number.isInteger(ocrEntryId(p))||ocrEntryId(p)<1||!Number.isInteger(p.page)||p.page<1||pages.has(ocrEntryId(p))||!['recognized','existing','empty'].includes(p.status)||typeof p.text!=='string'||p.text.length>100000||typeof p.message!=='string'||p.message.length>3000||!Number.isFinite(p.confidence)||p.confidence<0||p.confidence>100||!ocrLanguage(p.language))throw new Error('Página de revisión OCR inválida.');pages.add(ocrEntryId(p));characters+=p.text.length;
    if(p.comparison&&(p.comparison.version!==1||typeof p.comparison.text!=='string'||p.comparison.text.length>100000||!Array.isArray(p.comparison.differences)||p.comparison.differences.length>10000||p.comparison.differences.some(d=>!Number.isInteger(d.id)||!p.words?.some(w=>w.id===d.id)||typeof d.text!=='string'||d.text.length>500||!Number.isFinite(d.confidence)||d.confidence<0||d.confidence>100)))throw new Error('Comparación OCR inválida.');
    if(p.status==='recognized'){if(!(p.pdf instanceof Uint8Array)||!p.pdf.length||p.pdf.length>4*1024*1024)throw new Error('Capa OCR recuperable inválida.');pdfBytes+=p.pdf.length;}
    if(p.region&&ocrRegion(p.region).page!==p.page)throw new Error('Zona de revisión OCR inválida.');if(p.geometry){if(p.geometry.perspective)perspectiveQuad(p.geometry.perspective);const g=rotationGeometry(p.geometry.width,p.geometry.height,p.geometry.degrees);if(g.processedWidth!==p.geometry.processedWidth||g.processedHeight!==p.geometry.processedHeight)throw new Error('Geometría de revisión OCR inválida.');}
    if(p.words!==undefined){if(!Array.isArray(p.words)||p.words.length>10000)throw new Error('Palabras recuperables inválidas.');let end=0;for(const[i,w]of p.words.entries()){
      if(w.id!==i||!Number.isInteger(w.start)||w.start<end||!Number.isInteger(w.length)||w.length<1||p.text.slice(w.start,w.start+w.length)!==w.text||!Number.isInteger(w.line)||w.line<0||w.line>10000||!Number.isFinite(w.confidence)||w.confidence<0||w.confidence>100||!Array.isArray(w.box)||w.box.length!==4||w.box.some(n=>!Number.isFinite(n)||n<0||n>1.01)||w.correction!==undefined&&(typeof w.correction!=='string'||w.correction.length>500)||w.reviewed!==undefined&&typeof w.reviewed!=='boolean'||w.baseline!==undefined&&(!Array.isArray(w.baseline)||w.baseline.length!==4||w.baseline.some(n=>!Number.isFinite(n)||n<-.1||n>1.1)))throw new Error('Palabra de revisión OCR inválida.');end=w.start+w.length;
    }}
  }
  if(pdfBytes>PDF_LIMIT||characters>1000000)throw new Error('La revisión OCR supera el límite de recuperación. Reconoce menos páginas o aplica y guarda.');
  if(value.selected.some(n=>!value.report.pages.some(p=>ocrEntryId(p)===n&&p.status==='recognized'))||!pages.has(value.current))throw new Error('Selección de revisión OCR inválida.');
  if(value.remaining!==undefined&&(!Array.isArray(value.remaining)||value.remaining.length>50||new Set(value.remaining).size!==value.remaining.length||value.remaining.some(n=>!Number.isInteger(n)||n<1||pages.has(n))||pages.size+value.remaining.length>50))throw new Error('Páginas pendientes OCR inválidas.');
  if(value.pixels!==undefined&&(!Number.isSafeInteger(value.pixels)||value.pixels<0||value.pixels>200000000))throw new Error('Presupuesto OCR inválido.');
  if(value.views){if(typeof value.views!=='object'||Object.keys(value.views).length>50)throw new Error('Vistas OCR inválidas.');for(const[key,v]of Object.entries(value.views)){if(!pages.has(Number(key))||!v||v.chosen!==null&&(!Number.isInteger(v.chosen)||!value.report.pages.find(p=>ocrEntryId(p)===Number(key))?.words?.some(w=>w.id===v.chosen))||!Number.isFinite(v.threshold)||v.threshold<0||v.threshold>100||typeof v.lowOnly!=='boolean'||v.allPending!==undefined&&typeof v.allPending!=='boolean'||![1,1.5,2,3].includes(v.zoom))throw new Error('Vista OCR inválida.');}}
  return value;
}
export async function encodeOcrSession(value){
  if(packedOcrSession(value))return value;validate(value);
  const report={...value.report,pages:value.report.pages.map(p=>{const{pdf,preview,words,...rest}=p,baselines={};for(const w of words||[])if(w.baseline)baselines[w.line]=w.baseline;return{...rest,...(pdf?{pdf:base64(pdf)}:{}),...(words?{baselines,words:words.map(w=>[w.start,w.length,w.line,w.confidence,...w.box,w.correction??null,w.reviewed?1:0])}:{})};})};
  const raw=new TextEncoder().encode(JSON.stringify({...value,report}));if(raw.length>RAW_LIMIT)throw new Error('Los datos de revisión OCR superan 32 MB. Reconoce menos páginas o aplica y guarda.');
  const bytes=await transform(raw,true,PACKED_LIMIT);return{version:1,encoding:'gzip-base64',source:value.report.source,rawBytes:raw.length,data:base64(bytes)};
}
export async function decodeOcrSession(value,expectedSource){
  if(!packedOcrSession(value))throw new Error('El registro de revisión OCR no es compatible.');
  if(expectedSource&&value.source!==expectedSource)throw new Error('El PDF base cambió. La revisión OCR se conserva, pero no puede aplicarse sobre este documento.');
  const raw=await transform(unbase64(value.data),false,RAW_LIMIT);if(raw.length!==value.rawBytes)throw new Error('La revisión OCR está incompleta.');
  const parsed=JSON.parse(new TextDecoder().decode(raw));if(parsed.report?.source!==value.source)throw new Error('La identidad de la revisión OCR no coincide.');
  for(const p of parsed.report.pages||[]){if(p.pdf){if(typeof p.pdf!=='string'||p.pdf.length>Math.ceil(4*1024*1024/3)*4)throw new Error('Capa OCR recuperada demasiado grande.');p.pdf=unbase64(p.pdf);}if(p.words){if(!Array.isArray(p.words)||p.words.length>10000)throw new Error('Palabras OCR inválidas.');p.words=p.words.map((w,id)=>{if(!Array.isArray(w)||w.length!==10)throw new Error('Palabra OCR inválida.');const[start,length,line,confidence,x0,y0,x1,y1,correction,reviewed]=w;return{id,start,length,line,confidence,text:p.text?.slice(start,start+length),box:[x0,y0,x1,y1],...(p.baselines?.[line]?{baseline:p.baselines[line]}:{}),...(correction!==null?{correction}:{}),reviewed:!!reviewed};});}delete p.baselines;}
  return validate(parsed);
}
