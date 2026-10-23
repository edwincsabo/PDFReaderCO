export function noteColors(hex){
  const components=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),border='#'+components.map(v=>Math.round(v*.65).toString(16).padStart(2,'0')).join('');
  return {fill:hex,border,ink:components[0]*.299+components[1]*.587+components[2]*.114>150?'#263342':'#ffffff'};
}
