"""Run in the isolated FreeCAD container: real kernel tests, no API/key required."""
import importlib.util,json,os,math
spec=importlib.util.spec_from_file_location('worker','/source/scripts/freecad-worker.py');worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
serial=0;results=[]
def op(kind,p,target='base',tools=[]):return {'operation':kind,'parameters':p,'targetId':target,'toolIds':tools,'name':kind}
def run(name,ops):
 global serial
 serial+=1;r=worker.run({'schema':'draw3d.modeling.v1','targetId':'base','meshes':[],'operations':ops},'/tmp/cad-tools/'+str(serial));assert r['metrics']['valid'];results.append({'name':name,'metrics':{k:v for k,v in r['metrics'].items() if k not in ('faces','edges')},'elapsedMs':r['elapsedMs']});return r
cube=op('create_cube',{'center':[.03,0,0],'sizeMetres':[.02,.02,.02]})
r=run('native mirror',[cube,op('mirror',{'direction':[1,0,0],'pivot':[0,0,0]})]);assert abs(r['metrics']['bounds']['max'][0]+.02)<2e-10 # OCC optimal bounds may pad by 1e-10 metres
assert r['metrics']['solids']==1
r=run('linear body pattern',[cube,op('body_pattern',{'patternType':'linear','count':3,'direction':[0,1,0],'spacingMetres':.04})]);assert r['metrics']['solids']==3;assert abs(r['metrics']['volumeMetres3']-3*.02**3)<1e-12
r=run('circular body pattern',[cube,op('body_pattern',{'patternType':'circular','count':4,'direction':[0,0,1],'pivot':[0,0,0],'angleDeg':360})]);assert r['metrics']['solids']==4
r=run('cone',[op('create_cone',{'center':[0,0,0],'radiusMetres':.02,'topRadiusMetres':0,'heightMetres':.06})]);assert abs(r['metrics']['volumeMetres3']-math.pi*.02**2*.06/3)<1e-12
path=op('create_bspline',{'center':[0,0,0],'points3D':[[0,0,0],[0,0,.02],[.005,.002,.04],[.015,.008,.06]],'closed':False},'path')
r=run('3D B-spline sweep',[op('create_sketch',{'center':[0,0,0],'radiusMetres':.002}),path,op('sweep',{'solid':True,'frenet':True},tools=['path'])]);assert r['metrics']['solids']==1;assert r['metrics']['volumeMetres3']>0
r=run('smooth loft surface',[op('create_sketch',{'center':[0,0,0],'radiusMetres':.02}),op('create_sketch',{'center':[.005,0,.04],'radiusMetres':.01},'top'),op('loft',{'solid':False,'ruled':False},tools=['top'])]);assert r['metrics']['solids']==0;assert r['metrics']['faceCount']>0
r=run('periodic 3D spline',[op('create_bspline',{'center':[0,0,0],'points3D':[[.02,0,0],[0,.02,.005],[-.02,0,0],[0,-.02,-.005]],'closed':True})]);assert r['metrics']['edgeCount']==1
for profile,w,h,radius in [('rectangle',.04,.02,None),('rounded_rectangle',.04,.02,.01),('ellipse',.02,.04,None)]:
 p={'center':[0,0,0],'profileType':profile,'widthMetres':w,'heightMetres':h}
 if radius is not None:p['cornerRadiusMetres']=radius
 r=run(profile,[op('create_sketch',p),op('extrude',{'distanceMetres':.01,'direction':[0,0,1]})]);expected=(w*h if profile=='rectangle' else w*h-(4-math.pi)*radius**2 if profile=='rounded_rectangle' else math.pi*w*h/4)*.01;assert abs(r['metrics']['volumeMetres3']-expected)<1e-10
r=run('native face draft',[op('create_cube',{'center':[0,0,0],'sizeMetres':[.04,.03,.02]}),op('draft',{'faceIndices':[1,2,3,4],'direction':[0,0,1],'pivot':[0,0,-.01],'neutralNormal':[0,0,1],'angleDeg':5})]);assert r['metrics']['solids']==1;assert abs(r['metrics']['volumeMetres3']-.04*.03*.02)>1e-9
r=run('offset surface',[op('create_plane',{'center':[0,0,0],'sizeMetres':[.04,.03,0]}),op('offset',{'distanceMetres':.002})]);assert r['metrics']['solids']==0;assert abs(r['metrics']['bounds']['max'][2]-.002)<1e-9
r=run('thicken surface',[op('create_plane',{'center':[0,0,0],'sizeMetres':[.04,.03,0]}),op('thicken',{'thicknessMetres':.002})]);assert r['metrics']['solids']==1;assert abs(r['metrics']['volumeMetres3']-.04*.03*.002)<1e-12
pipe={'center':[.1,.2,-.3],'points3D':[[0,0,0],[0,0,.02],[.005,.002,.04],[.015,.008,.06]],'radiusMetres':.002,'closed':False,'frenet':True}
r=run('one action spline pipe',[op('create_pipe',pipe)]);assert r['metrics']['solids']==1;assert r['metrics']['volumeMetres3']>0;assert r['metrics']['bounds']['min'][0]>.09;assert r['metrics']['bounds']['min'][1]>.19;assert r['metrics']['bounds']['max'][2]<-.23
r=run('editable pipe radius',[op('create_pipe',{**pipe,'radiusMetres':.003})]);assert r['metrics']['solids']==1;assert r['metrics']['volumeMetres3']>1.5*results[-2]['metrics']['volumeMetres3']
r=run('closed pipe',[op('create_pipe',{'center':[0,0,0],'points3D':[[.02,0,0],[0,.02,0],[-.02,0,0],[0,-.02,0]],'radiusMetres':.002,'closed':True})]);assert r['metrics']['solids']==1;assert r['metrics']['watertight']
print('CAD_TOOL_TEST_RESULTS '+json.dumps(results),flush=True)
