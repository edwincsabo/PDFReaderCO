import { PDFName, PDFNumber } from 'pdf-lib';
export function viewToPdf(x,y,width,height,rotation,crop={x:0,y:0,width,height}){
  switch(((rotation%360)+360)%360){case 90:return[crop.x+y*crop.width,crop.y+x*crop.height];case 180:return[crop.x+(1-x)*crop.width,crop.y+y*crop.height];case 270:return[crop.x+(1-y)*crop.width,crop.y+(1-x)*crop.height];default:return[crop.x+x*crop.width,crop.y+(1-y)*crop.height];}
}
export function pdfToView(x,y,geometry){
  const c=geometry.crop,a=(x-c.x)/c.width,b=(y-c.y)/c.height;
  switch(geometry.rotation){case 90:return[b,a];case 180:return[1-a,b];case 270:return[1-b,1-a];default:return[a,1-b];}
}
export function pageGeometry(page){
  const crop=page.getCropBox(),rotation=((page.getRotation().angle%360)+360)%360,unit=page.node.lookupMaybe(PDFName.of('UserUnit'),PDFNumber)?.asNumber()||1;
  if(![0,90,180,270].includes(rotation)||!Number.isFinite(unit)||unit<=0||!Object.values(crop).every(Number.isFinite)||crop.width<=0||crop.height<=0)throw new Error('Geometría de página no compatible.');
  return {crop,rotation,unit,width:(rotation%180?crop.height:crop.width)*unit,height:(rotation%180?crop.width:crop.height)*unit};
}
