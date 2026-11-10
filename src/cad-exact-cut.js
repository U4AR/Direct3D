// Remus and OpenCascade exchange exact STEP operands when the primary kernel
// refuses a body operation. The editable feature stays in the native feature tree.
let factory;
export async function prepareExactCut(){
 if(!factory)factory=(async()=>{
  const [{default:init},response]=await Promise.all([import('./occt-wasm-DNj0ubLK.js'),fetch(new URL('/cad/assets/occt-wasm-gYVViyDS.wasm',location.href))]);
  if(!response.ok)throw Error('Could not load the exact-cut kernel');
  return init({wasmBinary:new Uint8Array(await response.arrayBuffer())});
 })().catch(e=>{factory=null;throw e;});
 return factory;
}
let engine;
export async function enableExactCut(){engine=await prepareExactCut();}
export function exactCut(remus,left,right,io,readStep,operation="cut"){
 if(!engine)return null;
 const step=id=>io.exportStep(remus.serializeSolids(Uint32Array.of(id)));
 const leftStep=step(left),rightStep=step(right);
 const cad=new engine.OcctKernel(),ids=[];
 try{
  const load=bytes=>{const h=cad.importStep(new TextDecoder().decode(bytes));ids.push(h);return h;};
  const a=load(leftStep),b=load(rightStep),before=cad.getVolume(a),toolVolume=cad.getVolume(b);
  const run=tool=>{const shape=operation==='fuse'?cad.fuse(a,tool):operation==='intersect'?cad.common(a,tool):cad.cut(a,tool);ids.push(shape);return shape;};
  const valid=shape=>{
   if(!cad.isValid(shape)||cad.subShapeCount(shape,'solid')!==1)return false;
   const v=cad.getVolume(shape),eps=Math.min(before,toolVolume)*1e-8;
   if(operation==='fuse')return v>before+eps&&v<=before+toolVolume+eps;
   if(operation==='intersect')return v>0&&v<=Math.min(before,toolVolume)+eps;
   return v>0&&v<before-eps;
  };
  let cut=run(b);
  if(!valid(cut)&&operation==='fuse'){
   // Aligned periodic seams can make the classifier split an actual union.
   // Recompute in a common oblique basis, then return to the document frame.
   const angle=Math.PI/6;
   const rotate=(shape,theta)=>{const h=cad.rotate(shape,0,0,0,1,1,1,theta);ids.push(h);return h;};
   const united=cad.fuse(rotate(a,angle),rotate(b,angle));ids.push(united);
   cut=rotate(united,-angle);
  }
  if(!valid(cut)&&operation==='cut'){
   // A cutter coincident with a periodic seam can report zero overlap. Retry
   // once at a sub-tessellation displacement, capped at one micron in STEP.
   const delta=Math.min(.001,Math.cbrt(Math.min(before,toolVolume))*1e-5);
   const shifted=cad.translate(b,delta,0,delta/2);ids.push(shifted);cut=run(shifted);
  }
  if(!valid(cut))throw Error(operation==='cut'?'The cutter did not remove material from a single valid body':operation==='fuse'?'The added material did not join the target into one solid':'The tool and target have no valid solid intersection');
  const simplified=cad.unifySameDomain(cut);ids.push(simplified);
  function adopt(shape){
   const file=cad.exportStep(shape),text=typeof file==='string'?file:new TextDecoder().decode(file);
   let adopted;
   try{adopted=readStep(remus,new TextEncoder().encode(text));}
   catch(error){
    if(!/PCURVE|pcurve|surface.curve/i.test(error.message))throw error;
    // STEP permits an edge to reference its 3D curve directly. Some readers
    // disagree about periodic UV curves at seams; retain the exact 3D curve.
    const curves=new Map([...text.matchAll(/#(\d+)\s*=\s*(?:SURFACE_CURVE|SEAM_CURVE)\s*\(\s*'[^']*'\s*,\s*#(\d+)/gi)].map(m=>[m[1],m[2]]));
    const edges=text.replace(/(EDGE_CURVE\s*\(\s*'[^']*'\s*,\s*#\d+\s*,\s*#\d+\s*,\s*)#(\d+)/gi,(all,start,id)=>curves.has(id)?start+'#'+curves.get(id):all);
    if(text===edges)throw error;
    adopted=readStep(remus,new TextEncoder().encode(edges));
   }
   if(adopted.solids.length!==1)throw Error('The operation must produce one connected solid');
   return adopted;
  }
  const shapes=valid(simplified)&&simplified!==cut?[simplified,cut]:[cut];
  let adopted,lastError;
  // Native STEP import uses an absolute boundary sampling tolerance. A unit
  // conversion changes sampling density without changing the exact surfaces.
  candidates: for(const shape of shapes)for(const factor of [1,.25,.05]){
   let candidate;
   try{
    const compact=factor===1?shape:cad.scale(shape,0,0,0,factor);
    if(factor!==1)ids.push(compact);
    candidate=adopt(compact);
    if(factor!==1){
     const n=1/factor;
     remus.transformSolid(candidate.solids[0],Float64Array.of(n,0,0,0,0,n,0,0,0,0,n,0,0,0,0,1));
    }
    const check=load(step(candidate.solids[0]));
    const expected=cad.getVolume(shape),difference=Math.abs(cad.getVolume(check)-expected);
    const bounds=cad.getBoundingBox(shape,false),imported=cad.getBoundingBox(check,false);
    // The mass integral changes slightly when a periodic face is reparameterized.
    // Bound that variation by the volume of a one-micron skin as well as the
    // measured relative error, and separately verify topology and placement.
    const allowance=Math.max(expected*1e-7,Math.min(expected*.0003,cad.getSurfaceArea(shape)*.001));
    const displacement=Math.max(...Object.keys(bounds).map(k=>Math.abs(bounds[k]-imported[k])));
    if(!valid(check)||difference>allowance||displacement>.01)throw Error(
     'Native STEP round-trip verification failed (valid='+cad.isValid(check)+', solids='+cad.subShapeCount(check,'solid')+
     ', volume error='+difference.toPrecision(3)+' / '+allowance.toPrecision(3)+', bounds error='+displacement.toPrecision(3)+')');
    adopted=candidate;break candidates;
   }catch(error){
    if(candidate)remus.deleteSolid(candidate.solids[0]);
    lastError=error;
    if(!/face-bound containment work|curve domain|endpoints|round-trip verification|pcurve/i.test(error.message))throw error;
   }
  }
  if(!adopted)throw lastError;
  return adopted.solids[0];
 }finally{for(const id of ids.reverse())cad.release(id);cad.delete();}
}

// Some STEP writers reparameterize a periodic face while serializing an
// otherwise valid boolean result. Verify the delivered file independently.
export function verifiedBooleanStep(text,doc,selected,build,remus,io,unit,measureVolume){
 if(!engine||selected.length!==1)return text;
 const feature=Object.values(doc.nodes).find(n=>n.kind==='feature'&&n.bodyId===selected[0]&&n.data?.featureKind==='boolean');
 if(!feature||feature.data.targetBodyIds?.length!==2)return text;
 const expectedVolume=measureVolume();
 const cad=new engine.OcctKernel(),owned=[];
 const own=h=>{owned.push(h);return h;};
 const checked=h=>cad.isValid(h)&&cad.subShapeCount(h,'solid')===1&&Math.abs(cad.getVolume(h)-expectedVolume)<=Math.max(1e-8,expectedVolume*.001);
 try{
  // Different STEP readers can interpret a native writer's periodic face
  // differently. Emit the OCCT representation that was actually validated.
  const canonicalFile=shape=>{
   if(!checked(shape))return null;
   const data=cad.exportStep(shape),result=typeof data==='string'?data:new TextDecoder().decode(data);
   return checked(own(cad.importStep(result)))?result:null;
  };
  const canonical=canonicalFile(own(cad.importStep(text)));
  if(canonical)return canonical;
  const operands=feature.data.targetBodyIds.map(id=>{
   const ids=build.shapes.get(id)?.solids;
   if(ids?.length!==1)throw Error('Cannot verify STEP without both exact boolean operands');
   const h=own(cad.importStep(new TextDecoder().decode(io.exportStep(remus.serializeSolids(Uint32Array.from(ids))))));
   return unit===1?h:own(cad.scale(h,0,0,0,unit));
  });
  const method={union:'fuse',subtract:'cut',intersect:'common'}[feature.data.operation];
  if(!method)throw Error('Unsupported STEP boolean operation');
  for(const angle of [0,Math.PI/6]){
   const rotate=(h,t)=>t?own(cad.rotate(h,0,0,0,1,1,1,t)):h;
   const shape=rotate(own(cad[method](...operands.map(h=>rotate(h,angle)))),-angle);
   const result=canonicalFile(shape);
   if(result)return result;
  }
  throw Error('STEP export did not preserve the verified solid and volume');
 }finally{for(const h of owned.reverse())cad.release(h);cad.delete();}
}
