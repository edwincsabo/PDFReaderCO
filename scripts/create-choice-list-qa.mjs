import {mkdir,writeFile} from 'node:fs/promises';
import {PDFDocument,PDFName,PDFNumber,degrees} from 'pdf-lib';
import {designForm,getFields,exportPdf} from '../src/pdf-engine.mjs';

const doc=await PDFDocument.create();
for(const rotation of[0,90,180,270]){const page=doc.addPage([600,800]);page.setCropBox(20,30,500,700);page.setRotation(degrees(rotation));page.node.set(PDFName.of('UserUnit'),PDFNumber.of(2));}
doc.addPage([600,800]).drawText('Selección al final de una lista extensa',{x:40,y:750,size:18});let bytes=await doc.save();
for(let page=1;page<=5;page++){
  const created=await designForm(bytes,{}, {action:'create',kind:'list',page,rect:{x:.15,y:.2,w:.5,h:.2}}),field=(await getFields(created.bytes)).find(f=>f.id===created.selectedId);
  const options=page===5?Array.from({length:24},(_,i)=>'Opción '+String(i+1).padStart(2,'0')+' con una descripción extensa que debe ocupar una sola fila'):['Lectura','Revisión','Entrega'];
  bytes=(await designForm(created.bytes,{}, {action:'properties',id:created.selectedId,props:{...field.design,name:'Lista_'+page,multiple:page!==5,options,defaultValue:page===5?[options[22]]:['Lectura','Entrega'],fontSize:16,rule:null}})).bytes;
}
await mkdir('tmp/pdfs',{recursive:true});await writeFile('tmp/pdfs/listas-qa-1.25.0.pdf',await exportPdf(bytes,{marks:[],forms:{}}));
console.log('Creada muestra sintética: cuatro rotaciones con UserUnit 2 y selección tardía con texto extenso.');
