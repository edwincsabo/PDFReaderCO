"""Independent logical paragraph, font embedding, raster and form checks."""
from pathlib import Path
from poppler_path import pdftoppm
import json,re,subprocess
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image,ImageChops,ImageDraw
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
out=root/'docs/capturas'/version/'edicion';out.mkdir(parents=True,exist_ok=True)
source=root/'test-results/editing-refinements-engine'
poppler=pdftoppm()
logical='  Primera frase con varias palabras que deben distribuirse dentro del área.\n\nSegunda frase con otros estilos y un final.  \n'
def compact(text):return re.sub(r'\s+','',text)
def data(reader):
    for args,op in ContentStream(reader.pages[0].get_contents(),reader).operations:
        if op==b'BDC' and str(args[0])=='/PDFCOParagraph' and '/Data' in args[1]:return args[1]
    raise AssertionError('No hay datos lógicos del párrafo')
def render(file,name):
    subprocess.run([poppler,'-f','1','-singlefile','-r','120','-png',str(file),str(out/name)],check=True,capture_output=True)
    return Image.open(out/(name+'.png')).convert('RGB')
before=PdfReader(source/'source.pdf');narrow=PdfReader(source/'narrow.pdf');wide=PdfReader(source/'wide.pdf')
for reader in[narrow,wide]:
    props=data(reader);assert str(props['/Text'])==logical
    styles=json.loads(str(props['/Data']));assert ''.join(s['text'] for s in styles['spans'])==logical
    assert styles['spans'][1]['color']=='#225599'
    assert compact(logical) in compact(reader.pages[0].extract_text())
    assert 'Vecino intacto' in reader.pages[0].extract_text()
    assert reader.get_fields()['Respuesta']['/V']=='Conservada'
    widgets=[r.get_object() for r in reader.pages[0]['/Annots'] if r.get_object().get('/Subtype')=='/Widget']
    assert len(widgets)==1 and widgets[0]['/AP']['/N'].get_object().get_data()
n=json.loads(str(data(narrow)['/Data']));w=json.loads(str(data(wide)['/Data']));assert len(n['paint'])>len(w['paint'])
a=render(source/'source.pdf','original');b=render(source/'narrow.pdf','estrecho');c=render(source/'wide.pdf','ancho')
for image in[b,c]:
    diff=ImageChops.difference(a,image);scale=120/72
    ImageDraw.Draw(diff).rectangle([int(35*scale),int((800-730)*scale),int(460*scale),int((800-420)*scale)],fill=(0,0,0))
    assert diff.getbbox() is None,'Cambio de píxeles fuera del párrafo'
ui=root/'test-results/refinement-ui-family/Arial Narrow guardado.pdf'
font_checked=False
if ui.exists():
    reader=PdfReader(ui);found=[]
    for ref in reader.pages[0]['/Resources']['/Font'].get_object().values():
        f=ref.get_object()
        for child in f.get('/DescendantFonts',[]):
            child=child.get_object();desc=child['/FontDescriptor'].get_object()
            if str(desc.get('/FontName'))=='/ArialNarrow-BoldItalic':
                assert child['/Subtype']=='/CIDFontType2';assert len(desc['/FontFile2'].get_object().get_data())>10000;found.append(desc)
    assert found;render(ui,'arial-narrow-negrita-cursiva');font_checked=True
paragraph_ui=root/'test-results/refinement-ui-paragraph/Parrafo ancho.pdf'
if paragraph_ui.exists():
    reader=PdfReader(paragraph_ui);assert str(data(reader)['/Text'])==logical.strip();assert reader.get_fields()['Respuesta']['/V']=='Conservada'
    styles=json.loads(str(data(reader)['/Data']))['spans'];assert len(styles)==3 and styles[0]['color']=='#000000' and styles[1]['color']=='#225599' and styles[2]['color']=='#000000'
    render(paragraph_ui,'parrafo-interfaz')
result={'version':version,'logical_text_exact':True,'styles_preserved':True,'widening_reduces_painted_fragments':True,'form_value_and_appearance':True,'outside_paragraph_pixels_identical':True,'ui_narrow_family_embedded':font_checked,'packaged_paragraph_output_checked':paragraph_ui.exists()}
(out/'verificacion.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))
