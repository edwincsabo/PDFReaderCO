export function pageMap(count,operation,options={}){
  let pages=Array.from({length:count},(_,i)=>i),ids=options.indices||[];
  if(operation==='reorder')pages=[...ids];
  if(operation==='delete')pages=pages.filter(n=>!ids.includes(n));
  if(operation==='blank')pages.splice(options.at??count,0,null);
  if(operation==='duplicate')for(const n of [...ids].sort((a,b)=>b-a))pages.splice(n+1,0,n);
  return pages;
}
export function remapBookmarks(bookmarks,mapping){return (bookmarks||[]).map(b=>({...b,page:mapping.indexOf(b.page-1)+1})).filter(b=>b.page>0);}
