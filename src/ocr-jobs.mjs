import{ocrRegion,regionsIntersect}from'./ocr-region.mjs';
import{parsePageRange}from'./page-range.mjs';
export const ocrEntryId=entry=>entry.id??entry.page;
export function ocrRegions(value){
  if(value.regions!==undefined&&(!Array.isArray(value.regions)||value.regions.length>49))throw new Error('Selecciona hasta cincuenta zonas por trabajo.');
  const regions=[...(value.regions||[]),...(value.region?[value.region]:[])].map(ocrRegion);
  if(regions.some((r,i)=>regions.slice(0,i).some(other=>other.page===r.page&&regionsIntersect(r,other))))throw new Error('Las zonas del trabajo se superponen. Ajusta o retira la zona repetida.');
  return regions;
}
export function ocrJobs(options,count){
  const regions=ocrRegions(options),jobs=regions.length?regions.map((region,i)=>({id:1000001+i,page:region.page,region})):parsePageRange(options.range,count).map(index=>({id:index+1,page:index+1,region:undefined}));
  if(!jobs.length||jobs.length>50||jobs.some(j=>j.page<1||j.page>count))throw new Error('Selecciona entre 1 y 50 páginas o zonas existentes.');
  // Preserve legacy identifiers for a single region and for full pages.
  if(regions.length===1)jobs[0].id=jobs[0].page;
  return jobs;
}
