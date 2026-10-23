// Test corpus metrics require a known reference; confidence alone is not accuracy.
const normalized=value=>String(value).normalize('NFC').replace(/\s+/gu,' ').trim();
export function editDistance(a,b){
  if(a.length>b.length)return editDistance(b,a);
  if(a.length*b.length>12000000)throw new Error('La muestra es demasiado grande para esta comparación.');
  let previous=Uint32Array.from({length:a.length+1},(_,i)=>i),current=new Uint32Array(a.length+1);
  for(let y=1;y<=b.length;y++){current[0]=y;for(let x=1;x<=a.length;x++)current[x]=Math.min(current[x-1]+1,previous[x]+1,previous[x-1]+(a[x-1]===b[y-1]?0:1));[previous,current]=[current,previous];}return previous[a.length];
}
export function ocrMetrics(reference,result){
  const expected=normalized(reference),actual=normalized(result),chars=Array.from(expected),text=Array.from(actual),words=expected?expected.split(' '):[],recognized=actual?actual.split(' '):[];
  const characterErrors=editDistance(chars,text),wordErrors=editDistance(words,recognized);
  return{referenceCharacters:chars.length,recognizedCharacters:text.length,characterErrors,cer:characterErrors/Math.max(1,chars.length),referenceWords:words.length,recognizedWords:recognized.length,wordErrors,wer:wordErrors/Math.max(1,words.length),exact:expected===actual};
}
