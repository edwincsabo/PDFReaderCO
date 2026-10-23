import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { PDFProxy } from './types';

type ViewportSnapshot={top:number;left:number;width:number;height:number;page:number;document:PDFProxy|null};

// A PDF reload temporarily removes its pages. Keep the scroll extent until all
// replacement page boxes have their real geometry, then restore the exact view.
export function useViewportRestore(root:RefObject<HTMLDivElement>,pdf:PDFProxy|null,loading:boolean,active:boolean,error:string){
  const [snapshot,setSnapshot]=useState<ViewportSnapshot|null>(null),pending=useRef<ViewportSnapshot|null>(null);
  const preserve=useCallback((page:number)=>{
    const element=root.current;if(!element)return;
    const next={top:element.scrollTop,left:element.scrollLeft,width:element.scrollWidth,height:element.scrollHeight,page,document:pdf};
    pending.current=next;setSnapshot(next);
  },[root,pdf]);
  useLayoutEffect(()=>{
    const element=root.current;if(!snapshot||!element||!active)return;
    if(error){pending.current=null;setSnapshot(null);return;}
    const restore=()=>{
      if(pending.current!==snapshot)return;
      element.scrollTop=snapshot.top;element.scrollLeft=snapshot.left;
      if(loading||!pdf||pdf===snapshot.document)return;
      if(element.querySelectorAll('.pdf-page[data-layout-ready="true"]').length!==pdf.numPages)return;
      pending.current=null;setSnapshot(null);
    };
    const observer=new MutationObserver(restore);
    observer.observe(element,{subtree:true,childList:true,attributes:true,attributeFilter:['data-layout-ready','style']});
    restore();return()=>observer.disconnect();
  },[root,snapshot,pdf,loading,active,error]);
  return {snapshot,pending,preserve};
}
