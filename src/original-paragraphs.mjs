import{textCaretGeometry,transformCaretGeometry}from'./text-caret.mjs';
import{nativeTextAdvances}from'./native-text-advances.mjs';
import{typographyValues,validateTypography,hasTypography,placeParagraphLine}from'./paragraph-typography.mjs';
import{restoreParagraphSpans,restoreLegacyParagraphSpans}from'./paragraph-text-data.mjs';
import{validateSpans,editSpans}from'./text-spans.mjs';
import{layoutRichText}from'./rich-text-layout.mjs';
import{expandableClipPaths}from'./original-clip.mjs';
import{clipContainsBox}from'./original-clip.mjs';
import{expandedTextFit,containsBox}from'./original-text-space.mjs';
import {groupOriginalLines,textFit} from './original-text-lines.mjs';
import {transformBounds} from './original-groups.mjs';
import {rewriteMarkedText,createStrokeMarker} from './original-rewrite.mjs';

export function groupOriginalParagraphs(objects){
  const lines=groupOriginalLines(objects),groups=[];
  for(const line of lines){
    const previous=groups.at(-1),last=previous?.lines.at(-1),m=line.matrix,size=line.fontSize*Math.hypot(m[2],m[3]);let join=false;
    if(last&&line.editable&&last.editable&&line.index===last.indices.at(-1)+1&&(line.rich&&last.rich||line.fontName===last.fontName&&line.fontSize===last.fontSize&&line.color===last.color)&&line.opacity===last.opacity&&m.slice(0,4).every((v,i)=>Math.abs(v-last.matrix[i])<.0001)){
      const first=objects.find(r=>r.index===line.index),old=objects.find(r=>r.index===last.index),sx=Math.hypot(m[0],m[1]),ux=m[0]/sx,uy=m[1]/sx,dx=m[4]-last.matrix[4],dy=m[5]-last.matrix[5],down=dx*uy-dy*ux,left=Math.abs(dx*ux+dy*uy);
      join=(first.rich&&old.rich||first.fontKey===old.fontKey)&&first.clipKey===old.clipKey&&first.markKey===old.markKey&&(first.paragraphAnchor&&old.paragraphAnchor?down>.01:down>=size*.8)&&(down<=size*3.05||first.paragraphAnchor&&old.paragraphAnchor)&&(left<=size*.3||first.paragraphAnchor&&old.paragraphAnchor)&&previous.indices.length+line.indices.length<=(first.paragraphAnchor&&old.paragraphAnchor?4096:200);
    }
    if(line.manualBlock||last?.manualBlock){
      const first=objects.find(r=>r.index===line.index),old=last&&objects.find(r=>r.index===last.index);
      join=!!line.manualBlock&&line.manualBlock===last?.manualBlock&&line.editable&&last.editable&&line.index===last.indices.at(-1)+1&&line.opacity===last.opacity&&first.clipKey===old.clipKey&&first.markKey===old.markKey&&m.slice(0,4).every((v,i)=>Math.abs(v-last.matrix[i])<.0001)&&previous.indices.length+line.indices.length<=4096;
    }
    if(join){const distance=Math.abs(((line.matrix[4]-last.matrix[4])*m[1]-(line.matrix[5]-last.matrix[5])*m[0])/Math.hypot(m[0],m[1])),breaks=line.paragraphAnchor?Math.max(1,Math.min(200,Math.round(distance/(line.fontSize*Math.hypot(m[2],m[3])*line.lineSpacing)))):1;if(previous.richSpans){previous.richSpans.push({...previous.richSpans.at(-1),text:'\n'.repeat(breaks)},...(line.richSpans||[]));}previous.lines.push(line);previous.text+='\n'.repeat(breaks)+line.text;previous.indices.push(...line.indices);previous.originals.push(...line.originals);previous.bounds=[Math.min(previous.bounds[0],line.bounds[0]),Math.min(previous.bounds[1],line.bounds[1]),Math.max(previous.bounds[2],line.bounds[2]),Math.max(previous.bounds[3],line.bounds[3])];}
    else groups.push({...line,paragraph:true,indices:[...line.indices],originals:[...line.originals],lines:[line],bounds:[...line.bounds]});
  }
  return groups.map(({lines,...p})=>{const paint=lines.map(line=>line.text).join('\n');if(p.richSpans&&typeof p.paragraphSourceText==='string'){const restored=restoreParagraphSpans(p,p.indices.map(id=>objects.find(o=>o.index===id)))||(!p.paragraphTextData&&!p.paragraphTextDataInvalid&&p.paragraphPaint===paint?restoreLegacyParagraphSpans(p.paragraphSourceText,p.richSpans):null);if(restored){p.richSpans=restored;p.text=p.paragraphSourceText;}}else if(p.paragraphPaint===paint&&typeof p.paragraphSourceText==='string')p.text=p.paragraphSourceText;const m=p.paragraphAnchor?[...p.matrix.slice(0,4),...p.paragraphAnchor]:p.matrix,det=m[0]*m[3]-m[1]*m[2],inverse=[m[3]/det,-m[1]/det,-m[2]/det,m[0]/det,(m[2]*m[5]-m[3]*m[4])/det,(m[1]*m[4]-m[0]*m[5])/det],local=transformBounds(inverse,p.bounds),spacing=lines.length>1?Math.hypot(lines[1].matrix[4]-m[4],lines[1].matrix[5]-m[5])/Math.hypot(m[2],m[3])/p.fontSize:1.2;return {...p,matrix:m,paragraphWidth:p.paragraphWidth??Math.max(1,local[2]-Math.min(0,local[0])),paragraphHeight:p.paragraphHeight??Math.max(1,local[3]-local[1]),lineSpacing:p.lineSpacing??Math.max(.8,Math.min(3,spacing)),align:p.align??'left',paragraphTop:p.paragraphTop??local[3]};});
}

export function wrapParagraph(text,width,measure){
  const lines=[];for(const paragraph of text.split('\n')){
    if(!paragraph){lines.push('');continue;}let current='';
    for(const word of paragraph.match(/\S+\s*|\s+/gu)||[]){
      const candidate=current+word;if(measure(candidate.trimEnd())<=width+.001){current=candidate;continue;}
      if(current.trim()){lines.push(current.trimEnd());current='';}
      if(measure(word.trimEnd())<=width+.001){current=word.trimStart();continue;}
      for(const ch of word.trimStart()){if(current&&measure(current+ch)>width+.001){lines.push(current.trimEnd());current='';}current+=ch;}
    }
    lines.push(current.trimEnd());if(lines.length>200)throw new Error('El párrafo supera el límite de 200 líneas.');
  }
  return lines;
}

export function createTextRewriter(env){
  const {api,memory,withPage,allocated,floats,describe,readObjects,save,hash,standardFonts}=env;
  const setText=(object,text)=>allocated((text.length+1)*2,ptr=>{memory.stringToUTF16(text,ptr,(text.length+1)*2);if(!api.FPDFText_SetText(object,ptr))throw new Error('La fuente no admite el texto nuevo. Selecciona una fuente alternativa.');});
  return async function rewrite(bytes,request,preview=false){
    if(request.source!==await hash(bytes))throw new Error('El documento cambió. Selecciona de nuevo el texto.');
    const paragraph=!!request.paragraph,styled=validateSpans(request);
    const spans=styled||editSpans(request);
    const fontIds=[...new Set(spans.filter(s=>s.font.startsWith('local:')).map(s=>s.font))];if(fontIds.length>8)throw new Error('Usa hasta ocho fuentes locales por edición.');for(const id of fontIds){const data=request.fonts?.find(f=>f.id===id)?.bytes;if(!(data instanceof Uint8Array)||data.length>16*1024*1024||'local:'+await hash(data)!==id)throw new Error('La fuente local no está disponible o sus datos cambiaron.');}
    if(spans.some(s=>s.font!=='original'&&!standardFonts.has(s.font)))throw new Error('Selecciona una fuente compatible para cada fragmento.');
    for(const key of['paragraphAutoGrow','paragraphSpace','inkFit'])if(request[key]!==undefined&&typeof request[key]!=='boolean')throw new Error('La opción de crecimiento del párrafo no es válida.');
    for(const key of['paragraphOffsetX','paragraphOffsetY'])if(request[key]!==undefined&&(!Number.isFinite(request[key])||Math.abs(request[key])>10000))throw new Error('El desplazamiento del área no es válido.');
    if(typeof request.text!=='string'||request.text.length>(paragraph?12000:4000)||/[\r\u0000-\u0009\u000b-\u001f]/.test(request.text)||!paragraph&&request.text.includes('\n'))throw new Error('El texto contiene caracteres no compatibles o supera el límite permitido.');
    if(!Number.isFinite(request.fontSize)||request.fontSize<1||request.fontSize>400||!/^#[0-9a-f]{6}$/i.test(request.color)||request.font!=='original'&&!standardFonts.has(request.font))throw new Error('Fuente, tamaño o color no válidos.');
    if(!styled&&request.font!=='original'&&!request.font.startsWith('local:')&&Array.from(request.text).some(ch=>ch.codePointAt(0)>255&&!/[€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/.test(ch)))throw new Error('La fuente alternativa admite texto latino. Conserva una fuente original compatible para otros alfabetos.');
    let result;
    withPage(bytes,request.page,({doc,page,textPage})=>{
      const items=readObjects(page,textPage).objects,selection=(paragraph?groupOriginalParagraphs(items):request.indices?groupOriginalLines(items):items).find(r=>r.index===request.index);
      if(!selection||selection.text!==request.original||request.indices&&(JSON.stringify(selection.indices)!==JSON.stringify(request.indices)||JSON.stringify(selection.originals)!==JSON.stringify(request.originals)))throw new Error('La selección cambió. Selecciona de nuevo el texto.');
      if(!selection.editable)throw new Error(selection.reason);
      const space=(paragraph&&(request.paragraphAutoGrow||request.paragraphSpace)||request.expandToSpace&&!paragraph&&(!selection.clipped||selection.clipExpandable))?env.textSpace(page):null;
      const indices=selection.indices||[selection.index],source=api.FPDFPage_GetObject(page,selection.index),before=describe(source,selection.index,textPage),m=paragraph?[...selection.matrix]:before.matrix,det=m[0]*m[3]-m[1]*m[2],inverse=[m[3]/det,-m[1]/det,-m[2]/det,m[0]/det,(m[2]*m[5]-m[3]*m[4])/det,(m[1]*m[4]-m[0]*m[5])/det],localArea=transformBounds(inverse,selection.bounds),width=request.paragraphWidth??selection.paragraphWidth,height=request.paragraphHeight??selection.paragraphHeight,leading=request.lineSpacing??selection.lineSpacing??1.2,align=request.align??selection.align??'left';
      if(paragraph&&(!Number.isFinite(width)||width<1||width>10000||!Number.isFinite(height)||height<1||height>10000||!Number.isFinite(leading)||leading<.8||leading>3||!['left','center','right','justify'].includes(align)))throw new Error('El área o interlineado del párrafo no es válido.');
      const typography=paragraph?validateTypography(typographyValues(request,selection),width):typographyValues(),advanced=paragraph&&(align==='justify'||hasTypography(typography)),formatted=!!styled||advanced;
      if(paragraph){const dx=request.paragraphOffsetX||0,dy=request.paragraphOffsetY||0;m[4]+=m[0]*dx+m[2]*dy;m[5]+=m[1]*dx+m[3]*dy;}
      const top=selection.paragraphTop??localArea[3],referenceArea=paragraph?transformBounds(selection.matrix,[Math.min(0,localArea[0]),top-selection.paragraphHeight,Math.min(0,localArea[0])+selection.paragraphWidth,top]):selection.bounds;let effectiveHeight=height,area=paragraph?transformBounds(m,[Math.min(0,localArea[0]),top-height,Math.min(0,localArea[0])+width,top]):[Math.min(selection.bounds[0],m[4]),Math.min(selection.bounds[1],m[5]),Math.max(selection.bounds[2],m[4]),Math.max(selection.bounds[3],m[5])];
      if(paragraph){const box=method=>allocated(16,p=>method(page,p,p+4,p+8,p+12)?Array.from(memory.HEAPF32.slice(p/4,p/4+4)):null),media=box(api.FPDFPage_GetMediaBox),crop=box(api.FPDFPage_GetCropBox)||media;if(!media||!crop||area[0]<Math.max(media[0],crop[0])-.01||area[1]<Math.max(media[1],crop[1])-.01||area[2]>Math.min(media[2],crop[2])+.01||area[3]>Math.min(media[3],crop[3])+.01)throw new Error('El área del párrafo debe permanecer dentro de la página o de su grupo.');}
      if(!styled&&request.font==='original'&&before.embedded){const available=new Set(['\n']);for(const item of items)if(item.fontKey===before.fontKey)for(const ch of item.text)available.add(ch);if(Array.from(request.text).some(ch=>!available.has(ch)))throw new Error('Para conservar la fuente incorporada se admiten los caracteres comprobados con esa fuente en la página. Selecciona una fuente alternativa para añadir otros.');}
      if(!request.text.trim()){const fit=textFit(area,[area[0],area[1],area[0],area[1]],request.fontSize);if(request.caretGeometry)fit.geometry=textCaretGeometry(request.text,[],{matrix:m,fontSize:request.fontSize,lineSpacing:leading});if(preview===true){result={fit};return;}for(const index of indices.slice().reverse()){const object=api.FPDFPage_GetObject(page,index);if(!api.FPDFPage_RemoveObject(page,object))throw new Error('No se pudo eliminar el texto.');api.FPDFPageObj_Destroy(object);}if(!api.FPDFPage_GenerateContent(page))throw new Error('No se pudo guardar la eliminación.');result={fit,bytes:save(doc),empty:true};return;}
      let ownedFont=0,temp=0;const loadedFonts=new Map(),fontBuffers=[];
      try{
        const getFont=span=>{
          const key=span.font+':'+(span.sourceIndex??selection.index);if(loadedFonts.has(key))return loadedFonts.get(key);
          let font;if(span.font==='original'){
            const id=span.sourceIndex??selection.index;if(!indices.includes(id))throw new Error('La fuente del fragmento no pertenece a esta selección.');
            const original=api.FPDFPage_GetObject(page,id),r=describe(original,id,textPage);font=api.FPDFTextObj_GetFont(original);
            if(r.embedded){const available=new Set(['\n']);for(const item of items)if(item.fontKey===r.fontKey)for(const ch of item.text)available.add(ch);if(Array.from(spans.filter(s=>s.font==='original'&&(s.sourceIndex??selection.index)===id).map(s=>s.text).join('')).some(ch=>!available.has(ch)))throw new Error('La fuente incorporada no contiene todos los caracteres comprobados. Selecciona una fuente alternativa para ese fragmento.');}
          }else if(span.font.startsWith('local:')){
            const bytes=request.fonts?.find(f=>f.id===span.font)?.bytes;if(!(bytes instanceof Uint8Array)||bytes.length<12||bytes.length>16*1024*1024)throw new Error('La fuente local no está disponible. Selecciónala de nuevo.');
            const ptr=memory._malloc(bytes.length);if(!ptr)throw new Error('No hay memoria para cargar la fuente.');fontBuffers.push(ptr);memory.HEAPU8.set(bytes,ptr);font=api.FPDFText_LoadFont(doc,ptr,bytes.length,2 /* FPDF_FONT_TRUETYPE */,true);
          }else font=api.FPDFText_LoadStandardFont(doc,span.font);
          if(!font)throw new Error('No se pudo cargar la fuente del fragmento.');loadedFonts.set(key,font);return font;
        };
        const advanceOf=nativeTextAdvances({api,memory,allocated,setText,doc,spans,getFont,items});
        const metrics=new Map(),measure=span=>{
          const key=JSON.stringify([span.font,span.sourceIndex,span.fontSize,span.text]);if(metrics.has(key))return metrics.get(key);
          const font=getFont(span),object=api.FPDFPageObj_CreateTextObj(doc,font,span.fontSize);if(!object)throw new Error('No se pudo preparar el fragmento.');
          try{setText(object,span.text);const bounds=floats(p=>api.FPDFPageObj_GetBounds(object,p,p+4,p+8,p+12),4);const advance=advanceOf(span);
            const value={bounds,advance};metrics.set(key,value);return value;
          }finally{api.FPDFPageObj_Destroy(object);}
        };
        // A source frame can end at the last glyph's ink, before its advance.
        // Batch formatting may use that terminal bearing for wrapping only;
        // the original frame and the final painted-bounds check stay strict.
        let layoutWidth=width;if(paragraph&&request.inkFit&&align==='left'){
          const sampled=new Set();let bearing=0;for(const span of spans)for(const ch of span.text){if(!ch.trim())continue;const key=JSON.stringify([span.font,span.sourceIndex,span.fontSize,ch]);if(sampled.has(key))continue;sampled.add(key);const metric=measure({...span,text:ch});bearing=Math.max(bearing,metric.advance-metric.bounds[2]);}layoutWidth+=bearing;
        }
        const richLayout=formatted?layoutRichText(spans,paragraph?layoutWidth:10000,leading,measure,paragraph,typography):null;
        const plainMeasure=text=>{if(!text)return 0;const value=measure({...spans[0],text});return Math.max(0,value.bounds[2])-Math.min(0,value.bounds[0]);};
        const lines=richLayout?richLayout.map(l=>l.parts.map(s=>s.text).join('')):paragraph?wrapParagraph(request.text,width,plainMeasure):[request.text],bounds=[],localBounds=[],objects=[];
        const layout=richLayout||lines.map((text,i)=>({parts:text?[{...spans[0],text}]:[],width:plainMeasure(text),y:-i*request.fontSize*leading}));
        temp=api.FPDFPage_New(doc,api.FPDF_GetPageCount(doc),20000,20000);if(!temp)throw new Error('No se pudo preparar el texto.');api.FPDFPage_SetMediaBox(temp,-10000,-10000,10000,10000);api.FPDFPage_SetCropBox(temp,-10000,-10000,10000,10000);
        for(const line of layout){let x=!paragraph||align==='left'?0:align==='center'?(width-line.width)/2:width-line.width;
          const placed=richLayout&&paragraph?placeParagraphLine(line,align,measure):line.parts.map(span=>{const p={span,x,y:line.y};x+=measure(span).advance;return p;});
          for(const position of placed){const span=position.span;if(!span.text.trim())continue;const font=getFont(span),object=api.FPDFPageObj_CreateTextObj(doc,font,span.fontSize);if(!object)throw new Error('No se pudo preparar una línea.');let inserted=false;
            try{setText(object,span.text);const matrix=[1,0,0,1,position.x,position.y];allocated(24,p=>{memory.HEAPF32.set(matrix,p/4);if(!api.FPDFPageObj_SetMatrix(object,p))throw new Error('No se pudo colocar el texto.');});
              const color=[1,3,5].map(i=>parseInt(span.color.slice(i,i+2),16));if(!api.FPDFPageObj_SetFillColor(object,...color,Math.round(before.opacity*255)))throw new Error('No se pudo aplicar el color del fragmento.');
              api.FPDFPage_InsertObject(temp,object);inserted=true;objects.push({object,text:span.text,font});const local=floats(p=>api.FPDFPageObj_GetBounds(object,p,p+4,p+8,p+12),4);localBounds.push(local);bounds.push(transformBounds(m,local));
            }finally{if(!inserted)api.FPDFPageObj_Destroy(object);}
          }
        }
        if(paragraph&&request.paragraphAutoGrow&&!selection.clipped){const inkBottom=localBounds.length?Math.min(...localBounds.map(b=>b[1])):0,lastBottom=richLayout&&advanced?richLayout.at(-1).y-richLayout.at(-1).height*.25-richLayout.at(-1).spaceAfter:lines.at(-1)?inkBottom:-(lines.length-1)*request.fontSize*leading-request.fontSize*.25;effectiveHeight=Math.min(10000,Math.max(height,top-Math.min(inkBottom,lastBottom)));area=transformBounds(m,[Math.min(0,localArea[0]),top-effectiveHeight,Math.min(0,localArea[0])+width,top]);}
        const merged=bounds.length?[Math.min(...bounds.map(b=>b[0])),Math.min(...bounds.map(b=>b[1])),Math.max(...bounds.map(b=>b[2])),Math.max(...bounds.map(b=>b[3]))]:[area[0],area[1],area[0],area[1]],fit={...expandedTextFit(area,merged,request.fontSize*Math.hypot(m[2],m[3]),space,indices,!!request.expandToSpace&&!paragraph&&(!selection.clipped||selection.clipExpandable)),lines:lines.length,...(paragraph?{paragraphHeight:effectiveHeight,paragraphWidth:width}: {})};
        if(advanced&&(typography.spaceAfter>0||!richLayout.at(-1).parts.length)){const last=richLayout.at(-1),bottom=Math.min(localBounds.length?Math.min(...localBounds.map(b=>b[1])):0,last.parts.length?last.y:last.y-last.height*.25)-typography.spaceAfter;if(top-bottom>effectiveHeight+.75/Math.hypot(m[2],m[3])){fit.fits=false;fit.expansionReason='El espacio posterior o los saltos finales no caben en el alto del párrafo. Amplía el alto o activa el crecimiento.';}}
        if(paragraph&&(request.paragraphAutoGrow||request.paragraphSpace)){const checked=expandedTextFit(referenceArea,area,request.fontSize*Math.hypot(m[2],m[3]),space,indices,true);Object.assign(fit,{originalArea:referenceArea,expansionEnabled:true,expanded:checked.expanded,spaceBounds:area,expansionReason:checked.expansionReason||fit.expansionReason,fits:fit.fits&&checked.fits});}
        if(!paragraph&&request.expandToSpace&&selection.clipped&&fit.expanded&&!clipContainsBox(before.clipKey,merged)){fit.fits=false;fit.blocker={kind:'clip',clipPaths:expandableClipPaths(before.clipKey),suggestion:'Acorta el texto, mueve texto y máscara juntos o reduce el tamaño.'};fit.expansionReason='El texto alcanzaría el límite de su máscara de recorte. Acórtalo o ajusta su tamaño.';}
        if(advanced&&before.clipped&&!(before.clipExpandable?clipContainsBox(before.clipKey,merged):containsBox(referenceArea,merged))){fit.fits=false;fit.expansionReason='El texto del párrafo excede su máscara de recorte o no se puede comprobar su interior. Reduce las sangrías, los espacios o el texto.';fit.blocker={kind:'clip',clipPaths:expandableClipPaths(before.clipKey),suggestion:'Mantén el texto dentro de la máscara original; sus límites no se amplían.'};}
        // Validate real Unicode after PDFium has encoded every new line.
        let paragraphTextData;
        const check=api.FPDFText_LoadPage(temp);try{const data=readObjects(temp,check).objects.filter(r=>r.text.trim()),expected=objects.filter(r=>r.text.trim());if(data.length!==expected.length||data.some((r,i)=>r.text!==expected[i].text&&!(paragraph&&formatted&&r.text.replace(/\s/gu,'')===expected[i].text.replace(/\s/gu,''))))throw new Error('La fuente original no puede representar todos los caracteres nuevos. Selecciona una fuente alternativa.');
          if(request.caretGeometry)fit.geometry=transformCaretGeometry(textCaretGeometry(request.text,data,{matrix:[1,0,0,1,0,0],fontSize:request.fontSize,lineSpacing:leading}),m);
          if(paragraph&&formatted){if(data.length>4096)throw new Error('El párrafo con formato supera 4096 fragmentos pintados. Amplía el área o reduce los cambios de formato.');paragraphTextData={v:1,spans:spans.map(s=>{let slot=expected.findIndex(o=>o.font===getFont(s));if(slot<0)slot=0;return{text:s.text,slot,fontSize:s.fontSize,color:s.color};}),paint:data.map(r=>({text:r.text,fontName:r.fontName,fontSize:r.fontSize,color:r.color,matrix:r.matrix,bounds:r.bounds}))};if(JSON.stringify(paragraphTextData).length*2+2>3*1024*1024)throw new Error('Los datos de edición del párrafo superan 3 MB. Reduce el texto o los cambios de formato.');}
        }finally{if(check){env.clearTextPage(check);api.FPDFText_ClosePage(check);}}
        if(preview===true){result={fit};return;}
        if(!preview&&request.checkFit&&!fit.fits&&(selection.clipped||!request.allowOverflow))throw new Error(fit.expansionReason||'El texto nuevo supera el área disponible. Amplía el área, acórtalo o reduce el tamaño.');
        if(preview==='validate'){result={fit};return;}
        const marker=createStrokeMarker(api,memory,allocated,page,source),color=[1,3,5].map(i=>parseInt(request.color.slice(i,i+2),16));if(!api.FPDFPageObj_SetFillColor(source,...color,Math.round(before.opacity*255)))throw new Error('No se pudo aplicar el color.');
        for(const index of indices.slice(1).reverse()){const object=api.FPDFPage_GetObject(page,index);if(!api.FPDFPage_RemoveObject(page,object))throw new Error('No se pudo sustituir la selección.');api.FPDFPageObj_Destroy(object);}
        if(!api.FPDFPage_GenerateContent(page)||!api.FPDFPage_GenerateContent(temp))throw new Error('No se pudo reconstruir el texto.');const old=before.matrix,oldDet=old[0]*old[3]-old[1]*old[2],dx=m[4]-old[4],dy=m[5]-old[5];result={fit,bytes:save(doc),marker,rich:formatted&&!before.rich,layout:paragraph?{...typography,manualBlock:selection.manualBlock,width,height:effectiveHeight,top,leading,align,paragraphAutoGrow:!!request.paragraphAutoGrow,x:m[4],y:m[5],paragraphSourceText:request.text,paragraphTextData,paragraphPaint:lines.filter(Boolean).join('\n'),offset:[(old[3]*dx-old[2]*dy)/oldDet,(old[0]*dy-old[1]*dx)/oldDet]}:null};
      }finally{if(temp)api.FPDF_ClosePage(temp);for(const [key,font]of loadedFonts)if(!key.startsWith('original:'))api.FPDFFont_Close(font);for(const ptr of fontBuffers)memory._free(ptr);}
    });
    if(result.bytes&&!result.empty)result.bytes=await rewriteMarkedText(result.bytes,request.page,result.marker,result.layout,result.rich);return result;
  };
}

