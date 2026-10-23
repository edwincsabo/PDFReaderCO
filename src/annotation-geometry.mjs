/** Full path bounds without spreading long point arrays onto the call stack. */
export function pointBounds(points){
  if(!points?.length)return null;
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const [x,y]of points){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  const box={x:left,y:top,w:right-left,h:bottom-top};if(!Object.values(box).every(Number.isFinite))throw new Error('Coordenadas de trazo inválidas.');return box;
}
/** Move an annotation in normalized page coordinates, preserving the complete drawing. */
export function translateMark(mark, dx, dy, bounds = mark) {
  const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
  const x = clamp(dx, -bounds.x, 1 - bounds.x - bounds.w);
  const y = clamp(dy, -bounds.y, 1 - bounds.y - bounds.h);
  return {
    ...mark,
    x: mark.x + x,
    y: mark.y + y,
    ...(mark.points ? { points: mark.points.map(([px, py]) => [px + x, py + y]) } : {})
  };
}

export function rotatePoint(x,y,cx,cy,angle,width,height) {
  const r=angle*Math.PI/180,c=Math.cos(r),s=Math.sin(r),dx=(x-cx)*width,dy=(y-cy)*height;
  return [cx+(dx*c-dy*s)/width,cy+(dx*s+dy*c)/height];
}
export function rotatedBounds(box,angle,width,height) {
  const cx=box.x+box.w/2,cy=box.y+box.h/2;
  const corners=[[box.x,box.y],[box.x+box.w,box.y],[box.x+box.w,box.y+box.h],[box.x,box.y+box.h]].map(([x,y])=>rotatePoint(x,y,cx,cy,angle||0,width,height));
  const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]);return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
}
export function unionBounds(boxes) {
  const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y};
}
export function translateMarks(marks,dx,dy,bounds) {
  const offset=translateMark({x:0,y:0},dx,dy,bounds);
  return marks.map(mark=>({...mark,x:mark.x+offset.x,y:mark.y+offset.y,...(mark.points?{points:mark.points.map(([x,y])=>[x+offset.x,y+offset.y])}:{})}));
}
export function resizeMark(mark,box,rect,width,height) {
  const sx=rect.w/box.w,sy=rect.h/box.h;
  const [cx,cy]=rotatePoint(rect.x+rect.w/2,rect.y+rect.h/2,box.x+box.w/2,box.y+box.h/2,mark.rotation||0,width,height);
  const x=cx-rect.w/2,y=cy-rect.h/2;
  return {...mark,x:x+(mark.x-box.x)*sx,y:y+(mark.y-box.y)*sy,w:rect.w,h:rect.h,
    ...(mark.tool==='text'?{size:Math.max(1,Math.min(200,mark.size*Math.min(sx,sy)))}:{}),
    ...(mark.points?{points:mark.points.map(([px,py])=>[x+(px-box.x)*sx,y+(py-box.y)*sy])}:{})};
}
