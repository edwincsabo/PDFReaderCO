const tools=['highlight','underline','strike','pen','rect','ellipse','text','note','signature','image'];
export function validateMark(m){
  if(!m||!tools.includes(m.tool)||!Number.isInteger(m.page)||m.page<1||typeof m.color!=='string'||!/^#[0-9a-f]{6}$/i.test(m.color)||![m.x,m.y,m.w,m.h,m.size].every(Number.isFinite)||m.w<0||m.h<0||m.size<=0||m.size>200||typeof m.id!=='string'||!m.id||m.id.length>160)throw new Error('Anotación inválida.');
  if(m.image!==undefined&&(typeof m.image!=='string'||!/^data:image\/(png|jpeg);base64,[a-z0-9+/=]+$/i.test(m.image)))throw new Error('Imagen inválida.');
  if(m.points!==undefined&&(!Array.isArray(m.points)||m.points.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite))))throw new Error('Trazo inválido.');
  if(m.text!==undefined&&typeof m.text!=='string')throw new Error('Texto inválido.');
  for(const key of ['rotation','opacity','fillOpacity'])if(m[key]!==undefined&&(!Number.isFinite(m[key])||key!=='rotation'&&(m[key]<0||m[key]>1)))throw new Error('Propiedad de anotación inválida.');
  if(m.fill!==undefined&&!/^#[0-9a-f]{6}$/i.test(m.fill))throw new Error('Relleno inválido.');
  if(m.fontFamily!==undefined&&!['sans','serif','mono'].includes(m.fontFamily)||m.align!==undefined&&!['left','center','right'].includes(m.align))throw new Error('Propiedad de texto inválida.');
  for(const key of ['bold','italic','stamp'])if(m[key]!==undefined&&typeof m[key]!=='boolean')throw new Error('Estilo inválido.');
  return m;
}
export function annotationData(m){
  if(m?.tool==='note'&&(m.w<=0||m.h<=0))throw new Error('El comentario debe tener un icono con dimensiones positivas.');
  if(m?.tool==='image'||m?.tool==='signature'&&m.image){if(!m.image||m.w<=0||m.h<=0)throw new Error('La imagen debe tener datos y dimensiones positivas.');}
  validateMark(m);const result={};for(const key of ['id','page','tool','x','y','w','h','color','size','text','rotation','opacity','fontFamily','bold','italic','align','stamp','fill','fillOpacity'])if(m[key]!==undefined)result[key]=m[key];if(m.tool==='image'||m.tool==='signature'&&m.image)result.image=m.image;if(m.tool==='pen'||m.tool==='signature'&&!m.image){if(!m.points||m.points.length<2)throw new Error('El trazo debe contener al menos dos puntos.');result.points=m.points.map(p=>[...p]);}return result;
}
