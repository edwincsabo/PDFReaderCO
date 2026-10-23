import {PDFName,PDFString,PDFHexString,PDFArray,PDFTextField,PDFCheckBox,PDFDropdown,PDFOptionList,PDFRadioGroup}from'pdf-lib';
import {describeFormDesign}from'./form-design.mjs';
import {describeRadioDesigns}from'./radio-design.mjs';
import {readFieldRule}from'./field-rules.mjs';
const text=value=>value instanceof PDFString||value instanceof PDFHexString?value.decodeText():'';
function initialValue(field){const raw=field.acroField.dict.lookup(PDFName.of('DV'));if(field instanceof PDFCheckBox)return raw?.toString()===field.acroField.getWidgets()[0]?.getOnValue()?.toString();if(field instanceof PDFRadioGroup){const i=field.acroField.getWidgets().findIndex(w=>w.getOnValue()===raw);return i<0?'':field.getOptions()[i]||'';}if(field instanceof PDFDropdown||field instanceof PDFOptionList){const values=raw instanceof PDFArray?raw.asArray().map(value=>text(field.doc.context.lookup(value))):raw?[text(raw)]:[];return field.isMultiselect()?values:values[0]||'';}return text(raw);}
export function describeFields(doc){
  if(!doc.catalog.has(PDFName.of('AcroForm')))return[];
  return doc.getForm().getFields().map(field=>{
    const design=describeFormDesign(doc,field),designs=field instanceof PDFRadioGroup?describeRadioDesigns(doc,field):undefined,own=!!design||!!designs?.length,ruleInfo=own?readFieldRule(field,field instanceof PDFTextField?'text':field instanceof PDFCheckBox?'checkbox':field instanceof PDFRadioGroup?'radio':'dropdown'):{rule:null,ruleError:''};
    const widget=field.acroField.getWidgets()[0],widgetRef=widget&&doc.context.getObjectRef(widget.dict),page=widget?doc.getPages().findIndex(page=>page.ref===widget.P()||page.node.Annots()?.asArray().includes(widgetRef))+1:1;
    const base={name:field.getName(),readOnly:field.isReadOnly(),required:field.isRequired(),design:design?{...design,...ruleInfo}:undefined,...(designs?{designs}:{}),id:design?.id||designs?.[0]?.groupId,defaultValue:initialValue(field),page:page||1,...ruleInfo};
    if(field instanceof PDFTextField)return{...base,type:'text',value:field.getText()||'',multiline:field.isMultiline(),max:field.getMaxLength()};
    if(field instanceof PDFCheckBox)return{...base,type:'checkbox',value:field.isChecked()};
    if(field instanceof PDFDropdown||field instanceof PDFOptionList)return{...base,type:'select',list:field instanceof PDFOptionList,value:field.getSelected(),options:field.getOptions(),multiple:field.isMultiselect()};
    if(field instanceof PDFRadioGroup)return{...base,type:'radio',value:field.getSelected()||'',options:field.getOptions()};
    return{...base,type:'unsupported',value:''};
  });
}
