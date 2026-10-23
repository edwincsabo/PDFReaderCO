import {test,expect} from '@playwright/test';
import {PDFDocument,PDFRawStream,PDFName} from 'pdf-lib';
import {readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash}from'node:crypto';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
import {featureScene} from './feature-helpers';
import {compressionFixture} from './compression-fixture.mjs';
import {encodeProject,createBlank} from '../src/pdf-engine.mjs';
const active=(page:any)=>page.locator('.workspace-host:not([hidden])');
const modal=(page:any)=>page.getByRole('dialog',{name:'Comprimir PDF',exact:true});
async function open(ctx:any,file:string){await ctx.app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await ctx.page.locator('.tabbar').getByRole('button',{name:'Abrir documento',exact:true}).click();await expect(ctx.page.locator('.tab.selected')).toContainText(path.basename(file));await expect(active(ctx.page).locator('.pdf-page.rendered').first()).toBeVisible();}
async function prepare(page:any){await modal(page).getByRole('button',{name:'Preparar compresión',exact:true}).click();await expect(modal(page).locator('.compression-result')).toBeVisible();}
async function chooseSave(ctx:any,file:string){await ctx.app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);await modal(ctx.page).getByRole('button',{name:'Guardar copia comprimida',exact:true}).click();}

test('compression: real worker reduces raster images, previews both PDFs, preserves text/forms/attachments and pending session',async()=>{
  const ctx=await featureScene('compression-copy',false),{page}=ctx;
  try{
    const source=await compressionFixture(1600,1000),file=path.join(ctx.root,'entrada.pdfco');await writeFile(file,encodeProject(source,{marks:[{id:'nota',tool:'note',page:1,x:.85,y:.1,w:.03,h:.03,color:'#ffcc00',size:12,text:'Comentario conservado'}],forms:{}}));await open(ctx,file);
    await active(page).getByRole('button',{name:'Formularios',exact:true}).click();await active(page).locator('.reader-sidebar').getByRole('textbox',{name:'Respuesta',exact:true}).fill('Respuesta pendiente');await expect(page.locator('.tab.selected .dirty-dot')).toHaveCount(1);await active(page).getByRole('button',{name:'Lectura',exact:true}).click();await active(page).getByRole('button',{name:'Comprimir PDF',exact:true}).click();
    await modal(page).getByRole('combobox',{name:'Perfil de compresión'}).selectOption('custom');await modal(page).getByRole('spinbutton',{name:'Calidad JPEG',exact:true}).fill('70');await modal(page).getByRole('spinbutton',{name:'Lado máximo',exact:true}).fill('800');await prepare(page);await expect(modal(page).locator('.compression-result')).toContainText('1 imagen modificada');for(const canvas of await modal(page).locator('canvas').all())await expect(canvas).toHaveAttribute('data-ready','true');const previewWidth=await modal(page).locator('canvas').first().evaluate((el:HTMLCanvasElement)=>el.width);await modal(page).getByRole('combobox',{name:'Ampliación de vista previa'}).selectOption('2');await expect.poll(()=>modal(page).locator('canvas').first().evaluate((el:HTMLCanvasElement)=>el.width)).toBeGreaterThan(previewWidth*1.9);await modal(page).getByRole('combobox',{name:'Ampliación de vista previa'}).selectOption('1');for(const canvas of await modal(page).locator('canvas').all())await expect(canvas).toHaveAttribute('data-ready','true');await page.screenshot({path:path.join(ctx.root,'compresion-comparada.png')});
    const output=path.join(ctx.root,'comprimido.pdf');await rm(output,{force:true});await chooseSave(ctx,output);await expect(modal(page)).toHaveCount(0);await expect(active(page).locator('.reader-status')).toContainText('Copia comprimida guardada');await expect(page.locator('.tab.selected')).toContainText('entrada.pdfco');await expect(page.locator('.tab.selected .dirty-dot')).toHaveCount(1);const bytes=new Uint8Array(await readFile(output)),doc=await PDFDocument.load(bytes);expect(bytes.length).toBeLessThan(source.length/2);expect(doc.getForm().getTextField('Respuesta').getText()).toBe('Respuesta pendiente');expect(doc.getTitle()).toBe('Compresión verificable');const img=doc.context.enumerateIndirectObjects().map(([,o])=>o).find(o=>o instanceof PDFRawStream&&o.dict.get(PDFName.of('Subtype'))===PDFName.of('Image')) as PDFRawStream;expect(img.dict.get(PDFName.of('Width'))?.toString()).toBe('800');expect(img.dict.get(PDFName.of('Height'))?.toString()).toBe('500');expect(img.dict.get(PDFName.of('Filter'))?.toString()).toBe('/DCTDecode');expect(hash(await readFile(file))).toBe(hash(encodeProject(source,{marks:[{id:'nota',tool:'note',page:1,x:.85,y:.1,w:.03,h:.03,color:'#ffcc00',size:12,text:'Comentario conservado'}],forms:{}})));await open(ctx,output);await expect(active(page).locator('.textLayer').first()).toContainText('Texto vectorial');await ctx.save('reabierto.pdf','pdf');expect(ctx.errors).toEqual([]);
  }finally{await ctx.close();}
});

test('compression: saving cannot overwrite the source or another file, save cancellation retains the prepared result',async()=>{
  const ctx=await featureScene('compression-destination',false),{page}=ctx;
  try{
    const source=await compressionFixture(),file=path.join(ctx.root,'original.pdf');await writeFile(file,source);await open(ctx,file);await active(page).getByRole('button',{name:'Comprimir PDF',exact:true}).click();await prepare(page);await chooseSave(ctx,file);await expect(modal(page).getByRole('alert')).toContainText('destino ya existe');expect(hash(await readFile(file))).toBe(hash(source));
    await ctx.app.evaluate(({dialog})=>{dialog.showSaveDialog=async()=>({canceled:true,filePath:''});});await modal(page).getByRole('button',{name:'Guardar copia comprimida',exact:true}).click();await expect(modal(page)).toBeVisible();await expect(modal(page).getByRole('button',{name:'Guardar copia comprimida',exact:true})).toBeEnabled();await rm(path.join(ctx.root,'copia.pdf'),{force:true});await chooseSave(ctx,path.join(ctx.root,'copia.pdf'));await expect(modal(page)).toHaveCount(0);expect(hash(await readFile(file))).toBe(hash(source));await open(ctx,path.join(ctx.root,'copia.pdf'));await active(page).getByRole('button',{name:'Comprimir PDF',exact:true}).click();await modal(page).getByRole('combobox',{name:'Perfil de compresión'}).selectOption('small');await prepare(page);await expect(modal(page).locator('.compression-items')).not.toContainText('No se pudo convertir');expect(ctx.errors).toEqual([]);
  }finally{await ctx.close();}
});

test('compression: cancelling a real worker or closing its dialog discards the result and keeps the original session',async()=>{
  const ctx=await featureScene('compression-cancel',false),{page}=ctx;
  try{
    const source=await compressionFixture(2048,1024),file=path.join(ctx.root,'grande.pdf');await writeFile(file,source);await open(ctx,file);await active(page).getByRole('button',{name:'Comprimir PDF',exact:true}).click();await modal(page).getByRole('button',{name:'Preparar compresión',exact:true}).click();await modal(page).getByRole('button',{name:'Cancelar compresión',exact:true}).click();await expect(modal(page).getByRole('button',{name:'Preparar compresión',exact:true})).toBeEnabled();await expect(modal(page).locator('.compression-result')).toHaveCount(0);await expect(modal(page).getByRole('button',{name:'Guardar copia comprimida',exact:true})).toBeDisabled();await modal(page).getByRole('button',{name:'Preparar compresión',exact:true}).click();await modal(page).getByRole('button',{name:'Cerrar',exact:true}).click();await expect(modal(page)).toHaveCount(0);await expect(page.locator('.tab.selected')).toContainText('grande.pdf');expect(hash(await readFile(file))).toBe(hash(source));expect(ctx.errors).toEqual([]);
  }finally{await ctx.close();}
});

test('compression: lossless preserves images, profile changes invalidate the preview and invalid custom limits are recoverable',async()=>{
  const ctx=await featureScene('compression-profiles',false),{page}=ctx;
  try{
    const file=path.join(ctx.root,'texto.pdf');await writeFile(file,await createBlank());await open(ctx,file);await active(page).getByRole('button',{name:'Comprimir PDF',exact:true}).click();await modal(page).getByRole('combobox',{name:'Perfil de compresión'}).selectOption('lossless');await prepare(page);await expect(modal(page).locator('.compression-result')).toContainText('0 imágenes modificadas');await modal(page).getByRole('combobox',{name:'Perfil de compresión'}).selectOption('custom');await expect(modal(page).locator('.compression-result')).toHaveCount(0);await expect(modal(page).getByRole('button',{name:'Guardar copia comprimida',exact:true})).toBeDisabled();await modal(page).getByRole('spinbutton',{name:'Lado máximo',exact:true}).fill('500');await modal(page).getByRole('button',{name:'Preparar compresión',exact:true}).click();await expect(modal(page).getByRole('alert')).toContainText('800 y 4096');await modal(page).getByRole('spinbutton',{name:'Lado máximo',exact:true}).fill('0');await prepare(page);expect(ctx.errors).toEqual([]);
  }finally{await ctx.close();}
});
