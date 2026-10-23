const point=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
export function paragraphLocalPoint(draft,x,y){const m=draft.matrix,det=m[0]*m[3]-m[1]*m[2];if(!Number.isFinite(det)||Math.abs(det)<1e-8)throw new Error('La transformación del párrafo no es válida.');x-=m[4];y-=m[5];return[(m[3]*x-m[2]*y)/det,(-m[1]*x+m[0]*y)/det];}
export function paragraphBox(draft,edit){
  const b=draft.bounds,corners=[[b[0],b[1]],[b[0],b[3]],[b[2],b[1]],[b[2],b[3]]].map(p=>paragraphLocalPoint(draft,...p)),left=Math.min(0,...corners.map(p=>p[0])),top=draft.paragraphTop??Math.max(...corners.map(p=>p[1])),x=edit.paragraphOffsetX||0,y=edit.paragraphOffsetY||0,width=edit.paragraphWidth??draft.paragraphWidth,height=edit.paragraphHeight??draft.paragraphHeight;
  return{left:left+x,top:top+y,width,height,points:[[left+x,top+y],[left+x+width,top+y],[left+x+width,top+y-height],[left+x,top+y-height]].map(p=>point(draft.matrix,...p))};
}
export function paragraphOuterBounds(run){const points=paragraphBox(run,run).points;return[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];}
export function resizeParagraph(draft,edit,handle,dx,dy,inside=points=>true){
  if(!['nw','n','ne','e','se','s','sw','w'].includes(handle)||![dx,dy].every(Number.isFinite))throw new Error('Tirador de párrafo no válido.');
  const width=edit.paragraphWidth??draft.paragraphWidth,height=edit.paragraphHeight??draft.paragraphHeight;
  const candidate=t=>{let x=dx*t,y=dy*t,w=width,h=height,ox=edit.paragraphOffsetX||0,oy=edit.paragraphOffsetY||0;
    if(handle.includes('w')){x=Math.max(width-10000,Math.min(width-1,x));w-=x;ox+=x;}if(handle.includes('e'))w=Math.max(1,Math.min(10000,width+x));
    if(handle.includes('n')){y=Math.max(1-height,Math.min(10000-height,y));h+=y;oy+=y;}if(handle.includes('s'))h=Math.max(1,Math.min(10000,height-y));
    return{...edit,paragraphWidth:w,paragraphHeight:h,paragraphOffsetX:ox,paragraphOffsetY:oy,paragraphSpace:true,...(/[ns]/.test(handle)?{paragraphAutoGrow:false}:{})};
  };
  let result=candidate(1);if(inside(paragraphBox(draft,result).points))return result;
  let low=0,high=1;for(let i=0;i<25;i++){const middle=(low+high)/2;if(inside(paragraphBox(draft,candidate(middle)).points))low=middle;else high=middle;}return candidate(low);
}
