"""Read only BRep checks of synthetic Meta proposal outputs; no original artifacts."""
import json,os,FreeCAD as App,Part
report=json.load(open('/source/artifacts/meta-logged-harness/native-verification.json'))
root='/data/modeling/freecad'
def read(artifact):
 s=Part.Shape();s.read(os.path.join(root,artifact,'model.brep'));return s
def stats(s):return {'valid':s.isValid(),'solids':len(s.Solids),'volumeMetres3':s.Volume/1e9,'surfaceTypes':sorted(set(type(f.Surface).__name__ for f in s.Faces)),'edgeCurveTypes':sorted(set(type(e.Curve).__name__ for e in s.Edges))}
results={}
for case in report['cases']:
 if case['name'] in ('new-jug','smooth-handle'):results[case['name']]=stats(read(case['model']['artifactId']))
 if case['name']=='matching-threads':
  before,outer=read(case['before']['artifactId']),read(case['outer']['artifactId'])
  if case.get('error'):results['matching-threads']={'rejected':case['error'],'unchanged':case['before']==case['after']}
  else:
   after=read(case['after']['artifactId']);added=after.cut(before);external=after.cut(outer)
   results['matching-threads']={**stats(after),'totalAddedVolumeMetres3':added.Volume/1e9,'externalAddedVolumeMetres3':external.Volume/1e9,'baselineShellVolumeMetres3':before.Volume/1e9,'addedConfinedToOriginalOuterEnvelope':abs(external.Volume)<1e-5,'interpretation':'Kernel valid does not prove external thread engagement. Added material contained entirely inside old outer envelope is internal cavity material or buried thread.'}
assert results['new-jug']['valid'] and results['new-jug']['solids']==1
assert 'BSplineSurface' in results['smooth-handle']['surfaceTypes'] and results['smooth-handle']['solids']==1
assert results['matching-threads']['totalAddedVolumeMetres3']>1e-8
assert results['matching-threads']['externalAddedVolumeMetres3']<1e-14
print('META_NATIVE_MECHANICAL '+json.dumps(results),flush=True)
