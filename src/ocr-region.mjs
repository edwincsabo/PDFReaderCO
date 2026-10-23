// Regions use the displayed CropBox, after page rotation, with origin at top left.
export function ocrRegion(value){
  if(!value||!Number.isInteger(value.page)||value.page<1||!['x','y','w','h'].every(k=>Number.isFinite(value[k]))||value.x<0||value.y<0||value.w<.02||value.h<.02||value.x+value.w>1.0000001||value.y+value.h>1.0000001)throw new Error('Dibuja una zona OCR válida dentro de la página, de al menos un 2 % por lado.');
  return{page:value.page,x:value.x,y:value.y,w:Math.min(value.w,1-value.x),h:Math.min(value.h,1-value.y)};
}
export const regionsIntersect=(a,b,pad=0)=>a.x<b.x+b.w+pad-1e-8&&a.x+a.w>b.x-pad+1e-8&&a.y<b.y+b.h+pad-1e-8&&a.y+a.h>b.y-pad+1e-8;
export const regionPoint=(x,y,region)=>region?[region.x+x*region.w,region.y+y*region.h]:[x,y];
const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
export function digitalTextRegions(content,viewport){
  const boxes=[];
  const scale=Math.hypot(viewport.transform[0],viewport.transform[1]);
  for(const item of content.items){
    if(typeof item.str!=='string'||!item.str.trim())continue;
    if(!Array.isArray(item.transform)||item.transform.length!==6||!item.transform.every(Number.isFinite)||!Number.isFinite(item.width))return null;
    const t=multiply(viewport.transform,item.transform),length=Math.hypot(t[0],t[1]),style=content.styles?.[item.fontName]||{};
    if(!length||style.vertical)return null; // Conservative for text we cannot bound reliably.
    const advance=item.width*scale,ascent=Number.isFinite(style.ascent)?style.ascent:1,descent=Number.isFinite(style.descent)?style.descent:-.3;
    const points=[descent,ascent].flatMap(h=>[0,advance].map(w=>[t[4]+t[0]/length*w+t[2]*h,t[5]+t[1]/length*w+t[3]*h]));
    const xs=points.map(p=>p[0]/viewport.width),ys=points.map(p=>p[1]/viewport.height),box={x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
    const pad=Math.max(2/viewport.width,2/viewport.height);boxes.push({x:Math.max(0,box.x-pad),y:Math.max(0,box.y-pad),w:box.w+pad*2,h:box.h+pad*2});
  }
  return boxes;
}
export function regionTextConflict(region,content,viewport){const boxes=digitalTextRegions(content,viewport);return !boxes||boxes.some(box=>regionsIntersect(region,box));}

