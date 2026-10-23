import{localeTag}from'./i18n';
import{tr,translateMessage}from'./i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { History, RefreshCw, RotateCcw, Trash2, ShieldCheck } from 'lucide-react';
import { Button, Modal } from './ui';
import { confirmAction, messageOf } from './bridge';
import type { HistoryData, HistoryVersion, OpenFile } from './types';

const size=(bytes:number)=>bytes<1024*1024?`${(bytes/1024).toFixed(1)} KB`:`${(bytes/(1024*1024)).toFixed(1)} MB`;
const date=(value:string)=>new Date(value).toLocaleString(localeTag(),{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
export function VersionHistory({initialId,onOpen,onClose}:{initialId?:string;onOpen:(file:OpenFile)=>void;onClose:()=>void}){
  const [data,setData]=useState<HistoryData|null>(null),[selected,setSelected]=useState(initialId||''),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const request=useRef(0),alive=useRef(true);
  const refresh=useCallback(async()=>{
    const current=++request.current;
    try{if(!window.desktop)throw new Error('El historial está disponible en la aplicación de escritorio.');const result=await window.desktop.listHistory();if(!alive.current||current!==request.current)return;setData(result);setSelected(id=>result.groups.some(g=>g.id===id)?id:result.groups[0]?.id||'');}
    catch(e){if(alive.current&&current===request.current)setError(messageOf(e));}
  },[]);
  useEffect(()=>{alive.current=true;refresh();const changed=()=>{refresh();};window.addEventListener('pdfco-history-changed',changed);return()=>{alive.current=false;request.current++;window.removeEventListener('pdfco-history-changed',changed);};},[refresh]);
  const run=async(label:string,action:()=>Promise<void>)=>{if(busy)return;setBusy(label);setError('');setNotice('');try{await action();}catch(e){setError(messageOf(e).split('Error: ').pop()||messageOf(e));}finally{if(alive.current)setBusy('');}};
  const group=data?.groups.find(g=>g.id===selected);
  const restore=(version:HistoryVersion)=>run('Abriendo versión…',async()=>{if(!group||!window.desktop)return;onOpen(await window.desktop.readHistoryVersion(group.id,version.id));});
  const remove=(version:HistoryVersion)=>run('Eliminando versión…',async()=>{
    if(!group||!window.desktop||!await confirmAction(`Eliminar la versión ${version.number} de «${group.name}» del historial local. Esta acción no se puede deshacer.`))return;
    await window.desktop.deleteHistoryVersion(group.id,version.id);await refresh();setNotice('Versión eliminada.');window.dispatchEvent(new Event('pdfco-history-changed'));
  });
  const clear=()=>run('Limpiando historial…',async()=>{
    if(!group||!window.desktop||!await confirmAction(`Eliminar las versiones de «${group.name}» del historial local. Se conservarán las copias que protegen trabajo sin guardar. Esta acción no se puede deshacer.`))return;
    const result=await window.desktop.clearHistory(group.id);await refresh();setNotice(`${result.removed} versiones eliminadas.${result.kept?' Se conservaron las copias de recuperación activas.':''}`);window.dispatchEvent(new Event('pdfco-history-changed'));
  });
  return <Modal title={tr("Historial de versiones")} wide onClose={()=>{if(!busy)onClose();}}>
    <p>{tr("Restaura una copia en otra pestaña para revisar o continuar una versión anterior. El documento abierto y el archivo original se conservan.")}</p>
    {error&&<div className="history-error" role="alert">{translateMessage(error)}</div>}{notice&&<div className="history-notice" role="status">{translateMessage(notice)}</div>}
    {data?<>
      <div className="history-storage"><span><strong>{size(data.usageBytes)}</strong>{tr(" de ")}{size(data.maxBytes)}{tr(" usados")}</span><span>{data.groups.length}{tr(" de ")}{data.maxDocuments}{tr(" documentos · Hasta ")}{data.maxVersions}{tr(" versiones por documento")}</span><meter aria-label={tr("Espacio de versiones recuperables")} min={0} max={data.maxBytes} value={data.usageBytes}/></div>
      {data.groups.length?<div className="history-browser">
        <nav className="history-documents" aria-label={tr("Documentos con versiones")}>{data.groups.map(item=><button type="button" className="history-document" key={item.id} aria-label={tr("Historial de {0}",[item.name])} aria-current={selected===item.id?'true':undefined} disabled={!!busy} onClick={()=>{setSelected(item.id);setError('');setNotice('');}}><History size={17}/><span><strong>{item.name}</strong><small>{item.versions.length}{tr(" versiones · ")}{date(item.updated)}</small></span></button>)}</nav>
        <section className="history-versions" aria-label={tr("Versiones del documento")}>{group&&<><h3>{group.name}</h3><div className="history-version-list">{group.versions.map(version=><article className="history-version" key={version.id} data-version-number={version.number} aria-label={tr("Versión {0}",[version.number])}><div><strong>{tr("Versión ")}{version.number}</strong><time dateTime={version.created}>{date(version.created)}</time><small>{size(version.size)}</small>{version.protected&&<span className="history-protected"><ShieldCheck size={12}/>{tr(" Recuperación activa")}</span>}</div><div className="history-version-actions"><Button icon={RotateCcw} disabled={!!busy} onClick={()=>restore(version)}>{tr("Restaurar copia")}</Button><Button icon={Trash2} disabled={!!busy||version.protected} title={version.protected?tr("Protege trabajo sin guardar"):tr("Eliminar versión {0}",[version.number])} onClick={()=>remove(version)}/></div></article>)}</div><Button icon={Trash2} disabled={!!busy} onClick={clear}>{tr("Eliminar historial")}</Button></>}</section>
      </div>:<div className="history-empty"><History size={30}/><h3>{tr("Todavía no hay versiones guardadas")}</h3><p>{tr("Al modificar un documento con la recuperación automática activada se conservarán sus versiones recientes.")}</p></div>}
      <p className="dialog-note">{tr("Las copias se guardan en este equipo, sin cifrado propio. Al guardar manualmente o cerrar se conserva el historial. La limpieza elimina versiones antiguas según los límites y protege la copia más reciente de cada documento y las recuperaciones activas. Puedes eliminar las versiones que ya no necesites. Si no hay espacio sin borrar copias protegidas, se informa en la barra de recuperación.")}</p>
    </>:<p role="status">{tr("Cargando versiones…")}</p>}
    <div className="modal-actions"><span className="history-progress" role="status">{busy}</span><Button icon={RefreshCw} disabled={!!busy} onClick={()=>{setError('');refresh();}}>{tr("Actualizar")}</Button><Button disabled={!!busy} onClick={onClose}>{tr("Cerrar")}</Button></div>
  </Modal>;
}

