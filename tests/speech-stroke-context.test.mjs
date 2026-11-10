import test from 'node:test';
import assert from 'node:assert/strict';
import {speechStrokeContext,speechFigureIds} from '../src/speech-stroke-context.js';
const strokes=[[12695,22886],[48175,49852],[51006,57239],[124022,128358],[129487,131094]].map(([started,ended],i)=>({id:'s'+i,started,ended,desktopSketchId:'front'}));
test('each recorded speech interval points at its drawing even after later strokes exist',()=>{
 const times=[[22921,28257],[50565,52327],[55168,56927],[124546,131077]];
 const sets=times.map(([start,end])=>speechStrokeContext({id:String(start),start,end},strokes,null,200000).strokeIds);
 assert.deepEqual(sets,[['s0'],['s1','s2'],['s2'],['s3','s4']]);
});
test('an unassociated instruction has no guessed future stroke; archived ink resolves to its current figure',()=>{
 const input=speechStrokeContext({start:68000,end:70000},strokes,null,200000);
 assert.deepEqual(input.strokeIds,[]);
 assert.deepEqual(speechFigureIds({strokeIds:['s0']},[{id:'left'},{id:'deleted',hidden:true},{id:'right',strokeIds:['s2']}],
  [{figureId:'left',sourceStrokeIds:['s0']},{figureId:'deleted',sourceStrokeIds:['s0']}]),['left']);
});

test('VAD trailing eight milliseconds does not bind the next feature; short intentional strokes still count',()=>{
 const marks=[[9349,13389],[14878,16637],[17469,20957]].map(([started,ended],i)=>({id:'g'+i,started,ended}));
 const intervals=[[11237,14697],[15687,17477],[18316,20557]];
 assert.deepEqual(intervals.map(([start,end])=>speechStrokeContext({start,end},marks,null,end).strokeIds),[['g0'],['g1'],['g2']]);
 assert.deepEqual(speechStrokeContext({start:15100,end:16200},[...marks,{id:'tap',started:15450,ended:15500}],null,16200).strokeIds,['g1','tap']);
 assert.deepEqual(speechFigureIds({strokeIds:[],selectedFigureId:'selected'},[{id:'selected'},{id:'other'}],[]),['selected']);
});
