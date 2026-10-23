import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {createHash}from'node:crypto';
await mkdir('dist/pdf-assets',{recursive:true});
for(const folder of ['cmaps','standard_fonts','wasm']) await cp(`node_modules/pdfjs-dist/${folder}`,`dist/pdf-assets/${folder}`,{recursive:true});
await mkdir('dist/ocr-assets/core',{recursive:true});await mkdir('dist/ocr-assets/langs',{recursive:true});
const ocrFiles=[['node_modules/tesseract.js/dist/worker.min.js','worker.min.js'],['node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt','worker.min.js.LICENSE.txt']];
for(const file of(await readdir('node_modules/tesseract.js-core')).filter(file=>/\.wasm(?:\.js)?$/.test(file)))ocrFiles.push(['node_modules/tesseract.js-core/'+file,'core/'+file]);
for(const language of['eng','spa','fra','deu','ita','por'])ocrFiles.push([`node_modules/@tesseract.js-data/${language}/4.0.0_best_int/${language}.traineddata.gz`,`langs/${language}.traineddata.gz`]);
const manifest=[];for(const [source,target]of ocrFiles){await cp(source,'dist/ocr-assets/'+target);const bytes=await readFile(source);manifest.push({file:target,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
await writeFile('dist/ocr-assets/manifest.json',JSON.stringify({engine:'Tesseract.js',version:'7.0.0',models:'@tesseract.js-data 1.0.0 / 4.0.0_best_int',files:manifest},null,2));
await mkdir('licenses',{recursive:true});
for(const [folder,name] of [['pdfjs-dist','PDF.js'],['@embedpdf/pdfium','PDFium'],['pdf-lib','pdf-lib'],['react','React'],['react-dom','React-DOM'],['lucide-react','Lucide'],['electron','Electron'],['@pdf-lib/standard-fonts','Standard-Fonts'],['@pdf-lib/upng','UPNG'],['pako','Pako'],['tslib','TSLib'],['scheduler','Scheduler'],['loose-envify','Loose-envify'],['js-tokens','JS-Tokens'],['tesseract.js','Tesseract-JS'],['tesseract.js-core','Tesseract-Core'],['bmp-js','BMP-JS'],['idb-keyval','IDB-Keyval'],['is-url','Is-URL'],['node-fetch','Node-Fetch'],['regenerator-runtime','Regenerator-Runtime'],['wasm-feature-detect','WASM-Feature-Detect'],['zlibjs','ZlibJS'],['whatwg-url','WHATWG-URL'],['tr46','TR46'],['webidl-conversions','WebIDL-Conversions']]) {
  const files=await readdir(`node_modules/${folder}`);
  for(const f of files.filter(f=>/^licen[cs]e/i.test(f)))await cp(`node_modules/${folder}/${f}`,`licenses/${name}-${path.basename(f)}`);
}
