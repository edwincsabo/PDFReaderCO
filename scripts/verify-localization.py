"""Inspect the synthetic PDF saved while switching the interface language."""
from pathlib import Path
from poppler_path import pdftoppm
import json,subprocess
from pypdf import PdfReader
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf8'))['version']
output=root/'docs/capturas'/version/'idioma';output.mkdir(parents=True,exist_ok=True)
file=root/'test-results/language-draft/english-ui-spanish-data.pdf'
r=PdfReader(file);assert len(r.pages)==1
assert r.get_fields()['Nombre en español']['/V']=='Lectura'
widgets=[ref.get_object() for ref in r.pages[0]['/Annots'] if ref.get_object().get('/Subtype')=='/Widget']
assert len(widgets)==1
w=widgets[0];owner=w
while '/V' not in owner and '/Parent' in owner:owner=owner['/Parent'].get_object()
assert owner['/V']=='Lectura' and w['/AP']['/N'].get_object().get_data()
notes=[ref.get_object() for ref in r.pages[0]['/Annots'] if ref.get_object().get('/Subtype')=='/FreeText']
assert any(str(note.get('/Contents'))=='Comentario' for note in notes)
paint=[]
def visitor(text,cm,tm,font,size):
    if text.strip():paint.append((text.strip(),cm[0]*tm[4]+cm[2]*tm[5]+cm[4],cm[1]*tm[4]+cm[3]*tm[5]+cm[5],size))
text=r.pages[0].extract_text(visitor_text=visitor)
assert 'Guardar hoy' in text and 'Save as' not in text and 'Reading' not in text
assert any(t=='Guardar hoy' and abs(x-50)<.01 and abs(y-300)<.01 and size==16 for t,x,y,size in paint),paint
poppler=pdftoppm()
subprocess.run([poppler,'-f','1','-singlefile','-r','110','-png',str(file),str(output/'datos-sin-traducir')],check=True,capture_output=True)
catalog=json.loads((root/'electron/locale-en.json').read_text(encoding='utf8'))
report={'version':version,'catalog_entries':len(catalog),'spanish_field_name_preserved':True,'canonical_field_value_preserved':True,'widget_appearance_present':True,'spanish_annotation_preserved':True,'spanish_edited_text_and_anchor_preserved':True,'english_ui_not_written_to_pdf':True}
(output/'verificacion.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(report,ensure_ascii=False))
