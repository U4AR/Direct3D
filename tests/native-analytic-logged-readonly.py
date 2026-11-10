"""Read only original logged immutable BReps; never load/save a mutable document."""
import importlib.util,json,os,hashlib
spec=importlib.util.spec_from_file_location('w','/source/scripts/freecad-worker.py');w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
source='.runtime/meta-harness-inputs/73aa55e7-0106-4f37-bc9c-1930e02aa8d2.json';e=json.load(open('/source/'+source))['turns'][0]['request']['evidence'];models=[]
def digest(path):return hashlib.sha256(open(path,'rb').read()).hexdigest()
for m in e['models']:
 if m['id'] not in ('freecad::9732bddc-b690-4ad7-98d4-184c2e7549c6','freecad::bab61db0-4365-4508-8626-49c4aaa92b75'):continue
 artifact=m['blender']['artifactId'];folder='/data/modeling/freecad/'+artifact;path=folder+'/model.brep'
 hashes={p:digest(folder+'/'+p) for p in ('model.brep','model.FCStd')};s=w.Part.Shape();s.read(path);solid=s.Solids[0] if len(s.Solids)==1 else None;faces=[];edges=[]
 for i,f in enumerate(s.Faces):
  a=w.analytic_geometry(f,True,solid)
  if a:faces.append({'index':i+1,'type':type(f.Surface).__name__,'center':w.web(f.CenterOfMass),'areaMetres2':f.Area/1e6,'analytic':a})
 for i,edge in enumerate(s.Edges):
  a=w.analytic_geometry(edge)
  if a:edges.append({'index':i+1,'type':type(edge.Curve).__name__,'center':w.web(edge.CenterOfMass),'lengthMetres':edge.Length/1000,'analytic':a})
 checks=[]
 for field,items,measure in [('faces',faces,'areaMetres2'),('edges',edges,'lengthMetres')]:
  previous={i['index']:i for i in m['blender']['metrics'][field]}
  for item in items:
   old=previous.get(item['index']);checks.append(bool(old and old['type']==item['type'] and max(abs(a-b) for a,b in zip(old['center'],item['center']))<1e-8 and abs(old[measure]-item[measure])<1e-8))
 assert all(checks),'Native topology index/measurement differs from logged evidence'
 assert all(digest(folder+'/'+p)==v for p,v in hashes.items()),'Immutable artifact bytes changed'
 models.append({'modelId':m['id'],'expectedVersion':m['version'],'artifactId':artifact,'name':m['name'],'frame':'stable native metres Y-up','originalArtifactSha256':hashes,'matchesLoggedTopologyIndices':True,'valid':s.isValid(),'solids':len(s.Solids),'volumeMetres3':s.Volume/1e9,'faces':faces,'edges':edges})
print('NATIVE_ANALYTIC_LOGGED '+json.dumps({'sourceLog':source,'readOnly':True,'sourceBytesUnchanged':True,'modelEdits':False,'models':models}),flush=True)
