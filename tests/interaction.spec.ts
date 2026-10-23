import { test, expect, _electron as electron, type Page, type Locator } from '@playwright/test';
import { PDFDocument, degrees } from 'pdf-lib';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { encodeProject } from '../src/pdf-engine.mjs';

async function openWorkspace(name:string) {
  const root=path.resolve('test-results',name);await mkdir(root,{recursive:true});
  const document=await PDFDocument.create();document.addPage([600,800]);const second=document.addPage([600,800]);second.setCropBox(20,30,500,700);second.setRotation(degrees(90));
  const model={forms:{},marks:[
    {id:'text',page:1,tool:'text',x:.15,y:.14,w:.3,h:.07,size:16,color:'#1f2937',text:'Texto movible\nSegunda línea larga'},
    {id:'pen',page:1,tool:'pen',x:.1,y:.4,w:.2,h:.06,size:3,color:'#008577',points:[[.1,.4],[.2,.46],[.3,.4]]},
    {id:'note',page:1,tool:'note',x:.75,y:.14,w:.035,h:.025,size:2,color:'#008577',text:'Nota movible'},
    {id:'rotated',page:2,tool:'text',x:.12,y:.2,w:.3,h:.07,size:16,color:'#1f2937',text:'Página rotada'}
  ]};
  const env={...process.env,PDFREADERCO_TEST_DATA:path.join(root,'profile-'+crypto.randomUUID())};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({executablePath:process.env.PDFREADERCO_EXECUTABLE||undefined,args:process.env.PDFREADERCO_EXECUTABLE?[]:[path.resolve('electron/main.cjs')],env});
  const page=await app.firstWindow();await expect(page.locator('.home')).toBeVisible();
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow},bytes)=>BrowserWindow.getAllWindows()[0].webContents.send('action','document',{id:'interaction',name:'Interacción.pdfco',bytes:new Uint8Array(bytes)}),Array.from(encodeProject(await document.save(),model)));
  await expect(page.locator('.pdf-page.rendered').first()).toBeVisible();await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption('1');
  const saveProject=async()=>{
    const output=path.join(root,'proyecto.pdfco');
    await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},output);
    await page.getByRole('button',{name:'Formularios',exact:true}).click();await page.getByRole('button',{name:'Proyecto editable',exact:true}).click();
    await expect(page.locator('.reader-status')).toContainText('Proyecto editable guardado');
    return JSON.parse(await readFile(output,'utf8'));
  };
  return {app,page,root,model,errors,saveProject,close:async()=>{await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;});await app.close();}};
}
async function position(mark:Locator) {return {x:Number(await mark.getAttribute('data-x')),y:Number(await mark.getAttribute('data-y'))};}
async function drag(page:Page,mark:Locator,dx:number,dy:number,finish=true) {
  const box=await mark.locator('.mark-hitbox').boundingBox();if(!box)throw new Error('Falta el área para arrastrar.');
  // Grab the transparent padding, not a painted text glyph.
  const x=box.x+box.width/2,y=box.y+2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:15});if(finish)await page.mouse.up();
}

test('mouse drag: text hit area, single undo, cancellation, bounds, double click and whole pen stroke',async()=>{
  const ctx=await openWorkspace('interaction');const {page}=ctx;
  try {
    const mark=page.locator('[data-mark-id="text"]'),sheet=page.locator('.pdf-page').first();
    await expect(sheet).toHaveCSS('width','600px');
    const before=await position(mark),box=await sheet.boundingBox();if(!box)throw new Error('Falta la página.');
    await drag(page,mark,100,55,false);
    await expect(page.locator('.reader-status')).toContainText('Guardado');
    await page.mouse.up();let moved=await position(mark);
    expect(moved.x).toBeCloseTo(before.x+100/box.width,3);expect(moved.y).toBeCloseTo(before.y+55/box.height,3);
    await page.getByRole('button',{name:'Deshacer (Ctrl+Z)',exact:true}).click();expect(await position(mark)).toEqual(before);await expect(page.getByRole('button',{name:'Deshacer (Ctrl+Z)',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Rehacer (Ctrl+Y)',exact:true}).click();expect(await position(mark)).toEqual(moved);
    await drag(page,mark,30,20,false);await page.keyboard.press('Escape');await page.mouse.up();expect(await position(mark)).toEqual(moved);
    await mark.locator('.mark-hitbox').click();await page.getByRole('button',{name:'Deshacer (Ctrl+Z)',exact:true}).click();expect(await position(mark)).toEqual(before);await page.getByRole('button',{name:'Rehacer (Ctrl+Y)',exact:true}).click();
    await drag(page,mark,650,0);const bounds=await mark.locator('.mark-content').evaluate(el=>{const b=(el as SVGGraphicsElement).getBBox();return {x:b.x,width:b.width};});expect(bounds.x+bounds.width).toBeLessThanOrEqual(box.width+.1);
    await mark.locator('.mark-hitbox').dblclick();await expect(page.getByRole('dialog').locator('textarea')).toHaveValue('Texto movible\nSegunda línea larga');await page.getByRole('dialog').locator('textarea').fill('Texto editado con doble clic');await page.getByRole('button',{name:'Aplicar',exact:true}).click();await expect(mark).toHaveAttribute('aria-label','Texto: Texto editado con doble clic');expect(await mark.locator('.mark-content').evaluate(el=>{const b=(el as SVGGraphicsElement).getBBox();return b.x+b.width;})).toBeLessThanOrEqual(box.width+.1);
    const pen=page.locator('[data-mark-id="pen"]');await drag(page,pen,60,25);const penPosition=await position(pen);
    const note=page.locator('[data-mark-id="note"]');await note.focus();const noteBefore=await position(note);await page.keyboard.press('Shift+ArrowDown');expect((await position(note)).y).toBeCloseTo(noteBefore.y+10/800,4);
    await page.screenshot({path:path.join(ctx.root,'arrastre.png')});
    const project=await ctx.saveProject();const saved=project.model.marks.find((m:any)=>m.id==='pen');expect(saved.x).toBeCloseTo(.2,4);expect(saved.y).toBeCloseTo(.4+25/800,4);expect(saved.x).toBe(penPosition.x);expect(saved.points[0][0]).toBeCloseTo(.2,4);expect(saved.points[1][0]).toBeCloseTo(.3,4);expect(saved.points[1][1]).toBeCloseTo(.46+25/800,4);
    expect(ctx.errors).toEqual([]);
  }finally{await ctx.close();}
});

test('mouse drag uses viewport coordinates at different zooms on a rotated cropped page',async()=>{
  const ctx=await openWorkspace('interaction-zoom');const {page}=ctx;
  try {
    const mark=page.locator('[data-mark-id="rotated"]'),sheet=page.locator('.pdf-page[data-page="2"]');
    for(const zoom of [.75,1,2]) {
      await page.getByRole('combobox',{name:'Zoom',exact:true}).selectOption(String(zoom));await expect(sheet).toHaveCSS('width',`${700*zoom}px`);await sheet.scrollIntoViewIfNeeded();
      const box=await sheet.boundingBox();if(!box)throw new Error('Falta la página rotada.');const before=await position(mark);await drag(page,mark,50,25);
      const after=await position(mark);expect(after.x).toBeCloseTo(before.x+50/box.width,3);expect(after.y).toBeCloseTo(before.y+25/box.height,3);
    }
    const expected=await position(mark),project=await ctx.saveProject();const saved=project.model.marks.find((m:any)=>m.id==='rotated');expect(saved.x).toBe(expected.x);expect(saved.y).toBe(expected.y);
    const source=await PDFDocument.load(Buffer.from(project.pdf,'base64'));expect(source.getPage(1).getRotation().angle).toBe(90);expect(source.getPage(1).getCropBox()).toEqual({x:20,y:30,width:500,height:700});expect(ctx.errors).toEqual([]);
  }finally{await ctx.close();}
});


