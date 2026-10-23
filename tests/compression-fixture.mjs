import {PDFDocument,PDFName,StandardFonts} from 'pdf-lib';
import {designForm,getFields} from '../src/pdf-engine.mjs';
export async function compressionFixture(width=64,height=64){
  const doc=await PDFDocument.create(),page=doc.addPage([600,800]),font=await doc.embedFont(StandardFonts.Helvetica),data=new Uint8Array(width*height*3);let seed=71;
  for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=(seed>>>24);}
  const image=doc.context.flateStream(data,{Type:'XObject',Subtype:'Image',Width:width,Height:height,BitsPerComponent:8,ColorSpace:'DeviceRGB'}),ref=doc.context.register(image);page.node.set(PDFName.of('Resources'),doc.context.obj({XObject:{Picture:ref},Font:{Body:font.ref}}));
  page.drawText('Texto vectorial que permanece seleccionable',{x:40,y:740,size:16,font});page.pushOperators();const contents=doc.context.flateStream('q 480 0 0 320 40 350 cm /Picture Do Q');page.node.addContentStream(doc.context.register(contents));
  doc.setTitle('Compresión verificable');doc.setAuthor('PDFReaderCO');await doc.attach(new Uint8Array([1,2,3,4]),'prueba.bin',{description:'Adjunto conservado'});
  let bytes=await doc.save({useObjectStreams:false});const created=await designForm(bytes,{}, {action:'create',kind:'text',page:1,rect:{x:.2,y:.7,w:.4,h:.06}}),field=(await getFields(created.bytes))[0];bytes=(await designForm(created.bytes,{}, {action:'properties',id:field.id,props:{...field.design,name:'Respuesta',defaultValue:'Valor inicial'}})).bytes;
  return bytes;
}
