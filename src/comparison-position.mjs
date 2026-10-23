const unit=value=>Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
export function comparisonLocation(value,pages){
  return {page:Math.max(1,Math.min(Math.max(1,pages),Number.isFinite(value?.page)?Math.trunc(value.page):1)),y:unit(value?.y),x:unit(value?.x)};
}
export function pairedLocation(value,targetPages,offset=0,direction=1){
  const page=value.page+Math.trunc(offset)*direction;
  return {...comparisonLocation({...value,page},targetPages),limited:page<1||page>targetPages};
}
export function pageAtOffset(boxes,top){
  if(!boxes.length)return {page:1,y:0};
  let lo=0,hi=boxes.length-1;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(boxes[mid].top<=top)lo=mid;else hi=mid-1;}
  const box=boxes[lo];return {page:box.page,y:unit((top-box.top)/Math.max(1,box.height))};
}
export function offsetForLocation(box,location,padding,maxTop,maxLeft){
  return {top:Math.max(0,Math.min(maxTop,box.top+unit(location.y)*box.height-padding)),left:unit(location.x)*Math.max(0,maxLeft)};
}
