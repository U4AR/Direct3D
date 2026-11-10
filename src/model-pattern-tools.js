import * as T from 'three';

const MAX_VERTICES = 500000;
const MAX_TRIANGLES = 1000000;
const vec = (value, name) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw Error(`${name} must be finite XYZ`);
  return new T.Vector3(...value);
};
const direction = (value, name) => {
  const v = vec(value, name);
  if (v.lengthSq() < 1e-20) throw Error(`${name} must be nonzero`);
  return v.normalize();
};
function meshCheck(mesh) {
  const {vertices, indices} = mesh;
  if (!vertices || !indices || vertices.length < 9 || vertices.length % 3 || indices.length < 3 || indices.length % 3 || !Array.from(vertices).every(Number.isFinite) || !Array.from(indices).every(i => Number.isInteger(i) && i >= 0 && i < vertices.length / 3)) throw Error('A valid finite indexed triangle mesh is required');
  if (vertices.length / 3 > MAX_VERTICES || indices.length / 3 > MAX_TRIANGLES) throw Error('Mesh exceeds bounded pattern geometry limits');
}
export function transformPatternMesh(mesh, matrix) {
  meshCheck(mesh);
  if (!(matrix instanceof T.Matrix4) || !matrix.elements.every(Number.isFinite) || Math.abs(matrix.determinant()) < 1e-15) throw Error('A finite nonsingular transform is required');
  const vertices = [], indices = Array.from(mesh.indices), point = new T.Vector3();
  for (let i = 0; i < mesh.vertices.length; i += 3) vertices.push(...point.fromArray(mesh.vertices, i).applyMatrix4(matrix).toArray());
  // Reflections reverse orientation. Correct winding to preserve outward-facing triangles.
  if (matrix.determinant() < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  return {vertices, indices};
}
export function mirrorMatrix(planeOrigin, planeNormal) {
  const o = vec(planeOrigin, 'planeOrigin'), n = direction(planeNormal, 'planeNormal'), {x,y,z} = n, d = 2 * n.dot(o);
  return new T.Matrix4().set(1-2*x*x, -2*x*y, -2*x*z, d*x, -2*y*x, 1-2*y*y, -2*y*z, d*y, -2*z*x, -2*z*y, 1-2*z*z, d*z, 0,0,0,1);
}
function merge(meshes) {
  const vertices = [], indices = [];
  for (const mesh of meshes) {
    const offset = vertices.length / 3;
    if (offset + mesh.vertices.length / 3 > MAX_VERTICES || (indices.length + mesh.indices.length) / 3 > MAX_TRIANGLES) throw Error('Pattern exceeds 500000 vertices or 1000000 triangles; use fewer copies or simpler source geometry');
    for (const v of mesh.vertices) vertices.push(v);
    for (const index of mesh.indices) indices.push(index + offset);
  }
  return {vertices, indices};
}
function countCheck(count) {
  if (!Number.isInteger(count) || count < 1 || count > 32) throw Error('Pattern count must be from 1 to 32 added copies');
}
function around(matrix, pivot, target = pivot) {
  return new T.Matrix4().makeTranslation(...target.toArray()).multiply(matrix).multiply(new T.Matrix4().makeTranslation(...pivot.clone().negate().toArray()));
}
function orientedFrame(normal, tangent) {
  const y = direction(normal, 'surface/source normal');
  let x;
  if (tangent) {
    x = vec(tangent, 'surface/source tangent');
    x.addScaledVector(y, -x.dot(y));
    if (x.lengthSq() < 1e-20) throw Error('Frame tangent must not be parallel to its normal');
    x.normalize();
  } else {
    x = new T.Vector3(Math.abs(y.x) < 0.8 ? 1 : 0, Math.abs(y.x) < 0.8 ? 0 : 1, 0);
    x.addScaledVector(y, -x.dot(y)).normalize();
  }
  return new T.Matrix4().makeBasis(x, y, new T.Vector3().crossVectors(x, y));
}
export function surfacePlacementMatrix({pivot, sourceNormal = [0,1,0], sourceTangent, point, normal, tangentU, normalOffsetMetres = 0}) {
  if (!Number.isFinite(normalOffsetMetres)) throw Error('normalOffsetMetres must be finite');
  const n = direction(normal, 'surface normal');
  const source = orientedFrame(sourceNormal, sourceTangent);
  const target = orientedFrame(normal, tangentU);
  const rotation = target.multiply(source.transpose());
  return around(rotation, vec(pivot, 'pivot'), vec(point, 'surface point').addScaledVector(n, normalOffsetMetres));
}
function uvSamples(options) {
  if (options.uvs) {
    if (!Array.isArray(options.uvs) || !options.uvs.length || options.uvs.length > 32 || options.uvs.some(uv => !Array.isArray(uv) || uv.length !== 2 || !uv.every(x => Number.isFinite(x) && x >= 0 && x <= 1))) throw Error('uvs must contain 1 to 32 normalized UV pairs');
    return options.uvs;
  }
  const grid = options.grid;
  if (!grid) throw Error('Surface patterns require uvs or grid');
  const {uCount, vCount, uRange = [0,1], vRange = [0,1]} = grid;
  countCheck(uCount); countCheck(vCount); countCheck(uCount * vCount);
  for (const range of [uRange,vRange]) if (!Array.isArray(range) || range.length !== 2 || !range.every(n => Number.isFinite(n) && n >= 0 && n <= 1) || range[0] > range[1]) throw Error('Grid ranges must be ascending normalized UV pairs');
  const result = [];
  for (let i=0;i<uCount;i++) for(let j=0;j<vCount;j++) result.push([uRange[0]+(uRange[1]-uRange[0])*(uCount===1 ? 0.5 : i/(uCount-1)),vRange[0]+(vRange[1]-vRange[0])*(vCount===1 ? 0.5 : j/(vCount-1))]);
  return result;
}
export async function buildPatternMesh(mesh, options, evaluateSurface) {
  meshCheck(mesh);
  const transforms = [], placements = [];
  const {mode, count} = options;
  if (mode === 'linear') {
    countCheck(count);
    const step = vec(options.stepMetres, 'stepMetres');
    if (step.lengthSq() < 1e-20) throw Error('Linear pattern step must be nonzero');
    for(let i=1;i<=count;i++) {
      const offset = step.clone().multiplyScalar(i);
      transforms.push(new T.Matrix4().makeTranslation(...offset.toArray()));
      placements.push({offsetMetres:offset.toArray()});
    }
  } else if (mode === 'circular') {
    countCheck(count);
    const pivot=vec(options.pivot, 'pivot'), axis=direction(options.axisDirection || [0,1,0], 'axisDirection');
    const step=options.angleStepDeg ?? 360/(count+1), start=options.startAngleDeg ?? step;
    if (![step,start].every(Number.isFinite) || Math.abs(step)>360000 || Math.abs(start)>360000 || Math.abs(step)<1e-10) throw Error('Finite nonzero angleStepDeg and finite startAngleDeg are required');
    for(let i=0;i<count;i++) {
      const angleDeg=start+i*step;
      transforms.push(around(new T.Matrix4().makeRotationAxis(axis,T.MathUtils.degToRad(angleDeg)),pivot));
      placements.push({angleDeg});
    }
  } else if (mode === 'surface') {
    if (typeof evaluateSurface !== 'function' || typeof options.surfaceId !== 'string' || !options.surfaceId) throw Error('Surface evaluator and surfaceId are required');
    vec(options.pivot, 'pivot');
    for(const [u,v] of uvSamples(options)) {
      const frame=await evaluateSurface(options.surfaceId,u,v,options.expectedSurfaceVersion);
      if (options.expectedSurfaceVersion !== undefined && frame.version !== undefined && frame.version !== options.expectedSurfaceVersion) throw Error('Surface version conflict');
      const point=frame.point || frame.position;
      transforms.push(surfacePlacementMatrix({...options,point,normal:frame.normal,tangentU:frame.tangentU}));
      placements.push({uv:[u,v],point,normal:frame.normal});
    }
  } else throw Error('Pattern mode must be linear, circular, or surface');
  if (mesh.vertices.length / 3 * transforms.length > MAX_VERTICES || mesh.indices.length / 3 * transforms.length > MAX_TRIANGLES) throw Error('Pattern geometry exceeds bounded limits; reduce copy count');
  return {...merge(transforms.map(matrix=>transformPatternMesh(mesh,matrix))),placements,count:transforms.length};
}

export function initModelPatternTools({models, ensure, refresh, store, persist, apply, evaluateSurface}) {
  function selected(args) {
    if (!Array.isArray(args.modelIds) || !args.modelIds.length || args.modelIds.length > 64 || new Set(args.modelIds).size !== args.modelIds.length) throw Error('Select 1 to 64 unique source model IDs');
    return args.modelIds.map(id=>{
      const model=models.get(id);
      if (!model) throw Error(`Source model not found: ${id}`);
      if (args.expectedVersions?.[id] !== model.version) throw Error(`Model version conflict: ${id}`);
      return model;
    });
  }
  function geometry(args) {
    return merge(selected(args).map(model=>{
      apply(model);
      model.mesh.updateWorldMatrix(true,false);
      return transformPatternMesh(model,model.mesh.matrixWorld);
    }));
  }
  async function run(args,operation) {
    // Load/refresh first: opening a native editor can restore newer versions.
    const api=await ensure('sculpt');
    await refresh();
    const source=geometry(args), expectedVersion=api.status().revision;
    let output;
    if (operation==='mirror') {
      if (args.copy === false) throw Error('Mirror preserves originals and creates copies; destructive replacement is not supported');
      output={...transformPatternMesh(source,mirrorMatrix(args.planeOrigin,args.planeNormal)),count:1};
    } else output=await buildPatternMesh(source,args,evaluateSurface);
    selected(args); // Surface evaluation may yield; do not import stale source geometry.
    const name=args.name || (operation==='mirror'?'Mirrored assembly':'Pattern assembly');
    const imported=api.importMesh({name,vertices:output.vertices,indices:output.indices,expectedVersion});
    store.log(`model.${operation}`,{modelIds:args.modelIds,count:output.count,name,result:imported});
    await refresh();
    await persist();
    const created=[...models.values()].find(m=>m.source==='sculpt' && m.nativeId===imported.id);
    return {modelId:created?.id || `sculpt::${imported.id}`,version:created?.version,nativeId:imported.id,sourceModelIds:args.modelIds,preservedOriginals:true,copyCount:output.count,vertexCount:output.vertices.length/3,triangleCount:output.indices.length/3,placements:output.placements,coordinateSystem:'world Y-up metres',note:'Copies are merged into one editable Sculpt mesh with disconnected components; they are not a welded or Boolean union. CAD sources retain their native features; copied geometry is a mesh.'};
  }
  return {mirror:args=>run(args,'mirror'),pattern:args=>run(args,'pattern')};
}
