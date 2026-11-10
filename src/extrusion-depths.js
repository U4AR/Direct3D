export function validExtrusionDepths(front,back){
 const valid=v=>Number.isFinite(v)&&v>=0&&v<=100;
 return valid(front)&&(back===null||valid(back))&&front+(back??0)>0;
}

export function nativeExtrusionDepths(front,back,scale){
 if(!validExtrusionDepths(front,back??null))throw Error('Extrusion needs a positive extent on at least one side of the sketch');
 if(front===0)return {distance:-back*scale};
 return {distance:front*scale,...(back>0?{backDistance:back*scale}:{})};
}

export function extrusionThickness(extrusion){
 return extrusion.distanceMetres+(extrusion.backDistanceMetres||0);
}
