const formats=new Set(['none','number','integer','date','email']),operations=new Set(['sum','difference','product','percentage','average','min','max']);
const bound=1_000_000_000_000n;
const empty=value=>value===''||value===null||value===undefined||value===false||Array.isArray(value)&&!value.length;
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
export function dateCode(value){
  const match=String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!match)return null;
  const [,d,m,y]=match.map(Number),days=[31,y%4===0&&(y%100!==0||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
  return y>=1&&m>=1&&m<=12&&d>=1&&d<=days[m-1]?y*10000+m*100+d:null;
}
export function normalizeFormRule(value,kind='text'){
  if(value===null||value===undefined)return null;
  if(typeof value!=='object'||Array.isArray(value)||!formats.has(value.format||'none'))throw new Error('Formato de validación no compatible.');
  const rule={format:value.format||'none',min:value.min??null,max:value.max??null,minLength:value.minLength??null,maxLength:value.maxLength??null,minDate:value.minDate||'',maxDate:value.maxDate||'',calculation:null,requiredCheck:value.requiredCheck===true};
  if(value.requiredCheck!==undefined&&typeof value.requiredCheck!=='boolean')throw new Error('Indicador de validación obligatorio no válido.');
  if(kind!=='text'&&(rule.format!=='none'||rule.min!==null||rule.max!==null||rule.minLength!==null||rule.maxLength!==null||rule.minDate||rule.maxDate||value.calculation))throw new Error('Estas reglas se configuran en campos de texto propios.');
  for(const key of['min','max'])if(rule[key]!==null){if(!['string','number'].includes(typeof rule[key]))throw new Error('El límite numérico no es válido.');rule[key]=String(rule[key]).trim().replace(',','.');numberValue(rule[key]);}
  if(rule.min!==null&&rule.max!==null){const a=numberValue(rule.min),b=numberValue(rule.max);if(a.n*b.d>b.n*a.d)throw new Error('El mínimo no puede superar el máximo.');}
  if(!['number','integer'].includes(rule.format)&&(rule.min!==null||rule.max!==null))throw new Error('Los límites de valor requieren formato numérico.');
  for(const key of['minLength','maxLength'])if(rule[key]!==null&&(!Number.isSafeInteger(rule[key])||rule[key]<0||rule[key]>10000))throw new Error('La longitud debe estar entre 0 y 10.000 caracteres.');
  if(rule.minLength!==null&&rule.maxLength!==null&&rule.minLength>rule.maxLength)throw new Error('La longitud mínima supera la máxima.');
  for(const key of['minDate','maxDate'])if(rule[key]&&(typeof rule[key]!=='string'||dateCode(rule[key])===null))throw new Error('Usa fechas válidas con formato DD/MM/AAAA.');
  if((rule.minDate||rule.maxDate)&&rule.format!=='date')throw new Error('Los límites de fecha requieren formato Fecha.');
  if(rule.minDate&&rule.maxDate&&dateCode(rule.minDate)>dateCode(rule.maxDate))throw new Error('La fecha mínima supera la máxima.');
  if(value.calculation){const c=value.calculation;if(!operations.has(c.operation)||!Array.isArray(c.sources)||c.sources.length<1||c.sources.length>20||new Set(c.sources).size!==c.sources.length||c.sources.some(id=>typeof id!=='string'||!id||id.length>100)||!Number.isInteger(c.decimals)||c.decimals<0||c.decimals>6)throw new Error('Cálculo inválido: elige de 1 a 20 campos distintos y de 0 a 6 decimales.');if(['difference','percentage'].includes(c.operation)&&c.sources.length!==2)throw new Error('La resta y el porcentaje requieren exactamente dos campos, en ese orden.');if(c.operation==='product'&&c.sources.length<2)throw new Error('El producto requiere al menos dos campos.');if(!['none','number','integer'].includes(rule.format))throw new Error('Un campo calculado debe tener formato numérico.');rule.calculation={operation:c.operation,sources:[...c.sources],decimals:c.decimals};if(rule.format==='none')rule.format='number';}
  return rule.format==='none'&&rule.min===null&&rule.max===null&&rule.minLength===null&&rule.maxLength===null&&!rule.minDate&&!rule.maxDate&&!rule.calculation&&!rule.requiredCheck?null:rule;
}
export function numberValue(value){
  const text=String(value).trim();if(text.length>40||!/^[-+]?\d+(?:[.,]\d{1,6})?$/.test(text))throw new Error('Usa un número con coma o punto decimal, hasta 6 decimales y sin separadores de miles.');
  const negative=text.startsWith('-'),[integer,fraction='']=text.replace(/^[-+]/,'').replace(',','.').split('.'),n=BigInt(integer)*1000000n+BigInt(fraction.padEnd(6,'0'));if(n>bound*1000000n)throw new Error('El valor supera el límite de 1 billón.');return{n:negative?-n:n,d:1000000n};
}
const gcd=(a,b)=>{a=a<0n?-a:a;while(b){const r=a%b;a=b;b=r;}return a||1n;};
const reduce=(n,d)=>{const g=gcd(n,d);return{n:n/g,d:d/g};};
function calculate(operation,values){
  const add=(a,b)=>reduce(a.n*b.d+b.n*a.d,a.d*b.d),multiply=(a,b)=>reduce(a.n*b.n,a.d*b.d),sum=()=>values.reduce(add,{n:0n,d:1n});
  if(operation==='sum')return sum();if(operation==='difference')return add(values[0],{n:-values[1].n,d:values[1].d});if(operation==='product')return values.reduce(multiply,{n:1n,d:1n});if(operation==='percentage'){const product=multiply(values[0],values[1]);return reduce(product.n,product.d*100n);}if(operation==='average'){const value=sum();return reduce(value.n,value.d*BigInt(values.length));}
  return values.reduce((a,b)=>operation==='min'?(a.n*b.d<=b.n*a.d?a:b):(a.n*b.d>=b.n*a.d?a:b));
}
function rounded(value,decimals){
  const negative=value.n<0n,absolute=negative?-value.n:value.n;if(absolute>bound*value.d)throw new Error('El resultado supera el límite de 1 billón.');const scale=10n**BigInt(decimals),numerator=absolute*scale,q=numerator/value.d,r=numerator%value.d,result=q+(r*2n>=value.d?1n:0n),digits=result.toString().padStart(decimals+1,'0');return(negative&&result?'-':'')+(decimals?digits.slice(0,-decimals)+'.'+digits.slice(-decimals):digits);
}
export function checkFieldValue(field,value){
  if(field.type==='unsupported'||field.readOnly&&!field.rule?.calculation)return'';
  if(field.type==='select'&&field.list&&field.id){const selected=value===''?[]:typeof value==='string'?[value]:value;if(!Array.isArray(selected)||selected.some(v=>typeof v!=='string'||!field.options.includes(v))||new Set(selected).size!==selected.length)return'Selecciona opciones diferentes que pertenezcan a la lista.';if(!field.multiple&&selected.length>1)return'Esta lista permite una sola selección.';}
  if(empty(value)||typeof value==='string'&&!value.trim())return field.required?'Completa este campo obligatorio.':'';
  const rule=field.rule;if(!rule)return'';const text=String(value),length=Array.from(text).length;
  if(rule.minLength!==null&&length<rule.minLength)return`Escribe al menos ${rule.minLength} caracteres.`;
  if(rule.maxLength!==null&&length>rule.maxLength)return`Escribe como máximo ${rule.maxLength} caracteres.`;
  if(['number','integer'].includes(rule.format)){let parsed;try{parsed=numberValue(value);}catch(e){return e.message;}if(rule.format==='integer'&&parsed.n%parsed.d!==0n)return'Escribe un número entero.';if(rule.min!==null&&parsed.n*numberValue(rule.min).d<numberValue(rule.min).n*parsed.d)return`El valor mínimo es ${rule.min}.`;if(rule.max!==null&&parsed.n*numberValue(rule.max).d>numberValue(rule.max).n*parsed.d)return`El valor máximo es ${rule.max}.`;}
  if(rule.format==='date'){const date=dateCode(text);if(date===null)return'Escribe una fecha válida con formato DD/MM/AAAA.';if(rule.minDate&&date<dateCode(rule.minDate))return`La fecha mínima es ${rule.minDate}.`;if(rule.maxDate&&date>dateCode(rule.maxDate))return`La fecha máxima es ${rule.maxDate}.`;}
  if(rule.format==='email'&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)||text.length>254))return'Escribe un correo con formato nombre@dominio.com.';
  return'';
}
export function validateCalculationGraph(fields){
  const ids=new Map();for(const field of fields)if(field.id){if(ids.has(field.id))throw new Error('Hay identidades de campo repetidas.');ids.set(field.id,field);}
  const calculated=fields.filter(f=>f.rule?.calculation);if(calculated.length>200)throw new Error('Se admiten hasta 200 campos calculados.');const visiting=new Set(),done=new Set(),order=[];
  function visit(field,depth){if(done.has(field.id))return;if(visiting.has(field.id))throw new Error('El cálculo crea una dependencia circular.');if(depth>200)throw new Error('La cadena de cálculos es demasiado larga.');visiting.add(field.id);for(const id of field.rule.calculation.sources){const source=ids.get(id);if(!source||source.type!=='text'||!source.id)throw new Error('Uno de los campos de origen ya no existe o no es un campo de texto propio.');if(source.rule?.calculation)visit(source,depth+1);}visiting.delete(field.id);done.add(field.id);order.push(field);}
  for(const field of calculated)visit(field,0);return order;
}
export function evaluateForm(fields,pending={},options={}){
  const values=Object.create(null),errors=Object.create(null),calculated=new Set(),hasRules=fields.some(f=>f.rule||f.ruleError);
  for(const field of fields){values[field.name]=options.defaults?field.defaultValue??'':own(pending,field.name)&&!field.rule?.calculation?pending[field.name]:field.value??'';if(field.ruleError)errors[field.name]=field.ruleError;}
  let order=[];try{order=validateCalculationGraph(fields);}catch(e){errors['']=e.message;}
  for(const field of fields){if(field.rule?.calculation){calculated.add(field.name);values[field.name]='';continue;}const error=checkFieldValue({...field,required:options.allowEmptyRequired?false:field.required},values[field.name]);if(error)errors[field.name]=error;}
  const byId=new Map(fields.filter(f=>f.id).map(f=>[f.id,f]));
  for(const field of order){try{const inputs=field.rule.calculation.sources.map(id=>{const source=byId.get(id);if(errors[source.name])throw new Error(`Corrige ${source.name} para calcular este campo.`);if(empty(values[source.name])||!String(values[source.name]).trim()){const missing=new Error(`Completa ${source.name} para calcular este campo.`);missing.pending=true;throw missing;}return numberValue(values[source.name]);});const result=rounded(calculate(field.rule.calculation.operation,inputs),field.rule.calculation.decimals),error=checkFieldValue(field,result);if(error)throw new Error(error);values[field.name]=result;}catch(e){if(!(options.allowEmptyCalculated&&e.pending))errors[field.name]=e.message;}}
  return{values,errors,calculated,hasRules};
}
