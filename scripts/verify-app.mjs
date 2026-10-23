import { extractFile, listPackage } from '@electron/asar';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const metadata=JSON.parse(await readFile('package.json','utf8'));
const target=`release/PDFReaderCO-${metadata.version}-Carpeta/resources/app.asar`;
const archived=JSON.parse(extractFile(target,'package.json').toString('utf8'));
assert.equal(archived.version,metadata.version);assert.equal(archived.main,'electron/main.cjs');
const entries=listPackage(target).map(name=>name.replaceAll('\\','/'));
for(const file of ['/dist/index.html','/electron/main.cjs','/electron/preload.cjs','/electron/preferences.cjs','/electron/locale-core.cjs','/electron/locale-en.json','/electron/ai-settings.cjs','/electron/ai-service.cjs','/electron/recovery-store.cjs','/electron/batch-files.cjs','/electron/batch-journal.cjs'])assert.ok(entries.includes(file),file);
assert.ok(entries.includes('/electron/local-fonts.cjs'),'Carga local de fuentes de Windows');
assert.ok(!entries.some(file=>file.includes('/node_modules/')));
const wasm=entries.find(file=>/\/dist\/assets\/pdfium-.*\.wasm$/.test(file));assert.ok(wasm,'PDFium WebAssembly local');
assert.ok(entries.some(file=>/\/dist\/assets\/batch\.worker-.*\.js$/.test(file)),'Worker local de lotes');
assert.ok(entries.some(file=>/\/dist\/assets\/compression\.worker-.*\.js$/.test(file)),'Worker local de compresión');
assert.ok(entries.some(file=>/\/dist\/assets\/ocr-image\.worker-.*\.js$/.test(file)),'Worker de preparación de imagen OCR');
assert.ok(entries.some(file=>/\/dist\/assets\/ocr-recognizer\.worker-.*\.js$/.test(file)),'Worker de coordinación OCR');
const ocrManifest=JSON.parse(extractFile(target,path.normalize('dist/ocr-assets/manifest.json')).toString('utf8'));assert.equal(ocrManifest.version,'7.0.0');assert.equal(ocrManifest.files.length,20);
for(const item of ocrManifest.files){assert.ok(/^(?:worker\.min\.js(?:\.LICENSE\.txt)?|core\/[\w.-]+\.wasm(?:\.js)?|langs\/(?:eng|spa|fra|deu|ita|por)\.traineddata\.gz)$/.test(item.file));const bytes=extractFile(target,path.normalize('dist/ocr-assets/'+item.file));assert.equal(bytes.length,item.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);const source=item.file.startsWith('core/')?'node_modules/tesseract.js-core/'+item.file.slice(5):item.file.startsWith('langs/')?`node_modules/@tesseract.js-data/${item.file.slice(6,9)}/4.0.0_best_int/${item.file.slice(6)}`:'node_modules/tesseract.js/dist/'+item.file;assert.deepEqual(bytes,await readFile(source));}
assert.ok(entries.some(file=>/\/dist\/assets\/original-text\.worker-.*\.js$/.test(file)),'Worker de texto original');
assert.ok(entries.some(file=>/\/dist\/assets\/document-tools\.worker-.*\.js$/.test(file)),'Worker local de imágenes y tablas');
assert.ok(entries.some(file=>/\/dist\/assets\/comparison\.worker-.*\.js$/.test(file)),'Worker de diferencias automáticas');
for(const file of ['/licenses/PDFium-LICENSE','/licenses/PDFium-LICENSE.pdfium'])assert.ok(entries.includes(file),file);
assert.deepEqual(extractFile(target,path.normalize(wasm.slice(1))),await readFile('node_modules/@embedpdf/pdfium/dist/pdfium.wasm'));
const hash=async(file)=>createHash('sha256').update(await readFile(file)).digest('hex');
assert.equal(await hash(target),await hash('release/application/app.asar'));
console.log(`ASAR ${archived.version}: ${entries.length} entradas, recursos de escritorio presentes y contenido idéntico al paquete generado.`);

