"""Independent pypdf verification of the 1.20 desktop fixtures."""
import json
from pathlib import Path
from pypdf import PdfReader

checks = []
root = Path('test-results')

def target_page(reader, entry):
    dest = entry['/Dest']
    return next(i + 1 for i, page in enumerate(reader.pages)
                if page.indirect_reference == dest[0])

r = PdfReader(root / 'document-outline/indice-editado.pdf')
outline = r.trailer['/Root']['/Outlines']
first = outline['/First']
second = first['/Next']
child = second['/First']
detail = child['/First']
assert [first['/Title'], second['/Title'], child['/Title'], detail['/Title']] == ['Inicio', 'Capítulo A', 'Capítulo B', 'Detalle']
assert [target_page(r, item) for item in [first, second, child, detail]] == [1, 2, 3, 1]
assert outline['/Count'] == 4 and second['/Count'] == 2 and child['/Count'] == 1
assert child.raw_get('/Parent') == second.indirect_reference
assert second.raw_get('/Prev') == first.indirect_reference
assert len(r.pages) == 3
assert len(r.pages[0].get('/Annots', [])) == 3
assert len(r.pages[1].get('/Annots', [])) == 1
checks.append({'case': 'outline-hierarchy', 'titles_pages_counts_links_annotations': True})

a = PdfReader(root / 'document-outline-existing/entrada.pdf')
b = PdfReader(root / 'document-outline-existing/indice-conservado.pdf')
old = a.trailer['/Root']['/Outlines']['/First']
new = b.trailer['/Root']['/Outlines']['/First']
assert new['/Title'] == 'Renombrado'
assert target_page(b, new) == target_page(a, old) == 2
assert list(new['/Dest'][1:]) == list(old['/Dest'][1:])
assert new['/F'] == old['/F'] == 3
assert new['/First']['/A'] == old['/Next']['/A']
assert b.get_fields()['Campo']['/V'] == 'Conservado'
widgets = [v.get_object() for v in b.pages[0]['/Annots'] if v.get_object()['/Subtype'] == '/Widget']
assert widgets and widgets[0]['/AP']['/N'].get_data()
assert b.attachments['original.txt'] == a.attachments['original.txt']
for before, after in zip(a.pages, b.pages):
    assert before.get_contents().get_data() == after.get_contents().get_data()
checks.append({'case': 'outline-preservation', 'xyz_style_uri_fields_appearances_attachments_page_streams': True})

r = PdfReader(root / 'document-attachments/adjuntos.pdf')
assert list(r.attachments) == ['datos.bin']
assert r.attachments['datos.bin'] == [bytes(range(256))]
assert (root / 'document-attachments/copia-extraida.bin').read_bytes() == (root / 'document-attachments/café.txt').read_bytes()
assert len(r.pages[0]['/Annots']) == 3 and len(r.pages[1]['/Annots']) == 1
checks.append({'case': 'attachment-bytes', 'binary_unchanged_unicode_extraction_and_annotations': True})

r = PdfReader(root / 'document-attachments-existing/adjunto-protegido.pdf')
assert list(r.attachments) == ['vinculado.bin']
assert r.attachments['vinculado.bin'] == [bytes([1, 2, 3])]
assert r.trailer['/Root']['/CustomFile']['/UF'] == 'vinculado.bin'
assert len(r.pages) == 1 and 'Adjuntos existentes' in r.pages[0].extract_text()
checks.append({'case': 'attachment-protection', 'unsafe_name_removed_custom_reference_retained': True})

output = Path('docs/capturas/1.20.0')
output.mkdir(parents=True, exist_ok=True)
report = json.dumps(checks, ensure_ascii=False, indent=2)
(output / 'verificacion-estructura.json').write_text(report + '\n', encoding='utf-8')
print(report)
