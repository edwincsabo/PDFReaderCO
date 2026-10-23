"""Independent extraction, geometry and document-structure checks for 1.19."""
import json
import os
import re
from pathlib import Path
from pypdf import PdfReader

def compact(text):return re.sub(r'\s+','',text)
def records(page):
    from pypdf.generic import ContentStream
    items=[]
    identity=[1,0,0,1,0,0]
    def mul(a,b):return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]
    def walk(content,resources,parent,level=0):
        assert level<17
        resources=resources.get_object();cm=list(parent);tm=list(identity);font='';size=0;stack=[]
        for args,op in ContentStream(content,page.pdf).operations:
            if op==b'q':stack.append((list(cm),font,size))
            elif op==b'Q':cm,font,size=stack.pop()
            elif op==b'cm':cm=mul(cm,list(map(float,args)))
            elif op==b'BT':tm=list(identity)
            elif op==b'Tm':tm=list(map(float,args))
            elif op==b'Tf':
                fonts=resources.get('/Font',{}).get_object();entry=fonts[args[0]].get_object();font=str(entry.get('/BaseFont',''));size=float(args[1])
            elif op in [b'Tj',b'TJ']:
                text=str(args[0]) if op==b'Tj' else ''.join(str(a) for a in args[0] if isinstance(a,str))
                if text.strip():
                    matrix=mul(cm,tm);items.append({'text':text,'x':matrix[4],'y':matrix[5],'font':font,'size':size})
            elif op==b'Do':
                form=resources['/XObject'][args[0]].get_object()
                if form.get('/Subtype')=='/Form':walk(form,form.get('/Resources',resources),mul(cm,list(map(float,form.get('/Matrix',identity)))),level+1)
    walk(page.get_contents(),page['/Resources'],identity)
    return items

checks=[]
for angle in [0,90]:
    root=Path(f'test-results/original-paragraph-{angle}');a=PdfReader(root/'entrada.pdf');b=PdfReader(root/'parrafo-editado.pdf')
    assert len(a.pages)==len(b.pages)==3
    assert compact('Texto modificado con varias palabras para distribuir. Otra linea del párrafo.') in compact(b.pages[1].extract_text())
    assert 'Primera linea original 2' not in b.pages[1].extract_text()
    assert 'Vecino intacto 2' in b.pages[1].extract_text()
    for index in [0,2]:assert a.pages[index].get_contents().get_data()==b.pages[index].get_contents().get_data()
    page=b.pages[1];assert page.get('/Rotate')==angle;assert page.get('/UserUnit')==2;assert list(page.cropbox)==[20,30,520,730]
    layouts=[args[1] for args,op in page.get_contents().operations if op==b'BDC' and str(args[0])=='/PDFCOParagraph']
    assert layouts and all(p['/Width']==210 and p['/Height']==100 and p['/Alignment']==1 and p['/X']==100 and p['/Y']==160 for p in layouts)
    checks.append({'case':f'paragraph-{angle}','page_count':3,'area':[210,100],'anchor':[100,160],'alignment':'center','other_pages_byte_identical':True})

root=Path('test-results/original-group-edit');a=PdfReader(root/'entrada.pdf');b=PdfReader(root/'grupo-editado.pdf')
assert 'Grupo editado' in b.pages[0].extract_text();assert 'Texto agrupado' in b.pages[0].extract_text()
assert 'Grupo editado' not in b.pages[1].extract_text();assert b.pages[1].extract_text().count('Texto agrupado')==2
assert a.pages[1].get_contents().get_data()==b.pages[1].get_contents().get_data()
target=next(r for r in records(b.pages[0]) if 'Grupo editado' in r['text']);assert abs(target['x']-95)<.003 and abs(target['y']-550)<.003
checks.append({'case':'shared-group','selected_origin':[95,550],'other_occurrences_unchanged':True,'other_page_byte_identical':True})

b=PdfReader('test-results/original-masked-font/fuente-con-mascara.pdf');page=b.pages[0];target=next(r for r in records(page) if 'Cambio con máscara' in r['text'])
assert target['font']=='/Times-BoldItalic';assert target['size']==16;assert abs(target['x']-40)<.003 and abs(target['y']-600)<.003
rectangles=[list(map(float,args)) for args,op in page.get_contents().operations if op==b're'];assert [45,605,100,8] in rectangles
assert any(op==b'BMC' and str(args[0])=='/Span' for args,op in page.get_contents().operations)
assert 'Vecino intacto' in page.extract_text();checks.append({'case':'masked-tagged-font','font':'Times-BoldItalic','size':16,'origin':[40,600],'clip':[45,605,100,8],'span_retained':True})

unit=PdfReader('tmp/pdfs/original-expansion/parrafo.pdf');fields=unit.get_fields();assert fields['Texto_1']['/V']=='Respuesta conservada';assert unit.metadata.title=='Edición ampliada'
widgets=[a.get_object() for a in unit.pages[0].get('/Annots',[]) if a.get_object().get('/Subtype')=='/Widget'];assert widgets and all(w.get('/AP',{}).get('/N') for w in widgets)
checks.append({'case':'native-form','field_value_and_widget_appearance_retained':True,'title_retained':True})

if os.environ.get('PDFREADERCO_TEST_PDF'):
    a=PdfReader(os.environ['PDFREADERCO_TEST_PDF']);b=PdfReader('test-results/original-expansion-sample/fuente-alternativa.pdf')
    assert len(a.pages)==len(b.pages);assert compact(a.pages[0].extract_text())==compact(b.pages[0].extract_text());assert (a.get_fields() or {})==(b.get_fields() or {})
    assert len(a.pages[0].get('/Annots',[]))==len(b.pages[0].get('/Annots',[]))
    metadata=lambda r:{k:v for k,v in (r.metadata or {}).items() if k not in ['/Producer','/ModDate']};assert metadata(a)==metadata(b)
    checks.append({'case':'private-sample','extracted_characters_fields_annotations_metadata_retained':True})
print(json.dumps(checks,ensure_ascii=False,indent=2))
