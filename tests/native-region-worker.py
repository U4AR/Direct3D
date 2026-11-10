"""Exact region and concurrent-region verification in an isolated, networkless FreeCAD worker."""
import importlib.util,json,os,math,uuid,hashlib
spec=importlib.util.spec_from_file_location('worker','/source/scripts/freecad-worker.py');worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
ROOT='/tmp/native-regions';os.makedirs(ROOT,exist_ok=True);results=[]
def op(kind,p,target='base',tools=[]):return {'operation':kind,'parameters':p,'targetId':target,'toolIds':tools,'name':kind}
def run(name,ops,**extras):
 id=str(uuid.uuid4());folder=os.path.join(ROOT,id);r=worker.run({'schema':'draw3d.modeling.v1','targetId':'base','meshes':[],'operations':ops,**extras},folder);assert r['metrics']['valid'];results.append({'name':name,'artifact':id,'volume':r['metrics']['volumeMetres3'],'solids':r['metrics']['solids'],'elapsedMs':r['elapsedMs']});return r,id
cube=op('create_cube',{'center':[.02,.04,-.01],'sizeMetres':[.1,.08,.06]});base,baseid=run('native source',[cube]);sourcepath=os.path.join(ROOT,baseid,'model.FCStd');original_digest=hashlib.sha256(open(sourcepath,'rb').read()).hexdigest()
box={'regionType':'box','center':[.045,.04,-.01],'sizeMetres':[.05,.08,.06]}
r,partid=run('copy exact boxed region',[cube,op('extract_region',box)]);assert abs(r['metrics']['volumeMetres3']-.05*.08*.06)<1e-12;assert r['verification']['independentRegion'];assert len(r['features'])==1;assert r['features'][0]['featureIndex']==0
project=worker.App.openDocument(os.path.join(ROOT,partid,'model.FCStd'));assert worker.saved_feature(project,0).Label=='extract_region';assert worker.feature_input(worker.saved_feature(project,0)).Shape.Volume>worker.saved_feature(project,0).Shape.Volume;worker.App.closeDocument(project.Name)
r,splitid=run('atomic split preserves exact source volume',[cube,op('split_region',box)]);part=r['parts'][0]['result'];assert part['metrics']['valid'];assert abs(r['metrics']['volumeMetres3']+part['metrics']['volumeMetres3']-base['metrics']['volumeMetres3'])<1e-12;assert abs(r['metrics']['bounds']['max'][0]-.02)<1e-10;assert abs(part['metrics']['bounds']['min'][0]-.02)<1e-10;assert r['verification']['region']['relativeConservationError']<1e-9
r,_=run('exact spherical halfspace',[op('create_sphere',{'center':[0,0,0],'radiusMetres':.03}),op('extract_region',{'regionType':'halfspace','pivot':[0,0,0],'direction':[1,0,0],'regionSide':'positive'})]);assert abs(r['metrics']['volumeMetres3']-2*math.pi*.03**3/3)<1e-12
r,_=run('extract native selected face surface',[cube,op('extract_region',{'regionType':'faces','faceIndices':[1]})]);assert r['metrics']['solids']==0;assert r['metrics']['faceCount']==1
r,_=run('extract individual solid from compound',[cube,op('body_pattern',{'patternType':'linear','count':2,'direction':[1,0,0],'spacingMetres':.2}),op('extract_region',{'regionType':'solids','solidIndices':[2]})]);assert r['metrics']['solids']==1;assert abs(r['metrics']['bounds']['min'][0]-.17)<1e-10
r,_=run('rotated box clips exact solid',[op('create_cube',{'center':[0,0,0],'sizeMetres':[1,1,1]}),op('extract_region',{'regionType':'box','center':[0,0,0],'sizeMetres':[.2,.3,.4],'axes':[[2**-.5,2**-.5,0],[-2**-.5,2**-.5,0],[0,0,1]]})]);assert abs(r['metrics']['volumeMetres3']-.2*.3*.4)<1e-12
hole=op('hole',{'center':[.02,.08,-.01],'direction':[0,-1,0],'radiusMetres':.005,'through':False,'depthMetres':.01});guard={'artifactId':baseid,'bounds':{'min':[.014,.069,-.016],'max':[.026,.081,-.004]}}
r,_=run('guard accepts local hole with exact influence',[cube,hole],collaborationValidation=guard);assert r['verification']['collaboration']['inside'];changed=r['verification']['collaboration']['changedBounds'];assert changed['max'][0]<.026;assert changed['min'][1]>.069
edge=base['metrics']['edges'][0];edge_bounds={'min':[v-.003 for v in edge['bounds']['min']],'max':[v+.003 for v in edge['bounds']['max']]}
r,_=run('guard accepts selected edge fillet',[cube,op('fillet',{'widthMetres':.002,'edgeIndices':[edge['index']]})],collaborationValidation={'artifactId':baseid,'bounds':edge_bounds});assert r['verification']['collaboration']['inside']
try:run('guard rejects all-edge spread',[cube,op('fillet',{'widthMetres':.002})],collaborationValidation={'artifactId':baseid,'bounds':edge_bounds});raise AssertionError('Global fillet accepted as local edge work')
except ValueError as error:assert 'Collaboration conflict' in str(error)
results.append({'name':'guard rejects all-edge spread','rejected':True})
r,_=run('guard checks immutable checkpoint input',[cube,hole],checkpoint={'artifactId':baseid,'operationCount':1},collaborationValidation=guard);assert r['verification']['collaboration']['changedBounds'] is not None
try:run('checkpoint cannot alias guard input',[cube,hole],checkpoint={'artifactId':baseid,'operationCount':1},collaborationValidation={'artifactId':baseid,'bounds':{'min':[-.03,0,-.04],'max':[-.02,.02,-.03]}});raise AssertionError('Checkpoint guard compared modified document to itself')
except ValueError as error:assert 'Collaboration conflict' in str(error)
results.append({'name':'checkpoint cannot alias guard input','rejected':True})

try:run('guard rejects remote change',[cube,hole],collaborationValidation={'artifactId':baseid,'bounds':{'min':[-.03,0,-.04],'max':[-.02,.02,-.03]}});raise AssertionError('Unclaimed native edit accepted')
except ValueError as error:assert 'Collaboration conflict' in str(error)
results.append({'name':'guard rejects remote change','rejected':True})
try:run('empty split',[cube,op('split_region',{'regionType':'box','center':[1,1,1],'sizeMetres':[.01,.01,.01]})]);raise AssertionError('Empty region accepted')
except ValueError as error:assert 'no valid geometry' in str(error)
results.append({'name':'empty split rejected','rejected':True})
try:run('whole body split',[cube,op('split_region',{'regionType':'box','center':[.02,.04,-.01],'sizeMetres':[1,1,1]})]);raise AssertionError('Whole body cut accepted')
except ValueError as error:assert 'no closed source remainder' in str(error)
results.append({'name':'whole-body split rejected','rejected':True})
assert hashlib.sha256(open(sourcepath,'rb').read()).hexdigest()==original_digest
for item in base['metrics']['edges']+base['metrics']['faces']:assert 'bounds' in item
print('NATIVE_REGION_RESULTS '+json.dumps(results),flush=True)
