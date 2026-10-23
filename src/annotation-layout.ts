import type { Mark } from './types';
import { translateMark, rotatedBounds } from './annotation-geometry.mjs';
import { annotationBox } from './text-layout.mjs';

/** Keep edited text on the page when its measured content grows at an edge. */
export function constrainTextMark(mark:Mark,width:number,height:number):Mark {
  const box=annotationBox(mark,width,height);
  return translateMark(mark,0,0,rotatedBounds(box,mark.rotation||0,width,height));
}
