// Draw3D native cubic spline support. CAD solids use exact Bézier/NURBS edges.
export function splineCurves(data:any,resolve:(v:any)=>number,id='spline'):any[]{
 if(!Array.isArray(data.segments)||!data.segments.length||data.segments.length>128)throw Error('Spline needs 1–128 cubic spans');
 const curves=data.segments.map((s:any)=>{if(!Array.isArray(s.points)||s.points.length!==8)throw Error('Each cubic span needs four XY control points');const p=s.points.map(resolve);if(!p.every(Number.isFinite))throw Error('Spline control points must be finite');return {kind:'bezier',a:{x:p[0],y:p[1]},controls:[{x:p[2],y:p[3]},{x:p[4],y:p[5]}],b:{x:p[6],y:p[7]},sourceObjectId:id};});
 for(let i=1;i<curves.length;i++){if(Math.hypot(curves[i].a.x-curves[i-1].b.x,curves[i].a.y-curves[i-1].b.y)>1e-7)throw Error('Spline spans must share endpoints');curves[i].a=curves[i-1].b;}
 if(data.closed){const a=curves[0].a,b=curves.at(-1).b;if(Math.hypot(a.x-b.x,a.y-b.y)>1e-7)curves.push({kind:'line',a:b,b:a,sourceObjectId:id});else curves.at(-1).b=a;}
 return curves;
}
export function splinePolyline(data:any,resolve:(v:any)=>number):{x:number,y:number}[]{
 const out=[];for(const c of splineCurves(data,resolve)){if(c.kind==='line'){out.push(c.a);continue;}for(let i=0;i<32;i++){const t=i/32,q=1-t;out.push({x:q*q*q*c.a.x+3*q*q*t*c.controls[0].x+3*q*t*t*c.controls[1].x+t*t*t*c.b.x,y:q*q*q*c.a.y+3*q*q*t*c.controls[0].y+3*q*t*t*c.controls[1].y+t*t*t*c.b.y});}}
 if(!data.closed)out.push(splineCurves(data,resolve).at(-1).b);return out;
}
