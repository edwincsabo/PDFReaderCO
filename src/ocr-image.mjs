// Pixel-only analysis; the PDF raster and its bytes are never modified here.
export function cleanOcrPixels(rgba,width,height,{contrast=false,denoise=false,lighting=false}={}){
  if(!(rgba instanceof Uint8ClampedArray)||rgba.length!==width*height*4||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16000000)throw new Error('Imagen OCR inválida.');
  if(!contrast&&!denoise&&!lighting)return rgba;
  const grey=new Uint8Array(width*height),histogram=new Uint32Array(256);for(let i=0;i<grey.length;i++){const at=i*4,value=Math.round(.299*rgba[at]+.587*rgba[at+1]+.114*rgba[at+2]);grey[i]=value;histogram[value]++;}
  if(lighting){
    const tile=48,cols=Math.ceil(width/tile),rows=Math.ceil(height/tile),background=new Uint8Array(cols*rows),bins=new Uint32Array(256);
    for(let by=0;by<rows;by++)for(let bx=0;bx<cols;bx++){bins.fill(0);let count=0;for(let y=by*tile;y<Math.min(height,(by+1)*tile);y++)for(let x=bx*tile;x<Math.min(width,(bx+1)*tile);x++){bins[grey[y*width+x]]++;count++;}let sum=0,v=0;for(;v<255;v++){sum+=bins[v];if(sum>=count*.9)break;}background[by*cols+bx]=Math.max(32,v);}
    histogram.fill(0);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const gx=x/tile-.5,gy=y/tile-.5,x0=Math.max(0,Math.min(cols-2,Math.floor(gx))),y0=Math.max(0,Math.min(rows-2,Math.floor(gy))),x1=Math.min(cols-1,x0+1),y1=Math.min(rows-1,y0+1),fx=cols>1?gx-x0:0,fy=rows>1?gy-y0:0,bg=(background[y0*cols+x0]*(1-fx)+background[y0*cols+x1]*fx)*(1-fy)+(background[y1*cols+x0]*(1-fx)+background[y1*cols+x1]*fx)*fy,v=Math.min(255,Math.round(grey[y*width+x]*250/Math.max(32,bg)));grey[y*width+x]=v;histogram[v]++;}
  }
  let low=0,high=255;
  if(contrast){const target=Math.max(1,grey.length*.005);let sum=0;for(;low<255;low++){sum+=histogram[low];if(sum>=target)break;}sum=0;for(;high>0;high--){sum+=histogram[high];if(sum>=target)break;}if(high-low<16){low=0;high=255;}}
  const median=new Uint8Array(9);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let value=grey[y*width+x];if(denoise&&x>0&&y>0&&x<width-1&&y<height-1){let n=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)median[n++]=grey[(y+dy)*width+x+dx];median.sort();value=median[4];}
    value=Math.round(Math.max(0,Math.min(255,(value-low)*255/(high-low))));const at=(y*width+x)*4;rgba[at]=rgba[at+1]=rgba[at+2]=value;rgba[at+3]=255;
  }
  return rgba;
}
