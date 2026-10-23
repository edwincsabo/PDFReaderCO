"""Independent OCR recovery/corpus extraction, structure and pixel checks."""
from pathlib import Path
import hashlib, json, subprocess, unicodedata
from pypdf import PdfReader
from PIL import Image, ImageChops

version = json.loads(Path('package.json').read_text(encoding='utf-8'))['version']
output = Path('docs/capturas') / version
output.mkdir(parents=True, exist_ok=True)
poppler = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe'
normalize = lambda s: ' '.join(unicodedata.normalize('NFC', s).split())

def images(resources, seen=None):
    seen = set() if seen is None else seen
    result = []
    objects = resources.get('/XObject', {})
    if hasattr(objects, 'get_object'): objects = objects.get_object()
    for ref in objects.values():
        obj = ref.get_object()
        if id(obj) in seen: continue
        seen.add(id(obj))
        if obj.get('/Subtype') == '/Image': result.append(hashlib.sha256(obj._data).hexdigest())
        elif obj.get('/Subtype') == '/Form': result.extend(images(obj.get('/Resources', {}), seen))
    return sorted(result)

def compare(before_path, after_path, label):
    before, after = PdfReader(before_path), PdfReader(after_path)
    assert len(before.pages) == len(after.pages)
    for n, (a, b) in enumerate(zip(before.pages, after.pages), 1):
        assert images(a['/Resources']) == images(b['/Resources'])
        for filename, suffix in [(before_path, 'antes'), (after_path, 'despues')]:
            subprocess.run([str(poppler), '-f', str(n), '-l', str(n), '-singlefile', '-scale-to', '1000', '-png', str(filename), str(output / f'{label}-{n}-{suffix}')], check=True, capture_output=True)
        a, b = [Image.open(output / f'{label}-{n}-{s}.png').convert('RGB') for s in ['antes', 'despues']]
        assert a.size == b.size and ImageChops.difference(a, b).getbbox() is None
    assert before.metadata.title == after.metadata.title
    assert dict(before.attachments) == dict(after.attachments)
    return before, after

checks = []
for folder, filename, count in [('ocr-review-recovery', 'recuperado.pdf', 1), ('ocr-partial-recovery', 'continuado.pdf', 2)]:
    root = Path('test-results') / folder
    before, after = compare(root / 'entrada.pdf', root / filename, folder)
    assert '2031' in after.pages[0].extract_text() and '2026' not in after.pages[0].extract_text()
    assert sum('/PDFReaderCOOCR' in p for p in after.pages) == count
    if count == 2: assert '2026' in after.pages[1].extract_text()
    else: assert not after.pages[1].extract_text().strip()
    assert list(after.attachments['recuperacion.bin']) == [bytes([6, 5, 4])]
    field = after.get_fields()['Respuesta']
    assert field['/V'] == before.get_fields()['Respuesta']['/V'] == 'Respuesta guardada'
    widgets = [r.get_object() for r in after.pages[0]['/Annots'] if r.get_object().get('/Subtype') == '/Widget']
    assert len(widgets) == 1
    widget = widgets[0]
    assert widget['/AP']['/N'].get_data()
    assert widget.get('/V', widget.get('/Parent', {}).get_object().get('/V') if widget.get('/Parent') else None) == 'Respuesta guardada'
    checks.append(dict(case=folder, applied_pages=count, original_image_streams_identical=True, rendered_pixels_identical=True, canonical_field_and_appearance_preserved=True, attachment_metadata_preserved=True, sha256=hashlib.sha256((root / filename).read_bytes()).hexdigest()))

root = Path('test-results/ocr-quality')
quality = json.loads((root / 'resultados.json').read_text(encoding='utf-8'))
for item in quality['samples']:
    label = item['layout']
    before, after = compare(root / (label + '.pdf'), root / (label + '-ocr.pdf'), 'corpus-' + label)
    assert normalize(after.pages[0].extract_text()) == normalize(item['text'])
    marker = json.loads(after.pages[0]['/PDFReaderCOOCR'])
    assert marker['layout'] == label
    checks.append(dict(case=label, extraction_matches_review=True, original_image_streams_identical=True, rendered_pixels_identical=True, metrics=item['metrics']))
quality['aggregate']['cer'] = quality['aggregate']['characterErrors'] / quality['aggregate']['characters']
quality['aggregate']['wer'] = quality['aggregate']['wordErrors'] / quality['aggregate']['words']
(output / 'precision-ocr.json').write_text(json.dumps(quality, ensure_ascii=False, indent=2), encoding='utf-8')
(output / 'verificacion-ocr-recuperacion.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(dict(checks=len(checks), rendered_page_pairs=8, aggregate=quality['aggregate']), ensure_ascii=False, indent=2))
