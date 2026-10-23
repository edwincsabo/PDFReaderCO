const word=/[\p{L}\p{N}\p{M}_]/u;
export function searchMatches(text,query,caseSensitive=false,wholeWord=false,limit=5001){
  if(!query||!query.trim())return[];
  const pattern=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),caseSensitive?'gu':'giu'),hits=[];
  for(const m of text.matchAll(pattern)){
    const start=m.index,length=m[0].length,end=start+length,previous=Array.from(text.slice(Math.max(0,start-2),start)).at(-1)||'',next=Array.from(text.slice(end,end+2))[0]||'';
    if(!wholeWord||!word.test(previous)&&!word.test(next)){hits.push({start,length});if(hits.length>=limit)break;}
  }
  return hits;
}
export function searchableContent(items){
  let text='';const spans=[];
  for(const item of items)if('str'in item){spans.push({start:text.length,length:item.str.length});text+=item.str+(item.hasEOL?'\n':' ');}
  return{text,spans};
}
