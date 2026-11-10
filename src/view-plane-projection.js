const dot=(a,b)=>a.reduce((n,v,k)=>n+v*b[k],0),sub=(a,b)=>a.map((v,k)=>v-b[k]);
// Reuse the exact camera at drawing time. Orthographic rays are parallel and
// originate at each source point, rather than converging at the camera eye.
export function projectRecordedStroke(stroke,frame,fallbackView){
 const view=stroke.view||fallbackView,m=view?.cameraToWorld;if(!Array.isArray(m)||m.length!==16||!m.every(Number.isFinite))throw Error('Projection needs a calibrated recorded view');const orthographic=view.projectionMatrix?.[15]===1,eye=m.slice(12,15),forward=m.slice(8,11).map(v=>-v);
 const points=stroke.points.map(point=>{const base=orthographic?point:eye,ray=orthographic?forward:sub(point,eye),den=dot(ray,frame.normal),t=dot(sub(frame.origin,base),frame.normal)/den;if(Math.abs(den)<1e-9||!Number.isFinite(t)||!orthographic&&t<=0)throw Error('Drawing rays miss the target plane or cross behind the camera');const p=base.map((v,k)=>v+t*ray[k]);if(dot(sub(p,eye),forward)<=0)throw Error('Projection lies behind the recorded camera');return p;});
 return {...stroke,points,uv:points.map(p=>[frame.xAxis,frame.yAxis].map(a=>dot(sub(p,frame.origin),a))),frame};
}
