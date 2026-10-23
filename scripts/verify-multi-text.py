"""Independent geometry, style, form and rendering checks for joint format."""
from pathlib import Path
from poppler_path import pdftoppm
import json,re,subprocess
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image,ImageChops,ImageDraw
from reportlab.pdfbase.pdfmetrics import stringWidth
root=Path(__file__).resolve().parents[1];version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
out=root/'docs/capturas'/version/'seleccion';out.mkdir(parents=True,exist_ok=True)
poppler=pdftoppm()
def form(r):
    assert r.get_fields()['Respuesta']['/V']=='Conservada'
    widgets=[a.get_object() for a in r.pages[0]['/Annots'] if a.get_object().get('/Subtype')=='/Widget'];assert len(widgets)==1
    w=widgets[0];owner=w
    while '/V' not in owner and '/Parent' in owner:owner=owner['/Parent'].get_object()
    assert owner['/V']=='Conservada' and w['/AP']['/N'].get_object().get_data()
def properties(r):
    return [args[1] for args,op in ContentStream(r.pages[0].get_contents(),r).operations if op==b'BDC' and str(args[0])=='/PDFCOParagraph' and '/Data' in args[1]]
def render(file,label):
    subprocess.run([poppler,'-f','1','-singlefile','-r','120','-png',str(file),str(out/label)],check=True,capture_output=True)
    return Image.open(out/(label+'.png')).convert('RGB')
source=root/'test-results/multi-text-engine/source.pdf';formatted=root/'test-results/multi-text-engine/formatted.pdf';a=PdfReader(source);b=PdfReader(formatted);form(b)
assert re.sub(r'\s+','',a.pages[0].extract_text())==re.sub(r'\s+','',b.pages[0].extract_text())
assert list(b.attachments['dato.bin'])==[bytes([4,3,2])]
props=properties(b);assert len(props)==2
for p,text,font,size,y,selected in zip(props,['Primero uno dos tres','Segundo cuatro cinco'],['Helvetica','Times-Bold'],[14,16],[700,640],['uno','cuatro']):
    assert str(p['/Text'])==text and float(p['/X'])==50 and float(p['/Y'])==y
    data=json.loads(str(p['/Data']));assert ''.join(s['text'] for s in data['spans'])==text
    x=0
    for span,paint in zip(data['spans'],data['paint']):
        assert paint['fontName']==font and paint['fontSize']==size
        assert abs(paint['matrix'][4]-x)<.002 and abs(paint['matrix'][5])<.002
        assert paint['matrix'][:4]==[1,0,0,1]
        assert paint['color']==('#225599' if span['text']==selected else '#000000')
        x+=stringWidth(span['text'],font,size)
    assert any(s['text']==selected for s in data['spans'])
# Check actual drawing transforms independently of the saved editing metadata.
painted=[]
def visitor(text,cm,tm,font,size):
    if text.strip():painted.append((text.strip(),cm[0]*tm[4]+cm[2]*tm[5]+cm[4],cm[1]*tm[4]+cm[3]*tm[5]+cm[5],size))
b.pages[0].extract_text(visitor_text=visitor)
for text,prefix,font,size,y in [('uno','Primero ','Helvetica',14,700),('cuatro','Segundo ','Times-Bold',16,640)]:
    actual=[v for v in painted if v[0]==text];assert actual,(text,painted)
    assert any(abs(v[1]-50-stringWidth(prefix,font,size))<.002 and abs(v[2]-y)<.002 and v[3]==size for v in actual)
original=render(source,'original');changed=render(formatted,'formato-parcial');diff=ImageChops.difference(original,changed);scale=120/72
for word,prefix,font,size,y in [('uno','Primero ','Helvetica',14,700),('cuatro','Segundo ','Times-Bold',16,640)]:
    x=50+stringWidth(prefix,font,size);right=x+stringWidth(word,font,size)
    ImageDraw.Draw(diff).rectangle([int((x-2)*scale),int((800-y-size-2)*scale),int((right+2)*scale),int((800-y+size*.3+2)*scale)],fill=(0,0,0))
assert diff.getbbox() is None,'Cambios fuera de las palabras formateadas'
ui={}
for angle in[0,90]:
    file=root/f'test-results/multi-text-ui-{angle}/formato.pdf';r=PdfReader(file);form(r);p=r.pages[0]
    assert p.get('/Rotate',0)==angle and int(p.get('/UserUnit',1))==(2 if angle else 1)
    ps=properties(r);assert [str(p['/Text']) for p in ps]==['Primero uno dos tres','Segundo cuatro cinco']
    assert float(ps[0]['/X'])==50 and float(ps[0]['/Y'])==700 and float(ps[1]['/Y'])==640
    d=json.loads(str(ps[0]['/Data']));assert any(s['text']=='uno dos tres' and s['color']=='#225599' for s in d['spans'])
    render(file,'interfaz-'+str(angle));ui[str(angle)]=True
masked_source=root/'test-results/multi-text-engine/masked-source.pdf';masked_result=root/'test-results/multi-text-engine/masked-formatted.pdf'
masked=False
if masked_source.exists():
    src=PdfReader(masked_source);dst=PdfReader(masked_result)
    curves=lambda r:{tuple(float(v) for v in args) for args,op in ContentStream(r.pages[0].get_contents(),r).operations if op==b'c'}
    assert curves(src) and curves(src)==curves(dst)
    assert re.sub(r'\s+','',src.pages[0].extract_text())==re.sub(r'\s+','',dst.pages[0].extract_text())
    render(masked_source,'mascaras-original');render(masked_result,'mascaras-formato');masked=True
report={'version':version,'logical_text_and_original_fonts':True,'actual_native_positions_match_standard_advances':True,'outside_selected_words_pixels_identical':True,'block_anchors_preserved':True,'canonical_form_and_appearance':True,'attachment_preserved':True,'curved_masks_preserved':masked,'rotation_and_userunit_ui_outputs':ui}
(out/'verificacion.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
