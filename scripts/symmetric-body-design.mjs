// Construct a new section from landmarks authored by the model. The reference
// contributes its coordinate frame and extents; it supplies no outline knots.
export function designSymmetricSection(spec,reference,localPoints){
 const {axisDegrees,halfOutline,thicknessMetres,name}=spec;
 const revolved=spec.form==='revolve';
 if(revolved&&thicknessMetres!=null)throw Error('A solid of revolution takes its radius from the half outline. Leave extrusion thickness null.');
 if(typeof name!=='string'||!name.trim()||!Number.isFinite(axisDegrees)||(!revolved&&!(thicknessMetres>0&&thicknessMetres<=100)))throw Error('Specify a body name, axis and positive thickness in metres');
 if(!Array.isArray(halfOutline)||halfOutline.length<3||halfOutline.length>30)throw Error('Specify 3–30 ordered half-outline landmarks');
 for(const [i,p] of halfOutline.entries()){
  const tip=i===0||i===halfOutline.length-1;
  if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||Math.abs(p[0])>2||p[1]>2||(tip?Math.abs(p[1])>1e-7:p[1]<=0))throw Error('Half-outline endpoints lie on the axis; interior widths must be positive');
 }
 if(halfOutline[0][0]>=halfOutline.at(-1)[0])throw Error('Order the section from its negative axial end to its positive end');
 const angle=axisDegrees*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 const points=localPoints.map(([x,y])=>[x*c+y*s,-x*s+y*c]);
 const limits=[0,1].map(k=>{const values=points.map(p=>p[k]);return [Math.min(...values),Math.max(...values)];});
 const [length,width]=limits.map(([lo,hi])=>(hi-lo)/2);
 if(Math.min(length,width)<1e-6)throw Error('Reference lacks two measurable dimensions');
 const [u,v]=limits.map(([lo,hi])=>(hi+lo)/2);
 const {xAxis:x,yAxis:y}=reference;
 const xAxis=x.map((a,k)=>c*a+s*y[k]),yAxis=x.map((a,k)=>-s*a+c*y[k]);
 const knots=halfOutline.map(([a,w],i)=>[a*length,i===0||i===halfOutline.length-1?0:w*width]);
 knots.push(...knots.slice(1,-1).reverse().map(([a,w])=>[a,-w]));
 const n=knots.length;
 const handles=knots.map((p,i)=>{
  const prev=knots[(i+n-1)%n],next=knots[(i+1)%n];
  const dist=q=>Math.hypot(q[0]-p[0],q[1]-p[1]);
  const len=Math.min(dist(prev),dist(next))/3,dx=next[0]-prev[0],dy=next[1]-prev[1],d=Math.hypot(dx,dy);
  if(d<1e-9||len<1e-9)throw Error('Separate adjacent design landmarks');
  return [dx/d*len,dy/d*len];
 });
 const segments=knots.map((p,i)=>{const j=(i+1)%n,q=knots[j];return [...p,p[0]+handles[i][0],p[1]+handles[i][1],q[0]-handles[j][0],q[1]-handles[j][1],...q];});
 return {...reference,name,operation:'create',figureId:null,expectedVersion:null,construction:false,kind:'spline',closed:true,
  origin:reference.origin.map((a,k)=>a+u*xAxis[k]+v*yAxis[k]),xAxis,yAxis,segments,
  radiusMetres:null,widthMetres:null,heightMetres:null,startAngleDeg:null,endAngleDeg:null,end:null,extrusionMetres:revolved?null:thicknessMetres};
}
