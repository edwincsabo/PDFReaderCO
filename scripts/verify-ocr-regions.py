"""Independent verification of OCR zones; source images must remain unchanged."""
from pathlib import Path
import hashlib, json, subprocess, unicodedata
from pypdf import PdfReader
from PIL import Image, ImageChops

version = json.loads(Path('package.json').read_text(encoding='utf-8'))['version']
out = Path('docs/capturas') / version
out.mkdir(parents=True, exist_ok=True)
poppler = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe'

def image_streams(resources, seen=None):
    seen = set() if seen is None else seen
    found = []
    objects = resources.get('/XObject', {})
    if hasattr(objects, 'get_object'): objects = objects.get_object()
    for ref in objects.values():
        obj = ref.get_object()
        if id(obj) in seen: continue
        seen.add(id(obj))
        if obj.get('/Subtype') == '/Image': found.append(hashlib.sha256(obj._data).hexdigest())
        elif obj.get('/Subtype') == '/Form': found.extend(image_streams(obj.get('/Resources', {}), seen))
    return sorted(found)

checks = []
for folder, name, zones, invoices in [
    ('ocr-mixed-regions', 'primera-zona.pdf', 1, 1),
    ('ocr-mixed-regions', 'dos-zonas.pdf', 2, 2),
    ('ocr-mixed-regions', 'deshecho.pdf', 1, 1),
    ('ocr-region-rotated', 'zona-girada.pdf', 1, 1),
    ('ocr-region-recovery', 'diacritico-corregido.pdf', 1, 0),
]:
    root = Path('test-results') / folder
    before, after = PdfReader(root / 'entrada.pdf'), PdfReader(root / name)
    a, b = before.pages[0], after.pages[0]
    text = unicodedata.normalize('NFC', b.extract_text())
    marker = json.loads(b['/PDFReaderCOOCR'])
    assert marker['version'] == 2 and marker['scope'] == 'regions' and len(marker['regions']) == zones
    assert text.count('Factura') == invoices
    assert image_streams(a['/Resources']) == image_streams(b['/Resources'])
    assert list(a.cropbox) == list(b.cropbox) and a.get('/Rotate', 0) == b.get('/Rotate', 0) and a.get('/UserUnit', 1) == b.get('/UserUnit', 1)
    assert before.metadata.title == after.metadata.title and dict(before.attachments) == dict(after.attachments)
    if invoices:
        assert text.count('CABECERA DIGITAL') == 1
        assert list(after.attachments['zonas.bin']) == [bytes([3, 1, 4])]
        field = after.get_fields()['Conservar']
        assert field['/V'] == before.get_fields()['Conservar']['/V'] == 'Respuesta conservada'
        widgets = [r.get_object() for r in b['/Annots'] if r.get_object().get('/Subtype') == '/Widget']
        assert len(widgets) == 1 and widgets[0]['/AP']['/N'].get_data()
        widget = widgets[0]
        parent = widget.get('/Parent')
        assert widget.get('/V', parent.get_object().get('/V') if parent else None) == 'Respuesta conservada'
    if folder == 'ocr-region-rotated':
        assert '2031' in text and '2026' not in text and marker['regions'][0]['deskewDegrees'] == 2
    elif folder == 'ocr-region-recovery':
        assert 'pingüino' in text and 'pingúino' not in text and 'pinguino' not in text
        assert marker['regions'][0]['correctedWords'] == 1
    else: assert text.count('2026') == invoices
    prefix = folder + '-' + Path(name).stem
    for file, suffix in [(root / 'entrada.pdf', 'antes'), (root / name, 'despues')]:
        subprocess.run([str(poppler), '-f', '1', '-singlefile', '-scale-to', '1200', '-png', str(file), str(out / (prefix + '-' + suffix))], check=True, capture_output=True)
    left, right = [Image.open(out / (prefix + '-' + s + '.png')).convert('RGB') for s in ['antes', 'despues']]
    assert left.size == right.size and ImageChops.difference(left, right).getbbox() is None
    checks.append(dict(case=prefix, applied_regions=zones, digital_text_preserved=bool(invoices), image_streams_identical=True, rendered_pixels_identical=True, fields_attachments_metadata_preserved=True, sha256=hashlib.sha256((root / name).read_bytes()).hexdigest()))
(out / 'verificacion-ocr-zonas.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(dict(checks=len(checks), rendered_page_pairs=len(checks), diacritic_corrected_explicitly=True), indent=2))
