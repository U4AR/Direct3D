"""Real native descriptor checks, including the logged bottle neck reconstruction."""
import importlib.util,json,os,time,uuid,math
spec=importlib.util.spec_from_file_location('worker','/source/scripts/freecad-worker.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
root='/tmp/native-analytic';os.makedirs(root,exist_ok=True);results=[]
def op(kind,p):return {'operation':kind,'parameters':p,'targetId':'base','toolIds':[],'name':kind}
def run(name,ops):
 r=w.run({'schema':'draw3d.modeling.v1','targetId':'base','meshes':[],'operations':ops},os.path.join(root,str(uuid.uuid4())));assert r['metrics']['valid'];results.append({'name':name,'elapsedMs':r['elapsedMs'],'faces':[{'index':f['index'],'analytic':f.get('analytic')} for f in r['metrics']['faces']]});return r
r=run('logged neck revolve and shell',[op('create_sketch',{'center':[.016,.94,-.3],'axes':[[1,0,0],[0,1,0],[0,0,1]],'profilePoints':[[0,0],[.075,0],[.085,.015],[.085,.13],[.08,.145],[.066,.17],[.066,.18],[0,.18]],'closed':True}),op('revolve',{'angleDeg':360,'direction':[0,1,0],'pivot':[.016,.94,-.3]}),op('shell',{'thicknessMetres':.003,'faceIndices':[7]})])
analytic=[f['analytic'] for f in r['metrics']['faces'] if f.get('analytic')]
outer=next(f for f in analytic if f['kind']=='cylinder' and abs(f['radiusMetres']-.066)<1e-8)
inner=next(f for f in analytic if f['kind']=='cylinder' and abs(f['radiusMetres']-.063)<1e-8)
assert outer['boundaryRole']=='exterior',outer
assert inner['boundaryRole']=='cavity',inner
for f in (outer,inner):
 assert abs(abs(f['axis'][1])-1)<1e-12
 assert abs(f['center'][0]-.016)<1e-10 and abs(f['center'][2]+.3)<1e-10
 ends=sorted(f['center'][1]+f['axis'][1]*f['axialRangeMetres'][k] for k in ('min','max'))
 assert abs(ends[1]-1.12)<1e-9,ends
 assert 1.108<ends[0]<1.112,ends
neck_surfaces=[f for f in r['metrics']['faces'] if f.get('analytic')]
assert any(f['kind']=='cone' and f.get('radialRangeMetres') for f in analytic)
assert any(e.get('analytic',{}).get('kind')=='circle' for e in r['metrics']['edges'])
assert any(e.get('analytic',{}).get('kind')=='line' for e in r['metrics']['edges'])
# A rigidly rotated cylinder must retain its native analytic frame and span.
r=run('rotated cylinder',[op('create_cylinder',{'center':[.1,.2,.3],'axes':[[0,1,0],[1,0,0],[0,0,-1]],'radiusMetres':.012,'heightMetres':.05})]);a=next(f['analytic'] for f in r['metrics']['faces'] if f.get('analytic',{}).get('kind')=='cylinder');assert abs(abs(a['axis'][0])-1)<1e-12;assert abs(a['axialRangeMetres']['max']-a['axialRangeMetres']['min']-.05)<1e-10;assert abs(a['radiusMetres']-.012)<1e-12
r=run('native sphere',[op('create_sphere',{'center':[.1,.2,.3],'radiusMetres':.02})]);a=r['metrics']['faces'][0]['analytic'];assert a['kind']=='sphere' and a['boundaryRole']=='exterior';assert a['center']==[.1,.2,.3];assert abs(a['axialRangeMetres']['min']+.02)<1e-10
r=run('native torus',[op('create_torus',{'center':[.1,.2,.3],'radiusMetres':.03,'minorRadiusMetres':.005})]);a=r['metrics']['faces'][0]['analytic'];assert a['kind']=='torus';assert abs(a['majorRadiusMetres']-.03)<1e-12 and abs(a['minorRadiusMetres']-.005)<1e-12
r=run('native cone',[op('create_cone',{'center':[.1,.2,.3],'radiusMetres':.02,'topRadiusMetres':.01,'heightMetres':.03})]);a=next(f['analytic'] for f in r['metrics']['faces'] if f.get('analytic',{}).get('kind')=='cone');assert abs(a['radialRangeMetres']['min']-.01)<1e-10 and abs(a['radialRangeMetres']['max']-.02)<1e-10;assert a['boundaryRole']=='exterior'
# Open surfaces and spline supports must not invent material orientation or radii.
shape=w.Part.makeCylinder(10,20);face=next(f for f in shape.Faces if type(f.Surface).__name__=='Cylinder');assert 'boundaryRole' not in w.analytic_geometry(face,True)
curve=w.Part.BSplineCurve();curve.interpolate([w.App.Vector(0,0,0),w.App.Vector(10,5,0),w.App.Vector(20,0,0)]);assert w.analytic_geometry(curve.toShape()) is None
# Cached triangulation must not shrink exact body/face extents used by guards.
cone=w.Part.makeCone(20,0,60);cone.tessellate(.12)
b=w.native_bounds(cone)
assert abs(b['min'][0]+.02)<1e-10 and abs(b['max'][0]-.02)<1e-10,b
assert abs(b['min'][2]+.02)<1e-10 and abs(b['max'][2]-.02)<1e-10,b
circle=w.Part.makeCircle(20);circle.discretize(Number=48);b=w.native_bounds(circle)
assert abs(b['min'][0]+.02)<1e-10 and abs(b['max'][0]-.02)<1e-10,b
assert abs(b['min'][2]+.02)<1e-10 and abs(b['max'][2]-.02)<1e-10,b
# Descriptor work is compact, independent of the preview tessellation.
start=time.perf_counter()
for i in range(100):w.analytic_geometry(face,True,shape.Solids[0])
ms=(time.perf_counter()-start)*10
print('NATIVE_ANALYTIC_RESULTS '+json.dumps({'cases':results,'meanCylinderDescriptorMs':ms,'loggedOuterNeck':outer,'loggedInnerNeck':inner,'loggedNeckAnalyticSurfaces':neck_surfaces}),flush=True)
