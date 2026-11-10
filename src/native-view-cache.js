// Cache only deterministic native views. User POV and live ink images are captured separately.
export function nativeViewKey(models,reference,options={},selection){
 const values=Array.from(models.values());
 const bodies=values.map(m=>{m.mesh?.updateWorldMatrix?.(true,false);const material=m.mesh?.material;return {id:m.id,name:m.name,version:m.version,hidden:!!m.hidden,visible:m.mesh?.visible,artifact:m.blender?.artifactId,geometry:m.mesh?.geometry?.uuid,matrix:m.mesh?.matrixWorld?.toArray(),color:material?.color?.getHexString?.(),opacity:material?.opacity};});
 return JSON.stringify({bodies,reference:reference?.id||null,allViews:!!options.allViews,annotate:options.annotate,selection:options.allViews?null:selection?{modelId:selection.modelId,kind:selection.kind,edgeIndices:selection.edgeIndices,faceIndices:selection.faceIndices}:null});
}
export function createNativeViewCache(limit=4){
 const entries=new Map();const stats={hits:0,misses:0,renders:0,renderMs:0,lastMs:0,lastHit:false};
 return {stats,async get(key,render){const start=performance.now();if(entries.has(key)){stats.hits++;stats.lastHit=true;const value=entries.get(key);entries.delete(key);entries.set(key,value);const result=await value;stats.lastMs=performance.now()-start;return structuredClone(result);}
  stats.misses++;stats.lastHit=false;const promise=Promise.resolve().then(render);entries.set(key,promise);while(entries.size>limit)entries.delete(entries.keys().next().value);
  try{const result=await promise;stats.renders++;stats.renderMs+=performance.now()-start;return structuredClone(result);}catch(e){if(entries.get(key)===promise)entries.delete(key);throw e;}finally{stats.lastMs=performance.now()-start;}
 },clear(){entries.clear();}};
}
