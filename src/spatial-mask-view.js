import {maskProjector} from './spatial-mask-fit.js';
import * as T from 'three';
export async function drawMaskFitOverlays(report,frames){
 const overlays=[];
 for(const metric of report.metrics){const frame=frames.find(f=>f.id===metric.frameId),mask=report.masks.find(m=>m.frameId===metric.frameId);if(!frame||!mask)throw Error('Mask overlay source image is stale');
  const img=new Image();img.src=frame.image;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const c=canvas.getContext('2d');c.drawImage(img,0,0);
  const trace=poly=>{c.beginPath();poly.forEach((p,i)=>i?c.lineTo(p[0]*canvas.width,p[1]*canvas.height):c.moveTo(p[0]*canvas.width,p[1]*canvas.height));c.closePath();};
  trace(mask.polygon);c.fillStyle='#ffb45430';c.fill();c.lineWidth=2;c.strokeStyle='#ffb454';c.stroke();trace(metric.projectedContour);c.strokeStyle='#64e8ff';c.stroke();
  c.fillStyle='#101923dc';c.fillRect(0,0,canvas.width,42);c.fillStyle='#fff';c.font='12px sans-serif';c.fillText('Orange: ink selection · Cyan: fitted '+report.kind,8,16);c.fillText((Number.isFinite(report.finalSourceRmsMetres)?'Ink RMS '+(report.finalSourceRmsMetres*1000).toFixed(1)+' mm · ':'')+'selection overlap '+metric.silhouetteIoU.toFixed(2),8,33);
  overlays.push({id:crypto.randomUUID(),layer:'mask-fit-overlay',sourceFrameId:frame.id,view:frame.view,legend:'Orange is the region selected by the model; cyan is the actual tool-fitted object projection. Inspect against fresh spatial views before accepting.',image:canvas.toDataURL('image/png')});
 }
 return overlays;
}
export function clearMaskGroup(group){for(const child of [...group.children]){child.geometry?.dispose();child.material?.dispose();group.remove(child);}}
export function showMaskRegions(group,report,frames,center){
 clearMaskGroup(group);
 for(const mask of report.masks){const f=frames.find(f=>f.id===mask.frameId);if(!f)continue;const camera=new T.Matrix4().fromArray(f.view.cameraToWorld),inverseProjection=new T.Matrix4().fromArray(f.view.projectionMatrix).invert(),normal=new T.Vector3(0,0,1).transformDirection(camera),plane=new T.Plane().setFromNormalAndCoplanarPoint(normal,new T.Vector3(...center));
  const points=mask.polygon.map(([u,v])=>{const near=new T.Vector3(u*2-1,1-v*2,-1).applyMatrix4(inverseProjection).applyMatrix4(camera),far=new T.Vector3(u*2-1,1-v*2,1).applyMatrix4(inverseProjection).applyMatrix4(camera);return plane.intersectLine(new T.Line3(near,far),new T.Vector3());});if(points.some(p=>!p))continue;
  const line=new T.LineLoop(new T.BufferGeometry().setFromPoints(points),new T.LineBasicMaterial({color:0xffb454,transparent:true,opacity:.85,depthTest:false}));line.renderOrder=20;group.add(line);
  const indices=T.ShapeUtils.triangulateShape(mask.polygon.map(p=>new T.Vector2(...p)),[]).flat(),geometry=new T.BufferGeometry().setFromPoints(points);geometry.setIndex(indices);const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({color:0xffb454,transparent:true,opacity:.06,depthWrite:false,depthTest:false,side:T.DoubleSide}));mesh.renderOrder=19;group.add(mesh);
 }
}

// Keep the original camera, image dimensions and framing. Highlight selected
// source samples, not the generated object's silhouette or the mask's filled area.
export async function drawSelectedInkHighlights(report,frames,strokes){
 const results=[];
 for(const mask of report.masks){const source=frames.find(f=>f.id===mask.frameId);if(!source)throw Error('Selected ink image is stale');const project=maskProjector(source),image=new Image();image.src=source.image;await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const c=canvas.getContext('2d');c.fillStyle='#080f17';c.fillRect(0,0,canvas.width,canvas.height);c.globalAlpha=.25;c.drawImage(image,0,0);c.globalAlpha=1;
  const path=()=>{c.beginPath();mask.polygon.forEach((p,i)=>i?c.lineTo(p[0]*canvas.width,p[1]*canvas.height):c.moveTo(p[0]*canvas.width,p[1]*canvas.height));c.closePath();};
  c.save();path();c.clip();c.strokeStyle='#fff36b';c.fillStyle='#fff36b';c.lineCap='round';c.lineJoin='round';
  const right=new T.Vector3(1,0,0).transformDirection(new T.Matrix4().fromArray(source.view.cameraToWorld));let visibleSegments=0;
  for(const range of report.ranges){if(source.layer==='stroke'&&!source.strokeIds?.includes(range.strokeId))continue;const stroke=strokes.find(s=>s.id===range.strokeId);if(!stroke)continue;const points=stroke.points.slice(range.start,range.end+1);let previous=null;
   for(const p of points){const q=project(p);if(!q){previous=null;continue;}const edge=project(new T.Vector3(...p).addScaledVector(right,stroke.radius||.002).toArray());c.lineWidth=Math.max(3,Math.min(32,edge?Math.hypot((edge[0]-q[0])*canvas.width,(edge[1]-q[1])*canvas.height)*2:3));
    if(previous){c.beginPath();c.moveTo(previous[0]*canvas.width,previous[1]*canvas.height);c.lineTo(q[0]*canvas.width,q[1]*canvas.height);c.stroke();visibleSegments++;}else{c.beginPath();c.arc(q[0]*canvas.width,q[1]*canvas.height,c.lineWidth/2,0,Math.PI*2);c.fill();}previous=q;
   }
  }
  c.restore();path();c.strokeStyle='#ffb454';c.lineWidth=1;c.stroke();
  results.push({id:crypto.randomUUID(),layer:'region-ink-highlight',content:'selected-user-ink',sourceFrameId:source.id,imageSize:[canvas.width,canvas.height],view:source.view,strokeIds:report.selectedStrokeIds,selectedRanges:report.ranges,visibleSegments,legend:'Same exact POV, projection and framing as sourceFrameId. Yellow highlights only selected ORIGINAL USER INK sample ranges; unselected source ink is dim. This is not the fitted object. Compare it to the separate fit overlay and fresh model views.',image:canvas.toDataURL('image/png')});
 }
 return results;
}
export function showSelectedInk(group,report,strokes){
 clearMaskGroup(group);for(const range of report.ranges){const stroke=strokes.find(s=>s.id===range.strokeId),points=stroke?.points.slice(range.start,range.end+1);if(!points||points.length<2)continue;const line=new T.Line(new T.BufferGeometry().setFromPoints(points.map(p=>new T.Vector3(...p))),new T.LineBasicMaterial({color:0xffef58,depthTest:false}));line.renderOrder=21;group.add(line);}
}
