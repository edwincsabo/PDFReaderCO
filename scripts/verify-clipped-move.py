"""Independent pypdf checks of actual clipping operators and glyph origins."""
import json
import os
import re
from pathlib import Path
from pypdf import PdfReader

def mul(a,b):
    return [a[0]*b[0]+a[1]*b[2],a[0]*b[1]+a[1]*b[3],a[2]*b[0]+a[3]*b[2],a[2]*b[1]+a[3]*b[3],a[4]*b[0]+a[5]*b[2]+b[4],a[4]*b[1]+a[5]*b[3]+b[5]]

def records(reader):
    state={'cm':[1,0,0,1,0,0],'tm':[1,0,0,1,0,0],'clips':[],'size':0}
    stack=[];path=[];items=[]
    for args,op in reader.pages[0].get_contents().operations:
        if op==b'q':stack.append({**state,'clips':list(state['clips'])})
        elif op==b'Q':state=stack.pop()
        elif op==b'cm':state['cm']=mul(list(map(float,args)),state['cm'])
        elif op==b'Tm':state['tm']=list(map(float,args))
        elif op==b'Tf':state['size']=float(args[1])
        elif op==b're':
            x,y,w,h=map(float,args);path.append([x,y,w,h])
        elif op in [b'W',b'W*']:state['clips']+=path
        elif op==b'n':path=[]
        elif op==b'Tj':
            matrix=mul(state['tm'],state['cm']);items.append({'text':str(args[0]),'origin':matrix[4:],'clip':list(state['clips']),'size':state['size']})
    return items

checks=[]
for folder,source,target,count,delta in [
    ('tmp/pdfs/clip-move','antes.pdf','despues.pdf',3,(220,-200)),
    ('test-results/original-move-rectangle','entrada.pdf','texto-y-mascara.pdf',1,(201,-170)),
]:
    root=Path(folder);before=PdfReader(root/source);after=PdfReader(root/target);a,b=records(before),records(after)
    assert len(a)==len(b)
    for i,(old,new) in enumerate(zip(a,b)):
        assert old['text']==new['text'];assert old['size']==new['size'];dx,dy=delta if i<count else (0,0)
        assert all(abs(new['origin'][j]-old['origin'][j]-(dx,dy)[j])<.002 for j in range(2))
        expected=[[r[0]+dx,r[1]+dy,r[2],r[3]] for r in old['clip']]
        assert new['clip']==expected,(old,new)
    assert before.pages[0].cropbox==after.pages[0].cropbox
    checks.append({'case':root.name,'text_objects':len(a),'selected':count,'translation':delta,'same_glyph_text_size_and_private_clips':True})

for angle in [0,90,180,270]:
    r=PdfReader(f'test-results/original-move-viewport-mask-{angle}/movimiento-con-zoom.pdf')
    assert len(r.pages)==3;assert r.pages[1].get('/Rotate')==angle;assert r.pages[1].get('/UserUnit')==2
    assert list(r.pages[1].cropbox)==[20,30,520,730];assert 'Texto inferior 2' in r.pages[1].extract_text()
checks.append({'rotations':[0,90,180,270],'user_unit':2,'crop_and_text_preserved':True})

if os.environ.get('PDFREADERCO_TEST_PDF'):
    a=PdfReader(os.environ['PDFREADERCO_TEST_PDF']);b=PdfReader('test-results/original-move-clip-sample/movido.pdf')
    normalize=lambda text:re.sub(r'\s+','',text)
    assert len(a.pages)==len(b.pages)
    assert normalize(a.pages[0].extract_text())==normalize(b.pages[0].extract_text())
    assert (a.get_fields() or {})==(b.get_fields() or {})
    assert len(a.pages[0].get('/Annots',[]))==len(b.pages[0].get('/Annots',[]))
    metadata=lambda r:{k:v for k,v in (r.metadata or {}).items() if k not in ['/Producer','/ModDate']}
    assert metadata(a)==metadata(b)
    checks.append({'case':'private-sample','same_extracted_characters_fields_annotations_and_metadata':True})
print(json.dumps(checks,ensure_ascii=False,indent=2))
