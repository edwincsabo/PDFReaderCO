export function viewportBox(viewport,bounds){
  const points=[[bounds[0],bounds[1]],[bounds[0],bounds[3]],[bounds[2],bounds[1]],[bounds[2],bounds[3]]].map(([x,y])=>viewport.convertToViewportPoint(x,y)),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
}
export function textBaseline(viewport,matrix){const a=viewport.convertToViewportPoint(matrix[4],matrix[5]),b=viewport.convertToViewportPoint(matrix[4]+matrix[0],matrix[5]+matrix[1]),size=Math.hypot(b[0]-a[0],b[1]-a[1]);if(Math.abs(b[1]-a[1])<size*.0001)return {axis:'y',value:a[1]};if(Math.abs(b[0]-a[0])<size*.0001)return {axis:'x',value:a[0]};return null;}
const anchors=(box,axis,baseline)=>[...(baseline?.axis===axis?[{type:'baseline',value:baseline.value}]:[]),...['start','center','end'].map((type,i)=>({type,value:(axis==='x'?box.x:box.y)+(axis==='x'?box.w:box.h)*i/2}))];
export function snapOriginalMove(box,baseline,dx,dy,neighbors,width,height,enabled=true,tolerance=5){
  if(![box.x,box.y,box.w,box.h,dx,dy,width,height].every(Number.isFinite)||box.w>width+.01||box.h>height+.01)return {dx:0,dy:0,guides:[]};
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v)),offset={x:clamp(dx,-box.x,width-box.x-box.w),y:clamp(dy,-box.y,height-box.y-box.h)},guides=[];
  if(enabled)for(const axis of ['x','y']){
    let nearest=null;
    for(const neighbor of neighbors)for(const a of anchors(box,axis,baseline))for(const b of anchors(neighbor.box,axis,neighbor.baseline)){
      if(a.type!==b.type)continue;const delta=b.value-a.value,correction=Math.abs(delta-offset[axis]),start=(axis==='x'?box.x:box.y)+delta,end=start+(axis==='x'?box.w:box.h),limit=axis==='x'?width:height;
      if(correction<=tolerance&&start>=-.001&&end<=limit+.001&&(!nearest||correction<nearest.correction))nearest={delta,correction,value:b.value,box:neighbor.box};
    }
    if(nearest){offset[axis]=nearest.delta;guides.push({axis,value:nearest.value,neighbor:nearest.box});}
  }
  return {dx:offset.x,dy:offset.y,guides};
}
export function pdfMoveDelta(viewport,dx,dy){const a=viewport.convertToPdfPoint(0,0),b=viewport.convertToPdfPoint(dx,dy);return {dx:b[0]-a[0],dy:b[1]-a[1]};}
