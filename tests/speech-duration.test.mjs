import test from 'node:test';
import assert from 'node:assert/strict';
import {speechSegments,MAX_CLIP_MS} from '../src/level-vad.js';
for(const neural of [true,false])test('bounded speech and pause rearming, neural='+neural,()=>{
 const clips=[];let starts=0,ends=0;
 const gate=speechSegments({onSpeechStart(){starts++;},onSpeechEnd(audio){ends++;clips.push(audio.length);},onVADMisfire(){ends++;},redemptionMs:480},{neural});
 const frame=new Float32Array(512);
 const send=(count,score)=>{for(let i=0;i<count;i++)gate.process(frame,score);};
 send(50,0);send(3,.95);send(20,0);assert.equal(starts,0);
 send(1000,.95);assert.equal(starts,1);assert.equal(ends,1);assert.equal(clips.length,neural?1:0);
 assert.ok(clips.every(n=>n/16<=MAX_CLIP_MS));
 send(5,0);send(20,.95);assert.equal(starts,1);
 send(20,0);send(12,.95);send(20,0);
 assert.equal(starts,2);assert.equal(ends,2);assert.equal(clips.length,neural?2:1);
});

test('end-of-speech keeps a short trailing pad without uploading the full pause',()=>{
 const clips=[];
 const gate=speechSegments({redemptionMs:750,onSpeechEnd:audio=>clips.push(audio),onSpeechStart(){}});
 const frame=new Float32Array(512);
 for(let i=0;i<12;i++)gate.process(frame,.9);
 for(let i=0;i<24;i++)gate.process(frame,0);
 assert.equal(clips.length,1);assert.equal(clips[0].length,18*512);
});
