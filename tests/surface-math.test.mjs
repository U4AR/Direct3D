import test from 'node:test';
import assert from 'node:assert/strict';
import {createSurface,evaluateSurface,fitSurface,sampleSurface,trimSurface,closestSurfaceUV} from '../src/surface-math.js';
const plane=()=>createSurface({controlNet:Array.from({length:4},(_,u)=>Array.from({length:4},(_,v)=>[u/3,v/3,0]))});
const near=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
test('cubic tensor surface has correct position, derivative normals and clamped boundaries',()=>{
 const s=plane(),e=evaluateSurface(s,.3,.7);e.point.forEach((x,i)=>near(x,[.3,.7,0][i]));e.normal.forEach((x,i)=>near(x,[0,0,1][i]));near(e.dU[0],1);near(e.dV[1],1);
 const uv=closestSurfaceUV(s,[.275,.675,.04]);near(uv.uv[0],.275);near(uv.uv[1],.675);near(uv.distance,.04);
 assert.throws(()=>evaluateSurface(s,2,0),/UV/);assert.throws(()=>createSurface({controlNet:[[[0,0,0]]]}),/rectangular/);
});
test('alternating regularized fit reconstructs curved samples with lower measured error',()=>{
 const s=plane(),points=[];for(let i=0;i<9;i++)for(let j=0;j<9;j++){const x=i/8,y=j/8;points.push([x,y,.035+.07*(x-.5)**2+.05*(y-.5)**2]);}
 const fit=fitSurface(s,points,{iterations:3,fairnessWeight:.001,anchorWeight:.00001,inlierThresholdMetres:.003});
 assert.ok(fit.diagnostics.final.all.rmsMetres<fit.diagnostics.baseline.all.rmsMetres*.05);
 assert.ok(fit.diagnostics.final.all.rmsMetres<.001);assert.ok(fit.diagnostics.final.inlierFraction>.95);
 assert.equal(s.version,1);assert.equal(fit.surface.version,2);near(s.controlNet[0][0][2],0);
 assert.ok(evaluateSurface(fit.surface,.5,.5).point[2]>.03);
});
test('locked control points are exact and fit does not discard outliers from all-sample metrics',()=>{
 const s=plane(),points=[[.2,.2,.03],[.5,.5,.03],[.8,.8,.03],[.5,.6,.1]];
 const f=fitSurface(s,points,{iterations:2,lockedControlPoints:[0,3,12,15],inlierThresholdMetres:.0001});
 for(const i of [0,3,12,15])assert.deepEqual(f.surface.controlNet.flat()[i],s.controlNet.flat()[i]);
 assert.equal(f.diagnostics.final.all.count,4);assert.ok(f.diagnostics.final.inliers.count<=4);
 assert.ok(f.diagnostics.final.all.rmsMetres<=f.diagnostics.baseline.all.rmsMetres);
});
test('loft and equation constructors interpolate sampled sections as editable cubic nets',()=>{
 const sections=Array.from({length:4},(_,i)=>[[i/3,0,i/12],[i/3,1,i/12]]),s=createSurface({kind:'loft',sections,profileSamples:4});
 for(let i=0;i<4;i++){const p=evaluateSurface(s,i/3,.5).point;near(p[0],i/3);near(p[1],.5);near(p[2],i/12);}
 const e=createSurface({kind:'equation',x:'u',y:'v',z:'height*(u^2+v^2)',parameters:{height:.1},uSamples:4,vSamples:4});near(evaluateSurface(e,.3,.7).point[2],.058);
 assert.throws(()=>createSurface({kind:'equation',x:'window.alert(1)',y:'v',z:'0'}),/Unknown|Unsupported|Unexpected/);
});
test('revolution produces curved cylinder geometry with bounded circular approximation',()=>{
 const s=createSurface({kind:'revolve',profile:[[1,0,-1],[1,0,1]],axisOrigin:[0,0,0],axisDirection:[0,0,1],profileSamples:4,angularSamples:10});
 for(let i=0;i<=20;i++){const p=evaluateSurface(s,i/20,.5).point;near(Math.hypot(p[0],p[1]),1,.006);near(p[2],0);}
 const a=evaluateSurface(s,0,.5).point,b=evaluateSurface(s,1,.5).point;a.forEach((v,i)=>near(v,b[i]));
 assert.match(s.metadata.note,/approximation/);
});
test('trim clips triangles to actual UV boundary rather than dropping crossing triangles',()=>{
 const s=trimSurface(plane(),{uvPolygon:[[.1,.1],[.9,.1],[.1,.9]]}),m=sampleSurface(s,{uSegments:7,vSegments:7});let area=0;
 for(let i=0;i<m.vertices.length;i+=3){const[x,y,z]=m.vertices.slice(i,i+3);assert.ok(x>=.1-1e-9&&y>=.1-1e-9&&x+y<=1+1e-9);near(z,0);}
 for(let i=0;i<m.indices.length;i+=3){const [a,b,c]=m.indices.slice(i,i+3).map(k=>m.vertices.slice(k*3,k*3+3));area+=((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;}
 near(area,.32);assert.equal(m.diagnostics.trimmed,true);
 const world=trimSurface(plane(),{worldPolygon:[[.1,.1,.004],[.9,.1,.004],[.1,.9,.004]]});near(world.trim.projectionMaxMetres,.004);
 assert.throws(()=>trimSurface(plane(),{uvPolygon:[[0,0],[1,1],[0,1],[1,0]]}),/intersects/);
 assert.throws(()=>trimSurface(plane(),{worldPolygon:[[0,0,1],[1,0,1],[0,1,1]]}),/too far/);
});
test('three-section loft retains its middle section and public tools preserve versions',async()=>{
 const sections=[[[0,0,0],[0,1,0]],[[.5,0,.2],[.5,1,.2]],[[1,0,0],[1,1,0]]];
 const surface=createSurface({kind:'loft',sections,profileSamples:4});near(evaluateSurface(surface,.5,.5).point[2],.2);
 const {initSurfaceTools}=await import('../src/surface-tools.js');const store={session:{revision:0},log(){},async flush(){}};
 const tools=initSurfaceTools({store,ensure(){throw Error('not used');},async refresh(){}});
 const created=await tools.dispatch('surface_create',{controlNet:plane().controlNet});
 const updated=await tools.dispatch('surface_update',{surfaceId:created.id,expectedVersion:1,name:'Edited'});
 assert.equal(updated.version,2);assert.equal(store.session.mathSurfaceHistory.length,1);
 assert.throws(()=>tools.evaluate(created.id,.5,.5,1),/version conflict/);
 assert.equal(tools.evaluate(created.id,.5,.5,2).version,2);
 await assert.rejects(()=>tools.dispatch('surface_update',{surfaceId:created.id,expectedVersion:1,name:'stale'}),/version conflict/);
});
