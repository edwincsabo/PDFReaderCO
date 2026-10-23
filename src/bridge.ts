import{translateMessage}from'./i18n';
import type { OpenFile, Model } from './types';
export async function chooseFiles(accept='.pdf,.pdfco', multiple=true):Promise<File[]> {
  return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept=accept;input.multiple=multiple;input.onchange=()=>resolve(Array.from(input.files||[]));input.oncancel=()=>resolve([]);input.click();});
}
export async function openFiles():Promise<OpenFile[]> {
  if(window.desktop)return window.desktop.open();
  return Promise.all((await chooseFiles()).map(async file=>({name:file.name,id:crypto.randomUUID(),bytes:new Uint8Array(await file.arrayBuffer())})));
}
export async function saveFile(bytes:Uint8Array,name:string,kind='pdf') {
  if(window.desktop)return window.desktop.save(bytes,name,kind);
  const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)]));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);return name;
}
export async function saveAttachmentFile(bytes:Uint8Array,name:string){
  if(window.desktop)return window.desktop.saveAttachment(bytes,name);
  const safe=name.split(/[\\/]/).pop()?.replace(/[<>:"\\/|?*\u0000-\u001f]/g,'_')||'Adjunto.bin';return saveFile(bytes,safe,'attachment');
}
export const confirmAction=(message:string)=>window.desktop?window.desktop.confirm(translateMessage(message)):Promise.resolve(window.confirm(translateMessage(message)));
export function externalLink(url:string) {if(window.desktop)return window.desktop.external(url);if(/^https?:|^mailto:/i.test(url)&&window.confirm(`Abrir ${url}`))window.open(url,'_blank','noopener');}
export const emptyModel=():Model=>({marks:[],forms:{}});
export function fileData(file:File):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(file);});}
export const baseName=(name:string)=>name.replace(/\.(pdf|pdfco)$/i,'');
export function messageOf(error:unknown) {return translateMessage(error instanceof Error?error.message:String(error));}

