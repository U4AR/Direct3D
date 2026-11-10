import * as T from 'three';
import {surfaceFeaturePlan} from './surface-feature.js';
import {transformSpatialParameters} from './model-spatial.js';

// Keep analytic arcs, B-splines and standard profiles intact. A spatial polyline
// intermediary loses curvature and cannot represent these native parameters.
export function nativeSurfaceSketchPlan({parameters,referenceModel,body,strokes,sourceStrokeIds,depthMetres=.01}){
 body.mesh.updateWorldMatrix(true,false);referenceModel?.mesh.updateWorldMatrix(true,false);
 const matrix=body.mesh.matrixWorld.clone().invert().multiply(referenceModel?.mesh.matrixWorld||new T.Matrix4()),scale=new T.Vector3().setFromMatrixScale(matrix);
 if(Math.max(scale.x,scale.y,scale.z)-Math.min(scale.x,scale.y,scale.z)>1e-7)throw Error('A native curved sketch needs a uniform drawing-to-body scale; use the body native frame');
 const p=structuredClone(parameters),basis=p.axes||[[1,0,0],[0,1,0],[0,0,1]];
 p.center=new T.Vector3(...p.center).applyMatrix4(matrix).toArray();p.axes=basis.map(a=>new T.Vector3(...a).transformDirection(matrix).toArray());
 for(const key of ['radiusMetres','widthMetres','heightMetres','cornerRadiusMetres'])if(p[key]!=null)p[key]*=scale.x;
 if(p.profilePoints)p.profilePoints=p.profilePoints.map(a=>a.map(n=>n*scale.x));
 if(p.profileSegments)p.profileSegments=p.profileSegments.map(s=>({...s,points:s.points.map(a=>a.map(n=>n*scale.x))}));
 const ids=strokes.filter(s=>!s.archived&&s.surface?.modelId===body.id&&(!sourceStrokeIds?.length||sourceStrokeIds.includes(s.id))).map(s=>s.id);
 const guide={kind:'circle3d',sourceStrokeIds:ids,parameters:transformSpatialParameters({center:p.center,axes:p.axes,radiusMetres:.001},body.mesh.matrixWorld)},plan=surfaceFeaturePlan(guide,strokes,[body],{depthMetres});
 if(!plan)throw Error('Missing source surface for this additive sketch');
 const normal=plan.recipe[1].parameters.direction;
 if(Math.abs(new T.Vector3(...normal).dot(new T.Vector3(...p.axes[2])))<.999)throw Error('Native sketch plane must be parallel to its selected planar surface');
 p.center=plan.recipe[0].parameters.center;p.closed=true;
 return {...plan,recipe:[{operation:'create_sketch',parameters:p},{operation:'extrude',parameters:{distanceMetres:depthMetres,direction:normal}}]};
}
