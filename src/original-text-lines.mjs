const union=items=>[Math.min(...items.map(o=>o.bounds[0])),Math.min(...items.map(o=>o.bounds[1])),Math.max(...items.map(o=>o.bounds[2])),Math.max(...items.map(o=>o.bounds[3]))];
// Deliberately conservative: do not cross painting operations, styles, masks,
// different semantic spans, wide column gaps or ambiguous baselines.
export function groupOriginalLines(objects){
  const lines=[];
  for(const run of objects){
    const line=lines.at(-1),previous=line?.members.at(-1),m=run.matrix;
    let join=false,gap=0;
    if(previous&&run.editable&&previous.editable&&run.markKey===previous.markKey&&(run.rich&&previous.rich||run.fontKey===previous.fontKey&&run.color===previous.color&&Math.abs(run.fontSize-previous.fontSize)<.001)&&run.clipKey===previous.clipKey&&Math.abs(run.opacity-previous.opacity)<.001&&run.index===previous.index+1&&m.slice(0,4).every((v,i)=>Math.abs(v-previous.matrix[i])<.0001)){
      const scale=Math.hypot(m[0],m[1]),ux=m[0]/scale,uy=m[1]/scale,height=run.fontSize*Math.hypot(m[2],m[3]);
      const project=box=>[box[0]*ux+box[1]*uy,box[0]*ux+box[3]*uy,box[2]*ux+box[1]*uy,box[2]*ux+box[3]*uy];
      gap=Math.min(...project(run.bounds))-Math.max(...project(previous.bounds));
      const baseline=Math.abs((m[4]-previous.matrix[4])*(-uy)+(m[5]-previous.matrix[5])*ux);
      // Axis-aligned text can be measured without inflating rotated glyph boxes.
      join=run.separatorBefore!==null&&(Math.abs(ux)<.0001||Math.abs(uy)<.0001)&&baseline<Math.max(.15,height*.035)&&gap>=-.3&&gap<=(run.paragraphAnchor&&previous.paragraphAnchor?run.paragraphWidth:height*.65)&&line.members.length<(run.paragraphAnchor&&previous.paragraphAnchor?4096:200);
    }
    if(join){
      const space=(run.separatorBefore??(gap>run.fontSize*Math.hypot(m[0],m[1])*.16?' ':''))&&!/\s$/.test(line.text)&&!/^\s/.test(run.text)?' ':'';
      const offset=line.text.length+space.length;line.characters.push(...(run.characters||[]).map(c=>({...c,start:c.start+offset,end:c.end+offset})));if(line.richSpans)line.richSpans.push({text:space+run.text,font:'original',sourceIndex:run.index,fontName:run.fontName,fontSize:run.fontSize,color:run.color});line.text+=space+run.text;line.members.push(run);line.bounds=union(line.members);line.indices.push(run.index);line.originals.push(run.text);
    }else lines.push({...run,characters:[...(run.characters||[])],richSpans:run.rich?[{text:run.text,font:'original',sourceIndex:run.index,fontName:run.fontName,fontSize:run.fontSize,color:run.color}]:undefined,indices:[run.index],originals:[run.text],members:[run],bounds:[...run.bounds]});
  }
  return lines.map(({members,fontKey,clipKey,markKey,...line})=>line);
}

export function textFit(area,bounds,fontSize){
  const tolerance=Math.max(.75,fontSize*.035);
  return {area,bounds,fits:bounds[0]>=area[0]-tolerance&&bounds[1]>=area[1]-tolerance&&bounds[2]<=area[2]+tolerance&&bounds[3]<=area[3]+tolerance,width:bounds[2]-bounds[0],height:bounds[3]-bounds[1],availableWidth:area[2]-area[0],availableHeight:area[3]-area[1]};
}
