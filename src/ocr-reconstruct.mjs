import{PDFDocument,StandardFonts,rgb,pushGraphicsState,popGraphicsState,concatTransformationMatrix}from'pdf-lib';
import{inspectOcrSource}from'./ocr-engine.mjs';
import{reviewError}from'./ocr-review.mjs';
import{ocrEntryId}from'./ocr-jobs.mjs';
export async function reconstructOcr(bytes,report,selected){
  const source=await inspectOcrSource(bytes);if(source.source!==report?.source||!Array.isArray(selected)||!selected.length||selected.length>50||new Set(selected).size!==selected.length)throw new Error('La selección de texto OCR cambió o no es válida.');
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
  for(const id of selected){const item=report.pages.find(p=>ocrEntryId(p)===id),info=source.pages[(item?.page||0)-1];if(!info||item.status!=='recognized'||!item.reviewable||!item.geometry)throw new Error('La copia editable necesita palabras posicionadas y revisables.');const error=reviewError(item);if(error)throw new Error(error);
    const g=item.geometry,area=info.width*info.height*(item.region?.w||1)*(item.region?.h||1),ratio=g.processedWidth/g.processedHeight,width=Math.sqrt(area*ratio),height=width/ratio,p=doc.addPage([width,height]);
    for(const word of item.words){const text=word.correction??word.text;if(!text)continue;try{font.encodeText(text);}catch{throw new Error('La copia editable usa una fuente latina. Corrige los caracteres no representables o conserva el PDF con su capa invisible.');}const[x0,y0,x1,y1]=word.box,size=Math.max(.1,(y1-y0)*height),advance=font.widthOfTextAtSize(text,size),boxWidth=(x1-x0)*width;if(!(advance>0)||!(boxWidth>0))continue;
      p.pushOperators(pushGraphicsState(),concatTransformationMatrix(boxWidth/advance,0,0,1,x0*width,(1-y1)*height));p.drawText(text,{x:0,y:size*.12,size,font,color:rgb(0,0,0)});p.pushOperators(popGraphicsState());
    }
  }
  doc.setTitle('Texto reconstruido mediante OCR');doc.setProducer('PDFReaderCO · OCR local · Copia de texto editable');return doc.save({updateFieldAppearances:false});
}
