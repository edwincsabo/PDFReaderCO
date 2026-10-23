const { app, BrowserWindow, Menu, dialog, ipcMain, shell, safeStorage } = require('electron');
const{createPreferences}=require('./preferences.cjs');const{createLocalization}=require('./locale-core.cjs');
const uiLocale=createLocalization();
const{createAiSettings}=require('./ai-settings.cjs');const{createAiService}=require('./ai-service.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { createRecoveryStore } = require('./recovery-store.cjs');
const { safeAttachmentName } = require('./attachment-name.cjs');
const { createBatchFiles } = require('./batch-files.cjs');
const {createLocalFonts}=require('./local-fonts.cjs');
const localFonts=createLocalFonts([path.join(process.env.WINDIR||'C:/Windows','Fonts'),process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Microsoft','Windows','Fonts')]);
const appVersion=require('../package.json').version;
let win, dirty = false, recent = [], ready = false, batchRunning = false;
const pending = [];
if (process.env.PDFREADERCO_TEST_DATA) app.setPath('userData', path.resolve(process.env.PDFREADERCO_TEST_DATA));
const configPath = () => path.join(app.getPath('userData'), 'recent.json');
function localizeDialog(options){const next={...options};for(const key of ['title','message','detail'])if(typeof next[key]==='string')next[key]=uiLocale.translateMessage(next[key]);if(Array.isArray(next.buttons))next.buttons=next.buttons.map(s=>uiLocale.tr(s));if(Array.isArray(next.filters))next.filters=next.filters.map(f=>({...f,name:uiLocale.tr(f.name)}));return next;}
const uiDialog=Object.fromEntries(['showMessageBox','showMessageBoxSync','showOpenDialog','showSaveDialog'].map(method=>[method,(...args)=>{args[args.length-1]=localizeDialog(args.at(-1));return dialog[method](...args);} ]));
uiDialog.showErrorBox=(title,message)=>dialog.showErrorBox(uiLocale.tr(title),uiLocale.translateMessage(message));
const localizeMenu=items=>items.map(item=>({...item,...typeof item.label==='string'?{label:uiLocale.tr(item.label)}:{},...Array.isArray(item.submenu)?{submenu:localizeMenu(item.submenu)}:{}}));
const filters = [{ name:'PDF y proyectos PDFReaderCO', extensions:['pdf','pdfco'] }];
const limit = 256 * 1024 * 1024;
function sender(event) { if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Origen no autorizado.'); }
async function readDocument(file) {
  if (!['.pdf','.pdfco'].includes(path.extname(file).toLowerCase())) throw new Error('Selecciona un archivo PDF o PDFCO.');
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > limit) throw new Error('El límite de apertura es 256 MB por archivo.');
  const bytes = new Uint8Array(await fs.readFile(file));
  const entry = { id:randomUUID(), name:path.basename(file), path:file, opened:new Date().toISOString() };
  recent = [entry, ...recent.filter(x => x.path !== file)].slice(0,16);
  await fs.writeFile(configPath(), JSON.stringify(recent), 'utf8');
  return { name:entry.name, bytes, id:randomUUID(), historyId:'file-'+createHash('sha256').update(path.resolve(file).toLowerCase()).digest('hex') };
}
async function openPaths(paths) {
  for (const file of paths) {
    try { const doc = await readDocument(file); if (ready) win.webContents.send('action','document',doc); else pending.push(doc); }
    catch (error) { uiDialog.showErrorBox('No se pudo abrir el documento',error.message); }
  }
}
function action(name) { win?.webContents.send('action', name); }
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
app.on('second-instance', (_, argv) => { if (win?.isMinimized()) win.restore(); win?.focus(); openPaths(argv.filter(x => /\.(pdf|pdfco)$/i.test(x))); });
app.whenReady().then(async () => {
  await fs.mkdir(app.getPath('userData'), {recursive:true});
  const preferences=createPreferences(app.getPath('userData'));uiLocale.setLanguage((await preferences.read()).language);
  const recovery=createRecoveryStore(path.join(app.getPath('userData'),'recovery'));
  const batch=createBatchFiles({directory:path.join(app.getPath('userData'),'batch')});
  const aiSettings=createAiSettings({directory:app.getPath('userData'),secure:safeStorage}),ai=createAiService({settings:aiSettings,fetchImpl:(...args)=>globalThis.fetch(...args)});
  app.on('before-quit',()=>ai.cancelAll());
  try { const data = JSON.parse(await fs.readFile(configPath(),'utf8')); if (Array.isArray(data)) recent = data.filter(x=> typeof x.id==='string' && typeof x.path==='string' && typeof x.name==='string').slice(0,16); } catch {}
  win = new BrowserWindow({width:1440,height:960,minWidth:1050,minHeight:700,backgroundColor:'#f5f6f8',title:'PDFReaderCO',icon:path.join(__dirname,'../build/icon.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  // The renderer owns keyboard shortcuts so a gesture cannot be dispatched twice.
  win.webContents.setIgnoreMenuShortcuts(true);
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_,__,callback)=>callback(false));
  win.webContents.session.on('will-download',event=>event.preventDefault());
  win.on('close', event => { if ((dirty||batchRunning) && uiDialog.showMessageBoxSync(win,{type:'question',buttons:['Seguir editando','Cerrar sin guardar'],defaultId:0,cancelId:0,title:'Trabajo en curso',message:batchRunning?'Hay un lote en curso. Cerrar interrumpirá los archivos pendientes; las copias terminadas se conservarán.':'Hay documentos con cambios sin guardar.'})!==1) event.preventDefault(); });
  const send = name => () => action(name);
  const installMenu=()=>Menu.setApplicationMenu(Menu.buildFromTemplate(localizeMenu([
    {label:'Archivo',submenu:[{label:'Procesar por lotes…',click:send('batch')},{label:'Abrir…',accelerator:'CmdOrCtrl+O',click:send('open')},{label:'Nuevo PDF',accelerator:'CmdOrCtrl+N',click:send('new')},{type:'separator'},{label:'Guardar como…',accelerator:'CmdOrCtrl+S',click:send('save')},{label:'Guardar copia con texto y marcas incorporados…',click:send('saveflat')},{label:'Guardar proyecto editable…',accelerator:'CmdOrCtrl+Shift+S',click:send('project')},{label:'Editar índice del PDF…',click:send('outline')},{label:'Archivos adjuntos…',click:send('attachments')},{label:'Historial de versiones…',click:send('history')},{label:'Imprimir…',accelerator:'CmdOrCtrl+P',click:send('print')},{type:'separator'},{role:'quit',label:'Salir'}]},
    {label:'Edición',submenu:[{label:'Deshacer',accelerator:'CmdOrCtrl+Z',click:send('undo')},{label:'Rehacer',accelerator:'CmdOrCtrl+Y',click:send('redo')},{type:'separator'},{label:'Copiar',accelerator:'CmdOrCtrl+C',click:send('copy')},{label:'Pegar',accelerator:'CmdOrCtrl+V',click:send('paste')},{label:'Duplicar selección',accelerator:'CmdOrCtrl+D',click:send('duplicate')},{label:'Seleccionar todo',accelerator:'CmdOrCtrl+A',click:send('selectAll')},{label:'Buscar',accelerator:'CmdOrCtrl+F',click:send('search')},{label:'Buscar y reemplazar…',accelerator:'CmdOrCtrl+H',click:send('replace')}]},
    {label:'Ver',submenu:[{label:'Configuración…',click:send('settings')},{label:'Comparar documentos…',click:send('compare')},{label:'Pantalla completa',accelerator:'F11',click:()=>win.setFullScreen(!win.isFullScreen())},{role:'toggleDevTools',visible:!app.isPackaged},{role:'resetZoom',label:'Restablecer interfaz'}]},
    {label:'Ayuda',submenu:[{label:'Acerca de PDFReaderCO',click:()=>uiDialog.showMessageBox(win,{title:'PDFReaderCO '+appVersion,message:'PDFReaderCO',detail:'Lector y herramientas PDF locales para Windows.\nPDF.js y pdf-lib.\nAplicación independiente, sin afiliación con Adobe.\nLa firma manuscrita es una marca visual, no una firma digital certificada.'})}]}
  ]))); installMenu();
  ipcMain.handle('preferences:read',event=>{sender(event);return preferences.read();});
  ipcMain.handle('preferences:save',async(event,value)=>{sender(event);const result=await preferences.save(value);uiLocale.setLanguage(result.language);installMenu();win.webContents.send('ui:language',result.language);return result;});
  ipcMain.handle('fonts:list',event=>{sender(event);return localFonts.list();});
  ipcMain.handle('ai:status',event=>{sender(event);return aiSettings.status();});
  ipcMain.handle('ai:save',(event,value)=>{sender(event);return aiSettings.save(value);});
  ipcMain.handle('ai:remove',(event,provider)=>{sender(event);return aiSettings.remove(provider);});
  ipcMain.handle('ai:reset',event=>{sender(event);return aiSettings.reset();});
  ipcMain.handle('ai:models',(event,provider)=>{sender(event);return ai.models(provider);});
  ipcMain.handle('ai:ask',(event,value)=>{sender(event);return ai.ask(value);});
  ipcMain.handle('ai:cancel',(event,id)=>{sender(event);return ai.cancel(id);});
  ipcMain.handle('fonts:read',(event,id)=>{sender(event);return localFonts.read(id);});
  ipcMain.handle('files:open',async event=>{sender(event);const result=await uiDialog.showOpenDialog(win,{properties:['openFile','multiSelections'],filters});return result.canceled?[]:Promise.all(result.filePaths.map(readDocument));});
  ipcMain.handle('batch:restore',event=>{sender(event);return batch.restore();});
  ipcMain.handle('batch:save',(event,state)=>{sender(event);return batch.save(state);});
  ipcMain.handle('batch:clear',event=>{sender(event);return batch.clear();});
  ipcMain.handle('batch:choose',async event=>{sender(event);const result=await uiDialog.showOpenDialog(win,{title:'Añadir PDF al lote',properties:['openFile','multiSelections'],filters:[{name:'Documentos PDF',extensions:['pdf']}]});return result.canceled?[]:batch.add(result.filePaths);});
  ipcMain.handle('batch:folder',async event=>{sender(event);const result=await uiDialog.showOpenDialog(win,{title:'Carpeta para las copias del lote',properties:['openDirectory','createDirectory']});return result.canceled?null:batch.folder(result.filePaths[0]);});
  ipcMain.handle('batch:read',(event,id)=>{sender(event);return batch.read(id);});
  ipcMain.handle('batch:write',(event,request)=>{sender(event);return batch.write(request);});
  ipcMain.handle('batch:release',(event,ids)=>{sender(event);batch.release(ids);});
  ipcMain.on('batch:running',(event,value)=>{sender(event);batchRunning=!!value;});
  ipcMain.handle('recovery:list',event=>{sender(event);return recovery.list();});
  ipcMain.handle('recovery:read',(event,id)=>{sender(event);return recovery.read(id);});
  ipcMain.handle('recovery:save',(event,{id,name,bytes,historyId})=>{sender(event);return recovery.write(id,name,bytes,historyId);});
  ipcMain.handle('recovery:discard',(event,id)=>{sender(event);return recovery.remove(id);});
  ipcMain.handle('recovery:history',event=>{sender(event);return recovery.listHistory();});
  ipcMain.handle('recovery:version-read',(event,{historyId,versionId})=>{sender(event);return recovery.readVersion(historyId,versionId);});
  ipcMain.handle('recovery:version-delete',(event,{historyId,versionId})=>{sender(event);return recovery.deleteVersion(historyId,versionId);});
  ipcMain.handle('recovery:history-clear',(event,historyId)=>{sender(event);return recovery.clearHistory(historyId);});
  ipcMain.handle('window:edit',(event,command)=>{sender(event);if(!['copy','paste','selectAll','undo','redo'].includes(command))throw new Error('Comando de edición inválido.');win.webContents[command]();});
  ipcMain.handle('files:recent',event=>{sender(event);return recent.map(({id,name,opened})=>({id,name,opened}));});
  ipcMain.handle('files:openRecent',async(event,id)=>{sender(event);const entry=recent.find(x=>x.id===id);if(!entry)throw new Error('El archivo ya no está en recientes.');return readDocument(entry.path);});
  ipcMain.handle('files:save',async(event,{bytes,name,kind})=>{
    sender(event);
    const ext = {pdf:'pdf',project:'pdfco',text:'txt',png:'png',json:'json',csv:'csv',xlsx:'xlsx','pdf-copy':'pdf'}[kind];
    if (!ext || !(bytes instanceof Uint8Array) || bytes.byteLength>limit) throw new Error('Datos de exportación inválidos o mayores de 256 MB.');
    const result=await uiDialog.showSaveDialog(win,{defaultPath:path.basename(String(name||'Documento')).replace(/[<>:"/\\|?*]/g,'_'),filters:[{name:ext.toUpperCase(),extensions:[ext]}]});
    if(result.canceled)return null;
    const dest = result.filePath.toLowerCase().endsWith('.'+ext)?result.filePath:result.filePath+'.'+ext;
    const temporary=path.join(path.dirname(dest),'.pdfreaderco-'+randomUUID()+'.tmp');
    try { await fs.writeFile(temporary,bytes,{flag:'wx'}); if(kind==='pdf-copy'){try{await fs.copyFile(temporary,dest,require('node:fs').constants.COPYFILE_EXCL);}catch(error){if(error.code==='EEXIST')throw new Error('El destino ya existe. Elige otro nombre para conservar ambos archivos.');throw error;}}else await fs.rename(temporary,dest); } finally { await fs.rm(temporary,{force:true}).catch(()=>{}); }
    return path.basename(dest);
  });
  ipcMain.on('window:dirty',(event,value)=>{sender(event);dirty=!!value;win.setTitle('PDFReaderCO'+(dirty?' · Cambios sin guardar':''));});
  ipcMain.handle('files:saveAttachment',async(event,{bytes,name})=>{
    sender(event);if(!(bytes instanceof Uint8Array)||bytes.byteLength>32*1024*1024)throw new Error('El adjunto supera los 32 MB o no contiene datos válidos.');
    const safe=safeAttachmentName(name),ext=path.extname(safe).slice(1),filters=/^[a-z0-9]{1,12}$/i.test(ext)?[{name:'Archivo adjunto',extensions:[ext]},{name:'Todos los archivos',extensions:['*']}]:[{name:'Todos los archivos',extensions:['*']}];
    const result=await uiDialog.showSaveDialog(win,{defaultPath:safe,filters});if(result.canceled)return null;
    const dest=result.filePath,temporary=path.join(path.dirname(dest),'.pdfreaderco-'+randomUUID()+'.tmp');
    try{await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,dest);}finally{await fs.rm(temporary,{force:true}).catch(()=>{});}return path.basename(dest);
  });
  ipcMain.handle('window:confirm',async(event,message)=>{sender(event);return (await uiDialog.showMessageBox(win,{type:'question',buttons:['Cancelar','Continuar'],defaultId:0,cancelId:0,message:String(message).slice(0,2000)})).response===1;});
  ipcMain.handle('window:external',async(event,url)=>{sender(event);const parsed=new URL(url);if(!['https:','http:','mailto:'].includes(parsed.protocol))throw new Error('Tipo de enlace no permitido.');if((await uiDialog.showMessageBox(win,{type:'question',buttons:['Cancelar','Abrir enlace'],defaultId:0,cancelId:0,message:'Abrir en la aplicación predeterminada',detail:parsed.href})).response===1)await shell.openExternal(parsed.href);});
  ipcMain.handle('window:fullscreen',event=>{sender(event);win.setFullScreen(!win.isFullScreen());});
  win.webContents.once('did-finish-load',()=>{ready=true;for(const doc of pending)win.webContents.send('action','document',doc);pending.length=0;});
  await win.loadFile(path.join(__dirname,'../dist/index.html'));
  await openPaths(process.argv.slice(1).filter(x=>/\.(pdf|pdfco)$/i.test(x)));
});
app.on('window-all-closed',()=>app.quit());
}



