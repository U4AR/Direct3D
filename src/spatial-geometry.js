import * as T from 'three';
import {createSurface,sampleSurface} from './surface-math.js';
import {validateSpatialParameters} from './spatial-edit-contract.js';
// Parameters stay editable; display tessellation is regenerated after each parameter edit.
export function spatialGeometry(kind,p){
 validateSpatialParameters(kind,p);let geometry;
 if(kind==='plane')geometry=new T.PlaneGeometry(p.sizeMetres[0],p.sizeMetres[1]);
 else if(kind==='rectangle3d'){
  const [w,h]=p.sizeMetres,curve=new T.CurvePath(),corners=[[-w/2,-h/2,0],[w/2,-h/2,0],[w/2,h/2,0],[-w/2,h/2,0]];
  for(let i=0;i<4;i++)curve.add(new T.LineCurve3(new T.Vector3(...corners[i]),new T.Vector3(...corners[(i+1)%4])));
  geometry=new T.TubeGeometry(curve,64,Math.max(.0004,Math.min(.002,Math.min(w,h)*.004)),6,true);
 }
 else if(kind==='extrusion'){
  geometry=p.profileKind==='circle3d'?new T.CylinderGeometry(p.radiusMetres,p.radiusMetres,p.depthMetres,48,1,false).rotateX(Math.PI/2):new T.BoxGeometry(p.sizeMetres[0],p.sizeMetres[1],p.depthMetres);
  geometry.translate(0,0,p.depthMetres/2);
 }
 else if(kind==='cuboid')geometry=new T.BoxGeometry(...p.sizeMetres);
 else if(kind==='profileExtrusion'){const shape=new T.Shape(p.profilePoints.map(v=>new T.Vector2(...v)));shape.closePath();geometry=new T.ExtrudeGeometry(shape,{depth:p.depthMetres,bevelEnabled:false,steps:1});}
 else if(kind==='revolved')geometry=new T.LatheGeometry([[0,p.profilePoints[0][1]],...p.profilePoints,[0,p.profilePoints.at(-1)[1]]].map(v=>new T.Vector2(...v)),64,0,p.angleDeg*Math.PI/180);
 else if(kind==='ellipse3d'){const curve=new T.EllipseCurve(0,0,p.radiiMetres[0],p.radiiMetres[1],0,Math.PI*2);const path=new T.CatmullRomCurve3(curve.getPoints(96).map(v=>new T.Vector3(v.x,v.y,0)),true);geometry=new T.TubeGeometry(path,96,.0007,6,true);}
 else if(kind==='spheroid'||kind==='ellipsoid'){geometry=new T.SphereGeometry(1,40,24);geometry.scale(...p.radiiMetres);}
 else if(kind==='cylinder')geometry=new T.CylinderGeometry(p.radiusMetres,p.radiusMetres,p.heightMetres,48,1,false);
 else if(kind==='circle3d')geometry=new T.TorusGeometry(p.radiusMetres,Math.max(.0004,Math.min(.002,p.radiusMetres*.004)),6,96);
 else if(['line3d','polyline3d','sweep','spline3d'].includes(kind)){
  const points=p.points.map(p=>new T.Vector3(...p));if(p.closed&&points.length>2&&points[0].distanceTo(points.at(-1))<1e-8)points.pop();
  let curve;if(['line3d','polyline3d'].includes(kind)){curve=new T.CurvePath();for(let i=1;i<points.length;i++)curve.add(new T.LineCurve3(points[i-1],points[i]));if(p.closed)curve.add(new T.LineCurve3(points.at(-1),points[0]));}else curve=new T.CatmullRomCurve3(points,p.closed,'centripetal');const bounds=new T.Box3().setFromPoints(points),radius=Math.max(.0004,Math.min(.002,bounds.getSize(new T.Vector3()).length()*.002));
  geometry=new T.TubeGeometry(curve,Math.min(512,Math.max(32,points.length*8)),kind==='sweep'?p.radiusMetres:radius,kind==='sweep'?16:6,p.closed);
 }else{
  const mesh=sampleSurface(createSurface({kind:'control-net',...p}),{uSegments:24,vSegments:24});geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(mesh.vertices,3));geometry.setIndex(mesh.indices);geometry.computeVertexNormals();
 }
 if(p.axes&&p.center){const a=p.axes,mat=new T.Matrix4().makeBasis(...a.map(v=>new T.Vector3(...v)));mat.setPosition(...p.center);geometry.applyMatrix4(mat);}
 if(!geometry.index){const count=geometry.getAttribute('position').count;geometry.setIndex(Array.from({length:count},(_,i)=>i));}
 return geometry;
}
export function spatialMeshData(kind,p){const g=spatialGeometry(kind,p);try{return {vertices:Array.from(g.getAttribute('position').array),indices:Array.from(g.index.array)};}finally{g.dispose();}}
export function disposeSpatialPreview(group){for(const m of [...group.children]){m.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});group.remove(m);}}
export function spatialPreview(candidate){
 const g=spatialGeometry(candidate.kind,candidate.parameters),mesh=new T.Mesh(g,new T.MeshStandardMaterial({color:0x68c9ff,transparent:true,opacity:.18,depthWrite:false,side:T.DoubleSide}));
 const edges=new T.LineSegments(candidate.kind==='cuboid'?new T.EdgesGeometry(g):new T.WireframeGeometry(g),new T.LineBasicMaterial({color:0x68c9ff,transparent:true,opacity:.55,depthTest:true}));mesh.add(edges);mesh.userData.spatialCandidateId=candidate.id;return mesh;
}
