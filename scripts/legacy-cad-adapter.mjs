// Compatibility for the original millimetre/Z-up primitive panel on server installs.
export function legacyCADDocument(d){
 if(d?.schema!=='draw3d.cad.v1'||!Array.isArray(d.operations)||!d.operations.length||d.operations.length>24)throw Error('Invalid CAD document');
 const finite=(n,min,max)=>{if(!Number.isFinite(n)||n<min||n>max)throw Error('CAD dimensions out of range');return n/1000;};
 const operations=[];for(const [i,item]of d.operations.entries()){
  const operation=item.operation||'add';if(!['add','cut','intersect'].includes(operation)||i===0&&operation!=='add')throw Error('Invalid CAD operation');
  const position=item.position||[0,0,0];if(!Array.isArray(position)||position.length!==3)throw Error('Position needs XYZ');const p=position.map(n=>finite(n,-2000,2000)),center=[p[0],p[2],-p[1]],id=i?'tool-'+i:'base';let kind,parameters={center};
  if(item.type==='box'){if(!Array.isArray(item.size)||item.size.length!==3)throw Error('Box needs XYZ sizes');kind='cube';parameters.sizeMetres=item.size.map(n=>finite(n,.1,2000));parameters.axes=[[1,0,0],[0,0,-1],[0,1,0]];}
  else if(item.type==='cylinder'){kind='cylinder';parameters.radiusMetres=finite(item.radius,.1,1000);parameters.heightMetres=finite(item.height,.1,2000);}
  else if(item.type==='sphere'){kind='sphere';parameters.radiusMetres=finite(item.radius,.1,1000);}else throw Error('Unknown CAD primitive');
  operations.push({operation:'create_'+kind,targetId:id,toolIds:[],name:item.type,parameters});if(i)operations.push({operation:{add:'union',cut:'difference',intersect:'intersect'}[operation],targetId:'base',toolIds:[id],name:operation,parameters:{}});
 }
 return {schema:'draw3d.modeling.v1',targetId:'base',meshes:[],operations};
}
export function legacyCADPreview(r){const b=r.metrics.bounds,v=r.vertices;return {id:r.artifactId,engine:'FreeCAD',version:r.version,units:'mm',volumeMm3:r.metrics.volumeMetres3*1e9,solids:r.metrics.solids,dimensionsMm:[b.max[0]-b.min[0],b.max[2]-b.min[2],b.max[1]-b.min[1]].map(n=>n*1000),mesh:{vertices:Array.from({length:v.length/3},(_,i)=>v.slice(i*3,i*3+3)),triangles:Array.from({length:r.indices.length/3},(_,i)=>r.indices.slice(i*3,i*3+3))}};}
