// Select a complete connected line boundary instead of the native default first entity.
export function completeLineProfile(operation,payload,doc){
 if(operation!=="extrudeSketch"||payload.profile)return payload;
 const sketch=Object.values(doc.nodes||{}).find(n=>n.kind==="sketch"&&n.sketchId===payload.sketchId);
 const entities=(sketch?.objectIds||[]).map(id=>doc.nodes[id]);
 if(entities.length<3||entities.some(n=>n?.data?.objectKind!=="line"))return payload;
 const points=[],edges=[],tolerance=1e-6;
 const vertex=p=>{let i=points.findIndex(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<=tolerance);if(i<0){i=points.length;points.push(p);}return i;};
 for(const {data:d}of entities){if(![d.x1,d.y1,d.x2,d.y2].every(Number.isFinite))return payload;const e=[vertex([d.x1,d.y1]),vertex([d.x2,d.y2])];if(e[0]===e[1])throw Error("Zero-length profile edge; repair the sketch before extrusion");edges.push(e);}
 const degrees=points.map((_,i)=>edges.filter(e=>e.includes(i)).length);
 if(degrees.some(n=>n!==2))throw Error("Sketch line boundary is open or branched. Close it or supply an explicit extrusion profile; no feature was created.");
 const visited=new Set([0]);for(let pass=0;pass<points.length;pass++)for(const [a,b]of edges)if(visited.has(a)||visited.has(b)){visited.add(a);visited.add(b);}
 if(visited.size!==points.length)throw Error("Multiple disconnected line loops require an explicit extrusion profile; no feature was created.");
 return {...payload,profile:{all:true,sourceEntityIds:entities.map(n=>n.id)}};
}
