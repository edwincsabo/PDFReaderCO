import{wordPolygon,reviewedText}from'./ocr-review.mjs';
const bounds=(w,p)=>{const points=wordPolygon(w,p.geometry,false,p.region),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];};
const overlap=(a,b)=>{const intersection=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));return intersection/Math.max(1e-12,(a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-intersection);};
export function compareOcrReadings(primary,alternative){
  if(primary.page!==alternative.page||!primary.geometry||!alternative.geometry||primary.words?.length>10000||alternative.words?.length>10000)throw new Error('Las lecturas no corresponden a la misma zona o página.');
  if((primary.words?.length||0)*(alternative.words?.length||0)>4000000)throw new Error('La comparación tiene demasiadas palabras. Reconoce una zona más pequeña.');
  const used=new Set(),differences=[];let unmatched=0,matching=0;
  const candidates=(alternative.words||[]).map(w=>({word:w,box:bounds(w,alternative)}));
  for(const word of primary.words||[]){const box=bounds(word,primary);let best=null,score=.3;for(const candidate of candidates){if(used.has(candidate.word.id))continue;const value=overlap(box,candidate.box);if(value>score){score=value;best=candidate.word;}}if(!best){unmatched++;continue;}used.add(best.id);if((word.correction??word.text)===best.text)matching++;else if(best.text.length<=500)differences.push({id:word.id,text:best.text,confidence:best.confidence});}
  unmatched+=candidates.length-used.size;return{version:1,text:reviewedText(alternative),language:alternative.language,layout:alternative.layout||'auto',dpi:alternative.dpi,matching,unmatched,differences};
}
