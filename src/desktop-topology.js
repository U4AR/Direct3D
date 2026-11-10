import * as T from 'three';
// Mesh topology shared by the desktop picker and tests. Welding joins duplicate face vertices.
export function meshTopology(geometry, angle=25){
 const position=geometry.attributes.position,index=geometry.index,faces=[],edges=new Map(),vertices=new Map();
 const vertex=i=>{const p=new T.Vector3().fromBufferAttribute(position,i),key=p.toArray().map(v=>Math.round(v*1e6)).join(',');if(!vertices.has(key))vertices.set(key,p);return key;};
 const count=index?index.count:position.count;
 for(let i=0;i<count;i+=3){const ids=[0,1,2].map(j=>vertex(index?index.getX(i+j):i+j)),p=ids.map(id=>vertices.get(id)),normal=new T.Vector3().subVectors(p[1],p[0]).cross(new T.Vector3().subVectors(p[2],p[0])).normalize(),face={ids,normal,neighbors:[]};const f=faces.push(face)-1;
  for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],key=[a,b].sort().join('|');if(!edges.has(key))edges.set(key,{a,b,faces:[]});edges.get(key).faces.push(f);}
 }
 const cosine=Math.cos(T.MathUtils.degToRad(angle)),creases=[];
 for(const edge of edges.values()){const [a,b]=edge.faces;if(edge.faces.length===2&&faces[a].normal.dot(faces[b].normal)>cosine){faces[a].neighbors.push(b);faces[b].neighbors.push(a);}else creases.push(edge);}
 const graph=new Map();creases.forEach((e,i)=>{for(const v of [e.a,e.b]){if(!graph.has(v))graph.set(v,[]);graph.get(v).push(i);}});
 function patch(start){const result=new Set([start]),queue=[start];for(let k=0;k<queue.length;k++)for(const n of faces[queue[k]].neighbors)if(!result.has(n)){result.add(n);queue.push(n);}return [...result];}
 function edgeChain(start){const result=new Set([start]),queue=[start];for(let k=0;k<queue.length;k++)for(const v of [creases[queue[k]].a,creases[queue[k]].b])if(graph.get(v).length===2)for(const n of graph.get(v))if(!result.has(n)){result.add(n);queue.push(n);}return [...result].map(i=>creases[i]);}
 return {faces,creases,vertices,patch,edgeChain};
}
export function nearestProjectedEdge(topology,matrix,camera,rect,pixel,maxPixels=18){
 let best=null;const screen=p=>{const v=p.clone().applyMatrix4(matrix).project(camera);return new T.Vector2(rect.left+(v.x+1)*rect.width/2,rect.top+(1-v.y)*rect.height/2);};
 topology.creases.forEach((edge,i)=>{const a=screen(topology.vertices.get(edge.a)),b=screen(topology.vertices.get(edge.b)),d=b.clone().sub(a),t=Math.max(0,Math.min(1,pixel.clone().sub(a).dot(d)/Math.max(1e-10,d.lengthSq()))),distance=pixel.distanceTo(a.addScaledVector(d,t));if(distance<=maxPixels&&(!best||distance<best.distance))best={index:i,distance};});return best;
}
