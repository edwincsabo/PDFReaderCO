from pathlib import Path
from poppler_path import pdftoppm
import json,subprocess,math
from pypdf import PdfReader
from PIL import Image,ImageChops,ImageDraw
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
out=root/'docs/capturas'/version/'parrafos'
out.mkdir(parents=True,exist_ok=True)
poppler=Path(pdftoppm())
def render(file,label):
    subprocess.run([str(poppler),'-f','1','-singlefile','-r','96','-png',str(file),str(out/label)],check=True,capture_output=True)
    return Image.open(str(out/label)+'.png').convert('RGB')
def fields(pdf):
    assert pdf.get_fields()['Respuesta']['/V']=='Conservada'
    widgets=[r.get_object() for r in pdf.pages[0]['/Annots'] if r.get_object().get('/Subtype')=='/Widget']
    assert len(widgets)==1 and widgets[0]['/AP']['/N'].get_object().get_data()
    for w in widgets:
        value=w.get('/V')
        if value is None and w.get('/Parent'):value=w['/Parent'].get_object().get('/V')
        assert value=='Conservada'
def inspect(file,word,expected):
    pdf=PdfReader(file);fields(pdf);found=[]
    def visit(text,cm,tm,font,size):
        if word in text:found.append({'text':text.strip(),'size':float(size),'anchor':[tm[4]*cm[0]+tm[5]*cm[2]+cm[4],tm[4]*cm[1]+tm[5]*cm[3]+cm[5]]})
    pdf.pages[0].extract_text(visitor_text=visit)
    assert found
    assert all(abs(p['size']-14)<.01 for p in found)
    assert max(abs(a-b) for a,b in zip(found[0]['anchor'],expected))<.02,(found[0],expected)
    return pdf,found[0]
engine=root/'test-results/paragraph-tools-engine'
original=render(engine/'source.pdf','original')
checks=[]
for name,word,anchor in [('grown','Este párrafo',[60,680]),('resized','Bloque ajustado',[85,660])]:
    pdf,position=inspect(engine/(name+'.pdf'),word,anchor)
    assert pdf.attachments['dato.bin'][0]==bytes([5,4,3])
    after=render(engine/(name+'.pdf'),name)
    difference=ImageChops.difference(original,after)
    # The changed paragraph and its original lines lie within this region.
    scale=96/72
    ImageDraw.Draw(difference).rectangle([int(45*scale),int((800-705)*scale),math.ceil(340*scale),math.ceil((800-350)*scale)],fill=(0,0,0))
    assert difference.getbbox() is None,name
    checks.append({'sample':name,'position':position,'outside_paragraph_pixels_identical':True})
ui=root/'test-results/paragraph-auto-height'
pdf,position=inspect(ui/'crecido.pdf','Este párrafo',[60,680])
render(ui/'crecido.pdf','interfaz-crecimiento')
checks.append({'sample':'saved-auto-height','position':position})
pdf,position=inspect(root/'test-results/paragraph-properties-handles/esquina-ajustada.pdf','Primer parrafo',[45,692])
render(root/'test-results/paragraph-properties-handles/esquina-ajustada.pdf','interfaz-tiradores')
checks.append({'sample':'properties-resized','position':position})
replacement=PdfReader(root/'test-results/replacement-space-expansion/reemplazado.pdf')
sizes=[]
for page in replacement.pages:
    found=[]
    def visit(text,cm,tm,font,size):
        if 'Cuatro' in text:found.append(float(size))
    page.extract_text(visitor_text=visit);assert found;sizes.append(found[0])
assert abs(sizes[0]-20)<.001 and 8<=sizes[1]<20,sizes
checks.append({'sample':'replacement-expansion-before-explicit-fit','sizes':sizes})
(out/'verificacion.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'version':version,'checks':len(checks),'result':'passed'}))
