import { PDFRef, PDFDict, PDFArray } from 'pdf-lib';
/** Collect only unreachable objects; shared fonts, forms, attachments and actions stay rooted. */
export function collectUnreachable(doc){
  const reachable=new Set(),seen=new WeakSet(),pending=Object.values(doc.context.trailerInfo).filter(Boolean);
  while(pending.length){const object=pending.pop();if(object instanceof PDFRef){if(reachable.has(object))continue;reachable.add(object);const value=doc.context.lookup(object);if(value)pending.push(value);continue;}
    if(!object||typeof object!=='object'||seen.has(object))continue;seen.add(object);
    if(object instanceof PDFDict)for(const [,value]of object.entries())pending.push(value);
    else if(object instanceof PDFArray)for(let i=0;i<object.size();i++)pending.push(object.get(i));
    else if(object.dict instanceof PDFDict)pending.push(object.dict);
  }
  for(const [ref]of doc.context.enumerateIndirectObjects())if(!reachable.has(ref))doc.context.delete(ref);
}
