import{tr}from'./i18n';
import {useLayoutEffect,useRef,type SelectHTMLAttributes} from 'react';
import type {FieldValue} from './types';

type Props=Omit<SelectHTMLAttributes<HTMLSelectElement>,'value'|'onChange'> & {list?:boolean;value:FieldValue;options:{value:string;label:string}[];onValue:(value:FieldValue)=>void};
export function ChoiceInput({list,multiple,value,options,onValue,...props}:Props){
  const root=useRef<HTMLSelectElement>(null),selected=Array.isArray(value)?value:typeof value==='string'&&value?[value]:[];
  // React otherwise selects the first enabled option when a single list is empty.
  useLayoutEffect(()=>{if(list&&!multiple&&!selected.length&&root.current)root.current.selectedIndex=-1;});
  return <select {...props} ref={root} multiple={multiple} size={list?Math.max(2,Math.min(6,options.length)):undefined} value={multiple?selected:selected[0]||''} onChange={e=>onValue(multiple?Array.from(e.target.selectedOptions).map(o=>o.value):e.target.value)}>
    {!list&&!multiple&&<option value="">{tr("Sin seleccionar")}</option>}{options.map((o,index)=><option key={index} value={o.value}>{o.label}</option>)}
  </select>;
}
