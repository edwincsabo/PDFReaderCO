import { PDFDocument, StandardFonts } from 'pdf-lib';
import { pointBounds } from './annotation-geometry.mjs';

const metricsDocument=await PDFDocument.create();
const metricFonts=new Map();
for(const name of Object.values(StandardFonts))if(!['Symbol','ZapfDingbats'].includes(name))metricFonts.set(name,await metricsDocument.embedFont(name));

export function fontName(mark) {
  const suffix=mark.bold?(mark.italic?'BoldOblique':'Bold'):(mark.italic?'Oblique':'');
  if(mark.fontFamily==='serif')return mark.bold?(mark.italic?'Times-BoldItalic':'Times-Bold'):(mark.italic?'Times-Italic':'Times-Roman');
  const base=mark.fontFamily==='mono'?'Courier':'Helvetica';
  return suffix?`${base}-${suffix}`:base;
}
export function cssFont(mark) {
  return `${mark.italic?'italic ':''}${mark.bold?'bold ':''}${mark.size}px ${mark.fontFamily==='serif'?'"Times New Roman"':mark.fontFamily==='mono'?'"Courier New"':'Arial'}`;
}
export function textLayout(mark,pageWidth,pageHeight) {
  const font=metricFonts.get(fontName(mark)),lines=String(mark.text||'').split('\n');
  const widths=lines.map(line=>{try{return font.widthOfTextAtSize(line,mark.size);}catch{return line.length*mark.size*.6;}});
  const padding=mark.size*(mark.stamp?.45:.15),width=Math.max(mark.w*pageWidth,...widths.map(w=>w+padding*(mark.stamp?2:1)),mark.size*.4),height=Math.max(mark.h*pageHeight,lines.length*mark.size*1.2+(mark.stamp?padding*2:0));
  return {width,height,lines:lines.map((text,i)=>({text,width:widths[i],x:mark.align==='center'?(width-widths[i])/2:mark.align==='right'?Math.max(0,width-widths[i]-padding):mark.stamp?padding:0,y:mark.size*(i+1)*1.2+(mark.stamp?padding:0)}))};
}
export function annotationBox(mark,pageWidth,pageHeight) {
  if(mark.tool==='text'){const l=textLayout(mark,pageWidth,pageHeight);return {x:mark.x,y:mark.y,w:l.width/pageWidth,h:l.height/pageHeight};}
  if((mark.tool==='pen'||mark.tool==='signature'&&!mark.image)&&mark.points?.length){const b=pointBounds(mark.points),x=Math.min(mark.x,b.x),y=Math.min(mark.y,b.y),w=Math.max(mark.x+mark.w,b.x+b.w)-x,h=Math.max(mark.y+mark.h,b.y+b.h)-y;return {x,y,w:w||1/pageWidth,h:h||1/pageHeight};}
  return {x:mark.x,y:mark.y,w:Math.max(mark.w,1/pageWidth),h:Math.max(mark.h,1/pageHeight)};
}
