import{useSyncExternalStore}from'react';
import localization from'../electron/locale-core.cjs';
const locale=localization.createLocalization();
export const tr=(text:string|undefined,args:unknown[]=[]):string=>locale.tr(text,args);
export const translateMessage=(text:unknown):string=>locale.translateMessage(text);
export type Language='es'|'en';
export const getLanguage=():Language=>locale.getLanguage() as Language;
export const localeTag=()=>getLanguage()==='en'?'en-US':'es-CO';
export function setLanguage(language:Language){locale.setLanguage(language);document.documentElement.lang=language;try{localStorage.setItem('pdfco-language',language);}catch{}}
export const useLanguage=()=>useSyncExternalStore(locale.subscribe,getLanguage,getLanguage);
export async function initializeLanguage(){let language:Language='es';try{if(window.desktop)language=(await window.desktop.preferencesRead()).language;else if(localStorage.getItem('pdfco-language')==='en')language='en';}catch{}setLanguage(language);window.desktop?.onLanguage(setLanguage);}
