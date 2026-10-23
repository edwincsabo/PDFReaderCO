"""Independent AcroForm validation of the desktop form-designer test outputs."""
from pathlib import Path
from pypdf import PdfReader

root = Path('test-results')
reader = PdfReader(root / 'form-designer/formulario-editado.pdf')
expected = {'Nombre': 'Ana García', 'Casilla_1': '/Off', 'Lista_1': 'Cali'}
fields = reader.get_fields()
assert set(fields) == set(expected), fields.keys()
assert fields['Nombre']['/DV'] == 'José Pérez'
assert fields['Casilla_1']['/DV'] == '/Yes'
assert fields['Lista_1']['/DV'] == 'Bogotá'
assert fields['Nombre']['/Ff'] & 2
seen = set()
for page in reader.pages:
    for ref in page.get('/Annots', []):
        widget = ref.get_object()
        if widget.get('/Subtype') != '/Widget':
            continue
        parent_ref = widget.raw_get('/Parent')
        parent = parent_ref.get_object()
        name = parent['/T']
        assert name in expected and name not in seen
        assert any(child == ref for child in parent['/Kids'])
        assert fields[name].indirect_reference == parent_ref
        assert parent['/V'] == expected[name], (name, parent['/V'])
        assert fields[name]['/V'] == expected[name]
        normal = widget['/AP']['/N']
        streams = [normal] if hasattr(normal, 'get_data') else [r.get_object() for r in normal.values()]
        assert streams and all(stream.get_data() for stream in streams), name
        if name == 'Casilla_1':
            assert widget['/AS'] == parent['/V']
        seen.add(name)
assert seen == set(expected)

flat = PdfReader(root / 'form-designer-rotated/formulario-fijo.pdf')
assert '/AcroForm' not in flat.trailer['/Root']
assert not flat.get_fields()
assert all(ref.get_object().get('/Subtype') != '/Widget' for page in flat.pages for ref in page.get('/Annots', []))
assert 'Respuesta' in flat.pages[0].extract_text()
print('pypdf: 3 campos canónicos, valores actuales e iniciales, widgets y apariencias coherentes; copia fija sin AcroForm ni widgets.')
