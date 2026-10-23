"""Independent saved-PDF structure, form, attachment and Poppler pixel checks."""
from pathlib import Path
from poppler_path import pdftoppm
import json,subprocess,re
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image,ImageChops
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
out=root/'docs/capturas'/version/'bloques';out.mkdir(parents=True,exist_ok=True)
samples=root/'test-results/original-blocks-engine'
poppler=pdftoppm()
def read(file):
    r=PdfReader(file)
    fields=r.get_fields();assert fields['Respuesta']['/V']=='Conservada'
    widgets=[a.get_object() for a in r.pages[0]['/Annots'] if a.get_object().get('/Subtype')=='/Widget']
    assert len(widgets)==1
    w=widgets[0];owner=w
    while '/V' not in owner and '/Parent' in owner:owner=owner['/Parent'].get_object()
    assert owner['/V']=='Conservada' and w['/AP']['/N'].get_object().get_data()
    assert r.metadata.title=='Bloques de prueba'
    assert list(r.attachments['dato.bin'])==[bytes([1,2,3])]
    return r
def render(file,label):
    subprocess.run([poppler,'-f','1','-singlefile','-r','120','-png',str(file),str(out/label)],check=True,capture_output=True)
    return Image.open(out/(label+'.png')).convert('RGB')
source=read(samples/'source.pdf');original=render(samples/'source.pdf','original')
text=re.sub(r'\s+','',source.pages[0].extract_text());results={}
for label,expected in [('joined',1),('split',2)]:
    r=read(samples/(label+'.pdf'));assert re.sub(r'\s+','',r.pages[0].extract_text())==text
    ids=set();logical=[]
    for args,op in ContentStream(r.pages[0].get_contents(),r).operations:
        if op==b'BDC' and str(args[0])=='/PDFCOParagraph':
            p=args[1];assert '/Block' in p;ids.add(str(p['/Block']))
            if '/Data' in p:
                data=json.loads(str(p['/Data']));assert ''.join(s['text'] for s in data['spans'])==str(p['/Text'])
                assert len(data['paint'])==len(data['spans']) or label=='split'
                logical.append(str(p['/Text']))
    assert len(ids)==expected
    assert ''.join(logical)=='Primer bloque de texto\nSegundo bloque con otro estilo\nTercer bloque independiente'
    image=render(samples/(label+'.pdf'),label);diff=ImageChops.difference(original,image)
    extrema=diff.getextrema();maximum=max(b for a,b in extrema)
    # PDFium normalizes source fill colors to 8-bit channels while serializing.
    assert maximum<=2,(label,extrema)
    results[label]={'blocks':len(ids),'max_channel_difference':maximum,'canonical_form_and_appearance':True,'attachments_and_metadata':True,'logical_text':True}
ui={}
for folder,name,expected in [('manual-blocks-ui','unido.pdf',1),('manual-blocks-ui','separado.pdf',2),('manual-blocks-fragments','fragmentos.pdf',2)]:
    file=root/'test-results'/folder/name
    if file.exists():
        r=PdfReader(file);assert r.get_fields()['Respuesta']['/V']=='Conservada';ids=set()
        for args,op in ContentStream(r.pages[0].get_contents(),r).operations:
            if op==b'BDC' and str(args[0])=='/PDFCOParagraph':ids.add(str(args[1]['/Block']))
        assert len(ids)==expected,(name,len(ids));ui[name]=True
report={'version':version,'engine_samples':results,'ui_outputs':ui}
(out/'verificacion.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
