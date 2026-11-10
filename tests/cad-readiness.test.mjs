import {test} from 'node:test';import assert from 'node:assert/strict';import {isCadDocument,waitForCadEditor} from '../src/cad-readiness.js';
test('the initial about:blank iframe is not an editor initialization',()=>{assert.equal(isCadDocument({getAttribute:()=>null,contentWindow:{location:{pathname:'blank'}}}),false);assert.equal(isCadDocument({getAttribute:()=>'/cad/index.html',contentWindow:{location:{pathname:'blank'}}}),false);});
test('CAD readiness waits for the real document and restoration, preserving the editor instance',async()=>{
 const api={document:()=>({projectId:'saved'})},frame={getAttribute:()=>'/cad/index.html',contentWindow:{location:{pathname:'blank'}},contentDocument:{querySelector:()=>false}};let tick=0;const progress=[];
 const result=await waitForCadEditor(frame,{onProgress:m=>progress.push(m),pause:async()=>{tick++;frame.contentWindow.location.pathname='/cad/index.html';frame.contentWindow.__draw3dCAD=api;frame.contentDocument.querySelector=()=>tick===1;}});assert.equal(result,api);assert.equal(tick,2);assert.ok(progress.some(m=>m.includes('Restoring')));
});
test('a failed CAD launch gives a retry instruction without clearing saved work',async()=>{await assert.rejects(waitForCadEditor({getAttribute:()=>null},{timeoutMs:0}),/Retry CAD.*saved work is kept/);});
