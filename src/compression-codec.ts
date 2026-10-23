export async function transcodeImage(image:any){
  let bitmap:ImageBitmap|undefined,source:OffscreenCanvas|undefined;
  const target=new OffscreenCanvas(image.targetWidth,image.targetHeight),ctx=target.getContext('2d',{alpha:false});if(!ctx)throw new Error('No se pudo iniciar el conversor de imágenes.');
  try{
    if(image.jpeg){bitmap=await createImageBitmap(new Blob([image.data],{type:'image/jpeg'}),{imageOrientation:'none',colorSpaceConversion:'none'});if(bitmap.width!==image.width||bitmap.height!==image.height)throw new Error('Dimensiones JPEG incompatibles');}
    else{source=new OffscreenCanvas(image.width,image.height);const pixels=new Uint8ClampedArray(image.width*image.height*4);for(let n=0;n<image.width*image.height;n++){const offset=n*image.channels;pixels[n*4]=image.data[offset];pixels[n*4+1]=image.data[offset+(image.channels===1?0:1)];pixels[n*4+2]=image.data[offset+(image.channels===1?0:2)];pixels[n*4+3]=255;}source.getContext('2d')!.putImageData(new ImageData(pixels,image.width,image.height),0,0);}
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap||source!,0,0,image.targetWidth,image.targetHeight);const blob=await target.convertToBlob({type:'image/jpeg',quality:image.quality});if(blob.type!=='image/jpeg')throw new Error('El conversor no produjo JPEG');return new Uint8Array(await blob.arrayBuffer());
  }finally{bitmap?.close();target.width=target.height=1;if(source)source.width=source.height=1;}
}
