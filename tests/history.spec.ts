import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { featureScene, launchApp } from './feature-helpers';

const active=(page:any)=>page.locator('.workspace-host:not([hidden])');
async function edit(page:any,text:string){await active(page).locator('[data-mark-id="one"] .mark-hitbox').dblclick();await page.getByRole('dialog').locator('textarea').fill(text);await page.getByRole('button',{name:'Aplicar',exact:true}).click();await expect(active(page).locator('[data-mark-id="one"]')).toHaveAttribute('aria-label','Texto: '+text);}
const history=(app:any)=>app.evaluate(async({BrowserWindow}:any)=>BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('window.desktop.listHistory()'));
async function waitCount(app:any,name:string,count:number){await expect.poll(async()=>{const data=await history(app);return data.groups.find((g:any)=>g.name===name)?.versions.length||0;},{timeout:12000}).toBe(count);}
async function openHistory(page:any){await page.locator('.app-header').getByRole('button',{name:'Historial de versiones',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Historial de versiones',exact:true});await expect(dialog.locator('.history-storage')).toBeVisible();return dialog;}

test('history restores an older version in a separate tab without changing the current document',async()=>{
  const ctx=await featureScene('history-restore'),{page,app}=ctx;
  try{
    await edit(page,'Versión A');await waitCount(app,'Escena.pdfco',1);await edit(page,'Versión B');await waitCount(app,'Escena.pdfco',2);
    const dialog=await openHistory(page);await expect(dialog.locator('.history-version')).toHaveCount(2);await expect(dialog.locator('.history-version time').first()).toHaveAttribute('datetime',/\d{4}-\d\d-\d\dT/);await page.screenshot({path:path.join(ctx.root,'historial-versiones.png')});
    await dialog.locator('[data-version-number="1"]').getByRole('button',{name:'Restaurar copia',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('.tabbar .tab:not(.home-tab)')).toHaveCount(2);await expect(active(page).locator('[data-mark-id="one"]')).toHaveAttribute('aria-label','Texto: Versión A');await expect(active(page).locator('.reader-status')).toContainText('Cambios sin guardar');
    await page.getByTitle('Escena.pdfco',{exact:true}).click();await expect(active(page).locator('[data-mark-id="one"]')).toHaveAttribute('aria-label','Texto: Versión B');await ctx.save('actual.pdfco');await waitCount(app,'Escena.pdfco',2);const data=await history(app),group=data.groups.find((g:any)=>g.name==='Escena.pdfco');expect(group.versions.some((v:any)=>v.protected)).toBe(false);
    await page.getByTitle('Escena (versión recuperada).pdfco',{exact:true}).click();const restored=await ctx.save('version-anterior.pdfco');expect(restored.model.marks.find((m:any)=>m.id==='one').text).toBe('Versión A');expect(restored.model.marks).toHaveLength(4);expect(ctx.errors).toEqual([]);
  }finally{await ctx.close();}
});

test('history checkpoints manual saves and keeps one file history across reopen and restart',async()=>{
  const ctx=await featureScene('history-persistence'),input=path.join(ctx.root,'entrada-historial.pdfco');let second:Awaited<ReturnType<typeof launchApp>>|undefined;
  const open=async()=>{await ctx.app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},input);await ctx.page.locator('.tabbar').getByRole('button',{name:'Abrir documento',exact:true}).click();await expect(active(ctx.page).locator('[data-mark-id="one"]')).toBeVisible();};
  try{
    await ctx.save('entrada-historial.pdfco');const source=await readFile(input);await ctx.page.locator('.tab.selected .tab-close').click();await open();await edit(ctx.page,'Guardado rápido A');await ctx.save('copia-a.pdfco');await waitCount(ctx.app,'entrada-historial.pdfco',1);await ctx.page.locator('.tab.selected .tab-close').click();await open();await edit(ctx.page,'Guardado rápido B');await ctx.save('copia-b.pdfco');await waitCount(ctx.app,'entrada-historial.pdfco',2);expect(await readFile(input)).toEqual(source);await ctx.page.locator('.tab.selected .tab-close').click();
    await ctx.app.evaluate(({app})=>app.exit(0)).catch(()=>{});second=await launchApp(ctx.profile);await expect(second.page.getByRole('dialog',{name:'Recuperar documentos',exact:true})).not.toBeVisible();const dialog=await openHistory(second.page);await dialog.getByRole('button',{name:'Historial de entrada-historial.pdfco',exact:true}).click();await expect(dialog.locator('.history-version')).toHaveCount(2);await dialog.locator('[data-version-number="1"]').getByRole('button',{name:'Restaurar copia',exact:true}).click();await expect(active(second.page).locator('[data-mark-id="one"]')).toHaveAttribute('aria-label','Texto: Guardado rápido A');expect(await readFile(input)).toEqual(source);
  }finally{if(second)await second.close();else await ctx.close().catch(()=>{});}
});

test('history rejects corrupt restores, confirms deletion and preserves active recovery during cleanup',async()=>{
  const ctx=await featureScene('history-cleanup'),{app,page}=ctx;
  try{
    for(const [i,text]of ['Primera','Segunda','Actual'].entries()){await edit(page,text);await waitCount(app,'Escena.pdfco',i+1);}
    const dialog=await openHistory(page);await expect(dialog.locator('.history-version')).toHaveCount(3);await expect(dialog.locator('[data-version-number="3"]').getByRole('button',{name:'Protege trabajo sin guardar',exact:true})).toBeDisabled();const data=await history(app),group=data.groups.find((g:any)=>g.name==='Escena.pdfco'),old=group.versions.find((v:any)=>v.number===1),file=path.join(ctx.profile,'recovery','history',old.id+'.pdfco'),damaged=await readFile(file);damaged[0]^=1;await writeFile(file,damaged);
    await dialog.locator('[data-version-number="1"]').getByRole('button',{name:'Restaurar copia',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('fue modificada');await expect(page.locator('.tabbar .tab:not(.home-tab)')).toHaveCount(1);
    await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});});await dialog.getByRole('button',{name:'Eliminar versión 1',exact:true}).click();await expect(dialog.locator('.history-version')).toHaveCount(3);await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});await dialog.getByRole('button',{name:'Eliminar versión 1',exact:true}).click();await expect(dialog.locator('.history-version')).toHaveCount(2);await dialog.getByRole('button',{name:'Eliminar historial',exact:true}).click();await expect(dialog.locator('.history-version')).toHaveCount(1);await expect(dialog.locator('.history-notice')).toContainText('recuperación activas');await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();
    await expect(active(page).locator('[data-mark-id="one"]')).toHaveAttribute('aria-label','Texto: Actual');await ctx.save('actual-guardado.pdfco');const again=await openHistory(page);await expect(again.getByRole('button',{name:'Eliminar versión 3',exact:true})).toBeEnabled();await again.getByRole('button',{name:'Eliminar historial',exact:true}).click();await expect(again.locator('.history-empty')).toContainText('Todavía no hay versiones');await expect(again.getByRole('meter')).toHaveAttribute('value','0');expect(ctx.errors).toEqual([]);
  }finally{await ctx.close();}
});

test('legacy startup recovery migrates safely and its earlier version remains restorable',async()=>{
  const ctx=await featureScene('history-legacy');let second:Awaited<ReturnType<typeof launchApp>>|undefined;
  try{
    await ctx.app.evaluate(({app})=>app.exit(0)).catch(()=>{});const root=path.join(ctx.profile,'recovery');await mkdir(root,{recursive:true});await writeFile(path.join(root,'legacy-document.json'),JSON.stringify({id:'legacy-document',name:'Anterior.pdf',updated:'2026-10-01T12:00:00.000Z'}));await writeFile(path.join(root,'legacy-document.pdfco'),new Uint8Array(ctx.bytes));second=await launchApp(ctx.profile);const {page,app}=second;await expect(page.getByRole('dialog',{name:'Recuperar documentos',exact:true})).toBeVisible();await page.getByRole('button',{name:'Recuperar',exact:true}).click();await expect(active(page).locator('[data-mark-id="one"]')).toHaveAttribute('aria-label','Texto: Primer texto');await edit(page,'Después de migrar');await expect.poll(async()=>{const data=await history(app);return data.groups.find((g:any)=>g.id==='legacy-document')?.versions.length||0;},{timeout:12000}).toBe(2);
    const dialog=await openHistory(page);await expect(dialog.locator('.history-version')).toHaveCount(2);await dialog.locator('[data-version-number="1"]').getByRole('button',{name:'Restaurar copia',exact:true}).click();await expect(active(page).locator('[data-mark-id="one"]')).toHaveAttribute('aria-label','Texto: Primer texto');await page.getByTitle('Anterior (recuperado).pdfco',{exact:true}).click();await expect(active(page).locator('[data-mark-id="one"]')).toHaveAttribute('aria-label','Texto: Después de migrar');expect((JSON.parse(await readFile(path.join(root,'legacy-document.json'),'utf8'))).version).toBe(2);
  }finally{if(second)await second.close();else await ctx.close().catch(()=>{});}
});

test('disabling recovery stops new automatic and manual-save versions while retaining earlier history',async()=>{
  const ctx=await featureScene('history-opt-out'),{page,app}=ctx;
  try{
    await edit(page,'Estado conservado');await waitCount(app,'Escena.pdfco',1);await active(page).locator('.recovery-status').click();await expect(active(page).locator('.recovery-status')).toContainText('Desactivada');await edit(page,'Estado sin historial');await ctx.save('sin-historial.pdfco');const group=(await history(app)).groups.find((g:any)=>g.name==='Escena.pdfco');expect(group.versions).toHaveLength(1);expect(group.versions[0].protected).toBe(false);
    await active(page).locator('.recovery-status').click();await edit(page,'Historial reanudado');await waitCount(app,'Escena.pdfco',2);const dialog=await openHistory(page);await expect(dialog.locator('.history-version')).toHaveCount(2);expect(ctx.errors).toEqual([]);
  }finally{await ctx.close();}
});
