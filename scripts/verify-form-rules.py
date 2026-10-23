"""Independent pypdf checks of rules, values, defaults and widget appearances."""
from pathlib import Path
import json
from pypdf import PdfReader
from pypdf.generic import ContentStream

root=Path('test-results')
checks=[]
def appearance(reader,name,expected):
    field=reader.get_fields()[name]
    canonical=field.indirect_reference.get_object()
    widgets=[ref.get_object() for ref in canonical['/Kids']]
    assert widgets
    for widget in widgets:
        assert widget.raw_get('/Parent')==field.indirect_reference
        stream=widget['/AP']['/N'];assert stream.get_data()
        texts=[]
        for args,op in ContentStream(stream,reader).operations:
            if op==b'Tj':texts.append(str(args[0]))
            elif op==b'TJ':texts.extend(str(value) for value in args[0] if not isinstance(value,(float,int)))
        assert expected in ''.join(texts),(name,texts,expected)

valid=PdfReader(root/'form-rules-validation/validado.pdf')
field=valid.get_fields()['Edad'];assert field['/V']=='23' and field['/Ff']&2
rule=json.loads(field.indirect_reference.get_object()['/PDFReaderCORules'])
assert rule['version']==1 and rule['rule']['format']=='integer'
assert rule['rule']['min']=='0' and rule['rule']['max']=='120'
appearance(valid,'Edad','23')
checks.append({'case':'validation','required_age':'23','format':'integer','range':[0,120],'appearance_matches':True})

calculated=PdfReader(root/'form-rules-calculation/calculado.pdf')
fields=calculated.get_fields();assert fields['Cantidad']['/V']=='3'
assert fields['Subtotal']['/V']=='30.75' and fields['Subtotal']['/DV']=='20.50'
assert fields['Subtotal']['/Ff']&1
rules=json.loads(fields['Subtotal'].indirect_reference.get_object()['/PDFReaderCORules'])['rule']
assert rules['calculation']['operation']=='product' and rules['calculation']['decimals']==2
ids=[json.loads(fields[name].indirect_reference.get_object()['/PDFReaderCOForm'])['id'] for name in ['Cantidad','Precio']]
assert rules['calculation']['sources']==ids
assert '/AA' not in fields['Subtotal'].indirect_reference.get_object()
appearance(calculated,'Subtotal','30.75')
checks.append({'case':'calculation','current':'30.75','default':'20.50','read_only':True,'stable_source_ids':True,'appearance_matches':True,'no_actions_added':True})

template=PdfReader(root/'form-rules-template/plantilla.pdf')
tf=template.get_fields();assert tf['Fecha']['/V']=='20/10/2026' and tf['Correo']['/V']=='ana@ejemplo.com'
assert tf['Subtotal']['/V']=='20.50' and tf['Impuesto']['/V']=='3.90' and tf['Total']['/V']=='24.40'
appearance(template,'Total','24.40')
project=json.loads((root/'form-rules-template/borrador.pdfco').read_text(encoding='utf-8'))
assert project['model']['forms']['Fecha']=='31/02/2026'
assert project['model']['forms']['Correo']=='correo-incompleto'
checks.append({'case':'template-and-project','defaults_preserved':True,'template_total':'24.40','invalid_draft_retained':True})

recalculated=PdfReader(root/'form-rules-recalculate/recalculado.pdf')
rf=recalculated.get_fields();assert rf['Cantidad']['/V']=='4' and rf['Total']['/V']=='48.79'
appearance(recalculated,'Total','48.79')
assert all(rf[name]['/Ff']&1 for name in ['Subtotal','Impuesto','Total'])
checks.append({'case':'recalculation','total':'48.79','calculated_fields_read_only':True,'appearance_matches':True})
output=Path('docs/capturas/1.24.0');output.mkdir(parents=True,exist_ok=True)
report=json.dumps(checks,ensure_ascii=False,indent=2)
(output/'verificacion-reglas.json').write_text(report+'\n',encoding='utf-8')
print(report)
