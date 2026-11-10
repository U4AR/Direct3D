import test from 'node:test';import assert from 'node:assert/strict';import {incidentalHandTap,contextChangedError,waitForDrawingPause} from '../src/drawing-concurrency.js';
const tap={input:'left-hand',spatialRole:'edge',started:100,ended:132,points:[[0,0,0],[.0021,0,0],[.0042,0,0]]};
test('brief stationary hand pinches are filtered, intentional marks and small desktop strokes survive',()=>{assert.equal(incidentalHandTap(tap),true);for(const change of [{input:'pointer'},{input:'left-controller'},{spatialRole:'corner'},{ended:220},{points:[[0,0,0],[.03,0,0]]}])assert.equal(incidentalHandTap({...tap,...change}),false);});
test('stale state feedback explicitly confirms no geometry was applied',()=>{assert.deepEqual(contextChangedError('drawing').applicationFailure,{kind:'context_changed',reason:'drawing',unchanged:true});});
test('drawing-pause wait is immediate when idle and stoppable during a stroke',async()=>{assert.equal(await waitForDrawingPause({active:new Map()}),true);assert.equal(await waitForDrawingPause({active:new Map([['hand',{}]])},()=>true),false);});


test('AI waits for a held object even during slow movement and remains cancellable',async()=>{const studio={active:new Map(),objects:{grabbing:true}};assert.equal(await waitForDrawingPause(studio,()=>true),false);setTimeout(()=>studio.objects.grabbing=false,10);let shown=0;assert.equal(await waitForDrawingPause(studio,()=>false,()=>shown++),true);assert.equal(shown,1);});
