import {drawingIntentForStrokes} from './drawing-intent.js';
import * as T from 'three';
import {modelFrame} from './model-spatial.js';
const matrix=a=>new T.Matrix4().fromArray(a),point=(p,m)=>new T.Vector3(...p).applyMatrix4(m).toArray();
export function attachStroke(studio,stroke,worldPoint){
 if(!stroke.surface?.modelId)return;
 const models=studio.surfaceModels?.()||[],id=stroke.surface.modelId,m=models.find(m=>m.id===id&&!m.hidden);
 if(!m)return;const bounds=new T.Box3().setFromObject(m.mesh,true),distance=bounds.distanceToPoint(new T.Vector3(...worldPoint));
 if(!stroke.surface&&distance>Math.max(.03,bounds.getSize(new T.Vector3()).length()*.5))return;
 m.mesh.updateWorldMatrix(true,false);const inverse=m.mesh.matrixWorld.clone().invert();
 stroke.objectAttachment={modelId:m.id,frameId:'native:'+m.id,geometryVersion:m.geometryVersion||1,nativePoints:[],nativeToWorldAtDraw:m.mesh.matrixWorld.toArray(),placementSignature:m.mesh.matrixWorld.elements.join(','),cameraToNative:stroke.view?.cameraToWorld?inverse.clone().multiply(matrix(stroke.view.cameraToWorld)).toArray():null};
}
export function recordAttachedPoint(studio,stroke,p){const a=stroke.objectAttachment,m=a&&studio.surfaceModels?.().find(m=>m.id===a.modelId);if(!m)return;m.mesh.updateWorldMatrix(true,false);a.nativePoints.push(point(p,m.mesh.matrixWorld.clone().invert()));}
export function syncAttachedStrokes(studio,m){
 if(!studio.store?.session?.strokes)return;m.mesh.updateWorldMatrix(true,false);const signature=m.mesh.matrixWorld.elements.join(',');
 for(const s of studio.store.session.strokes){const a=s.objectAttachment;if(!a||a.modelId!==m.id||!a.nativePoints.length||a.placementSignature===signature)continue;
  s.points=a.nativePoints.map(p=>point(p,m.mesh.matrixWorld));a.placementSignature=signature;
  if(s.endView&&a.endCameraToNative)s.endView.cameraToWorld=m.mesh.matrixWorld.clone().multiply(matrix(a.endCameraToNative)).toArray();
  if(s.view&&a.cameraToNative)s.view.cameraToWorld=m.mesh.matrixWorld.clone().multiply(matrix(a.cameraToNative)).toArray();
  delete s.localFit;s.fitVersion=(s.fitVersion||0)+1;studio.strokeWorkflow?.restore(s);
  const old=studio.strokeMeshes.get(s.id),active=[...studio.active.values()].find(active=>active.stroke===s),base=old?.userData?.attachmentMatrix;
  a.currentNativeToWorld=m.mesh.matrixWorld.toArray();
  if(old&&base&&!active){old.matrixAutoUpdate=false;old.matrix.copy(m.mesh.matrixWorld).multiply(matrix(base).invert());old.matrixWorldNeedsUpdate=true;}
  else{if(old){old.removeFromParent();old.geometry.dispose();old.material.dispose();studio.strokeMeshes.delete(s.id);}const fresh=studio.addStrokeMesh(s);if(active)active.mesh=fresh;}
 }
 studio.surface?.syncPlacement?.(m);
}
export function designEvidence(e,models,preferredId,focusId){
 const intent=drawingIntentForStrokes(e.strokes,e.lastDeterministicCAD),list=[...models.values()],id=focusId||(intent.mode==='independent-part'?null:e.selectedSurface?.modelId||e.selection?.modelIds?.[0]||preferredId),focus=list.find(m=>m.id===id&&!m.hidden),frames=list.map(modelFrame);
 const strokes=(e.strokes||[]).map(s=>{const explicit=s.surface?.modelId||(['surface-feature','edit-part'].includes(s.drawingIntent?.mode)?s.objectAttachment?.modelId:null),m=list.find(m=>m.id===explicit);if(!m)return {...s,pointSpace:'world',objectSpace:undefined,objectAttachment:undefined};const frame=modelFrame(m),inverse=matrix(frame.worldToNative),a=s.objectAttachment;
  return {...s,pointSpace:'world',objectSpace:{modelId:m.id,frameId:frame.frameId,units:'metres',attached:!!a,points:a?.nativePoints?.length===s.points.length?structuredClone(a.nativePoints):s.points.map(p=>point(p,inverse)),fittedPath:s.fit?.selected?.path?.map(p=>point(p,inverse)),bounds:new T.Box3().setFromPoints(s.points.map(p=>new T.Vector3(...p).applyMatrix4(inverse))).getSize(new T.Vector3()).toArray(),note:'Use these native points for edits on this body; the outer world points are for scene images and free-world placement.'}};});
 return {...e,strokes,drawingIntent:intent,surfaceFeatureIntent:intent.mode==='independent-part'?null:e.surfaceFeatureIntent,liveApproximation:e.liveApproximation&&intent.mode==='independent-part'?{...e.liveApproximation,committedModelId:intent.currentDraftModelId}:e.liveApproximation,lastDeterministicCAD:intent.mode==='independent-part'&&intent.currentDraftModelId!==e.lastDeterministicCAD?.modelId?null:e.lastDeterministicCAD,designContext:focus?{modelId:focus.id,frameId:'native:'+focus.id,parameterSpace:'native geometry metres Y-up',placementOnlyChangesOnMove:true}: {frameId:'world',parameterSpace:'world metres Y-up'},coordinateFrames:{...e.coordinateFrames,world:{units:'metres',up:'Y',frameId:'world'},objects:frames}};
}
