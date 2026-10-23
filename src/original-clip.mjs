// PDFium exposes page-space path segments: MOVETO=2, LINETO=0, BEZIERTO=1.
// Accept one closed, axis-aligned rectangle only. Multiple contours, curves,
// intersections and degenerate paths must never be approximated by a box.
export function rectangleClipBounds(signature){
  if(!signature.startsWith('['))return null;
  const paths=JSON.parse(signature);if(paths.length!==1)return null;
  const segments=paths[0];if(segments.length!==4&&segments.length!==5)return null;
  if(segments[0][0]!==2||segments.slice(1).some(s=>s[0]!==0)||segments.slice(0,-1).some(s=>s[1])||!segments.at(-1)[1])return null;
  if(segments.some(s=>!Number.isFinite(s[2])||!Number.isFinite(s[3])))return null;
  const points=segments.map(s=>s.slice(2)),equal=(a,b)=>a[0]===b[0]&&a[1]===b[1];
  if(points.length===5){if(!equal(points[0],points[4]))return null;points.pop();}
  const xs=[...new Set(points.map(p=>p[0]))],ys=[...new Set(points.map(p=>p[1]))];
  if(xs.length!==2||ys.length!==2||new Set(points.map(p=>p.join(','))).size!==4)return null;
  for(let i=0;i<4;i++){const a=points[i],b=points[(i+1)%4];if((a[0]===b[0])===(a[1]===b[1]))return null;}
  const box=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
  return box[2]-box[0]>1e-5&&box[3]-box[1]>1e-5?box:null;
}

// Retain every path/contour and cubic control point; never approximate a mask.
export function clipPaths(signature){
  if(!signature.startsWith('['))return null;
  const paths=JSON.parse(signature);let total=0;
  if(!paths.length||paths.length>2000)return null;
  for(const path of paths){
    if(!path.length||(total+=path.length)>2000||path[0][0]!==2)return null;
    let cubic=0;
    for(const [type,closed,x,y] of path){
      if(![0,1,2].includes(type)||!Number.isFinite(x)||!Number.isFinite(y))return null;
      if(type===1){cubic++;if(closed&&cubic%3)return null;}
      else if(cubic%3)return null;
    }
    if(cubic%3)return null;
  }
  return paths;
}

export function translatedClipMatches(before,after,dx,dy){
  const a=clipPaths(before),b=clipPaths(after);if(!a||!b||a.length!==b.length)return false;
  return a.every((path,i)=>path.length===b[i].length&&path.every((s,j)=>s[0]===b[i][j][0]&&s[1]===b[i][j][1]&&Math.abs(s[2]+dx-b[i][j][2])<=.002&&Math.abs(s[3]+dy-b[i][j][3])<=.002));
}

// Certify containment without replacing a curve by its bounding rectangle.
// Every cubic and its endpoint chord lie inside the control-point AABB. If
// that AABB is disjoint from the candidate, deforming the curve into its chord
// cannot change the winding number anywhere in the candidate rectangle.
// Require |winding|=1 so the result agrees for nonzero and even-odd fill rules.
export function expandableClipPaths(signature){
  let paths;try{paths=clipPaths(signature);}catch{return null;}
  if(!paths)return null;
  if(paths.some(path=>path.filter(s=>s[0]===2).length!==1||path.slice(0,-1).some(s=>s[1])||!path.at(-1)[1]))return null;
  return paths;
}
export function clipContainsBox(signature,box){
  const paths=expandableClipPaths(signature);
  if(!paths||!Array.isArray(box)||box.length!==4||box.some(n=>!Number.isFinite(n))||box[2]<=box[0]||box[3]<=box[1])return false;
  const guard=.005,candidate=[box[0]-guard,box[1]-guard,box[2]+guard,box[3]+guard],cx=(box[0]+box[2])/2,cy=(box[1]+box[3])/2;
  for(const path of paths){
    let previous=path[0].slice(2),first=previous,vertices=[first],controls=[];
    const disjoint=points=>{const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return Math.max(...xs)<candidate[0]||Math.min(...xs)>candidate[2]||Math.max(...ys)<candidate[1]||Math.min(...ys)>candidate[3];};
    for(const segment of path.slice(1)){
      const point=segment.slice(2);
      if(segment[0]===1){controls.push(point);if(controls.length===3){if(!disjoint([previous,...controls]))return false;vertices.push(point);previous=point;controls=[];}}
      else if(segment[0]===0){if(controls.length||!disjoint([previous,point]))return false;vertices.push(point);previous=point;}
      else return false;
    }
    if(controls.length)return false;
    if(previous[0]!==first[0]||previous[1]!==first[1]){if(!disjoint([previous,first]))return false;vertices.push(first);}
    let winding=0;for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length],cross=(b[0]-a[0])*(cy-a[1])-(cx-a[0])*(b[1]-a[1]);if(a[1]<=cy&&b[1]>cy&&cross>0)winding++;else if(a[1]>cy&&b[1]<=cy&&cross<0)winding--;}
    if(Math.abs(winding)!==1)return false;
  }
  return true;
}
