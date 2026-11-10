import * as T from 'three';
import {meshTopology} from './desktop-topology.js';
import {planeFrame} from './sketch-projection.js';

// Geometry stays in the saved harness request, never in the language-model input.
// No decimation: omitted large meshes are reported, rather than picked inaccurately.
const MAX_VERTICES=120000,MAX_TRIANGLES=120000,compiled=new WeakMap();
export function captureSurfaceScene(models=[]){
 const scene={version:1,models:[],omitted:[]};let vertices=0,triangles=0;
 for(const m of models.filter(m=>!m.hidden&&m.mesh?.visible).slice(0,32)){
  const g=m.mesh.geometry,p=g?.attributes?.position,indices=g?.index,count=indices?.count||p?.count||0;
  if(!p||vertices+p.count>MAX_VERTICES||triangles+count/3>MAX_TRIANGLES){scene.omitted.push({id:m.id,reason:'Exact mesh exceeds the surface-picking budget'});continue;}
  m.mesh.updateWorldMatrix(true,false);vertices+=p.count;triangles+=count/3;
  scene.models.push({id:m.id,name:m.name||m.id,version:m.version||1,geometryVersion:m.geometryVersion||1,nativeId:m.nativeId||null,matrixWorld:m.mesh.matrixWorld.toArray(),positions:Array.from({length:p.count},(_,i)=>[p.getX(i),p.getY(i),p.getZ(i)]).flat(),indices:indices?Array.from(indices.array):null,nativeFaces:(m.blender?.metrics?.faces||[]).filter(f=>Number.isInteger(f.triangleStart)&&Number.isInteger(f.triangleCount)).map(f=>({index:f.index,type:f.type,triangleStart:f.triangleStart,triangleCount:f.triangleCount}))});
 }
 return scene;
}
export function validateSurfaceScene(scene){
 if(scene===undefined||scene===null)return;
 if(!Array.isArray(scene.models)||scene.models.length>32||!Array.isArray(scene.omitted)||scene.omitted.length>32)throw Error('Use a bounded surface-picking snapshot');let vertices=0,triangles=0;const ids=new Set();
 for(const m of scene.models){if(typeof m.id!=='string'||m.id.length>160||ids.has(m.id)||!Number.isInteger(m.version)||m.version<1||!Number.isInteger(m.geometryVersion)||m.geometryVersion<1)throw Error('Surface snapshots need unique versioned objects');ids.add(m.id);
  if(!Array.isArray(m.matrixWorld)||m.matrixWorld.length!==16||!m.matrixWorld.every(Number.isFinite)||Math.abs(new T.Matrix4().fromArray(m.matrixWorld).determinant())<1e-12)throw Error('Invalid surface object frame');
  if(!Array.isArray(m.positions)||m.positions.length%3||m.positions.length<9||m.positions.some(v=>!Number.isFinite(v)||Math.abs(v)>1e4))throw Error('Surface mesh needs finite vertices');vertices+=m.positions.length/3;
  if(m.indices!==null&&(!Array.isArray(m.indices)||m.indices.some(i=>!Number.isInteger(i)||i<0||i>=m.positions.length/3)))throw Error('Invalid surface mesh indices');const count=m.indices?.length||m.positions.length/3;if(count%3)throw Error('Surface mesh needs triangles');triangles+=count/3;
  if(m.nativeFaces!==undefined&&(!Array.isArray(m.nativeFaces)||m.nativeFaces.length>120000||m.nativeFaces.some(f=>!Number.isInteger(f.triangleStart)||!Number.isInteger(f.triangleCount)||f.triangleStart<0||f.triangleCount<1||f.triangleStart+f.triangleCount>count/3)))throw Error('Invalid native face ranges');
 }
 if(vertices>MAX_VERTICES||triangles>MAX_TRIANGLES)throw Error('Surface-picking geometry budget exceeded');
}
function meshes(scene){let entry=compiled.get(scene);if(entry)return entry;validateSurfaceScene(scene);entry=scene.models.map(record=>{const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(record.positions,3));if(record.indices)geometry.setIndex(record.indices);const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));mesh.matrixAutoUpdate=false;mesh.matrix.fromArray(record.matrixWorld);mesh.updateMatrixWorld(true);return {record,mesh};});compiled.set(scene,entry);return entry;}
export function surfaceSceneCatalog(scene){return {objects:(scene?.models||[]).map(m=>({id:m.id,name:m.name,version:m.version,geometryVersion:m.geometryVersion,nativeId:m.nativeId,matrixWorld:m.matrixWorld})),omitted:scene?.omitted||[],coordinateNote:'Image points use the ORIGINAL drawing viewport: normalized [x,y], top-left [0,0], bottom-right [1,1]. Exact mesh raycast returns the nearest visible face and object-local frame. Geometry is private harness data, not model tokens.'};}
export function imagePointForWorld(point,view){const p=new T.Vector3(...point).applyMatrix4(new T.Matrix4().fromArray(view.cameraToWorld).invert()).applyMatrix4(new T.Matrix4().fromArray(view.projectionMatrix));return [(p.x+1)/2,(1-p.y)/2];}
export function pickImageSurface(scene,view,imagePoint){
 if(!Array.isArray(imagePoint)||imagePoint.length!==2||imagePoint.some(v=>!Number.isFinite(v)||v<0||v>1))throw Error('Image point must be normalized [x,y] within [0,1]');
 if(!view||![view.cameraToWorld,view.projectionMatrix].every(m=>Array.isArray(m)&&m.length===16&&m.every(Number.isFinite))||Math.abs(new T.Matrix4().fromArray(view.projectionMatrix).determinant())<1e-12)throw Error('Surface picking needs the original calibrated image camera');
 if(!scene?.models?.length)throw Error('No exact object meshes were captured for this drawing view');
 const camera=new T.Matrix4().fromArray(view.cameraToWorld),projection=new T.Matrix4().fromArray(view.projectionMatrix).invert(),eye=new T.Vector3().setFromMatrixPosition(camera),near=new T.Vector3(imagePoint[0]*2-1,1-imagePoint[1]*2,-1).applyMatrix4(projection).applyMatrix4(camera),orthographic=view.projectionMatrix[15]===1,direction=orthographic?new T.Vector3(0,0,-1).transformDirection(camera):near.clone().sub(eye).normalize(),ray=new T.Raycaster(orthographic?near:eye,direction,0,10000),entries=meshes(scene),hit=ray.intersectObjects(entries.map(e=>e.mesh),false)[0];
 if(!hit)throw Error('No visible object surface at that image point; choose a point inside the object silhouette');const {record,mesh}=entries.find(e=>e.mesh===hit.object),normal=hit.face.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize(),native=record.nativeFaces?.find(f=>hit.faceIndex>=f.triangleStart&&hit.faceIndex<f.triangleStart+f.triangleCount);
 // Patch computation is lazy and cached per immutable snapshot. It distinguishes
 // a genuinely flat face from a smooth tessellated curved surface.
 const entry=entries.find(e=>e.mesh===mesh);entry.topology||=meshTopology(mesh.geometry);const top=entry.topology,patch=native?Array.from({length:native.triangleCount},(_,i)=>native.triangleStart+i):top.patch(hit.faceIndex),localHit=hit.point.clone().applyMatrix4(mesh.matrixWorld.clone().invert()),localNormal=hit.face.normal,flat=patch.every(i=>Math.abs(top.faces[i].normal.dot(localNormal)-1)<1e-5&&top.faces[i].ids.every(id=>Math.abs(top.vertices.get(id).clone().sub(localHit).dot(localNormal))<1e-5)),planar=flat&&(!native?.type||/plane/i.test(native.type)),frame=planeFrame({origin:hit.point.toArray(),normal:normal.toArray()}),id='surface:'+record.id+':'+(native?'face-'+(native.index??hit.faceIndex):'triangle-'+hit.faceIndex);
 return {id,name:record.name+' / '+(planar?'face':'tangent surface'),modelId:record.id,modelVersion:record.version,geometryVersion:record.geometryVersion,nativeId:record.nativeId,nativeFaceIndex:native?.index??null,faceIndex:hit.faceIndex,planar,supportType:planar?'planar-face':'tangent-plane',imagePoint,frame:{...frame,id},localFrame:planeFrame({origin:localHit.toArray(),normal:localNormal.toArray(),up:new T.Vector3(...frame.yAxis).transformDirection(mesh.matrixWorld.clone().invert()).toArray()}),matrixWorld:record.matrixWorld,note:planar?'Exact hit face plane; offset measured from this face, never from the design origin.':'This is a tangent plane at the picked point, not a flattened or wrapped curved surface. For a requested surface-following curve, ask/route to native surface modeling rather than silently flatten.'};
}
export function surfaceProjectionCandidates(strokes,data){
 if(!data.surfaceScene?.models?.length||!data.view?.projectionMatrix)return [];const points=strokes.flatMap(s=>s.points),probes=points.length?[points[Math.floor(points.length/2)],points[0],points[Math.floor(points.length/4)]]:[],result=[];
 for(const p of probes)try{const hit=pickImageSurface(data.surfaceScene,data.view,imagePointForWorld(p,data.view));if(!result.some(r=>r.modelId===hit.modelId&&r.planar===hit.planar&&Math.abs(new T.Vector3(...r.frame.normal).dot(new T.Vector3(...hit.frame.normal))-1)<1e-4))result.push(hit);}catch{}
 return result;
}

// A user may reposition a body after the drawing image was captured. Resolve its
// local face placement against the current object, while retaining original POV.
export function rebaseSurfaceResult(result,models=[]){
 const out=structuredClone(result),frames=new Map();
 for(const plane of out.referencePlanes||[]){const support=plane.surfaceAttachment;if(!support)continue;const model=models.find(m=>m.id===support.modelId&&!m.hidden&&m.mesh?.visible);if(!model||(model.geometryVersion||1)!==support.geometryVersion)throw Error('The picked surface geometry changed; draw/select the face again');model.mesh.updateWorldMatrix(true,false);const delta=model.mesh.matrixWorld.clone().multiply(new T.Matrix4().fromArray(support.matrixWorld).invert()),scale=new T.Vector3().setFromMatrixScale(delta);if(Math.max(scale.x,scale.y,scale.z)-Math.min(scale.x,scale.y,scale.z)>1e-6||delta.determinant()<=0)throw Error('Surface sketch rebasing requires a uniform positive object scale');
  const point=p=>new T.Vector3(...p).applyMatrix4(delta).toArray(),axis=a=>new T.Vector3(...a).transformDirection(delta).toArray(),frame=f=>({...f,origin:point(f.origin),xAxis:axis(f.xAxis),yAxis:axis(f.yAxis),normal:new T.Vector3(...f.normal).applyNormalMatrix(new T.Matrix3().getNormalMatrix(delta)).normalize().toArray()});
  Object.assign(plane,frame(plane));if(plane.anchor)plane.anchor=point(plane.anchor);support.drawingMatrixWorld||=support.matrixWorld;support.matrixWorld=model.mesh.matrixWorld.toArray();support.modelVersion=model.version;support.frame=frame(support.frame);support.offsetMetres*=scale.x;frames.set(plane.id,{point,axis,frame,scale:scale.x});
 }
 for(let i=0;i<out.edits.length;i++){const e=out.edits[i],transform=frames.get(e.planeId);if(!transform)continue;const {point,axis,frame,scale}=transform;e.origin=point(e.origin);e.xAxis=axis(e.xAxis);e.yAxis=axis(e.yAxis);if(e.end)e.end=point(e.end);for(const k of ['radiusMetres','widthMetres','heightMetres','extrusionMetres'])if(e[k]!==null&&e[k]!==undefined)e[k]*=scale;if(e.segments)e.segments=e.segments.map(s=>s.map(v=>v*scale));const r=out.results[i];r.frame=frame(r.frame);r.pathWorld=r.pathWorld.map(point);if(r.primitive)for(const k of ['radius','width','height'])if(r.primitive[k]!=null)r.primitive[k]*=scale;if(r.segments)r.segments=r.segments.map(s=>({...s,coordinates:s.coordinates.map(v=>v*scale)}));if(r.knots)r.knots=r.knots.map(p=>p.map(v=>v*scale));}
 return out;
}
