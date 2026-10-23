export function parsePageRange(input, count) {
  if (!input.trim()) return Array.from({length:count},(_,i)=>i);
  const pages=[];
  for(const raw of input.split(',')) {
    const match=raw.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if(!match)throw new Error('Usa páginas como 1, 3-5, 8.');
    const a=Number(match[1]), b=Number(match[2]||match[1]);
    if(a<1||b<a||b>count)throw new Error(`El rango debe estar entre 1 y ${count}.`);
    for(let i=a;i<=b;i++)if(!pages.includes(i-1))pages.push(i-1);
  }
  return pages;
}
