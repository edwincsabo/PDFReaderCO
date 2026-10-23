export function comparisonTokens(content,viewport){
  const out=[],multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
  for(const item of content.items){if(typeof item.str!=='string'||!item.str.trim())continue;let box;
    if(Array.isArray(item.transform)&&item.transform.length===6&&item.transform.every(Number.isFinite)&&Number.isFinite(item.width)){
      const m=multiply(viewport.transform,item.transform),length=Math.hypot(m[0],m[1]),advance=item.width*Math.hypot(viewport.transform[0],viewport.transform[1]),style=content.styles?.[item.fontName]||{},ascent=Number.isFinite(style.ascent)?style.ascent:.9,descent=Number.isFinite(style.descent)?style.descent:-.2;
      if(length){const points=[descent,ascent].flatMap(h=>[0,advance].map(w=>[m[4]+m[0]/length*w+m[2]*h,m[5]+m[1]/length*w+m[3]*h])),xs=points.map(p=>p[0]/viewport.width),ys=points.map(p=>p[1]/viewport.height),x=Math.max(0,Math.min(1,Math.min(...xs))),y=Math.max(0,Math.min(1,Math.min(...ys)));box={x,y,w:Math.max(0,Math.min(1-x,Math.max(...xs)-x)),h:Math.max(0,Math.min(1-y,Math.max(...ys)-y))};}
    }
    for(const match of item.str.matchAll(/[\p{L}\p{M}\p{N}_]+|[^\s]/gu))out.push({value:match[0],...(box?{box}:{})});
  }return out;
}
export function compareWords(before,after,ignoreCase=false){
  if(!Array.isArray(before)||!Array.isArray(after)||before.length>30000||after.length>30000)throw new Error('La página supera el límite de palabras de comparación.');
  const value=t=>ignoreCase?t.value.normalize('NFC').toLocaleLowerCase():t.value.normalize('NFC');let start=0,endA=before.length,endB=after.length;
  while(start<endA&&start<endB&&value(before[start])===value(after[start]))start++;
  while(endA>start&&endB>start&&value(before[endA-1])===value(after[endB-1])){endA--;endB--;}
  const a=before.slice(start,endA),b=after.slice(start,endB),changes=[];if(!a.length&&!b.length)return{changes,coarse:false};
  const boxes=tokens=>{const map=new Map();for(const t of tokens)if(t.box)map.set(JSON.stringify(t.box),t.box);return[...map.values()];};
  const item=(old,next)=>({kind:!old.length?'added':!next.length?'removed':'changed',before:old.map(t=>t.value).join(' '),after:next.map(t=>t.value).join(' '),left:boxes(old),right:boxes(next)});
  if(a.length*b.length>4000000)return{changes:[item(a,b)],coarse:true};
  const width=b.length+1,dp=new Uint16Array((a.length+1)*width);for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)dp[i*width+j]=value(a[i])===value(b[j])?dp[(i+1)*width+j+1]+1:Math.max(dp[(i+1)*width+j],dp[i*width+j+1]);
  let i=0,j=0,old=[],next=[];const flush=()=>{if(old.length||next.length){changes.push(item(old,next));old=[];next=[];}};
  while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&value(a[i])===value(b[j])){flush();i++;j++;}else if(j<b.length&&(i===a.length||dp[i*width+j+1]>=dp[(i+1)*width+j]))next.push(b[j++]);else old.push(a[i++]);}flush();return{changes,coarse:false};
}
export function comparePixels(left,right,width,height,threshold=24){
  if(!(left instanceof Uint8ClampedArray)||!(right instanceof Uint8ClampedArray)||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>2000000||left.length!==width*height*4||right.length!==left.length||!Number.isFinite(threshold)||threshold<0||threshold>255)throw new Error('Imágenes de comparación inválidas.');
  const size=8,cols=Math.ceil(width/size),rows=Math.ceil(height/size),grid=new Uint16Array(cols*rows);let pixels=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=(y*width+x)*4;if(Math.max(Math.abs(left[p]-right[p]),Math.abs(left[p+1]-right[p+1]),Math.abs(left[p+2]-right[p+2]))>threshold){pixels++;grid[Math.floor(y/size)*cols+Math.floor(x/size)]++;}}
  const visited=new Uint8Array(grid.length),boxes=[];
  for(let k=0;k<grid.length;k++){if(visited[k]||grid[k]<3)continue;const stack=[k];visited[k]=1;let x0=cols,y0=rows,x1=0,y1=0,count=0;while(stack.length){const cell=stack.pop(),x=cell%cols,y=Math.floor(cell/cols);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);count+=grid[cell];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy,at=ny*cols+nx;if(nx>=0&&ny>=0&&nx<cols&&ny<rows&&!visited[at]&&grid[at]>=3){visited[at]=1;stack.push(at);}}}boxes.push({x:x0*size,y:y0*size,w:Math.min(width,(x1+1)*size)-x0*size,h:Math.min(height,(y1+1)*size)-y0*size,pixels:count});}
  const coarse=boxes.length>200;if(coarse){const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),right=Math.max(...boxes.map(b=>b.x+b.w)),bottom=Math.max(...boxes.map(b=>b.y+b.h));return{pixels,percent:pixels/(width*height)*100,boxes:[{x,y,w:right-x,h:bottom-y,pixels}],coarse};}return{pixels,percent:pixels/(width*height)*100,boxes,coarse};
}
export function comparisonPairs(leftCount,rightCount,offset=0,pages){
  if(!Number.isInteger(leftCount)||leftCount<1||!Number.isInteger(rightCount)||rightCount<1||!Number.isInteger(offset)||Math.abs(offset)>100000)throw new Error('Documentos o desfase inválidos.');
  if(!pages&&(leftCount>100||rightCount>100))throw new Error('La comparación admite hasta cien pares de páginas. Acota el rango.');
  const numbers=pages||Array.from({length:leftCount},(_,i)=>i+1),result=numbers.map(n=>({left:n,right:n+offset>=1&&n+offset<=rightCount?n+offset:null}));if(!pages){const paired=new Set(result.map(p=>p.right));for(let n=1;n<=rightCount;n++)if(!paired.has(n))result.push({left:null,right:n});}if(result.length>100)throw new Error('La comparación admite hasta cien pares de páginas. Acota el rango.');return result;
}
