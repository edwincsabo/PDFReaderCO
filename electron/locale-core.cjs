const catalog=require('./locale-en.json');
function createLocalization(initial='es'){
  let language=initial,patterns=null;const listeners=new Set();
  const format=(text,args)=>text.replace(/\{(\d+)\}/g,(slot,index)=>index<args.length?String(args[index]):slot);
  const tr=(text,args=[])=>{if(typeof text!=='string')return String(text??'');const key=text.trim(),value=language==='en'?(catalog[key]??key):key;return format(text.slice(0,text.indexOf(key))+value+text.slice(text.indexOf(key)+key.length),args);};
  function translateMessage(value){const text=String(value??'');if(language!=='en')return text;const clean=text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/,'');if(Object.hasOwn(catalog,clean.trim()))return tr(clean);
    patterns??=Object.entries(catalog).filter(([key])=>/\{\d+\}/.test(key)).map(([key,en])=>{const indices=[],parts=key.split(/(\{\d+\})/g),source=parts.map(p=>{if(/^\{\d+\}$/.test(p)){indices.push(Number(p.slice(1,-1)));return'([\\s\\S]*?)';}return p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}).join('');return{regex:new RegExp('^'+source+'$'),prefix:parts[0],indices,en};}).sort((a,b)=>b.prefix.length-a.prefix.length);
    if(clean.length<=16000)for(const p of patterns){if(!clean.startsWith(p.prefix))continue;const found=p.regex.exec(clean);if(found){const args=[];p.indices.forEach((index,i)=>{args[index]=found[i+1];});return format(p.en,args);}}
    return clean;
  }
  return{tr,translateMessage,getLanguage:()=>language,setLanguage:next=>{if(!['es','en'].includes(next))throw new Error('Unsupported interface language.');if(next===language)return;language=next;for(const fn of listeners)fn();},subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
}
module.exports={createLocalization};
