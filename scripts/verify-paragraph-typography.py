"""Independent paragraph layout/style/form and pixel checks with pypdf/Poppler."""
from pathlib import Path
from poppler_path import pdftoppm
import json,subprocess,re,math
from pypdf import PdfReader
from pypdf.generic import ContentStream
from reportlab.pdfbase.pdfmetrics import stringWidth
from PIL import Image,ImageChops,ImageDraw
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
out=root/'docs/capturas'/version/'tipografia';out.mkdir(parents=True,exist_ok=True)
samples=root/'test-results/paragraph-typography-engine'
poppler=pdftoppm()
logical='Primera frase con varias palabras para distribuir en líneas justificadas sin estirar las letras del documento.\n\nSegunda frase con otros estilos que conserva el salto escrito y su última línea.'
def properties(r):
    for args,op in ContentStream(r.pages[0].get_contents(),r).operations:
        if op==b'BDC' and str(args[0])=='/PDFCOParagraph' and '/Data' in args[1]:return args[1]
    raise AssertionError('Sin datos lógicos del párrafo')
def forms(r):
    assert r.get_fields()['Respuesta']['/V']=='Conservada'
    widgets=[v.get_object() for v in r.pages[0]['/Annots'] if v.get_object().get('/Subtype')=='/Widget']
    assert len(widgets)==1 and widgets[0]['/AP']['/N'].get_object().get_data()
def check(file,hanging=False):
    r=PdfReader(file);props=properties(r);assert str(props['/Text'])==logical;assert float(props['/Alignment'])==3
    t=json.loads(str(props['/Typography']));assert t=={'indentLeft':12,'indentRight':18,'firstLineIndent':-8 if hanging else 24,'spaceBefore':6,'spaceAfter':10}
    data=json.loads(str(props['/Data']));assert ''.join(s['text'] for s in data['spans'])==logical
    rows=[]
    for p in data['paint']:
        assert p['fontSize']==14 and max(abs(a-b) for a,b in zip(p['matrix'][:4],[1,0,0,1]))<.0001
        if not rows or abs(rows[-1][0]['matrix'][5]-p['matrix'][5])>.001:rows.append([])
        rows[-1].append(p)
    assert abs(rows[0][0]['matrix'][4]-(4 if hanging else 36))<.001 and abs(rows[0][0]['matrix'][5]+6)<.001
    paragraphs=[re.sub(r'\s+','',p) for p in logical.split('\n') if p.strip()];index=0;acc='';ends=[];starts=[0]
    for n,row in enumerate(rows):
        acc+=''.join(re.sub(r'\s+','',p['text']) for p in row);last=acc==paragraphs[index]
        if last:ends.append(n);index+=1;acc='';starts.append(n+1)
        if not last and len(row)>1:
            p=row[-1];right=p['matrix'][4]+stringWidth(p['text'],p['fontName'],14);assert abs(right-(float(props['/Width'])-18))<.002,(right,row)
        if n not in starts:assert abs(row[0]['matrix'][4]-12)<.002
        else:assert abs(row[0]['matrix'][4]-(4 if hanging else 36))<.002
        if last:assert len(row)==1
    assert index==2 and not acc
    assert abs(rows[ends[0]+1][0]['matrix'][5]-rows[ends[0]][0]['matrix'][5]+67)<.002
    assert any(p['color']=='#225599' and p['fontName']=='Times-Bold' for p in data['paint'])
    forms(r);assert 'Vecino intacto' in r.pages[0].extract_text();return r
def render(file,name):
    subprocess.run([poppler,'-f','1','-singlefile','-r','120','-png',str(file),str(out/name)],check=True,capture_output=True)
    return Image.open(out/(name+'.png')).convert('RGB')
a=render(samples/'source.pdf','original')
for file,label,hanging in [('justified.pdf','justificado',False),('hanging.pdf','sangria-francesa',True)]:
    check(samples/file,hanging);b=render(samples/file,label);diff=ImageChops.difference(a,b);scale=120/72
    ImageDraw.Draw(diff).rectangle([int(30*scale),int((800-735)*scale),int(450*scale),int((800-410)*scale)],fill=(0,0,0));assert diff.getbbox() is None,'Cambios fuera del párrafo'
ui={}
for angle in[0,90]:
    folder=root/f'test-results/typography-ui-{angle}'
    for file,hanging in [('Justificado.pdf',False),('Sangria francesa.pdf',True)]:
        path=folder/file
        if path.exists():
            r=PdfReader(path);p=properties(r);assert str(p['/Text'])==logical;t=json.loads(str(p['/Typography']));assert t['firstLineIndent']==(-8 if hanging else 24);assert t['spaceAfter']==10;forms(r);ui[str(angle)+'/'+file]=True
result={'version':version,'logical_text_and_styles':True,'first_line_and_hanging_indents':True,'interword_justification_and_last_lines':True,'explicit_paragraph_spacing':True,'no_glyph_stretch':True,'form_value_and_appearance':True,'outside_paragraph_pixels_identical':True,'ui_outputs':ui}
currency=samples/'currency.pdf'
if currency.exists():
    r=PdfReader(currency);p=properties(r);data=json.loads(str(p['/Data']));assert '10 €' in str(p['/Text']) and '€' in r.pages[0].extract_text();rows=[]
    for item in data['paint']:
        if not rows or abs(rows[-1][0]['matrix'][5]-item['matrix'][5])>.001:rows.append([])
        rows[-1].append(item)
    for row in rows[:-1]:
        last=row[-1];assert abs(last['matrix'][4]+stringWidth(last['text'],last['fontName'],14)-180)<.002
    render(currency,'simbolos');result['currency_and_quotes_metrics']=True
(out/'verificacion.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))
