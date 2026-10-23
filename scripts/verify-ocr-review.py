"""Independent text, structure and pixel verification for reviewed/prepared OCR."""
from pathlib import Path
from io import BytesIO
import base64, hashlib, json, subprocess
from pypdf import PdfReader
from PIL import Image, ImageChops

version=json.loads(Path('package.json').read_text(encoding='utf-8'))['version']
output=Path('docs/capturas')/version
output.mkdir(parents=True,exist_ok=True)
poppler=Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe'
normalize=lambda text:' '.join(text.split())
def images(resources,seen=None):
    seen=set() if seen is None else seen
    result=[]
    for ref in resources.get('/XObject',{}).get_object().values() if hasattr(resources.get('/XObject',{}),'get_object') else resources.get('/XObject',{}).values():
        obj=ref.get_object()
        if id(obj) in seen:continue
        seen.add(id(obj))
        if obj.get('/Subtype')=='/Image':result.append(hashlib.sha256(obj._data).hexdigest())
        elif obj.get('/Subtype')=='/Form':result.extend(images(obj.get('/Resources',{}),seen))
    return sorted(result)

checks=[]
for folder,filename,label in [('ocr-corrections','corregido.pdf','correcciones'),('ocr-preparation-manual','preparado.pdf','manual'),('ocr-preparation-auto','automatico.pdf','automatico')]:
    root=Path('test-results')/folder
    before,after=PdfReader(root/'entrada.pdf'),PdfReader(root/filename)
    text=after.pages[0].extract_text()
    marker=json.loads(after.pages[0]['/PDFReaderCOOCR'])
    assert 'Factura' in text
    if label=='correcciones':
        reviewed=(root/'revision.txt').read_text(encoding='utf-8').split('\n',1)[1]
        assert normalize(text)==normalize(reviewed),(text,reviewed)
        assert '2031' in text and 'Medellín.' in text and '2026' not in text and 'Bogotá.' not in text
        project=json.loads((root/'corregido.pdfco').read_text(encoding='utf-8'))
        assert normalize(PdfReader(BytesIO(base64.b64decode(project['pdf']))).pages[0].extract_text())==normalize(text)
        assert marker['correctedWords']==2
    elif label=='manual':
        assert '2031' in text and '2026' not in text
        assert marker['correctedWords']==1 and marker['deskewDegrees']==3
        assert after.pages[0]['/Rotate']==90 and after.pages[0]['/UserUnit']==2
        assert list(after.pages[0].cropbox)==list(before.pages[0].cropbox)
    else:
        assert marker['correctedWords']==0 and 2<marker['deskewDegrees']<4
    assert images(before.pages[0]['/Resources'])==images(after.pages[0]['/Resources'])
    assert before.metadata.title==after.metadata.title
    assert dict(before.attachments)==dict(after.attachments)
    assert list(after.attachments['control.bin'])==[bytes([2,4,6])]
    fields=after.get_fields();field=fields['Conservar']
    assert field['/V']==before.get_fields()['Conservar']['/V']=='Respuesta original'
    for ref in field['/Kids']:
        widget=ref.get_object()
        assert widget.raw_get('/Parent')==field.indirect_reference
        assert ref in after.pages[0]['/Annots']
        assert widget['/AP']['/N'].get_data()
    notes=[r.get_object() for r in after.pages[0]['/Annots'] if r.get_object().get('/Subtype')=='/Text']
    assert len(notes)==1 and notes[0]['/Contents']=='Comentario conservado'
    for file,suffix in [(root/'entrada.pdf','antes'),(root/filename,'despues')]:
        subprocess.run([str(poppler),'-f','1','-singlefile','-scale-to','1300','-png',str(file),str(output/(label+'-'+suffix))],check=True)
    a,b=Image.open(output/(label+'-antes.png')).convert('RGB'),Image.open(output/(label+'-despues.png')).convert('RGB')
    assert a.size==b.size and ImageChops.difference(a,b).getbbox() is None
    checks.append(dict(case=label,corrected_words=marker['correctedWords'],deskew_degrees=marker['deskewDegrees'],original_image_streams_identical=True,rendered_pixels_identical=True,canonical_field_and_appearance_preserved=True,attachment_comment_metadata_preserved=True,output_sha256=hashlib.sha256((root/filename).read_bytes()).hexdigest()))
(output/'verificacion-revision-ocr.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(checks,ensure_ascii=False,indent=2))
