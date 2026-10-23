import { rgb, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix, moveTo, lineTo, stroke, setLineCap, setLineJoin, setLineWidth, setStrokingColor, setGraphicsState } from 'pdf-lib';
import { annotationBox, fontName, textLayout } from './text-layout.mjs';
import { viewToPdf } from './pdf-coordinates.mjs';
import { noteColors } from './note-style.mjs';
import { embedMarkImage } from './image-assets.mjs';
function color(hex){return rgb(...[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255));}
export function safeText(text,font){for(const ch of text)try{font.encodeText(ch);}catch{throw new Error('Este texto incluye caracteres no compatibles con la fuente de exportación. Usa caracteres latinos.');}return text;}
export async function paintAnnotation(page,mark,geometry,fonts){
  const doc=page.doc;
    const {crop,rotation,width,height,unit}=geometry;
    const pos=(x,y)=>{const [px,py]=viewToPdf(x,y,width,height,rotation,crop);return {x:px,y:py};};
    const c=color(mark.color), thickness=mark.size/unit,opacity=mark.opacity??1;
    const bounds=annotationBox(mark,width,height),pivot=pos(bounds.x+bounds.w/2,bounds.y+bounds.h/2),angle=-(mark.rotation||0)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
    page.pushOperators(pushGraphicsState(),concatTransformationMatrix(cos,sin,-sin,cos,pivot.x-cos*pivot.x+sin*pivot.y,pivot.y-sin*pivot.x-cos*pivot.y));
    const corners=[pos(mark.x,mark.y),pos(mark.x+mark.w,mark.y),pos(mark.x+mark.w,mark.y+mark.h),pos(mark.x,mark.y+mark.h)];
    const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y);
    const box={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
    if(mark.tool==='pen'||mark.tool==='signature'&&!mark.image){
      const points=mark.points||[];
      if(points.length>1){const state=page.node.newExtGState('Ink',doc.context.obj({Type:'ExtGState',CA:opacity}));page.pushOperators(setGraphicsState(state),setStrokingColor(c),setLineWidth(thickness),setLineCap(1),setLineJoin(1));for(let i=0;i<points.length;i++){const p=pos(...points[i]);page.pushOperators(i===0?moveTo(p.x,p.y):lineTo(p.x,p.y));}page.pushOperators(stroke());}
    } else if(mark.tool==='text') {
      const size=mark.size/unit,name=fontName(mark);if(!fonts.has(name))fonts.set(name,await doc.embedFont(name));const textFont=fonts.get(name),layout=textLayout(mark,width,height);
      if(mark.stamp){const a=pos(bounds.x,bounds.y),z=pos(bounds.x+bounds.w,bounds.y+bounds.h);page.drawRectangle({x:Math.min(a.x,z.x),y:Math.min(a.y,z.y),width:Math.abs(z.x-a.x),height:Math.abs(z.y-a.y),borderColor:c,borderWidth:1.5/unit,borderOpacity:opacity});}
      layout.lines.forEach(line=>page.drawText(safeText(line.text,textFont),{...pos(mark.x+line.x/width,mark.y+line.y/height),size,font:textFont,color:c,rotate:degrees(rotation),opacity}));
    } else if(mark.tool==='note') {
      const colors=noteColors(mark.color),w=mark.w*width,h=mark.h*height,r=Math.min(3,w/2,h/2);
      const path=`M ${r} 0 H ${w-r} Q ${w} 0 ${w} ${r} V ${h-r} Q ${w} ${h} ${w-r} ${h} H ${r} Q 0 ${h} 0 ${h-r} V ${r} Q 0 0 ${r} 0 Z`;
      page.drawSvgPath(path,{...pos(mark.x,mark.y),scale:1/unit,rotate:degrees(rotation),color:color(colors.fill),borderColor:color(colors.border),borderWidth:1,opacity,borderOpacity:opacity});
      if(!fonts.has('Helvetica'))fonts.set('Helvetica',await doc.embedFont('Helvetica'));
      page.drawText('i',{...pos(mark.x+mark.w*.35,mark.y+mark.h*.75),size:Math.min(w,h)*.7/unit,font:fonts.get('Helvetica'),color:color(colors.ink),rotate:degrees(rotation),opacity});
    } else if(mark.tool==='image'||mark.tool==='signature'&&mark.image) {
      const image=await embedMarkImage(doc,mark.image);
      page.drawImage(image,{...pos(mark.x,mark.y+mark.h),width:mark.w*width/unit,height:mark.h*height/unit,rotate:degrees(rotation),opacity});
    } else if(mark.tool==='underline'||mark.tool==='strike') {
      const y=mark.y+mark.h*(mark.tool==='underline'?1:.5);
      page.drawLine({start:pos(mark.x,y),end:pos(mark.x+mark.w,y),color:c,thickness,opacity});
    } else if(mark.tool==='ellipse')page.drawEllipse({x:box.x+box.width/2,y:box.y+box.height/2,xScale:box.width/2,yScale:box.height/2,borderColor:c,borderWidth:thickness,borderOpacity:opacity,...(mark.fill?{color:color(mark.fill),opacity:(mark.fillOpacity??.3)*opacity}:{})});
    else page.drawRectangle({...box,...(mark.tool==='highlight'?{color:c,opacity:.32*opacity}:{borderColor:c,borderWidth:thickness,borderOpacity:opacity,...(mark.fill?{color:color(mark.fill),opacity:(mark.fillOpacity??.3)*opacity}:{})})});
    page.pushOperators(popGraphicsState());
}
