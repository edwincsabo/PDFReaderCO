import { createPackage } from '@electron/asar';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const source=JSON.parse(await readFile('package.json','utf8'));
const bundle=JSON.parse(await readFile('desktop-bundle/package.json','utf8'));
if(source.version!==bundle.version)throw new Error('El contenido de escritorio no corresponde a la versión actual.');
const target=path.resolve('release/application');await mkdir(target,{recursive:true});
await createPackage(path.resolve('desktop-bundle'),path.join(target,'app.asar'));
console.log('Contenido de aplicación empaquetado: '+path.join(target,'app.asar'));
