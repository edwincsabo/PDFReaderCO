import{init}from'@embedpdf/pdfium';
import{PDFDocument}from'pdf-lib';
import{pageGeometry,pdfToView}from'./pdf-coordinates.mjs';
import{multiply}from'./original-groups.mjs';
import{contentSourceId}from'./original-images.mjs';
export async function createDocumentAnalysis(wasmBinary){
  const api=await init({wasmBinary});api.PDFiumExt_Init();const mem=api.pdfium;
  const use=(size,fn)=>{const ptr=mem._malloc(Math.max(32,size));if(!ptr)throw new Error('No hay memoria para analizar la página.');try{return fn(ptr);}finally{mem._free(ptr);}};
  const matrix=obj=>use(24,p=>{if(!api.FPDFPageObj_GetMatrix(obj,p))throw new Error('Matriz de contenido no compatible.');return Array.from(mem.HEAPF32.slice(p/4,p/4+6));});
  return{async page(bytes,number){
    if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>256*1024*1024||!Number.isInteger(number)||number<1)throw new Error('Página inválida para extraer tablas.');
    const parsed=await PDFDocument.load(bytes.slice(),{updateMetadata:false});if(number>parsed.getPageCount())throw new Error('La página no existe.');const geometry=pageGeometry(parsed.getPage(number-1)),source=await contentSourceId(bytes);
    return use(bytes.length,ptr=>{mem.HEAPU8.set(bytes,ptr);const doc=api.FPDF_LoadMemDocument(ptr,bytes.length,'');if(!doc)throw new Error('La tabla requiere un PDF sin cifrado.');let page=0,text=0;
      try{if(api.EPDF_IsEncrypted(doc))throw new Error('Los PDF cifrados están disponibles solo para lectura.');page=api.FPDF_LoadPage(doc,number-1);if(!page)throw new Error('No se pudo abrir la página.');text=api.FPDFText_LoadPage(page);if(!text)throw new Error('No se pudo leer el texto.');const count=api.FPDFText_CountChars(text);if(count>200000)throw new Error('La página supera doscientos mil caracteres.');const glyphs=[],rules=[];
        for(let i=0;i<count;i++){
          const code=api.FPDFText_GetUnicode(text,i);if(!code||code<32||code>0x10ffff||api.FPDFText_IsGenerated(text,i)===1)continue;
          const box=use(32,p=>api.FPDFText_GetCharBox(text,i,p,p+8,p+16,p+24)?Array.from(mem.HEAPF64.slice(p/8,p/8+4)):null);if(!box?.every(Number.isFinite))continue;
          const points=[[box[0],box[2]],[box[1],box[3]]].map(p=>pdfToView(...p,geometry)),x=Math.min(...points.map(p=>p[0])),y=Math.min(...points.map(p=>p[1])),w=Math.abs(points[1][0]-points[0][0]),h=Math.abs(points[1][1]-points[0][1]);const origin=use(16,p=>api.FPDFText_GetCharOrigin(text,i,p,p+8)?Array.from(mem.HEAPF64.slice(p/8,p/8+2)):null),baseline=origin?pdfToView(...origin,geometry)[1]:y+h;if(w>0&&h>0)glyphs.push({text:String.fromCodePoint(code),x,y,w,h,index:i,baseline});
        }
        let seen=0;
        function paths(parent,world=[1,0,0,1,0,0],depth=0){if(depth>8)return;const n=depth?api.FPDFFormObj_CountObjects(parent):api.FPDFPage_CountObjects(parent);if(n>50000)throw new Error('La página contiene demasiados objetos.');for(let i=0;i<n;i++){if(++seen>100000)throw new Error('La estructura de la página supera el límite.');const obj=depth?api.FPDFFormObj_GetObject(parent,i):api.FPDFPage_GetObject(parent,i),type=api.FPDFPageObj_GetType(obj);if(type===5){paths(obj,multiply(world,matrix(obj)),depth+1);continue;}if(type!==2)continue;const stroke=use(8,p=>api.FPDFPath_GetDrawMode(obj,p,p+4)&&mem.HEAP32[(p+4)/4]);if(!stroke)continue;const local=multiply(world,matrix(obj)),n=api.FPDFPath_CountSegments(obj);if(n>20000)continue;let previous=null,first=null;for(let j=0;j<n;j++){const seg=api.FPDFPath_GetPathSegment(obj,j),kind=api.FPDFPathSegment_GetType(seg),p=use(8,p=>api.FPDFPathSegment_GetPoint(seg,p,p+4)?Array.from(mem.HEAPF32.slice(p/4,p/4+2)):null);if(!p)continue;const v=pdfToView(local[0]*p[0]+local[2]*p[1]+local[4],local[1]*p[0]+local[3]*p[1]+local[5],geometry);if(kind===2)first=v;if(kind===0&&previous&&rules.length<20000)rules.push({x0:previous[0],y0:previous[1],x1:v[0],y1:v[1]});const close=api.FPDFPathSegment_GetClose(seg);if(close&&first&&rules.length<20000)rules.push({x0:v[0],y0:v[1],x1:first[0],y1:first[1]});previous=kind===1||close?null:v;}}}
        paths(page);return{source,page:number,geometry,glyphs,rules};
      }finally{if(text)api.FPDFText_ClosePage(text);if(page)api.FPDF_ClosePage(page);api.FPDF_CloseDocument(doc);}
    });
  }};
}
