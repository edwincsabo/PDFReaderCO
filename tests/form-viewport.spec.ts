import { test, expect } from '@playwright/test';
import path from 'node:path';
import { featureScene } from './feature-helpers';

for(const zoom of [1,2])test(`form viewport: page bottom at ${zoom*100}% retains both scroll axes on create, repeated moves, resize, properties and history`,async()=>{
  const ctx=await featureScene('form-viewport-'+zoom,false),{page}=ctx,active=page.locator('.workspace-host:not([hidden])'),scroller=active.locator('.reader-main > .document-scroll'),sheet=active.locator('.pdf-page[data-page="2"]');
  const state=()=>scroller.evaluate(el=>({top:el.scrollTop,left:el.scrollLeft}));
  const start=async()=>{const before=await state();await scroller.evaluate(el=>{const w=window as any;w.viewportSamples=[];w.viewportSampling=true;const sample=()=>{if(!w.viewportSampling)return;w.viewportSamples.push([el.scrollTop,el.scrollLeft]);requestAnimationFrame(sample);};sample();});return before;};
  const unchanged=async(before:{top:number;left:number})=>{
    await expect(active.locator('.workspace')).toHaveAttribute('aria-busy','false');await expect(sheet).toHaveClass(/rendered/);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const samples=await page.evaluate(()=>{const w=window as any;w.viewportSampling=false;return w.viewportSamples as number[][];});
    const after=await state();expect(after.top).toBeCloseTo(before.top,0);expect(after.left).toBeCloseTo(before.left,0);
    expect(Math.max(...samples.map(s=>Math.abs(s[0]-before.top)))).toBeLessThan(2);expect(Math.max(...samples.map(s=>Math.abs(s[1]-before.left)))).toBeLessThan(2);
    await expect(active.getByRole('combobox',{name:'Zoom',exact:true})).toHaveValue(String(zoom));await expect(active.getByRole('spinbutton',{name:'Número de página',exact:true})).toHaveValue('2');
  };
  try{
    await active.getByRole('button',{name:'Formularios',exact:true}).click();await active.getByRole('combobox',{name:'Zoom',exact:true}).selectOption(String(zoom));await expect(sheet).toHaveCSS('height',800*zoom+'px');
    await active.getByRole('button',{name:'Campo de texto',exact:true}).click();await scroller.evaluate((el,zoom)=>{const p=el.querySelector('.pdf-page[data-page="2"]')!,r=p.getBoundingClientRect(),s=el.getBoundingClientRect();el.scrollTop+=r.top-s.top+800*zoom*.72-100;el.scrollLeft=zoom===2?80:0;},zoom);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await expect(sheet).toHaveClass(/rendered/);const initial=await start();expect(initial.top).toBeGreaterThan(600);
    const r=await sheet.boundingBox();if(!r)throw new Error('Página ausente');await page.mouse.move(r.x+r.width*.45,r.y+r.height*.8);await page.mouse.down();await page.mouse.move(r.x+r.width*.68,r.y+r.height*.84,{steps:8});await page.mouse.up();await expect(active.locator('.design-field')).toHaveCount(1);await unchanged(initial);
    const field=active.locator('.design-field');
    for(let i=0;i<3;i++){const b=await field.locator('.design-field-box').boundingBox();if(!b)throw new Error('Campo ausente');const before=await start(),x=Number(await field.getAttribute('data-x'));await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+12,b.y+b.height/2+8,{steps:8});await page.mouse.up();await expect.poll(async()=>Number(await field.getAttribute('data-x'))).toBeGreaterThan(x);await unchanged(before);}
    let before=await start();const h=await field.locator('.field-resize.se').boundingBox();if(!h)throw new Error('Tirador ausente');await page.mouse.move(h.x+4,h.y+4);await page.mouse.down();await page.mouse.move(h.x+24,h.y+14,{steps:8});await page.mouse.up();await unchanged(before);
    before=await start();await active.getByRole('textbox',{name:'Nombre del campo',exact:true}).fill('Campo inferior');await active.getByRole('button',{name:'Aplicar propiedades del campo',exact:true}).click();await expect(field).toHaveAttribute('data-field-name','Campo inferior');await unchanged(before);
    for(const command of ['Deshacer (Ctrl+Z)','Rehacer (Ctrl+Y)']){before=await start();await active.getByRole('button',{name:command,exact:true}).click();await unchanged(before);}
    await page.screenshot({path:path.join(ctx.root,'campo-inferior-zoom-'+zoom+'.png')});
    // Returning to the original PDF bytes must not reapply its remembered page-top position.
    for(let i=0;i<6;i++){before=await start();await active.getByRole('button',{name:'Deshacer (Ctrl+Z)',exact:true}).click();await unchanged(before);}
    await expect(field).toHaveCount(0);before=await start();await active.getByRole('button',{name:'Rehacer (Ctrl+Y)',exact:true}).click();await expect(field).toHaveCount(1);await unchanged(before);expect(ctx.errors).toEqual([]);
  }finally{await ctx.close();}
});
