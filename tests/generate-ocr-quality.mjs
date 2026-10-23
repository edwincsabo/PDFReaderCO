import{PDFDocument,StandardFonts,rgb}from'pdf-lib';
import{mkdir,writeFile}from'node:fs/promises';
const root='tests/fixtures/ocr-quality';await mkdir(root,{recursive:true});const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),cases=[];
function page(name,layout,lines,{contrast=false}={}){const p=doc.addPage([600,800]);for(const line of lines)p.drawText(line.text,{x:line.x,y:line.y,size:line.size||15,font:line.bold?bold:font,color:contrast?rgb(.75,.75,.75):rgb(.05,.05,.05)});cases.push({name,layout,contrast,image:`page-${cases.length+1}.png`,reference:lines.map(l=>l.text).join('\n')});return p;}
page('Una columna: factura en español','column',[
  {text:'FACTURA DE SERVICIOS',x:45,y:735,bold:true,size:20},
  ...['Cliente: Ana Morales','Factura: 83415','Fecha: 18/10/2026','Ciudad: Bogotá','Importe total: 420,75 pesos','El pingüino llegó a tiempo.'].map((text,i)=>({text,x:45,y:670-i*45}))
]);
page('Dos columnas: lectura por bloques','auto',[
  ...['CLIENTE','Nombre: Laura Torres','Referencia: 70214','Cantidad: 24','Estado: recibido'].map((text,i)=>({text,x:35,y:725-i*55,bold:i===0})),
  ...['PROVEEDOR','Nombre: Juan Rivera','Orden: 76028','Valor: 850,50','Estado: aprobado'].map((text,i)=>({text,x:335,y:725-i*55,bold:i===0}))
]).drawLine({start:{x:300,y:440},end:{x:300,y:760},thickness:1,color:rgb(.5,.5,.5)});
page('Bloque de bajo contraste','block',[
  ...['INFORME DE REVISION','Responsable: Maria Lopez','Saldo disponible: 4580,20','Referencia: A-72051','Entrega prevista: 24/10/2026','Observacion: pago recibido.'].map((text,i)=>({text,x:55,y:710-i*30,bold:i===0}))
],{contrast:true});
page('Formulario con texto disperso','sparse',[
  {text:'CONTROL DE ENTREGA',x:45,y:730,bold:true,size:20},{text:'Pedido 70214',x:45,y:610},{text:'Recibido 18/10/2026',x:310,y:520},{text:'Cantidad 24',x:70,y:350},{text:'APROBADO',x:350,y:190,bold:true}
]);
await writeFile(root+'/source.pdf',await doc.save());await writeFile(root+'/reference.json',JSON.stringify(cases,null,2));console.log('Cuatro controles sintéticos de diseño OCR creados.');
