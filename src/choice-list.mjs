import {PDFName,PDFNumber,rgb,drawOptionList,rotateInPlace,adjustDimsForRotation} from 'pdf-lib';

export function listSelection(options,value,multiple){
  const values=value===''?[]:typeof value==='string'?[value]:value;
  if(!Array.isArray(values)||values.some(v=>typeof v!=='string'||!options.includes(v))||new Set(values).size!==values.length)throw new Error('Selecciona opciones diferentes que pertenezcan a la lista.');
  if(!multiple&&values.length>1)throw new Error('Esta lista permite una sola selección.');
  return options.filter(option=>values.includes(option));
}

export function selectList(field,value){
  const values=listSelection(field.getOptions(),value,field.isMultiselect());
  if(values.length)field.select(values);else field.clear();
  // pdf-lib sorts these numbers lexically; PDF requires ascending numeric indices.
  if(values.length)field.acroField.dict.set(PDFName.of('I'),field.doc.context.obj(values.map(v=>field.getOptions().indexOf(v)).sort((a,b)=>a-b)));
  else field.acroField.dict.delete(PDFName.of('I'));
}

export function updateListAppearance(field,font){
  field.updateAppearances(font,(list,widget,embedded)=>{
    const rectangle=widget.getRectangle(),rotation=((widget.getAppearanceCharacteristics()?.getRotation()||0)%360+360)%360;
    const {width,height}=adjustDimsForRotation(rectangle,rotation),borderWidth=widget.getBorderStyle()?.getWidth()??1;
    const fontSize=Number((list.acroField.getDefaultAppearance()||'').match(/([\d.]+)\s+Tf/)?.[1]||12);
    const lineHeight=embedded.heightAtSize(fontSize)*1.2,padding=1,rows=Math.max(1,Math.floor((height-2*(borderWidth+padding))/lineHeight));
    const options=list.getOptions(),selected=list.getSelected(),first=options.findIndex(v=>selected.includes(v));
    const top=Math.min(Math.max(0,options.length-rows),first>=rows?first:0);
    list.acroField.dict.set(PDFName.of('TI'),PDFNumber.of(top));
    // One row per option, clipped horizontally. Long options must not wrap into
    // extra rows or lose their selection highlight. Only paint the visible rows.
    const visible=options.slice(top,top+rows),lines=visible.map((text,index)=>({encoded:embedded.encodeText(text),x:borderWidth+padding,y:height-borderWidth-padding-lineHeight*(index+1),height:embedded.heightAtSize(fontSize)}));
    return [...rotateInPlace({...rectangle,rotation}),...drawOptionList({x:borderWidth/2,y:borderWidth/2,width:width-borderWidth,height:height-borderWidth,borderWidth,color:rgb(.96,.99,1),borderColor:rgb(.12,.38,.4),textColor:rgb(.12,.17,.22),font:embedded.name,fontSize,textLines:lines,lineHeight,selectedLines:visible.flatMap((v,i)=>selected.includes(v)?[i]:[]),selectedColor:rgb(.6,.76,.85),padding})];
  });
}
