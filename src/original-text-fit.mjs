// Search on a physical 0.1 pt grid. Keep the exact current size when it fits,
// and never enlarge it or round a result below the requested readable minimum.
export async function findTextSize(measure,{fontSize,factor,minimum}){
  if(!Number.isFinite(fontSize)||fontSize<1||fontSize>400||!Number.isFinite(factor)||factor<=0||!Number.isFinite(minimum)||minimum<6||minimum>72)throw new Error('Indica un mínimo entre 6 y 72 puntos y un tamaño de texto válido.');
  const current=fontSize*factor,minTick=Math.ceil(Math.max(minimum,factor)*10-1e-7),maxTick=Math.floor(current*10+1e-7);
  if(!Number.isSafeInteger(minTick)||!Number.isSafeInteger(maxTick))throw new Error('La escala de este texto supera el límite del ajuste automático.');
  if(current+1e-7<minimum)return {fits:false,reason:'below-minimum',minimum,current};
  let checks=0;
  const check=async size=>{checks++;return measure(size);};
  const unchanged=await check(fontSize);
  if(unchanged.fits)return {fits:true,fontSize,pointSize:current,previousSize:current,minimum,changed:false,fit:unchanged,checks};
  if(minTick>maxTick)return {fits:false,reason:'no-fit',minimum,current,checks};
  let low=minTick,high=maxTick,best=null;
  const smallest=await check(low/10/factor);
  if(!smallest.fits)return {fits:false,reason:'no-fit',minimum,current,fit:smallest,checks};
  best={tick:low,fit:smallest};low++;
  while(low<=high){
    const middle=low+Math.floor((high-low)/2),fit=await check(middle/10/factor);
    if(fit.fits){best={tick:middle,fit};low=middle+1;}else high=middle-1;
  }
  // The measurement used to choose the result is the one used by commit.
  return {fits:true,fontSize:best.tick/10/factor,pointSize:best.tick/10,previousSize:current,minimum,changed:true,fit:best.fit,checks};
}
