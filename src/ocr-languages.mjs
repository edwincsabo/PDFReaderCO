export const OCR_LANGUAGES={spa:'Español',eng:'Inglés',fra:'Francés',deu:'Alemán',ita:'Italiano',por:'Portugués'};
export function ocrLanguage(value){
  const parts=typeof value==='string'?value.split('+'):[];
  if(!parts.length||parts.length>3||new Set(parts).size!==parts.length||parts.some(p=>!Object.hasOwn(OCR_LANGUAGES,p)))throw new Error('Elige entre uno y tres idiomas locales diferentes.');
  return value;
}
