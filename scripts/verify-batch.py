"""Independent pypdf validation of the batch desktop outputs."""
from pathlib import Path
import json
from pypdf import PdfReader

root=Path('test-results')
checks=[]
def report_folder(name):
    report=root/name/'informe.json'
    if report.exists():
        value=json.loads(report.read_text(encoding='utf-8'))
        return Path(value.get('destination') or root/name/'salida')
    journals=list((root/name).glob('profile-*/batch/queue.json'))
    assert journals, 'Falta el registro de destino de la prueba'
    saved=json.loads(max(journals,key=lambda p:p.stat().st_mtime_ns).read_text(encoding='utf-8'))
    assert saved['version']==1 and saved['folder']
    return Path(saved['folder']['path'])
numbered=PdfReader(report_folder('batch-numbers')/'Documento A-numerado (2).pdf')
assert len(numbered.pages)==3
for i,page in enumerate(numbered.pages):
    assert f'Folio {5+i} / 7' in page.extract_text()
    points=[]
    def visit(text,cm,tm,font,size):
        if 'Folio' in text:points.append((cm[0]*tm[4]+cm[2]*tm[5]+cm[4],cm[1]*tm[4]+cm[3]*tm[5]+cm[5]))
    page.extract_text(visitor_text=visit)
    assert points and abs(points[0][1]-20)<.01
assert numbered.get_fields()['Respuesta']['/V']=='Conservada'
assert numbered.metadata.title=='Documento de lote'
widgets=[a.get_object() for a in numbered.pages[0]['/Annots'] if a.get_object()['/Subtype']=='/Widget']
assert len(widgets)==1 and widgets[0]['/AP']['/N'].get_data()
checks.append({'case':'numbering','labels':['Folio 5 / 7','Folio 6 / 7','Folio 7 / 7'],'baseline_margin_points':20,'canonical_field_and_appearance':True})

source=PdfReader(root/'batch-watermark/Rotaciones.pdf')
marked=PdfReader(report_folder('batch-watermark')/'Rotaciones-marca-de-agua.pdf')
for i,(before,page) in enumerate(zip(source.pages,marked.pages)):
    assert page.rotation==i*90 and list(page.cropbox)==list(before.cropbox)
    assert page.get('/UserUnit',1)==before.get('/UserUnit',1)
    assert page.extract_text().count('REVISADO')==1
    assert f'Rotaciones - Pagina {i+1}' in page.extract_text()
    alpha=[v.get_object().get('/ca') for v in page['/Resources'].get('/ExtGState',{}).get_object().values()]
    assert any(v is not None and abs(float(v)-.22)<.001 for v in alpha)
assert marked.get_fields()['Respuesta']['/V']=='Conservada'
assert marked.pages[0]['/Annots'][0].get_object()['/AP']['/N'].get_data()
checks.append({'case':'watermark','rotations':[0,90,180,270],'crop_and_userunit_retained':True,'opacity':.22,'canonical_field_and_appearance':True})

extracted=PdfReader(report_folder('batch-extract')/'Extraer-paginas.pdf')
assert len(extracted.pages)==2
assert 'Extraer - Pagina 3' in extracted.pages[0].extract_text()
assert 'Extraer - Pagina 2' in extracted.pages[1].extract_text()
assert not extracted.get_fields()
report=json.loads((root/'batch-extract/informe.json').read_text(encoding='utf-8'))
assert sum(row['status']=='done' for row in report['results'])==2
assert sum(row['status']=='error' for row in report['results'])==3
checks.append({'case':'extraction-and-report','selected_order':[3,2],'completed':2,'errors':3,'settings_per_file':True})
output=Path('docs/capturas')/json.loads(Path('package.json').read_text(encoding='utf-8'))['version'];output.mkdir(parents=True,exist_ok=True)
text=json.dumps(checks,ensure_ascii=False,indent=2)
(output/'verificacion-lotes.json').write_text(text+'\n',encoding='utf-8')
print(text)
