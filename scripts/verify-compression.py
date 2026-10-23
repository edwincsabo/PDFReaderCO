"""Run after the compression UI tests and prepare-compression-qa.mjs."""
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream
import json

root = Path('test-results/compression-copy')
before = PdfReader(root / 'antes.pdf')
after = PdfReader(root / 'comprimido.pdf')
assert len(before.pages) == len(after.pages) == 1
assert before.pages[0].extract_text() == after.pages[0].extract_text()
assert 'Texto vectorial que permanece seleccionable' in after.pages[0].extract_text()
assert before.pages[0].get_contents().get_data() == after.pages[0].get_contents().get_data()
assert before.pages[0].mediabox == after.pages[0].mediabox
assert before.metadata.title == after.metadata.title
assert before.metadata.author == after.metadata.author
assert dict(before.attachments) == dict(after.attachments)
assert list(after.attachments['prueba.bin']) == [bytes([1, 2, 3, 4])]
bf, af = before.get_fields(), after.get_fields()
assert bf.keys() == af.keys()
field = af['Respuesta']
assert field['/V'] == 'Respuesta pendiente' and field['/DV'] == 'Valor inicial'
canonical = field.indirect_reference.get_object()
for ref in canonical['/Kids']:
    widget = ref.get_object()
    assert widget.raw_get('/Parent') == field.indirect_reference
    assert ref in after.pages[0]['/Annots']
    stream = widget['/AP']['/N']
    assert stream.get_data()
    texts = [str(args[0]) for args, op in ContentStream(stream, after).operations if op == b'Tj']
    assert 'Respuesta pendiente' in ''.join(texts)
notes = [ref.get_object() for ref in after.pages[0]['/Annots'] if ref.get_object().get('/Subtype') == '/Text']
assert len(notes) == 1 and notes[0]['/Contents'] == 'Comentario conservado'
source_image = list(before.pages[0].images)[0]
result_image = list(after.pages[0].images)[0]
assert source_image.image.size == (1600, 1000)
assert result_image.image.size == (800, 500)
assert result_image.image.format == 'JPEG'
original_size, compressed_size = (root / 'antes.pdf').stat().st_size, (root / 'comprimido.pdf').stat().st_size
assert compressed_size < original_size / 2
report = {'before_bytes': original_size, 'after_bytes': compressed_size, 'reduction_percent': round((1 - compressed_size / original_size) * 100, 2), 'image_before': [1600, 1000], 'image_after': [800, 500], 'vector_streams_unchanged': True, 'searchable_text_preserved': True, 'form_value_and_default_preserved': True, 'widget_links_and_appearance_valid': True, 'attachment_bytes_identical': True, 'comment_and_metadata_preserved': True}
output = Path('docs/capturas/1.26.0')
output.mkdir(parents=True, exist_ok=True)
(output / 'verificacion-compresion.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
