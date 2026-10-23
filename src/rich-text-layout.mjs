import{compactSpans,sliceSpans}from'./text-spans.mjs';
import{validateTypography}from'./paragraph-typography.mjs';
// Wrap styled text using actual font advances, preserving explicit blank lines
// and every style boundary. Coordinates stay in the original text's local axes.
export function layoutRichText(spans,width,leading,measure,paragraph=false,typography={}){
  const t=paragraph?validateTypography(typography,width):{indentLeft:0,indentRight:0,firstLineIndent:0,spaceBefore:0,spaceAfter:0};
  const text=spans.map(s=>s.text).join(''),lines=[];let start=0,y=0;
  const size=part=>part.reduce((n,s)=>n+measure(s).advance,0);
  const add=(parts,first,last)=>{if(lines.length>=200)throw new Error('El párrafo supera el límite de 200 líneas.');const height=Math.max(...parts.map(s=>s.fontSize),spans[0]?.fontSize||12),left=t.indentLeft+(first?t.firstLineIndent:0);lines.push({parts,width:size(parts),y,height,left,availableWidth:width-t.indentRight-left,paragraphEnd:last,spaceAfter:last?t.spaceAfter:0});y-=height*leading;};
  for(const line of text.split('\n')){
    if(!paragraph){add(sliceSpans(spans,0,text.length),true,true);break;}
    y-=t.spaceBefore;
    if(!line){add([],true,true);start++;y-=t.spaceAfter;continue;}
    let a=start,end=start+line.length,first=true;
    while(a<end){const available=width-t.indentLeft-t.indentRight-(first?t.firstLineIndent:0);let b=a,lastBreak=a,fitEnd=a;for(const ch of text.slice(a,end)){b+=ch.length;const part=sliceSpans(spans,a,b);if(size(part)>available+.001&&fitEnd>a)break;fitEnd=b;if(/[ \u2000-\u200a\u205f\u3000]/u.test(ch))lastBreak=b;if(size(part)>available+.001)break;}
      let stop=fitEnd<end&&lastBreak>a?lastBreak:fitEnd;if(stop<=a)stop=a+Array.from(text.slice(a,end))[0].length;
      // Whitespace consumed by a wrap remains in the stored spans; unlike the
      // plain wrapper it is not silently assigned another character's style.
      const inkEnd=a+text.slice(a,stop).trimEnd().length;add(compactSpans(sliceSpans(spans,a,inkEnd)),first,stop===end);first=false;a=stop;
    }start=end+1;y-=t.spaceAfter;
  }
  return lines;
}
