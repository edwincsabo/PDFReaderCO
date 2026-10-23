"""Independent text, painting, forms, clipping and rendering checks."""
from pathlib import Path
from poppler_path import pdftoppm
import json,re,subprocess
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image,ImageChops,ImageDraw

root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
out=root/'docs/capturas'/version/'reemplazo';out.mkdir(parents=True,exist_ok=True)
poppler=pdftoppm()

def form(r):
    assert r.get_fields()['Respuesta']['/V']=='Conservada'
    widgets=[a.get_object() for a in r.pages[0]['/Annots'] if a.get_object().get('/Subtype')=='/Widget'];assert len(widgets)==1
    w=widgets[0];owner=w
    while '/V' not in owner and '/Parent' in owner:owner=owner['/Parent'].get_object()
    assert owner['/V']=='Conservada' and w['/AP']['/N'].get_object().get_data()
    assert list(r.attachments['dato.bin'])==[bytes([7,4,1])]

def properties(r):
    return [args[1] for args,op in ContentStream(r.pages[0].get_contents(),r).operations if op==b'BDC' and str(args[0])=='/PDFCOParagraph' and '/Data' in args[1]]

def render(file,label):
    subprocess.run([poppler,'-f','1','-singlefile','-r','120','-png',str(file),str(out/label)],check=True,capture_output=True)
    return Image.open(out/(label+'.png')).convert('RGB')

samples=root/'test-results/multi-replace-engine'
source=PdfReader(samples/'source.pdf');replaced=PdfReader(samples/'replaced.pdf');form(replaced)
ps=properties(replaced)
assert [str(p['/Text']) for p in ps]==['Primero cuatro ','nuevo texto cinco']
painted=[]
def visitor(text,cm,tm,font,size):
    if text.strip():painted.append((text.strip(),cm[0]*tm[4]+cm[2]*tm[5]+cm[4],cm[1]*tm[4]+cm[3]*tm[5]+cm[5],str(font.get('/BaseFont')) if font else '',size))
replaced.pages[0].extract_text(visitor_text=visitor)
for text,y,font,size in [('Primero cuatro',700,'/Helvetica',14),('nuevo texto cinco',640,'/Times-Bold',16)]:
    assert any(t==text and abs(x-50)<.002 and abs(actual_y-y)<.002 and f==font and s==size for t,x,actual_y,f,s in painted),painted
extracted=replaced.pages[0].extract_text()
assert 'uno dos tres' not in extracted and 'Segundo cuatro' not in extracted
assert 'Tercero seis siete' in extracted and 'Vecino conservado' in extracted
for p,y in zip(ps,[700,640]):assert float(p['/X'])==50 and float(p['/Y'])==y
a=render(samples/'source.pdf','original');b=render(samples/'replaced.pdf','reemplazado');diff=ImageChops.difference(a,b);scale=120/72
for y in[700,640]:ImageDraw.Draw(diff).rectangle([int(44*scale),int((800-y-25)*scale),int(330*scale),int((800-y+25)*scale)],fill=(0,0,0))
assert diff.getbbox() is None,'Cambios fuera de los bloques seleccionados'
deleted=PdfReader(samples/'deleted.pdf');form(deleted)
assert 'Primero' not in deleted.pages[0].extract_text() and 'Segundo' not in deleted.pages[0].extract_text()
assert 'Tercero seis siete' in deleted.pages[0].extract_text();render(samples/'deleted.pdf','eliminado')
src=PdfReader(samples/'masked-source.pdf');dst=PdfReader(samples/'masked-replaced.pdf')
curves=lambda r:{tuple(float(v) for v in args) for args,op in ContentStream(r.pages[0].get_contents(),r).operations if op==b'c'}
assert curves(src) and curves(src)==curves(dst)
assert str(properties(dst)[0]['/Text'])=='Seis siete\n\nOcho'
render(samples/'masked-replaced.pdf','mascaras')
for angle in[0,90]:
    file=root/f'test-results/multi-replace-ui-{angle}/reemplazado.pdf';r=PdfReader(file);form(r)
    assert r.pages[0].get('/Rotate',0)==angle and int(r.pages[0].get('/UserUnit',1))==(2 if angle else 1)
    assert [str(p['/Text']) for p in properties(r)]==['Primero cuatro ','nuevo texto cinco']
    render(file,'interfaz-'+str(angle))
    undo=PdfReader(root/f'test-results/multi-replace-ui-{angle}/deshecho.pdf')
    assert 'Primero uno dos tres' in undo.pages[0].extract_text() and 'Segundo cuatro cinco' in undo.pages[0].extract_text()
local=PdfReader(root/'test-results/multi-replace-local/local.pdf');form(local);embedded=[]
for ref in local.pages[0]['/Resources']['/Font'].values():
    f=ref.get_object();children=f.get('/DescendantFonts');fd=(children[0].get_object() if children else f).get('/FontDescriptor')
    if fd and '/FontFile2' in fd.get_object():embedded.append(fd.get_object()['/FontFile2'].get_object().get_data())
assert embedded and all(embedded);render(root/'test-results/multi-replace-local/local.pdf','fuente-local-recuperada')
page=PdfReader(root/'test-results/multi-replace-page/pagina-uno.pdf')
assert 'Otra pagina intacta' in page.pages[1].extract_text()
report={'version':version,'exact_replacement_text':True,'actual_painting_and_anchors':True,'outside_destination_blocks_pixels_identical':True,'canonical_form_and_appearance':True,'attachment_preserved':True,'deletion_checked':True,'curved_masks_preserved':True,'logical_paragraph_breaks':True,'ui_rotations_userunit':True,'document_undo':True,'local_font_embedded_after_recovery':True,'other_page_intact':True}
(out/'verificacion.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
