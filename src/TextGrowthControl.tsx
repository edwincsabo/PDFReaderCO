import{tr}from'./i18n';
import type{OriginalDraft,OriginalEdit}from'./original-text-client';
export function TextGrowthControl({draft,edit,disabled,onChange}:{draft:OriginalDraft;edit:OriginalEdit;disabled:boolean;onChange:(edit:OriginalEdit)=>void}){
  if(draft.paragraph)return null;
  return <div className="text-growth-control"><label><input type="checkbox" aria-label={tr("Expandir texto en el espacio libre")} checked={!!edit.expandToSpace} disabled={disabled||!!draft.growthRestricted||draft.clipped&&!draft.clipExpandable} onChange={e=>onChange({...edit,expandToSpace:e.target.checked})}/>{tr(" Expandir texto en el espacio libre")}</label><p>{draft.growthRestricted?tr("El grupo tiene un recorte externo que conserva su área."):draft.clipped?(draft.clipExpandable?tr("El texto puede crecer dentro de la máscara comprobada. Se conservan todos sus recortes y se revisan los objetos vecinos."):tr("No se pudo comprobar toda la máscara. Se conserva el área original y sus recortes.")):tr("Conserva la fuente, el tamaño y la posición. El área puede crecer hasta encontrar otro objeto detectado o el borde de la página o del grupo. Los vecinos conservan su posición.")}</p></div>;
}
