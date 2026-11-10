import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {independentJugVariant,updateCapabilities,runMetaLoggedEvaluation} from '../scripts/test-meta-logged-harness.mjs';
const ids=['old','one','two','three','four'];
function log(id='source') {
 const evidence={
  strokes:ids.map((id,i)=>({id,ended:i,objectSpace:{frameId:'old-body'},objectAttachment:{modelId:'old-body'},surface:{modelId:'old-body'}})),
  frames:ids.map(id=>({layer:'stroke',strokeIds:[id],dataUrl:'unchanged-'+id})).concat([{layer:'scene',dataUrl:'unchanged-scene'}]),
  models:[{id:'old-body'}],selection:[{modelId:'old-body'}],
  spatialFit:{candidates:[{id:'old',sourceStrokeIds:['old']},{id:'new',sourceStrokeIds:['one','two']}],components:[{strokeIds:['old']},{strokeIds:['three','four']}],selectedId:'old',fittingContext:{target:'old-body'},regularization:{}},
  surfaceFeatureIntent:{modelId:'old-body'},
  modeling:{engines:{freecad:{ready:true,operations:['old']},blender:{ready:false,operations:['old']}}}
 };
 return {id,prompt:'Make a jug',turns:[{request:{prompt:'Make a jug',evidence}}]};
}
test('corrected independent drawing capture is explicitly labelled and leaves original log immutable',()=>{const original=log(),before=structuredClone(original),{evidence,variant}=independentJugVariant(original);assert.equal(variant.identicalReplay,false);assert.equal(variant.sourceRunId,'source');assert.deepEqual(original,before);assert.deepEqual(evidence.strokes.map(s=>s.id),ids.slice(1));assert.deepEqual(evidence.selection,before.turns[0].request.evidence.selection);assert.equal(evidence.designContext.frameId,'world');assert.equal(evidence.surfaceFeatureIntent,null);for(const s of evidence.strokes){assert.equal(s.objectSpace,undefined);assert.equal(s.objectAttachment,undefined);assert.equal(s.surface,null);assert.equal(s.drawingIntent.mode,'independent-part');}assert.deepEqual(evidence.spatialFit.candidates.map(c=>c.id),['new']);assert.equal(evidence.spatialFit.selectedId,'new');assert.equal(evidence.spatialFit.fittingContext,undefined);for(const frame of evidence.frames)assert.ok(before.turns[0].request.evidence.frames.some(f=>f.dataUrl===frame.dataUrl));assert.ok(!evidence.frames.some(f=>f.strokeIds?.includes('old')));});
test('capability refresh advertises only installed ready engines and includes smooth native pipe',()=>{const evidence=structuredClone(log().turns[0].request.evidence),original=structuredClone(evidence);updateCapabilities(evidence);assert.ok(evidence.modeling.engines.freecad.operations.includes('create_pipe'));assert.deepEqual(evidence.modeling.engines.blender,original.modeling.engines.blender);assert.deepEqual(evidence.strokes,original.strokes);});
test('dry-run reads only copied fixture logs and makes no provider request or geometry mutation',async()=>{const root=await fs.mkdtemp(path.join(tmpdir(),'draw3d-meta-proposal-')),input=path.join(root,'inputs'),output=path.join(root,'report');await fs.mkdir(input);const originalFetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Dry-run must not fetch');};try{for(const id of ['f819dc0d-2432-4194-b66c-5da845e97077','5a6ae9f1-0909-4f1f-a6f1-0d80f4180292','73aa55e7-0106-4f37-bc9c-1930e02aa8d2'])await fs.writeFile(path.join(input,id+'.json'),JSON.stringify(log(id)));const report=await runMetaLoggedEvaluation({inputDirectory:input,outputDirectory:output,execute:false});assert.equal(calls,0);assert.equal(report.planned.length,4);assert.match(report.mode,/no API/);assert.ok(report.planned.every(c=>c.variant.identicalReplay===false));assert.equal((await fs.readdir(root)).includes('sessions'),false);}finally{globalThis.fetch=originalFetch;await fs.rm(root,{recursive:true,force:true});}});
