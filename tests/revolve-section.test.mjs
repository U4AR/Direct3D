import test from 'node:test';
import assert from 'node:assert/strict';
import {revolveSection} from '../src/revolve-section.js';

const line=(a,b)=>[...a,...a.map((v,i)=>(2*v+b[i])/3),...b.map((v,i)=>(2*v+a[i])/3),...b];
const ring=[[-.04,-.03],[.04,-.03],[.04,.01],[-.04,.05]];
const profile={kind:'spline',closed:true,origin:[.4,.3,.2],xAxis:[0,1,0],yAxis:[0,0,1],segments:ring.map((a,i)=>line(a,ring[(i+1)%ring.length]))};
test('a full revolve of an asymmetric outline uses both radial envelopes',()=>{
 const saved=structuredClone(profile);
 const section=revolveSection(profile,{axis:'horizontal',angleDegrees:360});
 let integral=0;
 for(const [x,r,,,,,z,q] of section.segments){
  assert.ok(r>=0&&q>=0);
  integral+=(z-x)*(r*r+q*r+q*q)/3;
 }
 // The outer boundary changes sides halfway along the rotation axis.
 const expected=.04*(.05**2+.05*.03+.03**2)/3+.04*.03**2;
 assert.ok(Math.abs(Math.abs(integral)/expected-1)<.001);
 assert.deepEqual(section.origin,profile.origin);assert.deepEqual(section.xAxis,profile.xAxis);
 assert.deepEqual(profile,saved);
});
test('partial turns cannot use the full-turn folding rule',()=>{
 assert.throws(()=>revolveSection(profile,{axis:'horizontal',angleDegrees:180}),/partial revolve/);
});

test('a rotated seam on a mirrored curved section retains the original cubics and translated axis',()=>{
 const half=[[0,0,0,.01,.01,.021,.02,.021],[.02,.021,.029,.021,.04,.011,.04,0]];
 const mirror=s=>[s[6],-s[7],s[4],-s[5],s[2],-s[3],s[0],-s[1]];
 const full=[...half,...half.map(mirror).reverse()],pivot=[.025,.013];
 const shifted=[...full.slice(1),full[0]].map(seg=>seg.map((v,k)=>v+pivot[k%2]));
 const section=revolveSection({...profile,segments:shifted},{axis:'horizontal',axisOriginUV:pivot,angleDegrees:360});
 assert.equal(section.segments.length,3);
 for(let i=0;i<2;i++)half[i].forEach((v,k)=>assert.ok(Math.abs(v-section.segments[i][k])<1e-12));
 assert.deepEqual(section.origin,profile.origin.map((v,k)=>v+profile.xAxis[k]*pivot[0]+profile.yAxis[k]*pivot[1]));
});
