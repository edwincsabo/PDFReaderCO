import type { BookmarkEntry } from './types';
export function readReadingState(id:string,count:number):{page:number;bookmarks:BookmarkEntry[]}{
  try{const value=JSON.parse(localStorage.getItem('pdfco-reading-'+id)||'{}');return {page:Number.isInteger(value.page)?Math.min(count,Math.max(1,value.page)):1,bookmarks:Array.isArray(value.bookmarks)?value.bookmarks.filter((b:BookmarkEntry)=>typeof b.id==='string'&&Number.isInteger(b.page)&&b.page>0&&b.page<=count&&typeof b.label==='string').slice(0,1000):[]};}catch{return {page:1,bookmarks:[]};}
}
export function writeReadingState(id:string,page:number,bookmarks:BookmarkEntry[]){try{localStorage.setItem('pdfco-reading-'+id,JSON.stringify({page,bookmarks}));}catch{}}
