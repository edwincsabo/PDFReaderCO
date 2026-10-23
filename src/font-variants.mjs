const clean=name=>String(name||'').replace(/^[A-Z]{6}\+/,'').replace(/-Identity-[HV]$/i,'').normalize('NFKD').replace(/[^a-z0-9]/gi,'').toLowerCase();
const standards={Helvetica:['Helvetica','Helvetica-Bold','Helvetica-Oblique','Helvetica-BoldOblique'],Times:['Times-Roman','Times-Bold','Times-Italic','Times-BoldItalic'],Courier:['Courier','Courier-Bold','Courier-Oblique','Courier-BoldOblique']};
export function fontFace(style,originalName,fonts=[]){
  const name=style.font==='original'?(style.fontName||originalName):style.font,n=clean(name);
  for(const [family,faces]of Object.entries(standards)){const at=faces.findIndex(f=>clean(f)===n);if(at>=0)return{family,bold:!!(at&1),italic:!!(at&2),standard:faces};}
  const direct=fonts.find(f=>f.id===name)||fonts.find(f=>[f.name,f.postscript].some(s=>s&&clean(s)===n));
  if(direct)return{family:direct.family,bold:direct.bold??/bold|semibold/i.test(direct.style),italic:direct.italic??/italic|oblique/i.test(direct.style),local:direct};
  const candidates=fonts.filter(f=>{const family=clean(f.family);return family&&n.startsWith(family)&&/^(?:ps|mt|regular|roman|normal|bold|italic|oblique|bolditalic|boldoblique)*$/.test(n.slice(family.length));}).sort((a,b)=>clean(b.family).length-clean(a.family).length);
  if(candidates.length)return{family:candidates[0].family,bold:/bold/i.test(name),italic:/italic|oblique/i.test(name)};
  return null;
}
export function resolveFontVariant(style,originalName,fonts,kind,target){
  const face=fontFace(style,originalName,fonts);if(!face)return{reason:'No se pudo identificar una variante de esta familia. El formato se conserva; puedes elegir otra fuente en Fuente.'};
  const bold=kind==='bold'?(target??!face.bold):face.bold,italic=kind==='italic'?(target??!face.italic):face.italic;
  if(face.standard)return{font:face.standard[(bold?1:0)+(italic?2:0)],family:face.family,bold,italic};
  const options=fonts.filter(f=>clean(f.family)===clean(face.family)&&(!face.local?.widthClass||(f.widthClass||5)===face.local.widthClass)&&(f.bold??/bold|semibold/i.test(f.style))===bold&&(f.italic??/italic|oblique/i.test(f.style))===italic).sort((a,b)=>Math.abs((a.weight||400)-(bold?700:400))-Math.abs((b.weight||400)-(bold?700:400))||a.name.localeCompare(b.name));
  if(!options.length)return{reason:`No hay una variante compatible de ${face.family} con ese formato. Se conserva la fuente actual.`};
  return{font:options[0].id,family:face.family,bold,italic};
}
