"""Independent canonical-field and rendering checks for the new group designer output."""
from pathlib import Path
import json, subprocess, hashlib
from pypdf import PdfReader
from PIL import Image

root = Path('test-results/refinements-fields')
target = root / 'formulario-grupo.pdf'
reader = PdfReader(target)
fields = reader.get_fields()
assert len(fields) == 6
assert fields['Texto_1']['/V'] == fields['Texto_1_copia_1']['/V'] == 'Respuesta guardada'
assert fields['Texto_1']['/DV'] == fields['Texto_1_copia_1']['/DV'] == 'Inicial'
seen = set()
for page in reader.pages:
    for ref in page.get('/Annots', []):
        widget = ref.get_object()
        if widget.get('/Subtype') != '/Widget':
            continue
        parent_ref = widget.raw_get('/Parent')
        parent = parent_ref.get_object()
        name = parent['/T']
        assert name not in seen and name in fields
        assert fields[name].indirect_reference == parent_ref
        assert ref in parent['/Kids']
        assert widget['/P'] == page
        normal = widget['/AP']['/N']
        assert normal.get_data()
        seen.add(name)
assert seen == set(fields)
assert 'Formulario de control' in reader.pages[0].extract_text()
attachment = reader.attachments['control.bin']
assert attachment == [b'\x01\x02\x03']
out = Path('docs/capturas/1.29.0')
out.mkdir(parents=True, exist_ok=True)
poppler = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe'
subprocess.run([str(poppler), '-f','1','-singlefile','-scale-to','1200','-png',str(target),str(out/'formulario-grupo')], check=True)
with Image.open(out/'formulario-grupo.png') as image:
    assert min(image.size) > 500
report = dict(canonical_fields=6, unique_linked_widgets=6, current_and_default_values_preserved=True, original_attachment_preserved=True, original_text_preserved=True, nonempty_appearances=True, pdf_sha256=hashlib.sha256(target.read_bytes()).hexdigest())
(out/'verificacion-grupos.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
