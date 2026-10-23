import{digitalTextRegions,ocrRegion,regionsIntersect}from'./ocr-region.mjs';
function subtract(a,b){
  if(!regionsIntersect(a,b))return[a];const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.w,b.x+b.w),bottom=Math.min(a.y+a.h,b.y+b.h);
  return[{...a,h:y-a.y},{...a,y:bottom,h:a.y+a.h-bottom},{...a,y,h:bottom-y,w:x-a.x},{...a,x:right,y,h:bottom-y,w:a.x+a.w-right}].filter(r=>r.w>=.02&&r.h>=.02);
}
export function proposeOcrRegions(page,images,content,viewport,existing=[]){
  const digital=digitalTextRegions(content,viewport);if(!digital)throw new Error('No se puede delimitar el texto digital de esta página. Dibuja las zonas manualmente.');
  let out=[];for(const image of images){const r=image.rect;if(!r)continue;const x=Math.max(0,r.x),y=Math.max(0,r.y),w=Math.min(1,r.x+r.w)-x,h=Math.min(1,r.y+r.h)-y;if(w<.02||h<.02||w*h<.01)continue;let pieces=[{page,x,y,w,h}];for(const box of[...digital,...existing,...out]){pieces=pieces.flatMap(p=>subtract(p,box));if(pieces.length>1000)throw new Error('La página produce demasiadas zonas. Selecciona las áreas manualmente.');}out.push(...pieces);}
  out=out.filter(r=>r.w*r.h>=.003).sort((a,b)=>Math.abs(a.y-b.y)<.01?a.x-b.x:a.y-b.y);if(out.length>50)throw new Error('La página produce más de cincuenta zonas. Selecciona las áreas manualmente.');return out.map(ocrRegion);
}
