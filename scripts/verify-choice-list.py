"""Independent checks of canonical list fields and widget appearances."""
from pathlib import Path
import json
from pypdf import PdfReader
from pypdf.generic import ContentStream

root = Path('test-results')
checks = []

def verify(reader, name, values, defaults, multiple):
    entry = reader.get_fields()[name]
    field = entry.indirect_reference.get_object()
    actual = field.get('/V', [])
    actual = actual if isinstance(actual, list) else [actual]
    initial = field.get('/DV', [])
    initial = initial if isinstance(initial, list) else [initial]
    assert actual == values, (name, actual, values)
    assert initial == defaults, (name, initial, defaults)
    flags = int(field.get('/Ff', 0))
    assert not flags & (1 << 17), 'A list must not be a combo box'
    assert bool(flags & (1 << 21)) == multiple
    assert field['/FT'] == '/Ch'
    options = [str(option[0] if isinstance(option, list) else option) for option in field['/Opt']]
    if values:
        assert list(field['/I']) == sorted(options.index(value) for value in values)
    for ref in field['/Kids']:
        widget = ref.get_object()
        assert widget.raw_get('/Parent') == entry.indirect_reference
        assert any(ref in page.get('/Annots', []) for page in reader.pages)
        appearance = widget['/AP']['/N']
        assert appearance.get_data()
        texts = []
        for args, op in ContentStream(appearance, reader).operations:
            if op == b'Tj':
                texts.append(str(args[0]))
        for value in values:
            assert value in texts, (name, value, texts)
    assert '/AA' not in field and '/A' not in field
    checks.append({'field': name, 'values': values, 'defaults': defaults, 'multiple': multiple, 'canonical_widget_links': True, 'appearance_contains_selections': True})

reader = PdfReader(root / 'choice-list-reader/listas.pdf')
verify(reader, 'Ciudad', ['Cali'], ['Bogotá'], False)
verify(reader, 'Servicios', ['Correo', 'Visita'], ['Correo', 'Visita'], True)
edited = PdfReader(root / 'choice-list-properties/lista-editada.pdf')
verify(edited, 'Preferencias', ['Dos'], ['Uno'], False)
assert edited.get_fields()['Preferencias']['/Ff'] & 2
rotated = PdfReader(root / 'choice-list-rotated/lista-girada.pdf')
verify(rotated, 'Actividades', ['Revisión'], ['Lectura', 'Entrega'], True)
assert rotated.pages[0]['/Rotate'] == 90 and rotated.pages[0]['/UserUnit'] == 2
template = PdfReader(root / 'choice-list-rotated/plantilla.pdf')
verify(template, 'Actividades', ['Lectura', 'Entrega'], ['Lectura', 'Entrega'], True)
flat = PdfReader(root / 'choice-list-rotated/lista-fija.pdf')
assert '/AcroForm' not in flat.trailer['/Root']
assert all(annotation.get_object().get('/Subtype') != '/Widget' for page in flat.pages for annotation in page.get('/Annots', []))
checks.append({'case': 'flatten', 'canonical_fields_removed': True, 'widgets_removed': True})
project = json.loads((root / 'choice-list-reader/listas.pdfco').read_text(encoding='utf-8'))
assert project['model']['forms']['Ciudad'] == 'Cali'
assert project['model']['forms']['Servicios'] == ['Correo', 'Visita']
checks.append({'case': 'project', 'single_and_multiple_responses_retained': True})
qa = PdfReader('tmp/pdfs/listas-qa-1.25.0.pdf')
for index, rotation in enumerate([0, 90, 180, 270]):
    verify(qa, 'Lista_' + str(index + 1), ['Lectura', 'Entrega'], ['Lectura', 'Entrega'], True)
    assert qa.pages[index].get('/Rotate', 0) == rotation
    assert qa.pages[index]['/UserUnit'] == 2
late = 'Opción 23 con una descripción extensa que debe ocupar una sola fila'
verify(qa, 'Lista_5', [late], [late], False)
late_field = qa.get_fields()['Lista_5'].indirect_reference.get_object()
assert len(late_field['/Opt']) == 24 and int(late_field['/TI']) > 0
report = json.dumps(checks, ensure_ascii=False, indent=2)
output = Path('docs/capturas/1.25.0')
output.mkdir(parents=True, exist_ok=True)
(output / 'verificacion-listas.json').write_text(report + '\n', encoding='utf-8')
print(report)
