"""Independent checks of pasted styles, unchanged text, forms and rendering."""
from pathlib import Path
from poppler_path import pdftoppm
import json,re,subprocess
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image,ImageChops,ImageDraw
from reportlab.pdfbase.pdfmetrics import stringWidth
root=Path(__file__).resolve().parents[1];version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
out=root/'docs/capturas'/version/'pegado';out.mkdir(parents=True,exist_ok=True)
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
samples=root/'test-results/multi-paste-engine';source=PdfReader(samples/'source.pdf');pasted=PdfReader(samples/'pasted.pdf');form(pasted)
assert re.sub(r'\s+','',source.pages[0].extract_text())==re.sub(r'\s+','',pasted.pages[0].extract_text())
assert list(pasted.attachments['dato.bin'])==[bytes([6,5,4])]
ps=properties(pasted);assert len(ps)==2
for p,text,word,y in zip(ps,['Primero uno dos tres','Segundo cuatro cinco'],['uno','cuatro'],[700,640]):
    assert str(p['/Text'])==text and float(p['/X'])==50 and float(p['/Y'])==y
    data=json.loads(str(p['/Data']));assert ''.join(s['text'] for s in data['spans'])==text
    assert any(s['text']==word and s['fontSize']==10 and s['color']=='#772244' for s in data['spans'])
    assert any(paint['text'].strip()==word and paint['fontName']=='Courier-Bold' and paint['fontSize']==10 for paint in data['paint'])
painted=[]
def visitor(text,cm,tm,font,size):
    if text.strip():painted.append((text.strip(),cm[0]*tm[4]+cm[2]*tm[5]+cm[4],cm[1]*tm[4]+cm[3]*tm[5]+cm[5],str(font.get('/BaseFont')) if font else '',size))
pasted.pages[0].extract_text(visitor_text=visitor)
for word,prefix,font,size,y in [('uno','Primero ','Helvetica',14,700),('cuatro','Segundo ','Times-Bold',16,640)]:
    assert any(t==word and abs(x-50-stringWidth(prefix,font,size))<.002 and abs(actual_y-y)<.002 and actual_font=='/Courier-Bold' and actual_size==10 for t,x,actual_y,actual_font,actual_size in painted)
a=render(samples/'source.pdf','original');b=render(samples/'pasted.pdf','pegado');diff=ImageChops.difference(a,b);scale=120/72
for y in[700,640]:ImageDraw.Draw(diff).rectangle([int(44*scale),int((800-y-22)*scale),int(320*scale),int((800-y+24)*scale)],fill=(0,0,0))
assert diff.getbbox() is None,'Cambios fuera de los bloques de destino'
ui={}
for folder,file,word,font,size,color in [('multi-paste-ui','pegado.pdf','uno dos tres','Courier-Bold',10,'#772244'),('multi-paste-units','tamano-fisico.pdf','Primero uno dos tres','Courier-Bold',5,'#772244'),('multi-paste-unavailable','sin-fuente.pdf','uno dos tres','Helvetica',10,'#772244')]:
    path=root/'test-results'/folder/file;r=PdfReader(path);form(r);data=json.loads(str(properties(r)[0]['/Data']))
    assert any(s['text']==word and s['fontSize']==size and s['color']==color for s in data['spans'])
    assert any(font==p['fontName'] for p in data['paint'])
    if folder=='multi-paste-units':assert int(r.pages[0]['/UserUnit'])==2 and size*2==10
    ui[file]=True;render(path,folder)
embedded=False
if (samples/'local-pasted.pdf').exists():
    r=PdfReader(samples/'local-pasted.pdf');form(r);fonts=r.pages[0]['/Resources']['/Font'];files=[]
    for ref in fonts.values():
        f=ref.get_object();descendants=f.get('/DescendantFonts')
        descriptor=(descendants[0].get_object() if descendants else f).get('/FontDescriptor')
        if descriptor:
            descriptor=descriptor.get_object()
            if '/FontFile2' in descriptor:files.append(descriptor['/FontFile2'].get_object().get_data())
    assert files and all(files);embedded=True;render(samples/'local-pasted.pdf','fuente-local')
report={'version':version,'logical_text_preserved':True,'copied_font_size_color':True,'actual_painting_checked':True,'outside_destination_blocks_pixels_identical':True,'canonical_form_and_appearance':True,'attachment_preserved':True,'physical_size_userunit':True,'font_opt_out':True,'local_font_embedded':embedded,'ui_outputs':ui}
(out/'verificacion.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
