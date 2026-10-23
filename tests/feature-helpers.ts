import { _electron as electron, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { encodeProject } from '../src/pdf-engine.mjs';

export async function launchApp(profile:string){
  const env={...process.env,PDFREADERCO_TEST_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:process.env.PDFREADERCO_EXECUTABLE||undefined,args:process.env.PDFREADERCO_EXECUTABLE?[]:[path.resolve('electron/main.cjs')],env});
  const page=await app.firstWindow();await expect(page.locator('.home')).toBeVisible();
  return {app,page,close:async()=>{await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;});await app.close();}};
}
export async function featureScene(name:string,withMarks=true){
  const root=path.resolve('test-results',name);await mkdir(root,{recursive:true});const profile=path.join(root,'profile-'+crypto.randomUUID()),ctx=await launchApp(profile);
  const errors:string[]=[];ctx.page.on('pageerror',error=>errors.push(error.stack||error.message));
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
  for(let n=1;n<=3;n++){const p=doc.addPage([600,800]);p.drawText('Documento '+n,{x:40,y:755,size:20,font});p.drawText('Texto seleccionable para resaltar.',{x:40,y:720,size:14,font});}
  const model={forms:{},marks:withMarks?[
    {id:'one',page:1,tool:'text',x:.13,y:.16,w:.3,h:.06,size:16,color:'#263342',text:'Primer texto'},
    {id:'two',page:1,tool:'text',x:.58,y:.28,w:.25,h:.06,size:16,color:'#263342',text:'Segundo texto'},
    {id:'rect',page:1,tool:'rect',x:.15,y:.42,w:.2,h:.1,size:2,color:'#008577'},
    {id:'image',page:2,tool:'image',x:.2,y:.2,w:.2,h:.1,size:2,color:'#008577',image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='}
  ]:[]};
  const bytes=Array.from(encodeProject(await doc.save(),model));
  const send=async(id=crypto.randomUUID(),expectedPage=1)=>{await ctx.app.evaluate(({BrowserWindow},payload)=>BrowserWindow.getAllWindows()[0].webContents.send('action','document',payload),{id,name:'Escena.pdfco',bytes:new Uint8Array(bytes)});await expect(ctx.page.locator('.workspace-host:not([hidden]) .pdf-page[data-page="'+expectedPage+'"].rendered')).toBeVisible();};
  await send();await ctx.page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const save=async(name:string,kind:'project'|'pdf'='project')=>{const file=path.join(root,name);await ctx.app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);if(kind==='project'){await ctx.page.getByRole('button',{name:'Formularios',exact:true}).click();await ctx.page.getByRole('button',{name:'Proyecto editable',exact:true}).click();await expect(ctx.page.locator('.workspace-host:not([hidden]) .reader-status')).toContainText('Proyecto editable guardado');}else{await ctx.page.getByRole('button',{name:'Guardar como',exact:true}).click();await expect(ctx.page.locator('.workspace-host:not([hidden]) .reader-status')).toContainText('PDF guardado');}return kind==='project'?JSON.parse(await readFile(file,'utf8')):new Uint8Array(await readFile(file));};
  return {...ctx,root,profile,model,errors,bytes,send,save};
}
