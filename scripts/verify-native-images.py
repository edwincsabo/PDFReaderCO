"""Inspect standard Stamp appearances and exact original raster data with pypdf."""
import json
from pathlib import Path
from pypdf import PdfReader

root = Path('test-results/native-images-compatibility')
reader = PdfReader(root / 'visuales.pdf')
expected = [Path('tests/fixtures/' + name).read_bytes() for name in ['stamp-image.png', 'stamp-photo.jpg', 'stamp-signature.png']]
assert len(reader.pages) == 4
for page in reader.pages:
    annotations = [ref.get_object() for ref in page['/Annots']]
    assert len(annotations) == 4
    for index, annotation in enumerate(annotations):
        assert annotation['/Subtype'] == '/Stamp'
        assert annotation['/AP']['/N'].get_data()
        assert abs(float(annotation['/CA']) - .6) < 1e-7
        metadata = json.loads(annotation['/PDFReaderCO'])
        assert metadata['version'] == 2
        assert 'image' not in metadata['mark']
        if index < 3:
            assert annotation['/PDFReaderCOAsset'].get_data() == expected[index]
        else:
            assert '/PDFReaderCOAsset' not in annotation
            assert len(metadata['mark']['points']) == 4
flat = PdfReader(root / 'visuales-fijos.pdf')
for page in flat.pages:
    assert not any(ref.get_object().get('/Subtype') == '/Stamp' for ref in page.get('/Annots', []))
    assert page.get_contents().get_data()
print('pypdf: 16 sellos estándar con apariencias y opacidad; originales PNG/JPEG idénticos; copia fija sin sellos editables.')
