"""Independent pypdf/Poppler checks for partial editing and local fonts."""
from pathlib import Path
from poppler_path import pdftoppm
import json, subprocess, re
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image, ImageChops, ImageDraw

root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
folder=root/'docs/capturas'/version/'edicion';folder.mkdir(parents=True,exist_ok=True)
samples=root/'test-results/rich-text-engine'
poppler=Path(pdftoppm())
def render(file,label):
    subprocess.run([str(poppler),'-f','1','-singlefile','-r','120','-png',str(file),str(folder/label)],check=True,capture_output=True)
    return Image.open(folder/(label+'.png')).convert('RGB')
def compact(text): return re.sub(r'\s+','',text)
before=PdfReader(samples/'source.pdf');after=PdfReader(samples/'styled.pdf')
assert 'UnoCuatroCinco' in compact(after.pages[0].extract_text())
assert 'UnoTresCinco' not in compact(after.pages[0].extract_text())
assert 'Contenido conservado' in after.pages[0].extract_text()
fields=after.get_fields();assert fields['Respuesta']['/V']=='Conservada'
widgets=[r.get_object() for r in after.pages[0]['/Annots'] if r.get_object().get('/Subtype')=='/Widget']
assert len(widgets)==1 and widgets[0]['/AP']['/N'].get_object().get_data()
fonts=after.pages[0]['/Resources']['/Font'].get_object()
assert any(f.get_object().get('/BaseFont')=='/Helvetica-Bold' for f in fonts.values())
colors=[list(map(float,args)) for args,op in ContentStream(after.pages[0].get_contents(),after).operations if op==b'rg']
assert any(max(abs(a-b) for a,b in zip(c,[153/255,17/255,34/255]))<0.0001 for c in colors)
a=render(samples/'source.pdf','original');b=render(samples/'styled.pdf','formato-parcial')
diff=ImageChops.difference(a,b);scale=120/72
ImageDraw.Draw(diff).rectangle([int(35*scale),int((800-730)*scale),int(250*scale),int((800-680)*scale)],fill=(0,0,0))
assert diff.getbbox() is None,'Cambio de píxeles fuera del texto editado'
for name,text in [('local-font','TextoЖΩá€'),('mixed-local','UnoЖΩCinco')]:
    r=PdfReader(samples/(name+'.pdf'));assert text in compact(r.pages[0].extract_text())
    embedded=[]
    for font in r.pages[0]['/Resources']['/Font'].get_object().values():
        f=font.get_object()
        for item in f.get('/DescendantFonts',[f]):
            d=item.get_object().get('/FontDescriptor');d=d.get_object() if d else {}
            if d.get('/FontFile2'):embedded.append(d['/FontFile2'].get_object().get_data())
    assert embedded and max(map(len,embedded))>10000
    render(samples/(name+'.pdf'),name)
para=PdfReader(samples/'paragraph.pdf');assert 'UnoTresCinco' in compact(para.pages[0].extract_text());assert 'distribuir' in para.pages[0].extract_text();render(samples/'paragraph.pdf','parrafo')
ui_checks={}
for relative,text in [('rich-ui-word/Estilos guardados.pdf','UnoCuatroCinco'),('rich-ui-font/Fuente local.pdf','TextoЖΩá€')]:
    file=root/'test-results'/relative
    if file.exists():
        r=PdfReader(file);assert text in compact(r.pages[0].extract_text());assert r.get_fields()['Respuesta']['/V']=='Conservada';ui_checks[relative]=True
result={'version':version,'checks':{'partial_text':True,'bold_font_and_color':True,'form_value_and_appearance':True,'pixels_outside_edit_identical':True,'local_and_mixed_unicode':True,'fonts_embedded':True,'styled_paragraph':True},'packaged_ui_outputs':ui_checks}
(folder/'verificacion.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False))
