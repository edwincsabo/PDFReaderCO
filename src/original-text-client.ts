import type{CopiedTextFormat}from'./text-format-clipboard';
export type TextSpan={text:string;font:string;fontSize:number;color:string;sourceIndex?:number;fontName?:string};
export type TextRange={start:number;end:number;direction?:'forward'|'backward'|'none';row?:number};
export type CaretGeometry={text:string;stops:{offset:number;row:number;a:number[];b:number[]}[];boxes:{start:number;end:number;bounds:number[]}[]};
export type OriginalRun={visible?:boolean;readingOrder?:number[];directEditing?:boolean;index:number;text:string;characters?:{start:number;end:number;bounds:number[]}[];rich?:boolean;richSpans?:TextSpan[];selectionRange?:TextRange;bounds:number[];matrix:number[];fontSize:number;fontName:string;embedded:boolean;subset:boolean;clipped:boolean;clipExpandable?:boolean;clipCount:number;clipBounds:number[]|null;movable:boolean;moveReason:string;color:string;opacity:number;marks:number;editable:boolean;reason:string;indices?:number[];originals?:string[];paragraph?:boolean;paragraphWidth?:number;paragraphHeight?:number;paragraphTop?:number;paragraphAutoGrow?:boolean;indentLeft?:number;indentRight?:number;firstLineIndent?:number;spaceBefore?:number;spaceAfter?:number;lineSpacing?:number;align?:'left'|'center'|'right'|'justify';groupPath?:number[];growthRestricted?:boolean};
export type OriginalAnalysis={source:string;page:number;objects:OriginalRun[];lines:OriginalRun[];paragraphs:OriginalRun[];nested?:number;groupWarnings?:string[];grouped:number;unsupported:number};
export type OriginalDraft=OriginalRun&{source:string;page:number;unit:number};
export type FormatUndo={text:string;after:string;font:string;fontSize:number;color:string;spans?:TextSpan[]};
export type OriginalEdit={caretGeometry?:boolean;source:string;page:number;index:number;original:string;text:string;font:string;fontSize:number;color:string;spans?:TextSpan[];selection?:TextRange;formatUndo?:FormatUndo;indices?:number[];originals?:string[];expandToSpace?:boolean;checkFit?:boolean;allowOverflow?:boolean;fitMinimum?:number;paragraph?:boolean;paragraphWidth?:number;paragraphHeight?:number;paragraphOffsetX?:number;paragraphOffsetY?:number;paragraphAutoGrow?:boolean;paragraphSpace?:boolean;indentLeft?:number;indentRight?:number;firstLineIndent?:number;spaceBefore?:number;spaceAfter?:number;lineSpacing?:number;align?:'left'|'center'|'right'|'justify'};
export type OriginalFit={geometry?:CaretGeometry|null;area:number[];bounds:number[];fits:boolean;width:number;height:number;availableWidth:number;availableHeight:number;originalArea?:number[];expansionEnabled?:boolean;expanded?:boolean;expansionReason?:string;paragraphHeight?:number;paragraphWidth?:number;spaceBounds?:number[];blocker?:{kind:string;bounds?:number[];index?:number;clipPaths?:number[][][];suggestion:string}};
export type OriginalPreview=OriginalFit&{image:{width:number;height:number;data:Uint8ClampedArray}};
export type OriginalMove=Pick<OriginalEdit,'source'|'page'|'index'|'original'|'indices'|'originals'|'paragraph'>&{dx:number;dy:number};
export type OriginalMovePreview={bounds:number[];dx:number;dy:number;image:OriginalPreview['image']};
export type OriginalAutoFit={fits:boolean;reason?:'below-minimum'|'no-fit';fontSize?:number;pointSize?:number;previousSize?:number;minimum:number;current?:number;changed?:boolean;checks?:number;fit?:OriginalFit};
export type OriginalSession={draft:OriginalDraft;edit:OriginalEdit;surface:'inline'|'dialog';fromInline?:boolean;returnEdit?:OriginalEdit};
export const originalEdit=(draft:OriginalDraft):OriginalEdit=>({source:draft.source,page:draft.page,index:draft.index,original:draft.text,indices:draft.indices,originals:draft.originals,text:draft.text,spans:draft.richSpans,selection:draft.selectionRange,font:'original',fontSize:draft.fontSize,color:draft.color,expandToSpace:!draft.paragraph&&(!draft.clipped||!!draft.clipExpandable)&&!draft.growthRestricted,checkFit:true,allowOverflow:false,fitMinimum:8,paragraph:draft.paragraph,paragraphWidth:draft.paragraphWidth,paragraphHeight:draft.paragraphHeight,paragraphOffsetX:draft.paragraph?0:undefined,paragraphOffsetY:draft.paragraph?0:undefined,paragraphAutoGrow:draft.paragraph?(!draft.clipped&&!draft.growthRestricted&&(draft.paragraphAutoGrow??true)):undefined,paragraphSpace:draft.paragraph?true:undefined,lineSpacing:draft.lineSpacing,align:draft.align,...Object.fromEntries(['indentLeft','indentRight','firstLineIndent','spaceBefore','spaceAfter'].map(k=>[k,draft.paragraph?((draft as any)[k]??0):undefined]))});
export function makeOriginalDraft(run:OriginalRun,context:{source:string;page:number;unit:number}):OriginalDraft{const{paragraphSourceText,paragraphPaint,paragraphTextData,paragraphTextDataInvalid,...data}=run as any;return{...data,...context};}
export type ReplaceSettings={query:string;caseSensitive:boolean;wholeWord:boolean};
export type ReplaceMatch={id:string;page:number;index:number;start:number;length:number;text:string;line:string;bounds:number[];editable:boolean;reason:string};
export type ReplaceSearch={source:string;settings:ReplaceSettings;pages:number;scanned:number;truncated:boolean;grouped:number;unsupported:number;matches:ReplaceMatch[]};
export type ReplaceReviewRequest=ReplaceSettings&{source:string;replacement:string;autoFit:boolean;expandToSpace?:boolean;minimum:number;ids?:string[]};
export type ReplaceEntry={id:string;page:number;ids:string[];selected:number;count:number;before:string;after:string;bounds:number[];status:'ready'|'adjusted'|'blocked'|'unchanged';reason:string;pointSize:number;previousSize:number};
export type ReplaceReview={id:string;source:string;mode:'single'|'all';entries:ReplaceEntry[];replaced:number;lines:number;selected:number;blocked:number;unchanged:number;settings:ReplaceSettings&{replacement:string;autoFit:boolean;expandToSpace?:boolean;minimum:number}};
export type ReplaceProgress={stage:'search'|'review';current:number;total:number;matches?:number};
export type ReplaceResult={bytes:Uint8Array;replaced:number;lines:number};
type RequestOptions={signal?:AbortSignal;onProgress?:(progress:ReplaceProgress)=>void};
const fontCache=new Map<string,Promise<Uint8Array>>();
function localFont(id:string){if(!fontCache.has(id)){if(fontCache.size>=4)fontCache.delete(fontCache.keys().next().value!);fontCache.set(id,window.desktop!.readFont(id).catch(error=>{fontCache.delete(id);throw error;}));}return fontCache.get(id)!;}
let worker:Worker|undefined,nextId=0;
const requests=new Map<number,{resolve:(value:any)=>void;reject:(reason:Error)=>void;timer:ReturnType<typeof setTimeout>;cleanup:()=>void;onProgress?:RequestOptions['onProgress']}>();
const timeout=()=>setTimeout(()=>fail('La edición de texto tardó demasiado. Vuelve a intentarlo con una página menos compleja.'),120000);
function fail(message:string){worker?.terminate();worker=undefined;for(const item of requests.values()){clearTimeout(item.timer);item.cleanup();item.reject(new Error(message));}requests.clear();}
async function request(type:string,bytes:Uint8Array,payload:any,options:RequestOptions={}):Promise<any>{
  if(payload&&typeof payload==='object'){const ids=[...new Set([payload.font,payload.options?.font,...(payload.localFontIds||[]),...(payload.spans||[]).map((s:any)=>s.font)].filter((id:unknown):id is string=>typeof id==='string'&&id.startsWith('local:')))];if(payload.localFontIds&&ids.length>8)throw new Error('El formato conjunto admite hasta ocho fuentes locales por operación.');if(ids.length){if(!window.desktop?.readFont)throw new Error('Las fuentes locales requieren la aplicación de escritorio.');payload={...payload,fonts:await Promise.all(ids.map(async id=>({id,bytes:await localFont(id)})))};}}
  if(options.signal?.aborted)return Promise.reject(new DOMException('Operación cancelada.','AbortError'));
  if(!worker){worker=new Worker(new URL('./original-text.worker.ts',import.meta.url),{type:'module'});worker.onmessage=({data})=>{const pending=requests.get(data.id);if(!pending)return;if(data.progress){clearTimeout(pending.timer);pending.timer=timeout();pending.onProgress?.(data.progress);return;}requests.delete(data.id);clearTimeout(pending.timer);pending.cleanup();data.error?pending.reject(new Error(data.error)):pending.resolve(data.result);};worker.onerror=()=>fail('No se pudo iniciar el motor de edición de texto.');}
  const id=++nextId;return new Promise((resolve,reject)=>{const abort=()=>{const item=requests.get(id);if(!item)return;requests.delete(id);clearTimeout(item.timer);item.cleanup();worker?.postMessage({id,type:'cancel'});reject(new DOMException('Operación cancelada.','AbortError'));};const cleanup=()=>options.signal?.removeEventListener('abort',abort);requests.set(id,{resolve,reject,timer:timeout(),cleanup,onProgress:options.onProgress});options.signal?.addEventListener('abort',abort,{once:true});worker!.postMessage({id,type,bytes,payload});});
}
export const inspectOriginalText=(bytes:Uint8Array,page:number):Promise<OriginalAnalysis>=>request('inspect',bytes,page);
export type BlockRequest={source:string;page:number;index:number;groups:{index:number;text:string;indices:number[];originals:string[]}[];action:'join'|'split';separator:'line'|'space'|'none';split:'lines'|'fragments'|'after-line';after:number};
export type BlockPlan={blocks:{indices:number[];bounds:number[];text:string}[];lines:string[];fragments:number};
export const planOriginalBlocks=(bytes:Uint8Array,edit:BlockRequest):Promise<BlockPlan>=>request('blocks-plan',bytes,edit);
export const organizeOriginalBlocks=(bytes:Uint8Array,edit:BlockRequest):Promise<Uint8Array>=>request('blocks',bytes,edit);
export const replaceOriginalText=(bytes:Uint8Array,edit:OriginalEdit):Promise<Uint8Array>=>request('edit',bytes,edit);
export const measureOriginalText=(bytes:Uint8Array,edit:OriginalEdit):Promise<OriginalFit>=>request('measure',bytes,edit);
export const previewOriginalText=(bytes:Uint8Array,edit:OriginalEdit,width:number):Promise<OriginalPreview>=>request('preview',bytes,{...edit,previewWidth:width});
export const fitOriginalText=(bytes:Uint8Array,edit:OriginalEdit):Promise<OriginalAutoFit>=>request('fit',bytes,edit);
export const moveOriginalText=(bytes:Uint8Array,move:OriginalMove):Promise<Uint8Array>=>request('move',bytes,move);
export const previewOriginalMove=(bytes:Uint8Array,move:OriginalMove,width:number,options?:RequestOptions):Promise<OriginalMovePreview>=>request('move-preview',bytes,{...move,previewWidth:width},options);
export const searchOriginalReplacements=(bytes:Uint8Array,settings:ReplaceSettings,options?:RequestOptions):Promise<ReplaceSearch>=>request('replacement-search',bytes,settings,options);
export const reviewOriginalReplacements=(bytes:Uint8Array,settings:ReplaceReviewRequest,options?:RequestOptions):Promise<ReplaceReview>=>request('replacement-review',bytes,settings,options);
export const applyOriginalReplacements=(bytes:Uint8Array,review:Pick<ReplaceReview,'id'|'source'>):Promise<ReplaceResult>=>request('replacement-apply',bytes,{id:review.id,source:review.source});

export type TextBlockPart={index:number;text:string;indices:number[];originals:string[];start:number;end:number};
export type MultiFormatOptions={font?:string;size?:number;color?:string;bold?:boolean;italic?:boolean};
export type MultiFormatPaste={format:CopiedTextFormat;attributes:{font:boolean;size:boolean;color:boolean}};
export type MultiFormatRequest={paste?:MultiFormatPaste;source:string;page:number;parts:TextBlockPart[];options:MultiFormatOptions;catalog?:any[];localFontIds?:string[];previewWidth?:number};
export type MultiFormatReview={id:string|null;source:string;entries:{index:number;text:string;status:'ready'|'blocked';reason:string}[];ready:number;blocked:number;image?:OriginalPreview['image']};
export const reviewMultiFormat=(bytes:Uint8Array,edit:MultiFormatRequest):Promise<MultiFormatReview>=>request('multi-review',bytes,edit);
export const applyMultiFormat=(bytes:Uint8Array,edit:{id:string;source:string}):Promise<Uint8Array>=>request('multi-apply',bytes,edit);
export const clearMultiFormat=(bytes:Uint8Array):Promise<boolean>=>request('multi-clear',new Uint8Array(),{});
export type MultiReplacementRequest={source:string;page:number;parts:TextBlockPart[];replacement:{text:string;font:string;chunks?:string[]};localFontIds?:string[];previewWidth?:number};
export type MultiReplacementReview=Omit<MultiFormatReview,'entries'>&{entries:(MultiFormatReview['entries'][number]&{inserted:string;before:string;after:string})[]};
export const reviewMultiReplacement=(bytes:Uint8Array,edit:MultiReplacementRequest):Promise<MultiReplacementReview>=>request('multi-replace-review',bytes,edit);
export const applyMultiReplacement=(bytes:Uint8Array,edit:{id:string;source:string}):Promise<Uint8Array>=>request('multi-replace-apply',bytes,edit);
export const clearMultiReplacement=():Promise<boolean>=>request('multi-replace-clear',new Uint8Array(),{});
