const segmenter=new Intl.Segmenter('es',{granularity:'grapheme'});
const point=(m,x,y)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
const inverse=m=>{const d=m[0]*m[3]-m[1]*m[2];return[m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];};
const rect=(m,b)=>[[b[0],b[1]],[b[0],b[3]],[b[2],b[3]],[b[2],b[1]]].map(([x,y])=>point(m,x,y));
const union=ps=>[Math.min(...ps.map(p=>p[0])),Math.min(...ps.map(p=>p[1])),Math.max(...ps.map(p=>p[0])),Math.max(...ps.map(p=>p[1]))];
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
export const graphemeRanges=text=>Array.from(segmenter.segment(text),s=>({start:s.index,end:s.index+s.segment.length,text:s.segment}));
// Logical offsets come from the saved paragraph, positions from native glyph
// boxes. Never map a caret by browser-font widths or by unrelated page text.
export function textCaretGeometry(text,items,frame){
  if(typeof text!=='string'||text.length>12000||/[\u0590-\u08ff\u202a-\u202e\u2066-\u2069]/u.test(text))return null;
  const glyphs=[];let ink='';let row=-1,last=null;
  for(const item of items){const m=item.matrix;if(!m?.every(Number.isFinite)||Math.abs(m[0]*m[3]-m[1]*m[2])<1e-8)return null;const inv=inverse(m),size=item.fontSize;
    for(const c of item.characters||[]){const ch=item.text.slice(c.start,c.end);if(!ch||/\s/u.test(ch))continue;const b=union(rect(inv,c.bounds)),low=Math.min(-size*.22,b[1]),high=Math.max(size*.8,b[3]),before={a:point(m,b[0],low),b:point(m,b[0],high)},after={a:point(m,b[2],low),b:point(m,b[2],high)};
      if(!last||m.slice(0,4).some((v,i)=>Math.abs(v-last[i])>.0001)||Math.abs(point(inverse(last),m[4],m[5])[1])>Math.max(.25,size*.08))row++;
      const g={ch,before,after,quad:rect(m,[b[0],low,b[2],high]),row};glyphs.push(g);ink+=ch;last=m;
    }
  }
  if(ink!==Array.from(text).filter(c=>! /\s/u.test(c)).join(''))return null;
  const m=frame?.matrix||items[0]?.matrix||[1,0,0,1,0,0],size=frame?.fontSize||items[0]?.fontSize||12;
  const fallback={a:point(m,0,-size*.22),b:point(m,0,size*.8),row:0};
  const ranges=graphemeRanges(text),entries=[];let at=0;
  for(const range of ranges){const count=Array.from(range.text).filter(c=>! /\s/u.test(c)).length,paint=glyphs.slice(at,at+count);at+=count;entries.push({...range,paint});}
  const stops=[],boxes=[];
  const add=(offset,g)=>{const old=stops.at(-1);if(!old||old.offset!==offset||old.row!==g.row)stops.push({offset,row:g.row,a:g.a,b:g.b});};
  for(let i=0;i<entries.length;){const e=entries[i];if(e.paint.length){const first=e.paint[0],last=e.paint.at(-1);add(e.start,{...first.before,row:first.row});add(e.end,{...last.after,row:last.row});boxes.push({start:e.start,end:e.end,bounds:union(e.paint.flatMap(p=>p.quad))});i++;continue;}
    let end=i;while(end<entries.length&&!entries[end].paint.length)end++;const prev=entries[i-1]?.paint.at(-1),next=entries[end]?.paint[0],a=prev?{...prev.after,row:prev.row}:next?{...next.before,row:next.row}:fallback,b=next?{...next.before,row:next.row}:a;
    const count=end-i,newlines=entries.slice(i,end).filter(e=>e.text==='\n').length;let line=0;
    for(let j=i;j<end;j++){const part=entries[j],t=(j-i)/count;let start,finish;
      if(a.row===b.row&&!newlines){start={a:mix(a.a,b.a,t),b:mix(a.b,b.b,t),row:a.row};finish={a:mix(a.a,b.a,(j-i+1)/count),b:mix(a.b,b.b,(j-i+1)/count),row:a.row};}
      else if(newlines){const position=n=>{if(next)return{a:mix(a.a,b.a,n/newlines),b:mix(a.b,b.b,n/newlines),row:a.row+(b.row-a.row)*n/newlines};const shift=-n*size*(frame?.lineSpacing||1.2);return{a:point(m,0,shift-size*.22),b:point(m,0,shift+size*.8),row:a.row+n};};start=position(line);if(part.text==='\n')line++;finish=position(line);}
      else{start=a;finish=j===end-1?b:a;}
      add(part.start,start);add(part.end,finish);if(part.text!=='\n'&&start.row===finish.row)boxes.push({start:part.start,end:part.end,bounds:union([start.a,start.b,finish.a,finish.b])});
    }i=end;
  }
  if(!stops.length)add(0,fallback);
  return{text,stops,boxes};
}
export function nearestCaret(geometry,x,y){let best=null,distance=Infinity;for(const s of geometry?.stops||[]){const dx=s.b[0]-s.a[0],dy=s.b[1]-s.a[1],n=dx*dx+dy*dy,t=n?Math.max(0,Math.min(1,((x-s.a[0])*dx+(y-s.a[1])*dy)/n)):0,d=(x-s.a[0]-dx*t)**2+(y-s.a[1]-dy*t)**2;if(d<distance){best=s;distance=d;}}return best;}
export function caretAt(geometry,offset,row){const stops=geometry?.stops.filter(s=>s.offset===offset)||[];return stops.find(s=>row!==undefined&&s.row===row)||stops.at(-1)||null;}
export function verticalCaret(geometry,offset,direction,row){const current=caretAt(geometry,offset,row);if(!current)return null;const rows=[...new Set(geometry.stops.map(s=>s.row))].sort((a,b)=>a-b),target=rows[rows.indexOf(current.row)+direction];if(target===undefined)return current;const center=s=>[(s.a[0]+s.b[0])/2,(s.a[1]+s.b[1])/2],c=center(current);return geometry.stops.filter(s=>s.row===target).sort((a,b)=>{const x=center(a),y=center(b);return(x[0]-c[0])**2+(x[1]-c[1])**2-((y[0]-c[0])**2+(y[1]-c[1])**2);})[0];}
export function rangeInputEdit(edit,value,start,end){
  const inserted=value.length-(edit.text.length-(end-start));
  if(inserted<0||value.slice(0,start)!==edit.text.slice(0,start)||value.slice(start+inserted)!==edit.text.slice(end))return null;
  return{start,end,text:value.slice(start,start+inserted)};
}

export const transformCaretGeometry=(g,m)=>g?{...g,stops:g.stops.map(s=>({...s,a:point(m,...s.a),b:point(m,...s.b)})),boxes:g.boxes.map(b=>({...b,bounds:union(rect(m,b.bounds))}))}:null;
