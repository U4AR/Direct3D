import * as T from 'three';

// Test the actual solid mesh, including holes/concavities. A world bounding
// box alone would let an empty corner or a hole start a grab.
export function meshContainsPoint(mesh,worldPoint){
 if(!mesh?.geometry||!worldPoint?.toArray().every(Number.isFinite))return false;
 mesh.updateWorldMatrix(true,false);if(Math.abs(mesh.matrixWorld.determinant())<1e-15)return false;
 const g=mesh.geometry,p=worldPoint.clone().applyMatrix4(mesh.matrixWorld.clone().invert());if(!g.boundingBox)g.computeBoundingBox();
 if(!g.boundingBox?.containsPoint(p))return false;
 const attr=g.attributes.position,index=g.index,count=index?index.count:attr?.count;if(!attr||count<12)return false;
 const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),hit=new T.Vector3(),triangle=new T.Triangle(),ray=new T.Ray();
 const vertex=(out,i)=>out.fromBufferAttribute(attr,index?index.getX(i):i);
 let checkSurface=true;
 for(const direction of [[.743,.421,.521],[-.371,.819,-.439],[.293,-.547,.784]]){
  ray.set(p,new T.Vector3(...direction).normalize());const distances=[];
  for(let i=0;i<count;i+=3){vertex(a,i);vertex(b,i+1);vertex(c,i+2);
   // Boundary distance is needed once, and only for triangles whose local box contains the point.
   if(checkSurface&&p.x>=Math.min(a.x,b.x,c.x)-1e-7&&p.x<=Math.max(a.x,b.x,c.x)+1e-7&&p.y>=Math.min(a.y,b.y,c.y)-1e-7&&p.y<=Math.max(a.y,b.y,c.y)+1e-7&&p.z>=Math.min(a.z,b.z,c.z)-1e-7&&p.z<=Math.max(a.z,b.z,c.z)+1e-7){triangle.set(a,b,c);triangle.closestPointToPoint(p,hit);if(hit.distanceToSquared(p)<1e-14)return true;}
   if(ray.intersectTriangle(a,b,c,false,hit))distances.push(hit.distanceTo(p));
  }
  distances.sort((a,b)=>a-b);let crossings=0,last=-Infinity;for(const d of distances)if(d-last>1e-7){crossings++;last=d;}
  if(crossings%2!==1)return false;checkSurface=false;
 }
 return true;
}

// Interaction volume for shelled vessels includes their cavity. The solid test
// remains unchanged for CAD logic. Through-holes stay empty: an enclosure must
// have wall hits on at least one side of every axis and opposing walls on two.
export function meshGrabContainsPoint(mesh,worldPoint,{allowCavity=false}={}){
 if(meshContainsPoint(mesh,worldPoint))return true;if(!allowCavity||!mesh?.geometry||!worldPoint?.toArray().every(Number.isFinite))return false;
 mesh.updateWorldMatrix(true,false);if(Math.abs(mesh.matrixWorld.determinant())<1e-15)return false;const g=mesh.geometry,p=worldPoint.clone().applyMatrix4(mesh.matrixWorld.clone().invert());if(!g.boundingBox)g.computeBoundingBox();if(!g.boundingBox?.containsPoint(p))return false;
 const attr=g.attributes.position,index=g.index,count=index?index.count:attr?.count;if(!attr||count<12)return false;const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),hit=new T.Vector3();let opposed=0;
 for(let axis=0;axis<3;axis++){let sides=0;for(const sign of [-1,1]){const direction=new T.Vector3();direction.setComponent(axis,sign);const ray=new T.Ray(p,direction);let found=false;for(let i=0;i<count;i+=3){a.fromBufferAttribute(attr,index?index.getX(i):i);b.fromBufferAttribute(attr,index?index.getX(i+1):i+1);c.fromBufferAttribute(attr,index?index.getX(i+2):i+2);if(ray.intersectTriangle(a,b,c,false,hit)&&hit.distanceToSquared(p)>1e-14){found=true;break;}}if(found)sides++;}if(!sides)return false;if(sides===2)opposed++;}
 return opposed>=2;
}
export const bodyAllowsCavityGrab=model=>(model.blender?.features||[]).some(f=>['shell','solidify','difference'].includes(f.operation));

const ALIGNMENTS=[];
for(let x=0;x<4;x++)for(let y=0;y<4;y++)for(let z=0;z<4;z++){
 const q=new T.Quaternion().setFromEuler(new T.Euler(x*Math.PI/2,y*Math.PI/2,z*Math.PI/2));
 if(!ALIGNMENTS.some(a=>Math.abs(a.dot(q))>1-1e-8))ALIGNMENTS.push(q);
}
const smooth=t=>t*t*(3-2*t);
// A soft capture range is easy to pull out of. The small centre locks exactly
// to zero/orthogonal axes, without altering object size or CAD geometry.
export function magneticRange(sizeMetres){return Math.max(.004,Math.min(.12,sizeMetres*.25));}
export function precisionMotion(speed,angularSpeed,sizeMetres){return speed<Math.max(.004,Math.min(.06,sizeMetres*.15))&&angularSpeed<T.MathUtils.degToRad(8);}
export function magneticTransform(matrix,localCenter=new T.Vector3(),enabled=true,options={}){
 if(!enabled)return {matrix:matrix.clone(),labels:[],target:null};
 const position=new T.Vector3(),q=new T.Quaternion(),scale=new T.Vector3();matrix.decompose(position,q,scale);
 const center=localCenter.clone().applyMatrix4(matrix),labels=[],outer=magneticRange(options.sizeMetres||.1),inner=outer*.18;
 const origins=options.origins?.length?options.origins:[{point:new T.Vector3(),label:'Origin'}],target=center.clone();
 for(const axis of ['x','y','z']){const nearest=origins.reduce((best,o)=>Math.abs(center[axis]-o.point[axis])<Math.abs(center[axis]-best.point[axis])?o:best,origins[0]),d=Math.abs(center[axis]-nearest.point[axis]);if(d<outer){const t=Math.max(0,Math.min(1,(d-inner)/(outer-inner)));center[axis]=nearest.point[axis]+(center[axis]-nearest.point[axis])*smooth(t);target[axis]=nearest.point[axis];labels.push((nearest.label==='Origin'?'':nearest.label+' ')+axis.toUpperCase()+'=0');}}
 const basis=options.localOrientation||new T.Quaternion(),actual=q.clone().multiply(basis),nearest=ALIGNMENTS.reduce((best,a)=>Math.abs(a.dot(actual))>Math.abs(best.dot(actual))?a:best,ALIGNMENTS[0]);
 const angle=actual.angleTo(nearest),angleInner=T.MathUtils.degToRad(3),angleOuter=T.MathUtils.degToRad(15);
 if(angle<angleOuter){actual.slerp(nearest,1-smooth(Math.max(0,(angle-angleInner)/(angleOuter-angleInner))));q.copy(actual).multiply(basis.clone().invert());if(angle>1e-7)labels.push('axes');}
 position.copy(center).sub(localCenter.clone().multiply(scale).applyQuaternion(q));
 return {matrix:new T.Matrix4().compose(position,q,scale),labels,target};
}
