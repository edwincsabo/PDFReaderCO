"""Independent AcroForm, widget-state and caption verification for radio groups."""
from pathlib import Path
import json
from pypdf import PdfReader

root=Path('test-results')
checks=[]
def verify(file,name,options,selected,default):
    reader=PdfReader(file);fields=reader.get_fields();assert name in fields
    field=fields[name];assert field['/FT']=='/Btn' and field['/Ff']&32768 and not field['/Ff']&33554432
    assert list(field['/Opt'])==options
    canonical=field.indirect_reference.get_object();kids=canonical['/Kids'];assert len(kids)==len(options)
    value=canonical.get('/V','/Off');initial=canonical.get('/DV','/Off')
    selected_option=options[int(str(value)[1:])] if value!='/Off' else ''
    default_option=options[int(str(initial)[1:])] if initial!='/Off' else ''
    assert selected_option==selected and default_option==default
    found=[]
    for page in reader.pages:
        for ref in page.get('/Annots',[]):
            obj=ref.get_object()
            if obj.get('/Subtype')!='/Widget' or obj.get('/Parent')!=field.indirect_reference:continue
            assert ref in kids and obj.raw_get('/P')==page.indirect_reference
            ap=obj['/AP']['/N'];assert '/Off' in ap
            states=[key for key in ap if key!='/Off'];assert len(states)==1
            assert obj['/AS']==(value if value==states[0] else '/Off')
            assert all(stream.get_object().get_data() for stream in ap.values())
            found.append(obj)
    assert len(found)==len(options) and sum(widget['/AS']!='/Off' for widget in found)==bool(selected)
    labels=canonical['/PDFReaderCORadioLabels'];assert len(labels)==len(options)
    for ref,label in zip(labels,options):
        annotation=ref.get_object();assert annotation['/Subtype']=='/FreeText' and annotation['/Contents']==label
        assert annotation['/F']&4
        appearance=annotation['/AP']['/N'];assert appearance.get_data()
        assert appearance['/Resources']['/Font']
    return reader

one=verify(root/'radio-designer/grupo-editado.pdf','Decision',['Sí','No'],'No','Sí')
assert one.get_fields()['Decision']['/Ff']&2
checks.append({'case':'single-page','canonical_and_widget_value':'No','default':'Sí','options':['Sí','No'],'required':True,'captions_and_appearances':True})
multi=verify(root/'radio-multipage/multipagina.pdf','Grupo_1',['Opción 1','Opción 2','Tal vez'],'Tal vez','')
assert sum(ref.get_object().get('/Subtype')=='/Widget' for ref in multi.pages[1].get('/Annots',[]))==1
checks.append({'case':'multiple-pages','selected':'Tal vez','one_choice_in_group':True,'second_page_widget':True})
flat=PdfReader(root/'radio-multipage/multipagina-fijo.pdf')
assert '/AcroForm' not in flat.trailer['/Root'] and not flat.get_fields()
assert all(ref.get_object().get('/Subtype')!='/Widget' for page in flat.pages for ref in page.get('/Annots',[]))
assert sum(ref.get_object().get('/Subtype')=='/FreeText' for page in flat.pages for ref in page.get('/Annots',[]))==3
checks.append({'case':'flattened','zero_fields_and_widgets':True,'visible_static_captions':3})
lower=verify(root/'radio-viewport/grupo-inferior.pdf','Decision inferior',['Opción 1','Opción 2'],'','')
assert sum(ref.get_object().get('/Subtype')=='/Widget' for ref in lower.pages[1].get('/Annots',[]))==2
checks.append({'case':'viewport','lower_page_widgets_and_captions':True})
output=Path('docs/capturas/1.23.0');output.mkdir(parents=True,exist_ok=True)
report=json.dumps(checks,ensure_ascii=False,indent=2)
(output/'verificacion-opciones.json').write_text(report+'\n',encoding='utf-8')
print(report)
