"""Independent content/style/geometry, form and pixel checks for format paste."""
from pathlib import Path
from poppler_path import pdftoppm
import json,math,subprocess,re
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image,ImageChops,ImageDraw
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
out=root/'docs/capturas'/version/'formato';out.mkdir(parents=True,exist_ok=True)
engine=root/'test-results/text-format-engine'
poppler=pdftoppm()
def mul(a,b):return[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]
def records(r):
    p=r.pages[0];cm=[1,0,0,1,0,0];tm=cm[:];font='';size=0;color=[0,0,0];stack=[];rows=[]
    for args,op in ContentStream(p.get_contents(),r).operations:
        if op==b'q':stack.append((cm[:],tm[:],font,size,color[:]))
        elif op==b'Q':cm,tm,font,size,color=stack.pop()
        elif op==b'cm':cm=mul(cm,list(map(float,args)))
        elif op==b'Tm':tm=list(map(float,args))
        elif op==b'Tf':font=str(p['/Resources']['/Font'][args[0]].get_object()['/BaseFont']);size=float(args[1])
        elif op==b'rg':color=list(map(float,args))
        elif op==b'g':color=[float(args[0])]*3
        elif op==b'Tj':
            value=args[0];text=value.decode('latin1') if isinstance(value,bytes) else str(value);m=mul(cm,tm)
            rows.append({'text':text,'font':font,'size':size*math.hypot(m[2],m[3])*float(p.get('/UserUnit',1)),'color':color[:],'position':m[4:]})
    return rows
def forms(r):
    assert r.get_fields()['Respuesta']['/V']=='Conservada'
    widgets=[v.get_object() for v in r.pages[0]['/Annots'] if v.get_object().get('/Subtype')=='/Widget']
    assert len(widgets)==1 and widgets[0]['/AP']['/N'].get_object().get_data()
def check(file,points,omit=False):
    r=PdfReader(file);rows=records(r);word=next(x for x in rows if x['text']=='Tres');assert word['font']==('/Helvetica' if omit else '/Times-BoldItalic');assert abs(word['size']-points)<.001;assert max(abs(a-b) for a,b in zip(word['color'],[.6,0,.2]))<.0001
    prefix=next(x for x in rows if x['text'].strip()=='Uno');suffix=next(x for x in rows if x['text'].strip()=='Cinco');assert prefix['font']==suffix['font']=='/Helvetica' and prefix['color']==suffix['color']==[0,0,0];forms(r);return r,rows
def render(file,name):
    subprocess.run([poppler,'-f','1','-singlefile','-r','120','-png',str(file),str(out/name)],check=True,capture_output=True)
    return Image.open(out/(name+'.png')).convert('RGB')
before=PdfReader(engine/'source.pdf');after,rows=check(engine/'partial.pdf',16)
for text in['Fuente','Vecino intacto']:
    a=next(x for x in records(before) if x['text']==text);b=next(x for x in rows if x['text']==text);assert a['text']==b['text'] and a['font']==b['font'] and abs(a['size']-b['size'])<.00001 and max(abs(x-y) for x,y in zip(a['color']+a['position'],b['color']+b['position']))<.00001,(a,b)
a=render(engine/'source.pdf','original');b=render(engine/'partial.pdf','formato-parcial');diff=ImageChops.difference(a,b);scale=120/72
ImageDraw.Draw(diff).rectangle([int(35*scale),int((800-710)*scale),int(260*scale),int((800-655)*scale)],fill=(0,0,0));assert diff.getbbox() is None
para=PdfReader(engine/'paragraph.pdf');forms(para);assert 'Segunda frase conservada.' in para.pages[0].extract_text();render(engine/'paragraph.pdf','parrafo')
ui={}
for rel,size,omit in[('format-ui-partial/Formato parcial.pdf',12,False),('format-ui-tabs/Formato entre documentos.pdf',12,False),('format-ui-unavailable/Sin sustituir fuente.pdf',12,True)]:
    file=root/'test-results'/rel
    if file.exists():check(file,size,omit);ui[rel]=True
file=root/'test-results/format-ui-partial/Formato deshecho.pdf'
if file.exists():
    r=PdfReader(file);assert next(x for x in records(r) if x['text']=='Uno Tres Cinco')['font']=='/Helvetica';forms(r);ui['document_undo']=True
file=root/'test-results/format-ui-paragraph/Parrafo con formato.pdf'
if file.exists():
    r=PdfReader(file);forms(r);text=None
    for args,op in ContentStream(r.pages[0].get_contents(),r).operations:
        if op==b'BDC' and str(args[0])=='/PDFCOParagraph' and '/Text' in args[1]:text=str(args[1]['/Text']);assert float(args[1]['/Alignment'])==1
    assert text=='Primera frase con varias palabras.\n\nSegunda frase conservada.';ui['logical_paragraph']=True;render(file,'parrafo-interfaz')
result={'version':version,'font_color_size':True,'partial_text_surrounding_styles':True,'unrelated_text_unchanged':True,'form_value_and_appearance':True,'outside_line_pixels_identical':True,'ui_outputs':ui}
(out/'verificacion.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))
