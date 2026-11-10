import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBlenderParameters,FREECAD_OPERATIONS,MODELING_PARAMETER_KEYS,validateBlenderEdits,nativeEditResponseSchema,BLENDER_PARAMETER_PROPERTIES} from '../src/blender-contract.js';
import {resolveNativeActionFrame} from '../src/native-action-frame.js';
import {nativeDimensionDescriptors,nativeDimensionChange} from '../src/native-dimensions.js';
import {validateFreeCADDocument} from '../scripts/freecad-bridge.mjs';

test('smooth and mechanical tools expose only executable bounded parameters',()=>{
 for(const operation of ['create_bspline','create_cone','mirror','body_pattern','draft','offset','thicken'])assert.ok(FREECAD_OPERATIONS.includes(operation));
 validateBlenderParameters('create_bspline',{center:[0,0,0],points3D:[[0,0,0],[0,0,.02],[.01,0,.04]],closed:false});
 assert.throws(()=>validateBlenderParameters('create_bspline',{center:[0,0,0],points3D:[[0,0,0],[0,0,0],[.01,0,.04]]}),/distinct/);
 assert.throws(()=>validateBlenderParameters('create_cone',{center:[0,0,0],radiusMetres:.01,topRadiusMetres:.01,heightMetres:.05}),/Cone/);
 assert.throws(()=>validateBlenderParameters('body_pattern',{patternType:'circular',count:4,direction:[0,1,0],angleDeg:360}),/pattern/);
 validateBlenderParameters('body_pattern',{patternType:'circular',count:4,direction:[0,1,0],pivot:[0,0,0],angleDeg:360});
 validateBlenderParameters('loft',{solid:false,ruled:false});
 validateBlenderParameters('sweep',{solid:true,frenet:true});
 validateBlenderParameters('draft',{angleDeg:5,faceIndices:[1],direction:[0,0,1],pivot:[0,0,0],neutralNormal:[0,0,1]});
 assert.throws(()=>validateBlenderParameters('draft',{angleDeg:90,faceIndices:[1],direction:[0,0,1],pivot:[0,0,0],neutralNormal:[0,0,1]}),/Draft/);
 validateBlenderParameters('offset',{distanceMetres:-.002});
 assert.throws(()=>validateBlenderParameters('thicken',{thicknessMetres:0}),/signed nonzero/);
 assert.throws(()=>validateBlenderParameters('loft',{widthMetres:.02}),/accepts only/);
 assert.ok(MODELING_PARAMETER_KEYS.create_bspline.includes('points3D'));
 validateBlenderParameters('create_sketch',{center:[0,0,0],profileType:'rounded_rectangle',widthMetres:.04,heightMetres:.02,cornerRadiusMetres:.01});
 assert.throws(()=>validateBlenderParameters('create_sketch',{center:[0,0,0],profileType:'rounded_rectangle',widthMetres:.04,heightMetres:.02,cornerRadiusMetres:.02}),/corner radius/);
 assert.throws(()=>validateBlenderParameters('create_sketch',{center:[0,0,0],radiusMetres:.01,profilePoints:[[0,0],[.01,0],[0,.01]]}),/exactly one/);
});
test('3D spline points stay relative to the creation datum through frame conversion',()=>{
 const model={id:'p',position:[5,0,0],blender:{features:[{operation:'create_cube',parameters:{center:[.2,.3,.4]}}]}};
 const edit=resolveNativeActionFrame({operation:'create_bspline',parameterFrame:'part',coordinateReference:{modelId:'p'},parameters:{center:[0,0,0],points3D:[[0,0,0],[0,.02,0],[.01,.04,0]]}},{models:[model]});
 assert.deepEqual(edit.parameters.center,[.2,.3,.4]);
 assert.deepEqual(edit.parameters.points3D,[[0,0,0],[0,.02,0],[.01,.04,0]]);
});
test('advanced mirror parameters never silently reach the Blender axis-only implementation',()=>{
 const e={engine:'blender',operation:'mirror',modelId:'p',expectedVersion:1,tools:[],parameters:{direction:[1,0,0],pivot:[0,0,0]},keepTools:false,name:'mirror'};
 assert.throws(()=>validateBlenderEdits([e],{modeling:{engines:{blender:{ready:true}}},models:[{id:'p',version:1}]}),/axis only/);
 const document={schema:'draw3d.modeling.v1',targetId:'p',meshes:[],operations:[{operation:'create_cone',targetId:'p',toolIds:[],name:'cone',parameters:{center:[0,0,0],radiusMetres:.02,topRadiusMetres:0,heightMetres:.05}}]};
 assert.doesNotThrow(()=>validateFreeCADDocument(document));
});

test('operation-scoped strict branches cut fillet output and preserve editable feature arguments',()=>{
 const schema=nativeEditResponseSchema({modeling:{engines:{freecad:{ready:true,operations:FREECAD_OPERATIONS}}},models:[{id:'p',blender:{features:[{operation:'create_cube'},{operation:'fillet'}]}}]}),branches=schema.anyOf.map(s=>({...s.properties.parameters,description:s.description}));
 const fillet=branches.find(s=>s.description==='fillet'),editFillet=branches.find(s=>s.description.includes('edit_modifier of fillet'));
 assert.deepEqual(Object.keys(fillet.properties),['widthMetres','edgeIndices']);
 assert.deepEqual(Object.keys(editFillet.properties),['featureIndex','widthMetres','edgeIndices']);
 assert.ok(!branches.some(s=>s.required.includes('featureIndex')&&s.required.includes('pitchMetres')),'no editable thread exists in this scene');
 assert.ok(nativeEditResponseSchema({modeling:{engines:{freecad:{ready:false},blender:{ready:false}}}}).properties.parameters.type==='object','offline engine schema remains valid');
 const all=Object.fromEntries(Object.keys(BLENDER_PARAMETER_PROPERTIES).map(k=>[k,null])),compact={edgeIndices:[1,2],widthMetres:.002};assert.ok(JSON.stringify(compact).length<JSON.stringify({...all,...compact}).length/10);
});

test('new profiles and signed native distances have editable dimensions without reversing direction',()=>{
 const model={blender:{metrics:{bounds:{min:[-.02,-.02,-.02],max:[.02,.02,.02]}},features:[{operation:'create_sketch',parameters:{profileType:'rounded_rectangle',widthMetres:.04,heightMetres:.02,cornerRadiusMetres:.01}},{operation:'thicken',parameters:{thicknessMetres:-.002}},{operation:'draft',parameters:{angleDeg:-5}}]}},d=nativeDimensionDescriptors(model),thickness=d.find(x=>x.parameter==='thicknessMetres'),draft=d.find(x=>x.parameter==='angleDeg');
 assert.ok(d.some(x=>x.parameter==='cornerRadiusMetres'));assert.equal(nativeDimensionChange(thickness,3,model.blender.features).thicknessMetres,-.003);assert.equal(nativeDimensionChange(draft,8,model.blender.features).angleDeg,-8);
});

test('schema binds operation and profile encoding so sketch cannot emit helix parameters or omit geometry',()=>{const schema=nativeEditResponseSchema({modeling:{engines:{freecad:{ready:true,operations:FREECAD_OPERATIONS}}}}),sketches=schema.anyOf.filter(b=>b.properties.operation.enum[0]==='create_sketch');assert.equal(sketches.length,6);for(const b of sketches){const p=b.properties.parameters;assert.equal(p.properties.pitchMetres,undefined);const selector=['radiusMetres','profilePoints','profileSegments','profileType'].find(k=>p.properties[k]);assert.ok(selector);assert.notEqual(p.properties[selector].type,'null');assert.ok(!p.properties[selector].anyOf?.some(s=>s.type==='null'));}const helix=schema.anyOf.find(b=>b.properties.operation.enum[0]==='create_helix');assert.equal(helix.properties.parameters.properties.profileSegments,undefined);});

test('one-action pipe keeps explicit geometry and editable section radius',()=>{
 const p={center:[0,0,0],points3D:[[0,0,0],[0,0,.02],[.005,.002,.04]],radiusMetres:.002,closed:false,frenet:true};
 assert.ok(FREECAD_OPERATIONS.includes('create_pipe'));assert.doesNotThrow(()=>validateBlenderParameters('create_pipe',p));assert.throws(()=>validateBlenderParameters('create_pipe',{...p,radiusMetres:0}),/positive/);assert.throws(()=>validateBlenderParameters('create_pipe',{...p,points3D:[[0,0,0],[0,0,0],[0,0,.02]]}),/distinct/);
 const model={blender:{metrics:{bounds:{min:[-.01,-.01,0],max:[.02,.02,.04]}},features:[{operation:'create_pipe',parameters:p}]}},d=nativeDimensionDescriptors(model).find(x=>x.parameter==='radiusMetres');assert.equal(d.title,'Diameter');assert.equal(nativeDimensionChange(d,6,model.blender.features).radiusMetres,.003);
});
