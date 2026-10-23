export function perspectiveQuad(value){
  if(!Array.isArray(value)||value.length!==8||value.some(n=>!Number.isFinite(n)||n<0||n>1))throw new Error('Selecciona cuatro esquinas dentro de la fotografía.');
  const p=Array.from({length:4},(_,i)=>value.slice(i*2,i*2+2));let area=0;for(let i=0;i<4;i++){const a=p[i],b=p[(i+1)%4],c=p[(i+2)%4],cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);if(cross<.002)throw new Error('Las esquinas deben formar un cuadrilátero convexo, en orden, sin cruzarse.');area+=a[0]*b[1]-a[1]*b[0];}if(area/2<.05)throw new Error('La fotografía seleccionada es demasiado pequeña.');return [...value];
}
// Homography from the normalized rectified image into the source quadrilateral.
export function perspectiveMatrix(value){
  const[x0,y0,x1,y1,x2,y2,x3,y3]=perspectiveQuad(value),dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3,det=dx1*dy2-dx2*dy1;
  if(Math.abs(det)<1e-8)throw new Error('La perspectiva no se puede invertir.');const g=(dx3*dy2-dx2*dy3)/det,h=(dx1*dy3-dx3*dy1)/det;return[x1-x0+g*x1,x3-x0+h*x3,x0,y1-y0+g*y1,y3-y0+h*y3,y0,g,h,1];
}
export const projectPoint=(x,y,m)=>{const d=m[6]*x+m[7]*y+1;if(Math.abs(d)<1e-8)throw new Error('Perspectiva singular.');return[(m[0]*x+m[1]*y+m[2])/d,(m[3]*x+m[4]*y+m[5])/d];};
export function rectifyOcrPixels(rgba,width,height,quad){
  const m=perspectiveMatrix(quad),out=new Uint8ClampedArray(rgba.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const[u,v]=projectPoint(x/Math.max(1,width-1),y/Math.max(1,height-1),m),sx=Math.max(0,Math.min(width-1,u*(width-1))),sy=Math.max(0,Math.min(height-1,v*(height-1))),x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),fx=sx-x0,fy=sy-y0,at=(y*width+x)*4;for(let c=0;c<3;c++)out[at+c]=(rgba[(y0*width+x0)*4+c]*(1-fx)+rgba[(y0*width+x1)*4+c]*fx)*(1-fy)+(rgba[(y1*width+x0)*4+c]*(1-fx)+rgba[(y1*width+x1)*4+c]*fx)*fy;out[at+3]=255;}
  return out;
}
