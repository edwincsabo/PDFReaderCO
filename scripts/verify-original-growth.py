from pathlib import Path
from poppler_path import pdftoppm
import json, subprocess, hashlib, math
from pypdf import PdfReader
from PIL import Image,ImageChops,ImageDraw

root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
out=root/'docs/capturas'/version/'crecimiento'
out.mkdir(parents=True,exist_ok=True)
poppler=Path(pdftoppm())
checks=[]
def render(file,label,page=1):
    target=out/label
    subprocess.run([str(poppler),'-f',str(page),'-singlefile','-r','96','-png',str(file),str(target)],check=True,capture_output=True)
    return Image.open(str(target)+'.png').convert('RGB')
def body(file,word):
    pdf=PdfReader(file);positions=[]
    def visit(text,cm,tm,font,size):
        if text.strip()==word: positions.append({'size':float(size),'anchor':[tm[4]*cm[0]+tm[5]*cm[2]+cm[4],tm[4]*cm[1]+tm[5]*cm[3]+cm[5]],'font':str(font.get('/BaseFont'))})
    text=pdf.pages[0].extract_text(visitor_text=visit)
    assert word in text and len(positions)==1,(word,text,positions)
    assert abs(positions[0]['size']-20)<.001
    assert pdf.get_fields()['Respuesta']['/V']=='Conservada'
    widgets=[ref.get_object() for ref in pdf.pages[0]['/Annots'] if ref.get_object().get('/Subtype')=='/Widget']
    assert len(widgets)==1
    widget=widgets[0];assert widget.get('/V',widget.get('/Parent',{}).get_object().get('/V') if widget.get('/Parent') else None)=='Conservada'
    assert widget['/AP']['/N'].get_object().get_data()
    return pdf,positions[0]
engine=root/'test-results/original-growth-engine'
before=render(engine/'source.pdf','motor-original')
for file,word in [('longer','Cuatro'),('shortened','Tres'),('restored','Cinco')]:
    pdf,position=body(engine/(file+'.pdf'),word)
    assert max(abs(a-b) for a,b in zip(position['anchor'],[40,700]))<.001
    assert pdf.attachments['dato.bin'][0]==bytes([3,1,4])
    image=render(engine/(file+'.pdf'),'motor-'+file)
    difference=ImageChops.difference(before,image)
    # Only the first word may change; all other pixels, including the form
    # appearance and the colored background outside this rectangle, must agree.
    scale=96/72
    ImageDraw.Draw(difference).rectangle([int(30*scale),int((800-730)*scale),math.ceil(170*scale),math.ceil((800-680)*scale)],fill=(0,0,0))
    assert difference.getbbox() is None,file
    checks.append({'sample':file,'word':word,'position':position,'outside_word_pixels_identical':True})
group_before=PdfReader(engine/'group-source.pdf');group_after=PdfReader(engine/'group-expanded.pdf')
assert group_after.pages[0].extract_text().count('Cuatro')==1
assert group_after.pages[0].extract_text().count('Tres')==1
assert group_after.pages[1].extract_text()==group_before.pages[1].extract_text()
assert ImageChops.difference(render(engine/'group-source.pdf','grupo-antes',2),render(engine/'group-expanded.pdf','grupo-despues',2)).getbbox() is None
checks.append({'sample':'shared-group','other_page_text_and_pixels_identical':True})
table_before=render(engine/'table-source.pdf','tabla-antes')
table_after=render(engine/'table-expanded.pdf','tabla-despues')
assert 'Cuatro' in PdfReader(engine/'table-expanded.pdf').pages[0].extract_text()
difference=ImageChops.difference(table_before,table_after)
ImageDraw.Draw(difference).rectangle([int(35*96/72),int((800-720)*96/72),math.ceil(110*96/72),math.ceil((800-690)*96/72)],fill=(0,0,0))
assert difference.getbbox() is None
checks.append({'sample':'ruled-table','cell_edges_identical':True})
ui=root/'test-results/original-growth-ui'
short=PdfReader(ui/'corto.pdf');restored=PdfReader(ui/'restaurado.pdf')
assert short.pages[0].extract_text().count('Tres')==2
assert restored.pages[0].extract_text().count('Cinco')==1
assert 'Cuatro' in restored.pages[0].extract_text()
for word,expected_y in [('Cuatro',700),('Cinco',620)]:
    _,position=body(ui/'restaurado.pdf',word)
    assert max(abs(a-b) for a,b in zip(position['anchor'],[40,expected_y]))<.001
render(ui/'restaurado.pdf','interfaz-restaurado')
checks.append({'sample':'saved-reopened-restored','size':20,'positions_preserved':True})
(out/'verificacion.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'version':version,'checks':len(checks),'result':'passed'}))
