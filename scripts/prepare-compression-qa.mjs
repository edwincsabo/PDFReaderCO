import {readFile,writeFile} from 'node:fs/promises';
import {decodeProject,exportPdf} from '../src/pdf-engine.mjs';
const project=decodeProject(new Uint8Array(await readFile('test-results/compression-copy/entrada.pdfco')));
const bytes=await exportPdf(project.bytes,{...project.model,forms:{...project.model.forms,Respuesta:'Respuesta pendiente'}});
await writeFile('test-results/compression-copy/antes.pdf',bytes);
console.log('Copia sintética anterior a la compresión preparada para comparar.');
