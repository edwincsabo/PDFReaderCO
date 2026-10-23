"""Independent checks with pypdf and Poppler; run after OCR motor/UI samples."""
from pathlib import Path
from poppler_path import pdftoppm
import json, subprocess, hashlib
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image, ImageChops

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
output = root / 'docs' / 'capturas' / version / 'ocr'
output.mkdir(parents=True, exist_ok=True)
poppler = Path(pdftoppm())
results = []
def render(file, label, page=1):
    prefix = output / label
    subprocess.run([str(poppler), '-f', str(page), '-singlefile', '-r', '96', '-png', str(file), str(prefix)], check=True, capture_output=True)
    return Image.open(str(prefix)+'.png').convert('RGB')
def same(first, second, label):
    a, b = render(first, label+'-antes'), render(second, label+'-despues')
    assert a.size == b.size
    assert ImageChops.difference(a, b).getbbox() is None, label+' cambió píxeles visibles'
    results.append({'sample':label,'pixels_identical':True})

engine = root / 'test-results' / 'ocr-complete-engine'
source = engine / 'source.pdf'
for name in ['zones', 'removed', 'perspective']:
    same(source, engine/(name+'.pdf'), name)
    pdf = PdfReader(engine/(name+'.pdf'))
    assert pdf.get_fields()['Conservar']['/V'] == 'Valor original'
    assert pdf.attachments['dato.bin'][0] == bytes([1,2,3])
assert '/PDFReaderCOOCR' not in PdfReader(engine/'removed.pdf').pages[0]
assert '2031' in PdfReader(engine/'perspective.pdf').pages[0].extract_text()
words = json.loads((root/'tests/fixtures/ocr-native-words.json').read_text(encoding='utf-8'))
word = next(w for line in words['lines'] for w in line if w['text']=='2026')
x0,y0,x1,y1 = word['box']
baseline = word.get('baseline')
baseline_y = baseline[1]+(baseline[3]-baseline[1])/(baseline[2]-baseline[0])*(x0-baseline[0]) if baseline else y1
quad = [.05,.1,.9,.02,.95,.9,.1,.95]
ax,ay,bx,by,cx,cy,dx,dy = quad
dx1,dx2,dx3 = bx-cx,dx-cx,ax-bx+cx-dx
dy1,dy2,dy3 = by-cy,dy-cy,ay-by+cy-dy
det = dx1*dy2-dx2*dy1
g,h = (dx3*dy2-dx2*dy3)/det,(dx1*dy3-dx3*dy1)/det
u,v = x0/1200,baseline_y/1600
expected = [((bx-ax+g*bx)*u+(dx-ax+h*dx)*v+ax)/(g*u+h*v+1)*600,
            (1-((by-ay+g*by)*u+(dy-ay+h*dy)*v+ay)/(g*u+h*v+1))*800]
positions=[]
# Resolve nested Form matrices explicitly: visitor_text does not compose all
# ancestor transforms when reporting the nested text matrix.
def multiply(a,b):
    return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]]
perspective_pdf=PdfReader(engine/'perspective.pdf')
def inspect_stream(stream,resources,parent):
    matrix=parent[:];stack=[];tm=[1,0,0,1,0,0]
    for operands,operator in ContentStream(stream,perspective_pdf).operations:
        if operator==b'q': stack.append(matrix[:])
        elif operator==b'Q': matrix=stack.pop()
        elif operator==b'cm': matrix=multiply(matrix,[float(n) for n in operands])
        elif operator==b'Tm': tm=[float(n) for n in operands]
        elif operator==b'Do':
            form=resources['/XObject'][operands[0]].get_object()
            if form.get('/Subtype')=='/Form': inspect_stream(form,form.get('/Resources',resources),multiply(matrix,[float(n) for n in form.get('/Matrix',[1,0,0,1,0,0])]))
        elif operator==b'Tj':
            value=operands[0]
            raw=value.get_original_bytes() if hasattr(value,'get_original_bytes') else bytes(value)
            if '2031' in raw.decode('utf-16-be',errors='ignore'):
                combined=multiply(matrix,tm);positions.append(combined[4:6])
inspect_stream(perspective_pdf.pages[0]['/Contents'],perspective_pdf.pages[0]['/Resources'],[1,0,0,1,0,0])
assert any(max(abs(a-b) for a,b in zip(pos,expected))<.01 for pos in positions), (positions,expected)
results.append({'perspective_word_baseline':positions,'expected':expected,'tolerance_pdf_units':.01})
editable = PdfReader(engine/'editable.pdf')
assert '2031' in editable.pages[0].extract_text()
assert '2035' in PdfReader(engine/'editable-edited.pdf').pages[0].extract_text()
assert not editable.get_fields()
render(engine/'editable.pdf','editable-engine')
for grouped in ['false','true']:
    pdf = PdfReader(engine/f'external-{grouped}.pdf')
    assert 'Invisible' not in pdf.pages[0].extract_text()
    assert 'Visible' in pdf.pages[0].extract_text()
    if grouped == 'true': assert 'Invisible' in pdf.pages[1].extract_text()

mixed = root/'test-results'/'ocr-complete-zones'
same(mixed/'entrada.pdf',mixed/'dos-zonas.pdf','zonas-ui')
same(mixed/'entrada.pdf',mixed/'una-zona.pdf','retirada-ui')
text = PdfReader(mixed/'dos-zonas.pdf').pages[0].extract_text()
assert text.count('CABECERA DIGITAL') == 1
assert text.count('Factura') == 2
assert '2031' in text
editable = PdfReader(mixed/'editable.pdf')
assert len(editable.pages) == 2
assert '2031' in editable.pages[0].extract_text()
render(mixed/'editable.pdf','editable-ui')
for folder, filename, label in [('ocr-complete-orientation','orientado.pdf','orientacion-ui'),('ocr-complete-photo','foto-ocr.pdf','foto-ui')]:
    base = root/'test-results'/folder
    same(base/'entrada.pdf',base/filename,label)
    assert ('2040' if folder.endswith('photo') else 'Factura') in PdfReader(base/filename).pages[0].extract_text()
external=root/'test-results'/'ocr-complete-external'
same(external/'entrada.pdf',external/'externo-sustituido.pdf','externo-ui')
external_text=PdfReader(external/'externo-sustituido.pdf').pages[0].extract_text()
assert 'Incorrecto externo' not in external_text and 'Factura' in external_text
batch = root/'test-results'/'ocr-batch-complete'
report = json.loads((batch/'informe.json').read_text(encoding='utf-8'))
done = next(r for r in report['results'] if r['status']=='done')
assert done['ocr']['reviewed'] is False
file = Path(report['destination']) / done['output']
same(batch/'mixto.pdf',file,'lote-ui')
assert 'Factura' in PdfReader(file).pages[0].extract_text()
assert PdfReader(file).pages[1].extract_text().strip() == 'Digital conservado'
results.append({'batch_report':done['ocr'],'copy_sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
(output/'verificacion-independiente.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'version':version,'checks':len(results),'result':'passed'},ensure_ascii=False))
