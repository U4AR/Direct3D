import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {saveActivity,recentActivity} from '../scripts/session-activity.mjs';

test('retries and concurrent arrivals preserve one ordered copy of each event within a recording',async()=>{
 const original=process.env.SESSION_DIR,dir=await mkdtemp(path.join(tmpdir(),'draw3d-recording-'));
 process.env.SESSION_DIR=dir;
 try{
  const recording=randomUUID(),stream=randomUUID(),e=(seq,type,data)=>({seq,type,data,wallTime:'2026-10-01T12:00:00.000Z'});
  const first=e(255,'stroke.point',{point:[1,2,3]}),proposal=e(256,'decision.plane.proposed',{offset:-159}),fail=e(257,'decision.error',{message:'bad geometry'});
  await Promise.all([saveActivity(recording,{stream,events:[first,proposal]}),saveActivity(recording,{stream,events:[proposal,fail]})]);
  const ack=await saveActivity(recording,{stream,events:[proposal,fail]});
  assert.equal(ack.savedThrough,257);
  const {events,findings}=await recentActivity(recording);
  assert.deepEqual(events.map(e=>e.seq),[257,256]);assert.equal(findings[0].detail,'bad geometry');
  assert.deepEqual((await recentActivity(randomUUID())).events,[]);
  await assert.rejects(saveActivity(recording,{stream,events:Array(65).fill(fail)}));
 }finally{if(original===undefined)delete process.env.SESSION_DIR;else process.env.SESSION_DIR=original;await rm(dir,{recursive:true,force:true});}
});
