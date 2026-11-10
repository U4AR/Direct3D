import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePCA,fitPrimitive} from '../src/primitive-fitting.js';
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} differs from ${b}`);
const center=[0.1,0.9,-0.3],u=[Math.SQRT1_2,Math.SQRT1_2,0],v=[0,0,1],normal=cross(u,v);
const world=(x,y,z=0)=>center.map((c,i)=>c+x*u[i]+y*v[i]+z*normal[i]);
const outliers=Array.from({length:20},(_,i)=>[0.5+0.03*i,-0.3+0.02*i,0.4+0.001*i*i]);

test('PCA identifies rotated planar and linear regions with orthonormal right-handed axes',()=>{
  const points=Array.from({length:100},(_,i)=>world((i%10-5)*0.04,(Math.floor(i/10)-5)*0.02));
  const p=analyzePCA(points);assert.equal(p.dimensionality,'planar');near(dot(p.axes[0],p.axes[1]),0);near(dot(cross(p.axes[0],p.axes[1]),p.axes[2]),1);near(Math.abs(dot(p.axes[2],normal)),1);near(p.extents[0].size,0.36);assert.ok(p.eigenvalues[0]>=p.eigenvalues[1]);
  const line=analyzePCA(Array.from({length:30},(_,i)=>world(i*0.01,0)));assert.equal(line.dimensionality,'linear');near(Math.abs(dot(line.axes[0],u)),1);
  assert.equal(analyzePCA([[1,2,3],[1,2,3]]).degenerate,true);
});
test('line and plane RANSAC reject spatial outliers and report original indices',()=>{
  const line=Array.from({length:80},(_,i)=>world(i*0.003,0));
  const fitted=fitPrimitive([...line,...outliers],{kind:'line',thresholdMetres:0.0001});assert.equal(fitted.inlierCount,80);near(Math.abs(dot(fitted.model.direction,u)),1);near(fitted.coverage,0.8);assert.ok(fitted.errors.rmsMetres>0.1);assert.ok(fitted.errors.inlierRmsMetres<1e-10);assert.deepEqual(fitted.inlierIndices,Array.from({length:80},(_,i)=>i));
  const plane=Array.from({length:100},(_,i)=>world((i%10)*0.01,Math.floor(i/10)*0.01));
  const result=fitPrimitive([...plane,...outliers],{kind:'plane',thresholdMetres:0.0001});assert.equal(result.inlierCount,100);near(Math.abs(dot(result.model.normal,normal)),1);
});
test('circle fits a tilted 3D contour, rejects outliers and plane-offset points',()=>{
  const ring=Array.from({length:100},(_,i)=>world(0.12*Math.cos(i*Math.PI/50),0.12*Math.sin(i*Math.PI/50)));
  const result=fitPrimitive([...ring,...outliers,world(0.12,0,0.01)],{kind:'circle',thresholdMetres:0.001});
  near(result.model.radiusMetres,0.12);result.model.center.forEach((x,i)=>near(x,center[i]));near(Math.abs(dot(result.model.normal,normal)),1);assert.equal(result.inlierCount,100);
  assert.deepEqual(result,fitPrimitive([...ring,...outliers,world(0.12,0,0.01)],{kind:'circle',thresholdMetres:0.001}));
});
test('sphere RANSAC recovers a true 3D sphere with outliers',()=>{
  const sphere=Array.from({length:120},(_,i)=>{const z=1-2*(i+0.5)/120,a=i*2.399963229728653,r=Math.sqrt(1-z*z);return center.map((c,k)=>c+0.08*[r*Math.cos(a),r*Math.sin(a),z][k]);});
  const fit=fitPrimitive([...sphere,...outliers],{kind:'sphere',thresholdMetres:0.001});assert.equal(fit.inlierCount,120);near(fit.model.radiusMetres,0.08);fit.model.center.forEach((x,i)=>near(x,center[i]));
});
test('cylinder identifies rotated axis and reports limited PCA hypothesis explicitly',()=>{
  const tube=Array.from({length:240},(_,i)=>{const a=(i%24)*Math.PI/12,h=(Math.floor(i/24)-4.5)*0.07;return world(0.04*Math.cos(a),0.04*Math.sin(a),h);});
  const fit=fitPrimitive(tube,{kind:'cylinder',thresholdMetres:0.001});near(fit.model.radiusMetres,0.04);near(Math.abs(dot(fit.model.direction,normal)),1);assert.equal(fit.coverage,1);near(fit.model.extentMetres[1]-fit.model.extentMetres[0],0.63);assert.match(fit.method,/limited axis estimate/);assert.match(fit.note,/not unrestricted/);
  const robust=fitPrimitive([...tube,...outliers],{kind:'cylinder',thresholdMetres:0.001,axisDirection:normal});assert.equal(robust.inlierCount,240);near(robust.model.radiusMetres,0.04);assert.match(robust.method,/provided-axis/);
});
test('rejects invalid settings and degenerate selections rather than fabricating geometry',()=>{
  assert.throws(()=>analyzePCA([[0,1,NaN],[0,0,0]]),/finite/);
  assert.throws(()=>fitPrimitive([[0,0,0],[1,0,0],[2,0,0]],{kind:'circle'}),/stable/);
  assert.throws(()=>fitPrimitive([[0,0,0],[1,0,0],[0,1,0],[1,1,0]],{kind:'sphere'}),/stable/);
  assert.throws(()=>fitPrimitive([[0,0,0],[0,0,0]],{kind:'line'}),/stable/);
  assert.throws(()=>fitPrimitive([[0,0,0],[1,0,0]],{kind:'line',thresholdMetres:0}),/threshold/);
  assert.throws(()=>fitPrimitive([[0,0,0],[1,0,0]],{kind:'line',iterations:100000}),/iterations/);
});
test('limits hypothesis sample count but computes coverage on every original point',()=>{
  const points=Array.from({length:9001},(_,i)=>[i*0.0001,0.9,0.1]);
  const fit=fitPrimitive(points,{kind:'line',thresholdMetres:0.001,iterations:16});assert.ok(fit.sampledPoints<=4000);assert.equal(fit.inlierIndices.length,9001);assert.ok(analyzePCA(points).sampledPoints<=4000);
});
