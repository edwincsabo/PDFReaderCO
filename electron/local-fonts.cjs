const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
// Parse only static TrueType fonts. Restricted and bitmap-only embedding are
// excluded; files are embedded whole, including fonts forbidding subsetting.
function inspectFont(input){
  const b=Buffer.from(input);if(b.length<12||b.length>16*1024*1024||b.readUInt32BE(0)!==0x10000)throw new Error('Se requiere una fuente TrueType estática.');
  const count=b.readUInt16BE(4),tables=new Map();if(count>200||12+16*count>b.length)throw new Error('Tablas de fuente inválidas.');
  for(let i=0;i<count;i++){const p=12+i*16,name=b.toString('ascii',p,p+4),offset=b.readUInt32BE(p+8),length=b.readUInt32BE(p+12);if(offset+length>b.length)throw new Error('Tabla de fuente incompleta.');tables.set(name,b.subarray(offset,offset+length));}
  if(tables.has('fvar')||!tables.has('glyf')||!tables.has('cmap'))throw new Error('La fuente variable o su formato todavía no son compatibles.');
  const os=tables.get('OS/2');if(!os||os.length<10||os.readUInt16BE(8)&0x206)throw new Error('La fuente no permite esta incorporación al PDF.');
  const n=tables.get('name');if(!n||n.length<6)throw new Error('Nombre de fuente no disponible.');const records=n.readUInt16BE(2),offset=n.readUInt16BE(4),names=new Map();
  for(let i=0;i<records;i++){const p=6+i*12;if(p+12>n.length)break;const platform=n.readUInt16BE(p),id=n.readUInt16BE(p+6),length=n.readUInt16BE(p+8),a=offset+n.readUInt16BE(p+10);if(a+length>n.length||![1,2,4,6,16,17].includes(id))continue;let value='';if(platform===0||platform===3){for(let j=a;j+1<a+length;j+=2)value+=String.fromCharCode(n.readUInt16BE(j));}else if(platform===1)value=n.toString('latin1',a,a+length);value=value.replace(/[\u0000-\u001f]/g,'').trim().slice(0,150);if(value&&(!names.has(id)||platform===3))names.set(id,value);}
  const family=names.get(16)||names.get(1),style=names.get(17)||names.get(2)||'Regular';if(!family)throw new Error('Familia no disponible.');const weight=os.length>=6?os.readUInt16BE(4):400,flags=os.length>=64?os.readUInt16BE(62):0;return{family,style,name:names.get(4)||family+' '+style,postscript:names.get(6)||'',weight,widthClass:os.length>=8?os.readUInt16BE(6):5,bold:!!(flags&32)||weight>=600,italic:!!(flags&1)||/italic|oblique/i.test(style)};
}
function createLocalFonts(roots){
  let listing=null;const files=new Map();
  const list=()=>listing??=(async()=>{const out=[];for(const root of roots.filter(Boolean)){let entries=[];try{entries=await fs.readdir(root,{withFileTypes:true});}catch{continue;}for(const entry of entries.slice(0,2000)){if(!entry.isFile()||path.extname(entry.name).toLowerCase()!=='.ttf')continue;const file=path.join(root,entry.name);try{const stat=await fs.stat(file);if(stat.size>16*1024*1024)continue;const bytes=await fs.readFile(file),info=inspectFont(bytes),id='local:'+createHash('sha256').update(bytes).digest('hex');if(files.has(id))continue;files.set(id,file);out.push({id,...info});}catch{}}}return out.sort((a,b)=>a.name.localeCompare(b.name,'es'));})();
  const read=async id=>{await list();if(typeof id!=='string'||!files.has(id))throw new Error('La fuente local ya no está disponible.');const bytes=await fs.readFile(files.get(id));inspectFont(bytes);if('local:'+createHash('sha256').update(bytes).digest('hex')!==id)throw new Error('La fuente cambió. Reinicia la aplicación para actualizar las fuentes.');return new Uint8Array(bytes);};return{list,read};
}
module.exports={inspectFont,createLocalFonts};
