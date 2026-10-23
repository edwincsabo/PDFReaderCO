export function selectionRects(rects,page){
  const clipped=rects.map(r=>{const x=Math.max(page.left,r.left),y=Math.max(page.top,r.top),right=Math.min(page.right,r.right),bottom=Math.min(page.bottom,r.bottom);return {x,y,w:right-x,h:bottom-y};}).filter(r=>r.w>1&&r.h>1).sort((a,b)=>a.y-b.y||a.x-b.x);
  const rows=[];
  for(const r of clipped){const previous=rows[rows.length-1];if(previous&&Math.abs(previous.y-r.y)<Math.min(previous.h,r.h)*.4&&r.x<=previous.x+previous.w+3){previous.w=Math.max(previous.x+previous.w,r.x+r.w)-previous.x;previous.h=Math.max(previous.h,r.h);}else rows.push({...r});}
  return rows.map(r=>({x:(r.x-page.left)/page.width,y:(r.y-page.top)/page.height,w:r.w/page.width,h:r.h/page.height}));
}
