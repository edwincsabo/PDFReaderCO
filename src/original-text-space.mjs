import{textFit}from'./original-text-lines.mjs';
const valid=b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[2]>=b[0]&&b[3]>=b[1];
export const textFitMessage=fit=>fit.fits?(fit.expanded?'El texto cabe ampliando el área al espacio libre, sin reducir el tamaño.':'El texto cabe en el área original.'):(fit.expansionReason||'El texto supera el área original.');
export const containsBox=(a,b,pad=.02)=>b[0]>=a[0]-pad&&b[1]>=a[1]-pad&&b[2]<=a[2]+pad&&b[3]<=a[3]+pad;
const intersection=(a,b)=>{const box=[Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])];return box[2]-box[0]>.02&&box[3]-box[1]>.02?box:null;};
export function expandedTextFit(area,bounds,size,context,indices=[],enabled=false){
  const fit={...textFit(area,bounds,size),originalArea:[...area],expansionEnabled:enabled,expanded:false};if(!fit.fits)fit.blocker={kind:'area',bounds:area,suggestion:'Activa la expansión al espacio libre, amplía el área, acorta el texto o reduce el tamaño.'};
  if(!enabled||containsBox(area,bounds))return fit;
  const reject=(reason,blocker)=>({...fit,fits:false,expansionReason:reason,blocker});
  if(!valid(bounds)||!valid(context?.pageBox)||context.unknown)return reject('No se pudo comprobar todo el espacio vecino. Conserva el área original o revisa un desbordamiento explícito.');
  if(!containsBox(context.pageBox,bounds,.01))return reject('El texto alcanzaría el borde visible de la página o del grupo.',{kind:'page',bounds:context.pageBox,suggestion:'Mueve la selección hacia el interior, acorta el texto o reduce el tamaño.'});
  const selected=new Set(indices),first=Math.min(...indices);
  for(const other of context.objects||[]){
    if(selected.has(other.index)||other.hidden)continue;
    if(!valid(other.bounds))return reject('Un objeto vecino no tiene límites comprobables.');
    const overlap=intersection(bounds,other.bounds);if(!overlap||containsBox(area,overlap))continue;
    // A simple filled rectangle or image already behind the selection is its
    // background, not a neighbor. Its boundary still limits automatic growth.
    if(other.background&&other.index<first&&containsBox(other.bounds,area)){
      if(containsBox(other.bounds,bounds))continue;
      return reject('El texto alcanzaría el límite de su fondo o recuadro.',{kind:'background',bounds:other.bounds,index:other.index,suggestion:'Mantén el texto dentro del recuadro, acórtalo o reduce el tamaño.'});
    }
    return reject('No hay espacio libre suficiente: el texto se superpondría a otro objeto.',{kind:other.type==='annotation'?'annotation':'object',bounds:other.bounds,index:other.index,suggestion:'Mueve la selección o el objeto señalado, acorta el texto o reduce el tamaño.'});
  }
  const expanded=[Math.min(area[0],bounds[0]),Math.min(area[1],bounds[1]),Math.max(area[2],bounds[2]),Math.max(area[3],bounds[3])];
  return{...textFit(expanded,bounds,size),originalArea:[...area],expansionEnabled:true,expanded:true};
}
export function createTextSpace({api,memory,allocated,floats}){
  function strokeBoxes(object,nativeBounds){
    const mode=allocated(8,p=>api.FPDFPath_GetDrawMode(object,p,p+4)?[memory.HEAP32[p/4],memory.HEAP32[p/4+1]]:null),count=api.FPDFPath_CountSegments(object);
    if(!mode||mode[0]||!mode[1]||count<2||count>2000)return null;
    const matrix=floats(p=>api.FPDFPageObj_GetMatrix(object,p),6),width=floats(p=>api.FPDFPageObj_GetStrokeWidth(object,p),1)[0],padding=Math.max(.25,width)*Math.hypot(...matrix.slice(0,4))+.05,boxes=[];let previous=null,start=null;
    const segment=(a,b)=>boxes.push([Math.min(a[0],b[0])-padding,Math.min(a[1],b[1])-padding,Math.max(a[0],b[0])+padding,Math.max(a[1],b[1])+padding]);
    for(let i=0;i<count;i++){const item=api.FPDFPath_GetPathSegment(object,i),type=api.FPDFPathSegment_GetType(item);if(![0,2].includes(type))return null;const[x,y]=floats(p=>api.FPDFPathSegment_GetPoint(item,p,p+4),2),point=[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]];if(type===2){previous=start=point;}else{if(!previous)return null;segment(previous,point);previous=point;}if(api.FPDFPathSegment_GetClose(item)){if(previous&&start)segment(previous,start);previous=start;}}
    if(!boxes.length)return null;const union=[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))];
    // Keep the conservative full bound if joins or unknown painting effects
    // extend beyond the line segments we can account for.
    return containsBox(union,nativeBounds,.1)?boxes:null;
  }
  function rectangle(object){
    const count=api.FPDFPath_CountSegments(object);if(count<4||count>5)return false;
    const filled=allocated(8,p=>api.FPDFPath_GetDrawMode(object,p,p+4)&&memory.HEAP32[p/4]>0);if(!filled)return false;
    const points=[];let closed=false;for(let i=0;i<count;i++){const segment=api.FPDFPath_GetPathSegment(object,i);if(![0,2].includes(api.FPDFPathSegment_GetType(segment)))return false;points.push(floats(p=>api.FPDFPathSegment_GetPoint(segment,p,p+4),2));closed||=!!api.FPDFPathSegment_GetClose(segment);}
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);return closed&&maxX>minX&&maxY>minY&&points.every(([x,y])=>(Math.abs(x-minX)<.01||Math.abs(x-maxX)<.01)&&(Math.abs(y-minY)<.01||Math.abs(y-maxY)<.01));
  }
  return page=>{
    const box=method=>allocated(16,p=>method(page,p,p+4,p+8,p+12)?Array.from(memory.HEAPF32.slice(p/4,p/4+4)):null),media=box(api.FPDFPage_GetMediaBox),crop=box(api.FPDFPage_GetCropBox)||media,context={pageBox:media&&crop?[Math.max(media[0],crop[0]),Math.max(media[1],crop[1]),Math.min(media[2],crop[2]),Math.min(media[3],crop[3])]:null,objects:[],unknown:false};
    const count=api.FPDFPage_CountObjects(page);if(count>50000)context.unknown=true;
    for(let index=0;index<Math.min(count,50000);index++){
      const object=api.FPDFPage_GetObject(page,index),type=api.FPDFPageObj_GetType(object);try{
        const active=allocated(4,p=>api.FPDFPageObj_GetIsActive(object,p)?!!memory.HEAPU8[p]:true),hidden=!active||type===1&&api.FPDFTextObj_GetTextRenderMode(object)===3;
        const bounds=floats(p=>api.FPDFPageObj_GetBounds(object,p,p+4,p+8,p+12),4),segments=type===2&&!hidden?strokeBoxes(object,bounds):null;
        if(segments)for(const box of segments)context.objects.push({index,type,hidden,bounds:box,background:false});
        else context.objects.push({index,type,hidden,bounds,background:type===3||type===2&&rectangle(object)});
      }catch{context.unknown=true;}
    }
    const annotations=api.FPDFPage_GetAnnotCount(page);if(annotations<0||annotations>5000)context.unknown=true;
    for(let i=0;i<Math.min(annotations,5000);i++){const annotation=api.FPDFPage_GetAnnot(page,i);if(!annotation){context.unknown=true;continue;}try{const flags=api.FPDFAnnot_GetFlags(annotation);if(flags&3)continue;const r=floats(p=>api.FPDFAnnot_GetRect(annotation,p),4);context.objects.push({index:-i-1,type:'annotation',bounds:[Math.min(r[0],r[2]),Math.min(r[1],r[3]),Math.max(r[0],r[2]),Math.max(r[1],r[3])]});}catch{context.unknown=true;}finally{api.FPDFPage_CloseAnnot(annotation);}}
    return context;
  };
}
