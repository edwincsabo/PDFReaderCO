"""Independent saved-PDF, form, caret placement and pixel checks."""
from pathlib import Path
from poppler_path import pdftoppm
import json,re,subprocess
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image,ImageChops,ImageDraw
from reportlab.pdfbase.pdfmetrics import stringWidth
root=Path(__file__).resolve().parents[1];version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
out=root/'docs/capturas'/version/'cursor';out.mkdir(parents=True,exist_ok=True)
poppler=pdftoppm()
def form(r):
    assert r.get_fields()['Respuesta']['/V']=='Conservada'
    widgets=[a.get_object() for a in r.pages[0]['/Annots'] if a.get_object().get('/Subtype')=='/Widget'];assert len(widgets)==1
    w=widgets[0];owner=w
    while '/V' not in owner and '/Parent' in owner:owner=owner['/Parent'].get_object()
    assert owner['/V']=='Conservada' and w['/AP']['/N'].get_object().get_data()
def render(file,name):
    subprocess.run([poppler,'-f','1','-singlefile','-r','120','-png',str(file),str(out/name)],check=True,capture_output=True)
    return Image.open(out/(name+'.png')).convert('RGB')
source=root/'test-results/caret-engine/source.pdf';edited=root/'test-results/caret-engine/edited.pdf'
r=PdfReader(edited);form(r);assert 'Unocuatrotres' in re.sub(r'\s+','',r.pages[0].extract_text());assert 'Vecino conservado' in r.pages[0].extract_text()
geometry=json.loads((root/'test-results/caret-engine/geometry.json').read_text());stop=[s for s in geometry['stops'] if s['offset']==4][-1]
expected=50+stringWidth('Uno ','Helvetica',16);assert abs(stop['a'][0]-expected)<1.5,(stop,expected);assert 690<stop['a'][1]<705 and 710<stop['b'][1]<720
a=render(source,'original');b=render(edited,'editado');diff=ImageChops.difference(a,b);scale=120/72
ImageDraw.Draw(diff).rectangle([int(44*scale),int((800-730)*scale),int(325*scale),int((800-635)*scale)],fill=(0,0,0));assert diff.getbbox() is None,'Cambios fuera del párrafo'
ui={}
for angle in[0,90]:
    file=root/f'test-results/direct-cursor-{angle}/editado.pdf';reader=PdfReader(file);form(reader)
    p=reader.pages[0];assert p.get('/Rotate',0)==angle;assert int(p.get('/UserUnit',1))==(2 if angle else 1)
    assert 'Unocuatro dostres'.replace(' ','') in re.sub(r'\s+','',p.extract_text())
    data=[args[1] for args,op in ContentStream(p.get_contents(),reader).operations if op==b'BDC' and str(args[0])=='/PDFCOParagraph' and '/Text' in args[1]]
    assert str(data[0]['/Text'])=='Uno cuatro dos tres'
    render(file,'interfaz-'+str(angle));ui[str(angle)]=True
styled=PdfReader(root/'test-results/direct-cursor-properties/formato.pdf');form(styled)
logical=[]
for args,op in ContentStream(styled.pages[0].get_contents(),styled).operations:
    if op==b'BDC' and str(args[0])=='/PDFCOParagraph' and '/Data' in args[1]:logical.append(json.loads(str(args[1]['/Data'])))
assert any(s['fontName']=='Helvetica-Bold' and s['text']=='dos' for d in logical for s in d['paint'])
report={'version':version,'canonical_form_and_widget_appearance':True,'neighbor_preserved':True,'outside_paragraph_pixels_identical':True,'caret_contrasted_with_standard_font_advance':True,'rotation_and_userunit_outputs':ui,'mixed_style_after_draft_undo_redo':True}
(out/'verificacion.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
