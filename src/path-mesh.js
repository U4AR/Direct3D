import { Vector3, Quaternion } from "three";
const v = p => new Vector3(...p);
const finitePoint = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
function pointSegmentDistance(point, a, b) {
  const edge = v(b).sub(v(a)), offset = v(point).sub(v(a));
  const t = Math.max(0, Math.min(1, offset.dot(edge) / edge.lengthSq()));
  return offset.sub(edge.multiplyScalar(t)).length();
}
function pathDistance(point, path) {
  let result = Infinity;
  for (let i=1;i<path.length;i++) result=Math.min(result,pointSegmentDistance(point,path[i-1],path[i]));
  return result;
}
/** Capped triangle tube around an explicitly supplied world Y-up centreline, in metres. */
export function meshPath(points, { radiusMetres = 0.003, smoothingIterations = 0 } = {}) {
  if (!Array.isArray(points) || points.length < 2 || points.length > 1024 || points.some(p=>!finitePoint(p))) throw Error("Path needs 2 to 1024 finite world-metre XYZ points");
  if (!Number.isFinite(radiusMetres) || radiusMetres <= 0 || radiusMetres > 1) throw Error("Radius must be positive metres, at most 1");
  if (!Number.isInteger(smoothingIterations) || smoothingIterations < 0 || smoothingIterations > 2) throw Error("Smoothing iterations must be 0 to 2");
  let path = points.map(p=>[...p]);
  if (path.some((p,i)=>i && v(p).distanceTo(v(path[i-1]))<1e-8)) throw Error("Path has duplicate consecutive points; remove duplicates before thickening");
  if (v(path[0]).distanceTo(v(path.at(-1)))<1e-8) throw Error("Tube path must be open; closed tube loops are not supported");
  const original = path.map(p=>[...p]);
  for (let step=0;step<smoothingIterations;step++) {
    const smooth=[path[0]];
    for(let i=1;i<path.length;i++) {
      const a=path[i-1],b=path[i];
      smooth.push(a.map((x,j)=>x*.75+b[j]*.25),a.map((x,j)=>x*.25+b[j]*.75));
    }
    smooth.push(path.at(-1));path=smooth;
  }
  const sides=12;
  if(path.length*sides+2>4096) throw Error("Tube exceeds 4096 vertices; reduce smoothing or use a shorter path region");
  const directions=path.slice(1).map((p,i)=>v(p).sub(v(path[i])).normalize());
  const tangents=path.map((_,i)=>i===0?directions[0].clone():i===path.length-1?directions.at(-1).clone():directions[i-1].clone().add(directions[i]).normalize());
  if(tangents.some(t=>t.lengthSq()<.5) || directions.some((d,i)=>i && d.dot(directions[i-1])<-.95)) throw Error("Tube path reverses sharply; split this region instead");
  const axis=Math.abs(tangents[0].y)<.8?new Vector3(0,1,0):new Vector3(1,0,0);
  let normal=axis.cross(tangents[0]).normalize();
  const vertices=[],indices=[];
  for(let i=0;i<path.length;i++) {
    if(i) normal.applyQuaternion(new Quaternion().setFromUnitVectors(tangents[i-1],tangents[i]));
    normal.addScaledVector(tangents[i],-normal.dot(tangents[i])).normalize();
    const binormal=tangents[i].clone().cross(normal).normalize();
    for(let j=0;j<sides;j++) {
      const angle=j*2*Math.PI/sides;
      vertices.push(...v(path[i]).addScaledVector(normal,radiusMetres*Math.cos(angle)).addScaledVector(binormal,radiusMetres*Math.sin(angle)).toArray());
    }
  }
  for(let i=0;i<path.length-1;i++) for(let j=0;j<sides;j++) {
    const a=i*sides+j,b=i*sides+(j+1)%sides,c=b+sides,d=a+sides;
    indices.push(a,b,c,a,c,d);
  }
  const first=vertices.length/3,last=first+1,end=(path.length-1)*sides;
  vertices.push(...path[0],...path.at(-1));
  for(let j=0;j<sides;j++) {
    const next=(j+1)%sides;
    indices.push(first,next,j,last,end+j,end+next);
  }
  const forward=original.map(p=>pathDistance(p,path)),reverse=path.map(p=>pathDistance(p,original));
  const lengthMetres=path.slice(1).reduce((sum,p,i)=>sum+v(p).distanceTo(v(path[i])),0);
  return {vertices,indices,diagnostics:{
    radiusMetres,smoothingIterations,sourcePointCount:original.length,centrelinePointCount:path.length,
    lengthMetres,smoothingRmsMetres:Math.sqrt(forward.reduce((s,d)=>s+d*d,0)/forward.length),
    smoothingMaxMetres:Math.max(...forward,...reverse),vertexCount:vertices.length/3,triangleCount:indices.length/3,
    centrelineBounds:{min:[0,1,2].map(i=>Math.min(...path.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...path.map(p=>p[i])))},
    meshBounds:{min:[0,1,2].map(i=>Math.min(...vertices.filter((_,j)=>j%3===i))),max:[0,1,2].map(i=>Math.max(...vertices.filter((_,j)=>j%3===i)))},
    start:[...path[0]],end:[...path.at(-1)],watertightTopology:true,units:"metres",coordinateSystem:"world Y-up",
    note:"Capped 12-sided tube around the supplied centreline; endpoints preserved. Review bends for geometric self-overlap. Thickness and any inferred points are design assumptions, not recovered depth.",
  }};
}
