from pathlib import Path
from poppler_path import pdftoppm
import json,os,subprocess,hashlib
from pypdf import PdfReader
from PIL import Image,ImageChops,ImageDraw,ImageFilter
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
out=root/'docs/capturas'/version/'mascaras';out.mkdir(parents=True,exist_ok=True)
poppler=Path(pdftoppm())
title='Criterio de aceptación'+'n'*14
def render(file,folder,label):
    folder.mkdir(parents=True,exist_ok=True)
    subprocess.run([str(poppler),'-f','1','-singlefile','-r','96','-png',str(file),str(folder/label)],check=True,capture_output=True)
    return Image.open(str(folder/label)+'.png').convert('RGB')
def compare(before_path,after_path,folder,label,exact=True):
    a,b=PdfReader(before_path),PdfReader(after_path);text=b.pages[0].extract_text();assert title in text,text
    before=render(before_path,folder,label+'-antes');after=render(after_path,folder,label+'-despues');assert before.size==after.size
    difference=ImageChops.difference(before,after);scale=96/72;height=float(a.pages[0].mediabox.height)
    # The title is the only content permitted to change. The clip and its
    # surroundings remain untouched, including the rounded container corners.
    ImageDraw.Draw(difference).rectangle([int(75*scale),int((height-819)*scale),int(275*scale),int((height-804)*scale)],fill=(0,0,0))
    stats={'pixels_identical_outside_title':difference.getbbox() is None}
    if exact: assert stats['pixels_identical_outside_title'],label
    else:
        edges=ImageChops.lighter(ImageChops.difference(before.filter(ImageFilter.MaxFilter(3)),before.filter(ImageFilter.MinFilter(3))),ImageChops.difference(after.filter(ImageFilter.MaxFilter(3)),after.filter(ImageFilter.MinFilter(3))))
        away=0;changed=0;total=0
        for y in range(difference.height):
            for x in range(difference.width):
                delta=difference.getpixel((x,y));gradient=edges.getpixel((x,y));total+=sum(delta)
                if max(delta):changed+=1
                if max(delta)>2 and max(gradient)<8:away+=1
        assert away==0,'Cambios fuera de los bordes gráficos detectados'
        stats.update({'changed_edge_pixels':changed,'changes_away_from_edges':away,'mean_channel_delta':total/(difference.width*difference.height*3)})
    return a,b,stats
engine=root/'test-results/mask-expansion-engine'
a,b,synthetic=compare(engine/'source.pdf',engine/'expanded.pdf',out,'sintetico')
assert b.get_fields()['Respuesta']['/V']=='Conservada'
widgets=[r.get_object() for r in b.pages[0]['/Annots'] if r.get_object().get('/Subtype')=='/Widget']
assert len(widgets)==1 and widgets[0]['/AP']['/N'].get_object().get_data()
result={'version':version,'synthetic':{'text_correct':True,'outside_title_pixels_identical':synthetic['pixels_identical_outside_title'],'field_preserved':True}}
if os.environ.get('PDFREADERCO_MASK_PDF'):
    original=Path(os.environ['PDFREADERCO_MASK_PDF']);before_hash=hashlib.sha256(original.read_bytes()).hexdigest()
    a,b,private=compare(original,root/'tmp/mask-private/expanded.pdf',root/'tmp/mask-private','privado',exact=False)
    assert hashlib.sha256(original.read_bytes()).hexdigest()==before_hash
    ui=root/'test-results/mask-expansion-private/comprobacion-privada.pdf'
    if ui.exists():
        _,_,ui_stats=compare(original,ui,root/'tmp/mask-private','privado-interfaz',exact=False)
        result['reported_document_ui']={'text_correct':True,'raster_comparison':ui_stats}
    result['reported_document']={'text_correct':True,'raster_comparison':private,'source_sha256':before_hash,'source_unchanged':True}
(out/'verificacion.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'version':version,'result':'passed','reported_document':bool(os.environ.get('PDFREADERCO_MASK_PDF'))}))
