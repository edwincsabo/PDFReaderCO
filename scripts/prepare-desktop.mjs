import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
const source=JSON.parse(await readFile('package.json','utf8'));
await mkdir('desktop-bundle',{recursive:true});
const root=path.resolve('desktop-bundle');
for(const dir of ['dist','electron','licenses','build']) {
  const target=path.resolve(root,dir);
  if(!target.startsWith(root+path.sep))throw new Error('Carpeta de empaquetado fuera del proyecto.');
  await rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  await cp(dir,target,{recursive:true,force:true});
}
for(const file of ['LICENSE','NOTICE','THIRD_PARTY_NOTICES.md'])await cp(file,`desktop-bundle/${file}`);
await writeFile('desktop-bundle/package.json',JSON.stringify({name:source.name,productName:'PDFReaderCO',version:source.version,description:source.description,author:source.author,license:source.license,main:source.main},null,2));
