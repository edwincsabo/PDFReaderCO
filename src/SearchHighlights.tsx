import {useEffect,useState}from'react';
import type{PDFPageProxy}from'pdfjs-dist';
import {searchableContent,searchMatches}from'./search-text.mjs';
export type SearchState={query:string;caseSensitive:boolean;wholeWord?:boolean;enabled?:boolean;active?:{page:number;start:number;length:number;markId?:string}|null};
export function SearchHighlights({page,number,root,text,ready,search,width,height}:{page:PDFPageProxy;number:number;root:HTMLElement;text:HTMLElement;ready:boolean;search:SearchState;width:number;height:number}){
  const [rects,setRects]=useState<{x:number;y:number;w:number;h:number;active:boolean}[]>([]);
  useEffect(()=>{
    let stopped=false;setRects([]);if(!ready||search.enabled===false||!search.query.trim())return;
    (async()=>{const content=searchableContent((await page.getTextContent()).items);if(stopped)return;
      const spans=Array.from(text.querySelectorAll<HTMLElement>('span')).filter(s=>!!s.firstChild&&s.firstChild.nodeType===Node.TEXT_NODE),bounds=root.getBoundingClientRect(),found=[];
      // PDF.js omits empty spans from the DOM. Keep offsets from the source items.
      const offsets=content.spans.filter((s:any)=>s.length>0);
      for(const hit of searchMatches(content.text,search.query,search.caseSensitive,search.wholeWord)){
        const selected=search.active?.page===number&&!search.active.markId&&search.active.start===hit.start;
        for(let i=0;i<offsets.length;i++){const item=offsets[i],span=spans[i],start=Math.max(0,hit.start-item.start),end=Math.min(item.length,hit.start+hit.length-item.start);if(!span||end<=start)continue;
          const range=document.createRange();range.setStart(span.firstChild!,Math.min(start,span.textContent?.length||0));range.setEnd(span.firstChild!,Math.min(end,span.textContent?.length||0));
          for(const r of Array.from(range.getClientRects()))if(r.width&&r.height)found.push({x:(r.left-bounds.left)*width/bounds.width,y:(r.top-bounds.top)*height/bounds.height,w:r.width*width/bounds.width,h:r.height*height/bounds.height,active:selected});
        }
      }
      if(!stopped)setRects(found);
    })().catch(()=>{});return()=>{stopped=true;};
  },[page,ready,search.query,search.caseSensitive,search.wholeWord,search.enabled,search.active,number,width,height,root,text]);
  useEffect(()=>{const frame=requestAnimationFrame(()=>{const target=root.querySelector<HTMLElement>('.search-hit.active');target?.scrollIntoView({block:'nearest',inline:'nearest'});});return()=>cancelAnimationFrame(frame);},[rects,root]);
  return <div className="search-highlights" aria-hidden="true">{rects.map((r,i)=><span key={i} className={'search-hit '+(r.active?'active':'')} style={{left:r.x,top:r.y,width:r.w,height:r.h}}/>)}</div>;
}
