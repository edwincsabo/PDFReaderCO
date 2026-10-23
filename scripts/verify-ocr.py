"""Independent extraction, form, image and pixel checks after OCR UI tests."""
from pathlib import Path
from poppler_path import pdftoppm
from io import BytesIO
import base64
import hashlib
import json
import subprocess
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image, ImageChops

root = Path('test-results/ocr-offline')
before = PdfReader(root / 'escaneo.pdf')
after = PdfReader(root / 'con-ocr.pdf')
normalize = lambda text: ' '.join(text.split())
assert len(before.pages) == len(after.pages) == 3
assert not before.pages[0].extract_text().strip()
recognized = (root / 'reconocido.txt').read_text(encoding='utf-8').split('\n', 1)[1]
extracted = after.pages[0].extract_text()
assert normalize(extracted) == normalize(recognized)
assert 'Factura numero 2026' in extracted and 'Bogotá' in extracted and '1250,50' in extracted
assert before.pages[1].extract_text() == after.pages[1].extract_text()
assert not after.pages[2].extract_text().strip()
assert '/PDFReaderCOOCR' in after.pages[0]
assert all('/PDFReaderCOOCR' not in page for page in after.pages[1:])
marker = json.loads(after.pages[0]['/PDFReaderCOOCR'])
assert marker['language'] == 'spa+eng' and marker['version'] == 1
assert marker['engine'] == 'Tesseract.js 7.0.0'
assert 0 <= marker['confidence'] <= 100
assert dict(before.attachments) == dict(after.attachments)
assert list(after.attachments['prueba.bin']) == [bytes([4, 3, 2, 1])]
assert before.metadata.title == after.metadata.title
field = after.get_fields()['Respuesta']
assert field['/V'] == before.get_fields()['Respuesta']['/V'] == 'Dato conservado'
assert field.get('/DV') == before.get_fields()['Respuesta'].get('/DV')
for ref in field.indirect_reference.get_object()['/Kids']:
    widget = ref.get_object()
    assert widget.raw_get('/Parent') == field.indirect_reference
    assert ref in after.pages[0]['/Annots']
    stream = widget['/AP']['/N']
    texts = [str(args[0]) for args, op in ContentStream(stream, after).operations if op == b'Tj']
    assert 'Dato conservado' in ''.join(texts)
notes = [ref.get_object() for ref in after.pages[0]['/Annots'] if ref.get_object().get('/Subtype') == '/Text']
assert len(notes) == 1 and notes[0]['/Contents'] == 'Comentario conservado'

def rasters(resources, seen=None):
    seen = set() if seen is None else seen
    found = []
    objects = resources.get('/XObject')
    if objects is None:
        return found
    for ref in objects.get_object().values():
        obj = ref.get_object()
        key = id(obj)
        if key in seen:
            continue
        seen.add(key)
        if obj.get('/Subtype') == '/Image':
            found.append(hashlib.sha256(obj._data).hexdigest())
        elif obj.get('/Subtype') == '/Form':
            found.extend(rasters(obj.get('/Resources', {}), seen))
    return sorted(found)

assert rasters(before.pages[0]['/Resources']) == rasters(after.pages[0]['/Resources'])
project = json.loads((root / 'con-ocr.pdfco').read_text(encoding='utf-8'))
project_pdf = PdfReader(BytesIO(base64.b64decode(project['pdf'])))
assert normalize(project_pdf.pages[0].extract_text()) == normalize(extracted)
rotated_root = Path('test-results/ocr-rotated')
rotated = PdfReader(rotated_root / 'girado-ocr.pdf')
assert rotated.pages[0]['/Rotate'] == 90 and rotated.pages[0]['/UserUnit'] == 2
assert list(rotated.pages[0].cropbox) == [20, 30, 520, 730]
assert 'Factura' in rotated.pages[0].extract_text()

output = Path('docs/capturas')/json.loads(Path('package.json').read_text(encoding='utf-8'))['version']
output.mkdir(parents=True, exist_ok=True)
poppler = Path(pdftoppm())
comparisons = [(root / 'escaneo.pdf', root / 'con-ocr.pdf', 'ocr'), (rotated_root / 'girado.pdf', rotated_root / 'girado-ocr.pdf', 'girado')]
pixel_checks = {}
for original, result, label in comparisons:
    for file, suffix in [(original, 'antes'), (result, 'despues')]:
        subprocess.run([str(poppler), '-f', '1', '-singlefile', '-scale-to', '1300', '-png', str(file), str(output / (label+'-'+suffix))], check=True)
    a = Image.open(output / (label+'-antes.png')).convert('RGB')
    b = Image.open(output / (label+'-despues.png')).convert('RGB')
    assert a.size == b.size and ImageChops.difference(a, b).getbbox() is None
    pixel_checks[label] = True
summary = {'engine': marker['engine'], 'languages': marker['language'], 'searchable_text_matches_review': True, 'spanish_and_english_text': True, 'confidence': marker['confidence'], 'original_compressed_image_bytes_identical': True, 'forms_values_and_appearances_preserved': True, 'attachment_comment_metadata_preserved': True, 'existing_text_and_blank_pages_unchanged': True, 'project_text_preserved': True, 'rotated_crop_userunit_preserved': True, 'rendered_pixels_identical': pixel_checks}
(output / 'verificacion-ocr.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False, indent=2))
