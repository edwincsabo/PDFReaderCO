import{tr}from'./i18n';
import type {FormDesign} from './types';
import {Button} from './ui';
import {ArrowUp,ArrowDown} from 'lucide-react';
import {ChoiceInput} from './ChoiceInput';

export function ChoiceListProperties({value,onChange,disabled}:{value:FormDesign;onChange:(value:FormDesign)=>void;disabled:boolean}){
  const selected=Array.isArray(value.defaultValue)?value.defaultValue:[];
  const move=(index:number,step:number)=>{const options=[...value.options];[options[index],options[index+step]]=[options[index+step],options[index]];onChange({...value,options});};
  return <fieldset className="choice-list-properties" disabled={disabled}><legend>{tr("Opciones de la lista")}</legend>
    <label className="checkbox-label"><input type="checkbox" checked={!!value.multiple} onChange={e=>onChange({...value,multiple:e.target.checked,defaultValue:e.target.checked?selected:selected.slice(0,1)})}/>{tr(" Permitir selección múltiple")}</label>
    <label>{tr("Opciones, una por línea")}<textarea aria-label={tr("Opciones del campo")} rows={5} value={value.options.join('\n')} onChange={e=>{const options=e.target.value.split(/\r?\n/);onChange({...value,options,defaultValue:selected.filter(v=>options.map(o=>o.trim()).includes(v))});}}/></label>
    <p>{tr("Edita o elimina líneas para cambiar las opciones. Usa las flechas para ordenarlas. Máximo 100 opciones diferentes.")}</p>
    <ol className="choice-option-order">{value.options.map((option,index)=><li key={index}><span>{option||tr("Opción vacía")}</span><Button title={tr("Subir opción {0}",[(index+1)])} disabled={disabled||index===0} onClick={()=>move(index,-1)} icon={ArrowUp}/><Button title={tr("Bajar opción {0}",[(index+1)])} disabled={disabled||index===value.options.length-1} onClick={()=>move(index,1)} icon={ArrowDown}/></li>)}</ol>
    <label>{tr("Selección inicial")}<ChoiceInput aria-label={tr("Selección inicial")} list multiple={!!value.multiple} value={selected} options={value.options.filter(v=>v.trim()).map(v=>({value:v.trim(),label:v.trim()}))} onValue={v=>onChange({...value,defaultValue:Array.isArray(v)?v:v?[String(v)]:[]})}/></label>
    <Button disabled={disabled||!selected.length} onClick={()=>onChange({...value,defaultValue:[]})}>{tr("Limpiar selección inicial")}</Button>
    <p>{value.multiple?tr("Usa Ctrl + clic para elegir opciones separadas o Mayús + clic para un intervalo."):tr("Elige una opción o deja la selección vacía.")}{tr(" Al pasar a selección única se conserva como máximo una opción. Cambiar la selección inicial cambia también la respuesta actual al aplicar.")}</p>
  </fieldset>;
}
