import{StandardFontEmbedder}from'pdf-lib';
const standardNames=new Set(['Helvetica','Helvetica-Bold','Helvetica-Oblique','Helvetica-BoldOblique','Times-Roman','Times-Bold','Times-Italic','Times-BoldItalic','Courier','Courier-Bold','Courier-Oblique','Courier-BoldOblique']);
// Use canonical AFM widths for unembedded standard PDF fonts and measure
// other encoded fonts through PDFium's own character placement. Unicode is
// not necessarily the PDF font's character code (notably subset/CID fonts).
export function nativeTextAdvances({api,memory,allocated,setText,doc,spans,getFont,items}){
  const specs=new Map();for(const s of spans){const font=getFont(s),key=font+':'+s.fontSize;let spec=specs.get(key);if(!spec){const length=api.FPDFFont_GetBaseFontName(font,0,0),name=length>0&&length<2000?allocated(length,p=>{api.FPDFFont_GetBaseFontName(font,p,length);return memory.UTF8ToString(p);}):'';spec={font,size:s.fontSize,chars:new Set(),values:new Map(),standard:!api.FPDFFont_GetIsEmbedded(font)&&standardNames.has(name)?StandardFontEmbedder.for(name):null};specs.set(key,spec);}for(const ch of s.text)if(ch!=='\n')spec.chars.add(ch);}
  const index=api.FPDF_GetPageCount(doc),page=api.FPDFPage_New(doc,index,20000,20000);if(!page)throw new Error('No se pudo preparar la medición de fuentes.');
  const samples=new Map();let textPage=0,number=0;
  try{
    for(const spec of specs.values()){
      const observed=items.find(r=>r.fontKey===spec.font)?.text||'',sentinel=[...spec.chars,...observed].find(ch=>ch.trim());spec.sentinel=sentinel;
      for(const ch of new Set([...spec.chars,...(sentinel?[sentinel]:[])])){
        const object=api.FPDFPageObj_CreateTextObj(doc,spec.font,spec.size);if(!object)throw new Error('No se pudo medir un carácter.');let inserted=false;
        try{setText(object,!ch.trim()&&sentinel?sentinel+ch+sentinel:ch+ch);const scale=1/spec.size,matrix=[scale,0,0,scale,2+(number%2)*5,2+Math.floor(number/2)*3];number++;allocated(24,p=>{memory.HEAPF32.set(matrix,p/4);if(!api.FPDFPageObj_SetMatrix(object,p))throw new Error('No se pudo medir la fuente.');});api.FPDFPage_InsertObject(page,object);inserted=true;samples.set(object,{spec,ch,scale:1/spec.size,origins:[]});}finally{if(!inserted)api.FPDFPageObj_Destroy(object);}
      }
    }
    textPage=api.FPDFText_LoadPage(page);if(!textPage)throw new Error('No se pudieron medir los avances del texto.');
    const count=api.FPDFText_CountChars(textPage);if(count>100000)throw new Error('La medición de fuentes supera el límite permitido.');
    for(let i=0;i<count;i++){if(api.FPDFText_IsGenerated(textPage,i)===1)continue;const sample=samples.get(api.FPDFText_GetTextObject(textPage,i));if(!sample)continue;const code=api.FPDFText_GetUnicode(textPage,i),wanted=(!sample.ch.trim()&&sample.spec.sentinel?sample.spec.sentinel:sample.ch).codePointAt(0);if(code!==wanted)continue;const x=allocated(16,p=>api.FPDFText_GetCharOrigin(textPage,i,p,p+8)?memory.HEAPF64[p/8]:NaN);if(Number.isFinite(x))sample.origins.push(x);}
    for(const sample of samples.values())if(sample.ch.trim()){const advance=sample.origins.length>=2?(sample.origins.at(-1)-sample.origins[0])/sample.scale:0;if(advance<-.001||!Number.isFinite(advance))throw new Error('No se pudo medir un carácter de la fuente.');sample.spec.values.set(sample.ch,Math.max(0,advance));}
    for(const sample of samples.values())if(!sample.ch.trim()){
      let advance;if(sample.spec.sentinel&&sample.origins.length>=2)advance=(sample.origins.at(-1)-sample.origins[0])/sample.scale-sample.spec.values.get(sample.spec.sentinel);else advance=allocated(4,p=>api.FPDFFont_GetGlyphWidth(sample.spec.font,sample.ch.codePointAt(0),sample.spec.size,p)?memory.HEAPF32[p/4]:NaN);
      if(!Number.isFinite(advance)||advance<-.001)throw new Error('No se pudo medir el espacio de la fuente.');sample.spec.values.set(sample.ch,Math.max(0,advance));
    }
    for(const spec of specs.values())if(spec.standard)for(const ch of spec.chars){try{spec.values.set(ch,spec.standard.widthOfTextAtSize(ch,spec.size));}catch{}}
    return span=>{const spec=specs.get(getFont(span)+':'+span.fontSize);let width=0;for(const ch of span.text){const advance=spec?.values.get(ch);if(!Number.isFinite(advance))throw new Error('No se pudo comprobar el avance del texto.');width+=advance;}return width;};
  }finally{if(textPage)api.FPDFText_ClosePage(textPage);api.FPDF_ClosePage(page);api.FPDFPage_Delete(doc,index);}
}
