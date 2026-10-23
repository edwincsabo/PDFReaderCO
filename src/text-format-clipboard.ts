import{useSyncExternalStore}from'react';
import{copyTextFormat}from'./text-format.mjs';
export type CopiedTextFormat=ReturnType<typeof copyTextFormat>;
let copied:CopiedTextFormat|null=null;
const listeners=new Set<()=>void>();
export const textFormatClipboard={get:()=>copied,set:(value:CopiedTextFormat)=>{copied=Object.freeze({...value,originalRef:value.originalRef?Object.freeze({...value.originalRef}):null});for(const notify of listeners)notify();},clear:()=>{copied=null;for(const notify of listeners)notify();},subscribe:(notify:()=>void)=>{listeners.add(notify);return()=>{listeners.delete(notify);};}};
export const useTextFormatClipboard=()=>useSyncExternalStore(textFormatClipboard.subscribe,textFormatClipboard.get);
