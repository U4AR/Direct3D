import test from 'node:test';import assert from 'node:assert/strict';import {hollowRevolveSection} from '../src/hollow-revolve.js';
const line=(a,b)=>[...a,...a.map((v,k)=>v+(b[k]-v)/3),...a.map((v,k)=>v+2*(b[k]-v)/3),...b];
for(const reverse of [false,true])test('open cap retains a cavity and 3mm walls, reversed='+reverse,()=>{
 let points=[[.05,0],[.05,.1],[0,.1]];if(reverse)points.reverse();
 const section=hollowRevolveSection({kind:'spline',closed:false,origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,1,0],segments:points.slice(1).map((p,i)=>line(points[i],p))},{axis:'vertical',axisOriginUV:[0,0],wallThicknessMetres:.003,angleDegrees:360});
 const expected=Math.PI*(.05**2*.1-.047**2*.097);
 assert.ok(Math.abs(section.expectedVolumeMetres3/expected-1)<.01);
 assert.ok(section.segments.every(s=>s[1]>=0&&s[7]>=0));
});

test('a small retraced tip in an outer wall is removed only from its derived section',()=>{
 const shape=[[.07,0],[.07,.08],[.0708,.079],[.068,.0795],[.068,.1],[0,.1]];
 const source={kind:'spline',closed:false,origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,1,0],segments:shape.slice(1).map((p,i)=>line(shape[i],p))};
 const original=structuredClone(source);
 const section=hollowRevolveSection(source,{axis:'vertical',angleDegrees:360,wallThicknessMetres:.003});
 assert.ok(section.expectedVolumeMetres3>0);assert.deepEqual(source,original);
});
test('a large crossed meridian is rejected before the native CAD worker runs',()=>{
 const shape=[[.07,0],[.03,.08],[.07,.08],[.03,.02],[0,.1]];
 const source={kind:'spline',closed:false,origin:[0,0,0],xAxis:[1,0,0],yAxis:[0,1,0],segments:shape.slice(1).map((p,i)=>line(shape[i],p))};
 assert.throws(()=>hollowRevolveSection(source,{axis:'vertical',angleDegrees:360,wallThicknessMetres:.003}),/across itself/);
});
