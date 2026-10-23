const stop=new Set('de la el los las un una unos unas y o a en es que del al por para con se su sus lo como qué cuál cuales cuáles dónde cuando cuando me mi te tu tú favor documento pdf página paginas páginas puede puedes sobre este esta esto eso más mas resumir resumen explicar extraer requisitos tareas puntos clave the a an is are of in on to for and or what how where this that please document'.split(' '));
const words=text=>Array.from(text.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu,'').matchAll(/[\p{L}\p{N}]{2,}/gu),m=>m[0]).filter(w=>!stop.has(w));
export function aiChunks(pages){
  const out=[];for(const p of pages){let start=0;while(start<p.text.length){let end=Math.min(start+1800,p.text.length);if(end<p.text.length){const edge=p.text.lastIndexOf(' ',end);if(edge>start+1000)end=edge;}const text=p.text.slice(start,end);if(text.trim())out.push({page:p.page,start,text});if(end===p.text.length)break;start=Math.max(start+1,end-160);}}
  return out;
}
export function selectAiContext(pages,question,mode='ask',budget=24000,history=[]){
  if(!Number.isInteger(budget)||budget<4000||budget>96000)throw new Error('El contexto debe estar entre 4000 y 96000 caracteres.');
  const chunks=aiChunks(pages);if(!chunks.length)throw new Error('No se encontró texto en este rango. Aplica OCR local a las páginas escaneadas y vuelve a preparar la consulta.');
  const tokens=[...new Set(words(question+' '+history.filter(m=>m.role==='user').slice(-2).map(m=>m.content).join(' ')))],df=new Map();
  const bags=chunks.map(c=>{const counts=new Map();for(const w of words(c.text))counts.set(w,(counts.get(w)||0)+1);for(const w of tokens)if(counts.has(w))df.set(w,(df.get(w)||0)+1);return counts;});
  const ranked=chunks.map((c,i)=>({i,score:tokens.reduce((sum,w)=>sum+(bags[i].has(w)?(1+Math.log(bags[i].get(w)))*Math.log(1+chunks.length/(1+(df.get(w)||0))):0),0)})).sort((a,b)=>b.score-a.score||a.i-b.i),relevant=mode==='ask'&&ranked[0].score>0;
  // Overview samples span the range instead of silently taking only its start.
  const slots=Math.min(chunks.length,32,Math.floor(budget/1800));
  const order=relevant?ranked.map(r=>r.i):Array.from({length:slots},(_,i)=>Math.floor(i*(chunks.length-1)/Math.max(1,slots-1)));
  const chosen=[];let chars=0;for(const i of order){const c=chunks[i];if(chosen.length>=32)break;if(chars+c.text.length>budget)continue;chosen.push(i);chars+=c.text.length;}
  chosen.sort((a,b)=>a-b);const excerpts=chosen.map(i=>chunks[i]);return{excerpts:excerpts.map(({page,text})=>({page,text})),characters:chars,partial:chosen.length<chunks.length,totalChunks:chunks.length,chosenChunks:chosen.length,pages:[...new Set(excerpts.map(e=>e.page))],noMatch:mode==='ask'&&!relevant};
}
/** @param {any} pdf @param {number[]} indices @param {{signal?:AbortSignal,onProgress?:(current:number,total:number)=>void}} options */
export async function readAiPages(pdf,indices,{signal,onProgress=(current,total)=>{}}={}){
  if(!indices.length||indices.length>500)throw new Error('Prepara hasta 500 páginas por consulta. Reduce el rango si el documento es mayor.');
  const pages=[];let total=0;for(const index of indices){if(signal?.aborted)throw new Error('Preparación de IA cancelada.');const p=await pdf.getPage(index+1),content=await p.getTextContent();if(signal?.aborted)throw new Error('Preparación de IA cancelada.');const text=content.items.filter(i=>'str'in i).map(i=>i.str+(i.hasEOL?'\n':' ')).join('').trim();if(text.length>200000||total+text.length>2000000)throw new Error('El texto supera el límite de preparación local. Reduce el rango de páginas.');pages.push({page:index+1,text});total+=text.length;onProgress(pages.length,indices.length);}
  return pages;
}
