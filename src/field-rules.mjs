import {PDFName,PDFHexString,PDFString,PDFBool}from'pdf-lib';
import {normalizeFormRule}from'./form-rules.mjs';
const key=PDFName.of('PDFReaderCORules'),calculatedKey=PDFName.of('PDFReaderCOCalculated');
export function isCalculatedField(field){return field.acroField.dict.get(calculatedKey)===PDFBool.True;}
export function readFieldRule(field,kind='text'){
  const raw=field.acroField.dict.get(key);if(!raw)return{rule:null,ruleError:''};
  try{if(!(raw instanceof PDFString||raw instanceof PDFHexString))throw new Error();const text=raw.decodeText();if(text.length>16000)throw new Error();const value=JSON.parse(text);if(value.version!==1)throw new Error();return{rule:normalizeFormRule(value.rule,kind),ruleError:''};}catch{return{rule:null,ruleError:'Las reglas guardadas de este campo no son compatibles. Revísalas en Diseñar.'};}
}
export function writeFieldRule(field,value,kind='text'){
  const rule=normalizeFormRule({...value,format:value?.format||'none',requiredCheck:field.isRequired()},kind),wasCalculated=isCalculatedField(field);
  if(rule){field.acroField.dict.set(key,PDFHexString.fromText(JSON.stringify({version:1,rule})));}else field.acroField.dict.delete(key);
  if(rule?.calculation){field.acroField.dict.set(calculatedKey,PDFBool.True);field.enableReadOnly();}else if(wasCalculated){field.acroField.dict.delete(calculatedKey);field.disableReadOnly();}
  return rule;
}
