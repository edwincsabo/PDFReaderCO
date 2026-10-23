import{perspectiveMatrix,projectPoint}from'./ocr-perspective.mjs';
import{regionPoint}from'./ocr-region.mjs';

export function rotationGeometry(width,height,degrees=0){

  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>6000||height>6000||width*height>16000000||!Number.isFinite(degrees)||Math.abs(degrees)>275||Math.abs(degrees-Math.round(degrees/90)*90)>5)throw new Error('Geometría de análisis OCR inválida.');

  const angle=degrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),processedWidth=degrees?Math.ceil(Math.abs(c)*width+Math.abs(s)*height-1e-8):width,processedHeight=degrees?Math.ceil(Math.abs(s)*width+Math.abs(c)*height-1e-8):height;

  if(processedWidth>6000||processedHeight>6000||processedWidth*processedHeight>16000000)throw new Error('La imagen enderezada supera el límite. Reduce la resolución.');

  return{width,height,processedWidth,processedHeight,degrees};

}

export function reviewPoint(x,y,g){

  const angle=g.degrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),px=x*g.processedWidth-g.processedWidth/2,py=y*g.processedHeight-g.processedHeight/2;

  const point=[(c*px+s*py+g.width/2)/g.width,(-s*px+c*py+g.height/2)/g.height];return g.perspective?projectPoint(...point,perspectiveMatrix(g.perspective)):point;

}

/** @param {any} region */

export const wordPolygon=(word,g,analyzed=false,region=null)=>{const[x0,y0,x1,y1]=word.box;return[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(p=>analyzed?p:regionPoint(...reviewPoint(...p,g),region));};

export function normalizeOcrWords(text,lines,width,height){

  if(!Array.isArray(lines)||lines.length>10000)return{words:[],reviewable:false};

  const words=[];let cursor=0,lineId=0;

  for(const line of lines){if(!Array.isArray(line))return{words:[],reviewable:false};for(const raw of line){

    if(words.length>=10000||typeof raw.text!=='string'||!raw.text.trim()||!Array.isArray(raw.box)||raw.box.length!==4||!raw.box.every(Number.isFinite))return{words:[],reviewable:false};

    const start=text.indexOf(raw.text,cursor),[x0,y0,x1,y1]=raw.box;if(start<cursor||text.slice(cursor,start).trim()||x0<0||y0<0||x1>width+1||y1>height+1||x1<=x0||y1<=y0)return{words:[],reviewable:false};

    words.push({id:words.length,line:lineId,start,length:raw.text.length,text:raw.text,confidence:Math.max(0,Math.min(100,Number(raw.confidence)||0)),box:[x0/width,y0/height,x1/width,y1/height],...(Array.isArray(raw.baseline)&&raw.baseline.length===4&&raw.baseline.every(Number.isFinite)?{baseline:raw.baseline.map((v,i)=>v/(i%2?height:width))}:{})});cursor=start+raw.text.length;

  }lineId++;}

  return{words:!text.slice(cursor).trim()?words:[],reviewable:words.length>0&&!text.slice(cursor).trim()};

}

export function correctionError(text){return typeof text!=='string'||text.length>500||/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(text)||Array.from(text).some(c=>c.codePointAt(0)>65535)?'La corrección admite hasta 500 caracteres de una línea, sin controles ni caracteres fuera del plano Unicode básico.':'';}

export function reviewedText(page){

  let text=page.text;for(const word of [...(page.words||[])].reverse())if(word.correction!==undefined)text=text.slice(0,word.start)+word.correction+text.slice(word.start+word.length);return text;

}

export function reviewError(page){

  let last=0;const ids=new Set();

  if(!Array.isArray(page.words)||page.words.length>10000)throw new Error('Palabras OCR no compatibles.');

  for(const word of page.words){if(!Number.isInteger(word.id)||ids.has(word.id)||!Number.isInteger(word.start)||word.start<last||page.text.slice(last,word.start).trim()||!Number.isInteger(word.length)||word.length<1||page.text.slice(word.start,word.start+word.length)!==word.text||!Number.isInteger(word.line)||word.line<0||!Number.isFinite(word.confidence)||word.confidence<0||word.confidence>100||!Array.isArray(word.box)||word.box.length!==4||word.box.some(v=>!Number.isFinite(v)||v<0||v>1.001)||word.box[2]<=word.box[0]||word.box[3]<=word.box[1])throw new Error('La posición de una palabra OCR no es válida.');if(word.baseline&&(!Array.isArray(word.baseline)||word.baseline.length!==4||word.baseline.some(v=>!Number.isFinite(v)||v<0||v>1.001)))throw new Error('La línea base OCR no es válida.');ids.add(word.id);last=word.start+word.length;if(word.correction!==undefined&&correctionError(word.correction))return correctionError(word.correction);}

  if(page.text.slice(last).trim())throw new Error('Falta texto sin posicionar; no se puede corregir esta capa.');

  return reviewedText(page).length>100000?'La página corregida supera cien mil caracteres.':'';

}

