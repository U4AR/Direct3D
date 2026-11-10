import { ShapeUtils, Vector2 } from "three";

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function segmentDistance(p, a, b) {
  const d = b.map((v, i) => v - a[i]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / (d[0] ** 2 + d[1] ** 2 || 1)));
  return distance(p, a.map((v, i) => v + d[i] * t));
}
function boundaryDistance(p, loop) {
  return Math.min(...loop.map((a, i) => segmentDistance(p, a, loop[(i + 1) % loop.length])));
}
const polygonArea = loop => loop.reduce((s,p,i)=>s+p[0]*loop[(i+1)%loop.length][1]-p[1]*loop[(i+1)%loop.length][0],0)/2;
function largestLoop(input) {
  let loop = input, removedLoopCount = 0, discardedAreaSquareMetres = 0;
  for (let pass = 0; pass < 128; pass++) {
    let crossing = null;
    for (let i=0;i<loop.length && !crossing;i++) for (let j=i+2;j<loop.length;j++) {
      if (i===0 && j===loop.length-1) continue;
      const a=loop[i],b=loop[(i+1)%loop.length],c=loop[j],d=loop[(j+1)%loop.length];
      if (!(cross(a,b,c)*cross(a,b,d)<-1e-20 && cross(c,d,a)*cross(c,d,b)<-1e-20)) continue;
      const r=[b[0]-a[0],b[1]-a[1]],q=[d[0]-c[0],d[1]-c[1]];
      const t=((c[0]-a[0])*q[1]-(c[1]-a[1])*q[0])/(r[0]*q[1]-r[1]*q[0]);
      const p=[a[0]+r[0]*t,a[1]+r[1]*t];
      crossing=[[p,...loop.slice(i+1,j+1)],[p,...loop.slice(j+1),...loop.slice(0,i+1)]];
      break;
    }
    if (!crossing) return {loop,removedLoopCount,discardedAreaSquareMetres};
    const areas=crossing.map(p=>Math.abs(polygonArea(p))),keep=areas[0]>=areas[1]?0:1;
    discardedAreaSquareMetres+=areas[1-keep];removedLoopCount++;
    loop=crossing[keep];
  }
  throw Error("Contour has too many intersections; divide it into smaller regions");
}
function checkSimple(loop) {
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    for (let j = i + 2; j < loop.length; j++) {
      if (i === 0 && j === loop.length - 1) continue;
      const c = loop[j], d = loop[(j + 1) % loop.length];
      if ((cross(a,b,c) * cross(a,b,d) < -1e-20 && cross(c,d,a) * cross(c,d,b) < -1e-20) ||
          segmentDistance(c,a,b) < 1e-9 || segmentDistance(d,a,b) < 1e-9 || segmentDistance(a,c,d) < 1e-9 || segmentDistance(b,c,d) < 1e-9)
        throw Error(`Contour self-intersects near segments ${i} and ${j}; split the stroke with sketch_project ranges before meshing`);
    }
  }
}

/** Builds watertight triangle meshes from measured projected contours, in world Y-up metres. */
export function meshProjection(projection, {
  pathIndices = projection.paths.map((_, i) => i), thicknessMetres = 0.005,
  smoothingIterations = 0, closureToleranceMetres = 0.01, selfIntersectionPolicy = "reject",
} = {}) {
  if (!Number.isFinite(thicknessMetres) || thicknessMetres <= 0 || thicknessMetres > 10) throw Error("Thickness must be positive metres, at most 10");
  if (!Number.isInteger(smoothingIterations) || smoothingIterations < 0 || smoothingIterations > 3) throw Error("Smoothing iterations must be 0 to 3");
  if (!Number.isFinite(closureToleranceMetres) || closureToleranceMetres < 0 || closureToleranceMetres > 1) throw Error("Closure tolerance must be 0 to 1 metres");
  if (!Array.isArray(pathIndices) || !pathIndices.length || new Set(pathIndices).size !== pathIndices.length || pathIndices.some(i => !Number.isInteger(i) || !projection.paths[i])) throw Error("Select unique existing projection path indices");
  if (!["reject", "largest-loop"].includes(selfIntersectionPolicy)) throw Error("Unknown self intersection policy");
  const f = projection.frame;
  if (!f || [f.origin, f.xAxis, f.yAxis, f.normal].some(v => !Array.isArray(v) || v.length !== 3 || v.some(x => !Number.isFinite(x)))) throw Error("Projection needs a valid metric plane frame");
  const dot = (a,b) => a.reduce((sum,x,i) => sum+x*b[i],0);
  if ([f.xAxis,f.yAxis,f.normal].some(a=>Math.abs(dot(a,a)-1)>1e-6) || Math.abs(dot(f.xAxis,f.yAxis))>1e-6 || Math.abs(dot(f.xAxis,f.normal))>1e-6 || Math.abs(dot(f.yAxis,f.normal))>1e-6) throw Error("Projection frame must be orthonormal");
  return pathIndices.map(pathIndex => {
    const path = projection.paths[pathIndex];
    if (path.points.length > 2048) throw Error("Contour has too many samples; split the region first");
    let loop = [];
    for (const p of path.points) {
      if (!Array.isArray(p) || p.length !== 2 || p.some(v => !Number.isFinite(v))) throw Error("Invalid contour coordinate");
      if (!loop.length || distance(loop.at(-1),p) > 1e-8) loop.push([...p]);
    }
    if (loop.length < 3) throw Error("Contour needs at least three distinct points");
    const closureGapMetres = distance(loop[0],loop.at(-1));
    if (closureGapMetres > closureToleranceMetres + 1e-9) throw Error(`Path ${pathIndex} is open by ${closureGapMetres.toFixed(5)} m; choose a closed region or explicitly increase closureToleranceMetres`);
    if (closureGapMetres < 1e-8) loop.pop();
    if (loop.length < 3) throw Error("Contour needs at least three distinct points");
    if (loop.length * 2 ** smoothingIterations > 4096) throw Error("Smoothed contour exceeds 4096 vertices; reduce smoothing or split the region");
    const original = loop.map(p=>[...p]);
    const repair = selfIntersectionPolicy === "largest-loop" ? largestLoop(loop) : {loop,removedLoopCount:0,discardedAreaSquareMetres:0};
    loop = repair.loop;
    checkSimple(loop);
    for (let step = 0; step < smoothingIterations; step++) {
      loop = loop.flatMap((p, i) => {
        const q = loop[(i+1)%loop.length];
        return [[p[0]*.75+q[0]*.25,p[1]*.75+q[1]*.25],[p[0]*.25+q[0]*.75,p[1]*.25+q[1]*.75]];
      });
    }
    checkSimple(loop);
    let area = loop.reduce((s,p,i)=>s+p[0]*loop[(i+1)%loop.length][1]-p[1]*loop[(i+1)%loop.length][0],0)/2;
    if (Math.abs(area) < 1e-10) throw Error("Contour encloses no usable area");
    if (area < 0) loop.reverse();
    area = Math.abs(area);
    const triangles = ShapeUtils.triangulateShape(loop.map(p=>new Vector2(...p)),[]);
    const triangleArea = triangles.reduce((sum,[a,b,c])=>sum+Math.abs(cross(loop[a],loop[b],loop[c]))/2,0);
    if (!triangles.length || Math.abs(triangleArea-area) > Math.max(1e-10,area*1e-5)) throw Error("Contour triangulation failed; split the region");
    const vertices = [], indices = [], n = loop.length;
    for (const depth of [-thicknessMetres/2,thicknessMetres/2])
      for (const p of loop) vertices.push(...f.origin.map((o,i)=>o+p[0]*f.xAxis[i]+p[1]*f.yAxis[i]+depth*f.normal[i]));
    for (let [a,b,c] of triangles) {
      if (cross(loop[a],loop[b],loop[c]) < 0) [b,c]=[c,b];
      indices.push(c,b,a,a+n,b+n,c+n);
    }
    for (let i=0;i<n;i++) {
      const j=(i+1)%n;
      indices.push(i,j,j+n,i,j+n,i+n);
    }
    const edges = new Map();
    for (let i=0;i<indices.length;i+=3) for (let j=0;j<3;j++) {
      const a=indices[i+j],b=indices[i+(j+1)%3],key=[a,b].sort((x,y)=>x-y).join(":");
      const edge=edges.get(key)||{count:0,orientation:0};
      edge.count++;edge.orientation+=a<b?1:-1;edges.set(key,edge);
    }
    if ([...edges.values()].some(e=>e.count!==2||e.orientation!==0)) throw Error("Contour produced a nonmanifold mesh; simplify or split the region");
    const forward = original.map(p=>boundaryDistance(p,loop));
    const reverse = loop.map(p=>boundaryDistance(p,original));
    return { vertices, indices, diagnostics: {
      pathIndex, strokeId:path.strokeId, sourceRange:{start:path.start,end:path.end},
      closureGapMetres, closureAdded:closureGapMetres>1e-8, smoothingIterations,
      selfIntersectionPolicy, removedLoopCount:repair.removedLoopCount, discardedAreaSquareMetres:repair.discardedAreaSquareMetres,
      contourRmsMetres:Math.sqrt(forward.reduce((s,d)=>s+d*d,0)/forward.length),
      contourMaxMetres:Math.max(...forward,...reverse),
      areaSquareMetres:area, volumeCubicMetres:area*thicknessMetres,
      thicknessMetres, vertexCount:vertices.length/3, triangleCount:indices.length/3,
      watertight:true, frame:structuredClone(f),
      note:"Contour extrusion centered on the projection plane. It preserves measured outline, not unobserved depth or holes. Smoothing changes outline; inspect the reported error and overlay before approval.",
    }};
  });
}
