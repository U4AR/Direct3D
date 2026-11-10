"""Apply saved Terra output to copied original BRep only; source volume is read only."""
import importlib.util,json,os,hashlib,shutil,uuid,time
spec=importlib.util.spec_from_file_location('w','/source/scripts/freecad-worker.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
proposal=json.load(open('/source/artifacts/terra-logged-harness/matching-threads-terra-medium.json'));edit=proposal['edit']['modelEdits'][0]
source='/data/modeling/freecad/c1ac0817-ea47-4b37-87ea-286d010f62eb';hashes={name:hashlib.sha256(open(source+'/'+name,'rb').read()).hexdigest() for name in ('model.brep','model.FCStd')}
root='/tmp/terra-thread';artifact=str(uuid.uuid4());os.makedirs(root+'/'+artifact);shutil.copyfile(source+'/model.brep',root+'/'+artifact+'/model.brep')
identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
doc={'schema':'draw3d.modeling.v1','targetId':'base','meshes':[{'id':'base','nativeSource':{'artifactId':artifact,'matrix':identity}}],'operations':[{'operation':edit['operation'],'parameters':edit['parameters'],'targetId':'base','toolIds':[],'name':edit['name']}]}
result=w.run(doc,root+'/result');before=w.Part.Shape();before.read(source+'/model.brep');after=w.Part.Shape();after.read(root+'/result/model.brep');added=after.cut(before)
# Exact un-hollowed original revolve envelope, for the neck's exterior only.
profile=[[0,0],[.075,0],[.085,.015],[.085,.13],[.08,.145],[.066,.17],[.066,.18],[0,.18]]
points=[w.fc([.016+x,.94+y,-.3]) for x,y in profile];wire=w.Part.makePolygon(points+[points[0]]);outer=w.Part.Face(wire).revolve(w.fc([.016,.94,-.3]),w.fc([0,1,0]),360)
expected_delta=after.Volume-before.Volume
attempts=[]
for tolerance in (0,.0001,.001):
 candidate=after.cut(before,tolerance);attempts.append({'toleranceMillimetres':tolerance,'valid':candidate.isValid(),'volumeMetres3':candidate.Volume/1e9,'matchesNetIncrease':abs(candidate.Volume-expected_delta)<max(.001,abs(expected_delta)*1e-5)})
 if attempts[-1]['valid'] and attempts[-1]['matchesNetIncrease']:
  added=candidate;break
else:added=None
# Independent exact annular clip excludes source shell with 0.1 micron radial gap.
# It proves external thread material in the measured cylindrical neck even if a
# coincident-face subtraction between serialized full shapes is unreliable.
axis=w.fc([0,1,0]);annulus=w.Part.makeCylinder(80,10,w.fc([.016,1.11,-.3]),axis).cut(w.Part.makeCylinder(66.0001,10,w.fc([.016,1.11,-.3]),axis))
old_neck_external=before.common(annulus);new_neck_external=after.common(annulus)
assert after.isValid() and len(after.Solids)==1 and expected_delta>1e-6
assert abs(old_neck_external.Volume)<1e-5 and new_neck_external.isValid() and new_neck_external.Volume>1e-6
external=added.cut(outer) if added is not None else None
assert all(hashlib.sha256(open(source+'/'+name,'rb').read()).hexdigest()==value for name,value in hashes.items())
bounds=w.native_bounds(added) if added is not None else None;externalbounds=w.native_bounds(external) if external is not None else None;bodybounds=w.native_bounds(after)
print('TERRA_THREAD_NATIVE '+json.dumps({'scope':'Saved first-bottle-thread proposal only on a temporary copy of exact original BRep; no cap/mating claim','proposalRunId':proposal['runId'],'geometryParametersUnchanged':True,'transportAdaptations':['Native BRep copied to isolated tmp artifact; synthetic target base and toolIds[] for worker transport only'],'originalArtifactId':'c1ac0817-ea47-4b37-87ea-286d010f62eb','originalSha256':hashes,'sourceBytesUnchanged':True,'valid':after.isValid(),'solids':len(after.Solids),'beforeVolumeMetres3':before.Volume/1e9,'afterVolumeMetres3':after.Volume/1e9,'netVolumeIncreaseMetres3':expected_delta/1e9,'totalAddedVolumeMetres3':added.Volume/1e9 if added is not None else None,'externalAddedVolumeMetres3':external.Volume/1e9 if external is not None else None,'fullSubtractionDiagnostics':attempts,'oldNeckExternalMaterialMetres3':old_neck_external.Volume/1e9,'newNeckExternalMaterialMetres3':new_neck_external.Volume/1e9,'neckExternalMeasurementRegion':{'center':[.016,1.115,-.3],'innerRadiusMetres':.0660001,'outerRadiusMetres':.08,'heightMetres':.01},'addedBounds':bounds,'externalAddedBounds':externalbounds,'finalBodyBounds':bodybounds,'neckNativeYRange':[1.11,1.12],'overhangAboveNeckMetres':max(0,bodybounds['max'][1]-1.12),'elapsedMs':result['elapsedMs'],'verification':result['verification']}),flush=True)
