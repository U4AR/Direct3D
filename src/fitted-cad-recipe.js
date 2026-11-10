// Exact native feature recipes for supported recognized geometry. No model request.
export function fittedCADRecipe(candidate){const p=candidate.parameters,create=(operation,parameters)=>({operation,parameters}),axes=p.axes;
 if(candidate.kind==='cuboid')return [create('create_cube',{center:p.center,axes,sizeMetres:p.sizeMetres})];
 if(candidate.kind==='cylinder')return [create('create_cylinder',{center:p.center,axes,radiusMetres:p.radiusMetres,heightMetres:p.heightMetres})];
 if(candidate.kind==='spheroid'&&Math.max(...p.radiiMetres)-Math.min(...p.radiiMetres)<1e-6)return [create('create_sphere',{center:p.center,axes,radiusMetres:p.radiiMetres[0]})];
 if(candidate.kind==='rectangle3d'){const [w,h]=p.sizeMetres;return [create('create_sketch',{center:p.center,axes,profilePoints:[[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]],closed:true})];}
 if(candidate.kind==='circle3d')return [create('create_sketch',{center:p.center,axes,radiusMetres:p.radiusMetres,closed:true})];
 if(candidate.kind==='profileExtrusion')return [create('create_sketch',{center:p.center,axes,profilePoints:p.profilePoints,closed:true}),create('extrude',{direction:axes[2],distanceMetres:p.depthMetres})];
 if(candidate.kind==='revolved'){const first=p.profilePoints[0],last=p.profilePoints.at(-1);return [create('create_sketch',{center:p.center,axes,profilePoints:[[0,first[1]],...p.profilePoints,[0,last[1]]],closed:true}),create('revolve',{direction:axes[1],pivot:p.center,angleDeg:p.angleDeg})];}
 return null;
}
