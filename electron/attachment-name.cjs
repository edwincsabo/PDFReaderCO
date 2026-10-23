function safeAttachmentName(input){
  const base=String(input||'Adjunto.bin').split(/[\\/]/).pop().replace(/[<>:"\\/|?*\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/g,'').trim()||'Adjunto.bin';
  const guarded=/^(con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(\.|$)/i.test(base)?'_'+base:base;
  if(guarded.length<=180)return guarded;const match=guarded.match(/\.[a-z0-9]{1,12}$/i),ext=match?.[0]||'';return guarded.slice(0,180-ext.length)+ext;
}
module.exports={safeAttachmentName};
