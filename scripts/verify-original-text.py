"""Independent extraction checks for desktop tests of original-content editing."""
from pathlib import Path
from pypdf import PdfReader

root=Path('test-results')
reader=PdfReader(root/'original-text/original-editado.pdf')
assert len(reader.pages)==3
text=reader.pages[0].extract_text()
assert 'Documento corregido áéíóú' in text
assert 'Documento 1' not in text
assert 'Texto seleccionable para resaltar.' not in text
assert 'Primer texto' in text or len(reader.pages[0].get('/Annots',[]))>=3
assert 'Documento 2' in reader.pages[1].extract_text()
assert 'Documento 3' in reader.pages[2].extract_text()

before=PdfReader(root/'original-text-viewport/entrada.pdf')
after=PdfReader(root/'original-text-viewport/texto-inferior-editado.pdf')
assert 'Corrección inferior' in after.pages[1].extract_text()
assert 'Texto inferior 2' not in after.pages[1].extract_text()
for index in [0,2]:
    assert before.pages[index].get_contents().get_data()==after.pages[index].get_contents().get_data()

subset=PdfReader(root/'original-text-subset/fuente-alternativa.pdf')
assert 'Niño nuevo áéíóú' in subset.pages[0].extract_text()
assert 'Texto parcial abc' not in subset.pages[0].extract_text()
assert 'Conservar otra linea' in subset.pages[0].extract_text()
print('pypdf: sustituciones y eliminación verificadas en el contenido; originales retirados de las páginas editadas; páginas vecinas intactas; alternativa de fuente con acentos correcta.')
