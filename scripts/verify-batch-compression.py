"""Independent verification after batch-compression.spec.ts on the released app."""
from pathlib import Path
import json
import hashlib
from pypdf import PdfReader
from pypdf.generic import ContentStream

root = Path('test-results/batch-compression')
manifest = json.loads((root / 'verificacion.json').read_text(encoding='utf-8'))
source, output = Path(manifest['source']), Path(manifest['compressed'])
before, after = PdfReader(source), PdfReader(output)
report = manifest['report']
assert report['version'] == json.loads(Path('package.json').read_text(encoding='utf-8'))['version']
assert [entry['status'] for entry in report['results']] == ['done', 'unchanged', 'error', 'error', 'error']
done, unchanged = report['results'][:2]
assert done['compression']['before'] == source.stat().st_size
assert done['compression']['after'] == output.stat().st_size < source.stat().st_size
assert done['appliedProfile']['compression']['quality'] == 0.7
assert done['compression']['profile']['maxEdge'] == 800
assert unchanged['compression']['before'] == unchanged['compression']['after']
assert 'output' not in unchanged
assert not list(Path(manifest['output']).glob('Compacto-comprimido*.pdf'))
assert (Path(manifest['output']) / 'Foto-comprimido.pdf').read_text(encoding='utf-8') == 'Conservar copia anterior'
assert len(before.pages) == len(after.pages) == 1
assert before.pages[0].extract_text() == after.pages[0].extract_text()
assert before.pages[0].get_contents().get_data() == after.pages[0].get_contents().get_data()
assert before.pages[0].mediabox == after.pages[0].mediabox
assert before.metadata.title == after.metadata.title
assert dict(before.attachments) == dict(after.attachments)
assert list(after.attachments['prueba.bin']) == [bytes([1, 2, 3, 4])]
field = after.get_fields()['Respuesta']
assert field['/V'] == 'Guardada en disco' and field['/DV'] == 'Valor inicial'
for ref in field.indirect_reference.get_object()['/Kids']:
    widget = ref.get_object()
    assert widget.raw_get('/Parent') == field.indirect_reference
    assert ref in after.pages[0]['/Annots']
    stream = widget['/AP']['/N']
    texts = [str(args[0]) for args, op in ContentStream(stream, after).operations if op == b'Tj']
    assert 'Guardada en disco' in ''.join(texts)
notes = [ref.get_object() for ref in after.pages[0]['/Annots'] if ref.get_object().get('/Subtype') == '/Text']
assert len(notes) == 1 and notes[0]['/Contents'] == 'Comentario del lote'
assert list(before.pages[0].images)[0].image.size == (1200, 900)
assert list(after.pages[0].images)[0].image.size == (800, 600)
assert list(after.pages[0].images)[0].image.format == 'JPEG'
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
assert source_hash == manifest['sourceHash']
summary = {'before_bytes': source.stat().st_size, 'after_bytes': output.stat().st_size, 'reduction_percent': round((1-output.stat().st_size/source.stat().st_size)*100, 2), 'source_sha256': source_hash, 'report_matches_files': True, 'unchanged_creates_no_copy': True, 'existing_copy_untouched': True, 'vector_streams_and_text_preserved': True, 'form_value_default_widget_and_appearance_valid': True, 'attachment_bytes_and_comment_preserved': True, 'jpeg_size': [800, 600]}
destination = Path('docs/capturas')/report['version']
destination.mkdir(parents=True, exist_ok=True)
(destination / 'verificacion-lote.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False, indent=2))
