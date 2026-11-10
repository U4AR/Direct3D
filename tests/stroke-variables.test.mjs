import test from 'node:test';
import assert from 'node:assert/strict';
import {strokeAliases,initStrokeVariables} from '../src/stroke-variables.js';
import {questionOptionAt} from '../src/agent-question-panel.js';
test('stroke variables preserve independent immutable samples and stable identities',async()=>{
 const session={strokes:[{id:'a',points:[[0,0,0],[1,2,3]],color:'#fff'},{id:'b',points:[[2,0,0],[3,2,3]],color:'#000'}]};
 const store={session,flush:async()=>{}};const api=initStrokeVariables({store});
 assert.deepEqual(strokeAliases(session),{a:'s1',b:'s2'});
 await api.dispatch('stroke_load',{strokeIds:['a','b']});session.strokes[0].points[0][0]=7;
 assert.equal((await api.dispatch('math_evaluate',{expression:'s1.points[0][0]'})).value,0);
 assert.equal((await api.dispatch('math_evaluate',{expression:'mean(column(s2.points,0))',saveAs:'middle'})).value,2.5);
 assert.deepEqual((await api.dispatch('math_variables',{name:'s1',field:'points',start:1,count:1})).value,[[1,2,3]]);
 await assert.rejects(()=>api.dispatch('math_evaluate',{expression:'2',saveAs:'s1'}),/overwrite/);
 session.strokes.shift();session.strokes.push({id:'c',points:[[0,0,0],[1,1,1]]});
 assert.deepEqual(strokeAliases(session),{a:'s1',b:'s2',c:'s3'});
});
test('VR question choices match visible rectangles and reject blank space',()=>{
 assert.equal(questionOptionAt({x:0.5,y:1-350/720},4),0);
 assert.equal(questionOptionAt({x:0.5,y:1-565/720},4),3);
 assert.equal(questionOptionAt({x:0.5,y:0.9},4),null);
 assert.equal(questionOptionAt({x:0.5,y:1-565/720},2),null);
});
