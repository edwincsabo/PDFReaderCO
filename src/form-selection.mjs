// Rectangles use visible page coordinates; all geometry operations share a page.
export function formSelectionPlan(fields,ids,operation,delta={}){
  if(!Array.isArray(ids)||!ids.length||ids.length>200||new Set(ids).size!==ids.length)throw new Error('Selecciona entre 1 y 200 campos u opciones diferentes.');
  const selected=ids.map(id=>fields.find(f=>f.id===id));
  if(selected.some(f=>!f))throw new Error('La selección cambió. Selecciona de nuevo los campos.');
  if(new Set(selected.map(f=>f.page)).size!==1)throw new Error('Alinea o mueve campos de una misma página.');
  const first=selected[0],rects=selected.map(f=>({id:f.id,x:f.x,y:f.y,w:f.w,h:f.h}));
  if(operation==='move'){
    if(!Number.isFinite(delta.dx)||!Number.isFinite(delta.dy))throw new Error('Desplazamiento inválido.');
    const dx=Math.max(-Math.min(...rects.map(r=>r.x)),Math.min(1-Math.max(...rects.map(r=>r.x+r.w)),delta.dx));
    const dy=Math.max(-Math.min(...rects.map(r=>r.y)),Math.min(1-Math.max(...rects.map(r=>r.y+r.h)),delta.dy));
    rects.forEach(r=>{r.x+=dx;r.y+=dy;});
  }else if(operation==='distribute-x'||operation==='distribute-y'){
    if(rects.length<3)throw new Error('Selecciona al menos tres campos para distribuir.');
    const axis=operation==='distribute-x'?'x':'y',size=axis==='x'?'w':'h',ordered=[...rects].sort((a,b)=>a[axis]-b[axis]),last=ordered.at(-1);
    const gap=(last[axis]+last[size]-ordered[0][axis]-ordered.reduce((n,r)=>n+r[size],0))/(ordered.length-1);
    if(gap<-.000001)throw new Error('Separa más los extremos para distribuir sin superponer campos.');
    let at=ordered[0][axis];for(const r of ordered){r[axis]=at;at+=r[size]+Math.max(0,gap);}
  }else for(const r of rects){
    if(operation==='left')r.x=first.x;
    else if(operation==='right')r.x=first.x+first.w-r.w;
    else if(operation==='center-x')r.x=first.x+(first.w-r.w)/2;
    else if(operation==='top')r.y=first.y;
    else if(operation==='bottom')r.y=first.y+first.h-r.h;
    else if(operation==='center-y')r.y=first.y+(first.h-r.h)/2;
    else if(operation==='width')r.w=first.w;
    else if(operation==='height')r.h=first.h;
    else if(operation==='size'){r.w=first.w;r.h=first.h;}
    else throw new Error('Operación de selección desconocida.');
  }
  if(rects.some(r=>!['x','y','w','h'].every(k=>Number.isFinite(r[k]))||r.x<-.000001||r.y<-.000001||r.x+r.w>1.000001||r.y+r.h>1.000001))throw new Error('El resultado sale de la página. Cambia la posición o el campo de referencia.');
  return rects.map(({id,...rect})=>({id,rect}));
}
