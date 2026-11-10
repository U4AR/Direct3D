"""Deliberately difficult pen trajectories. Deterministic, not human validation."""
import json, math, random, copy, importlib.util, zlib
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];DIR=ROOT/'tests/fixtures/cad-robustness-v2'
spec=importlib.util.spec_from_file_location('cadprep',ROOT/'scripts/prepare-cad-robustness.py');prep=importlib.util.module_from_spec(spec);spec.loader.exec_module(prep)
def rotate2(p,a): return [p[0]*math.cos(a)-p[1]*math.sin(a),p[0]*math.sin(a)+p[1]*math.cos(a)]
def uv(p,f): return [sum((p[k]-f['origin'][k])*f[a][k] for k in range(3)) for a in ['xAxis','yAxis']]
def world(p,f): return [f['origin'][k]+p[0]*f['xAxis'][k]+p[1]*f['yAxis'][k] for k in range(3)]
def curve_features(case):
    f=case['plane'];family=case['family'];features={}
    if family=='slotted-plate': features={'outer':[(70,30,10,0,90),(-70,30,10,90,180),(-70,-30,10,180,270),(70,-30,10,270,360)],'slot':[(35,0,10,-90,90),(-35,0,10,90,270)]}
    if family=='filleted-step-bracket': features={'outer':[(44,56,6,180,270)]}
    for truth in case['truth']: truth['curveFeatures']=[{'radiusMetres':r*.001,'points':[prep.world(p,f) for p in prep.arc(x,y,r,a,b)]} for x,y,r,a,b in features.get(truth['id'],[])]

def main():
    manifest=json.loads((DIR/'cases.json').read_text());base=[c for c in manifest['cases'] if c['variant'] in ['clean','wobbly','fragmented','retraced-messy','generated-raster']]
    for c in base:
        if c['truth']: curve_features(c)
    cases=base[:]
    for original in [c for c in base if c['variant']=='clean']:
        for vi,variant in enumerate(['tremor-uneven-speed','overshoot-large-gaps','shuffled-paused-fragments','stray-marks','omitted-hole']):
            c=copy.deepcopy(original);c['id']=c['family']+'-'+variant;c['variant']=variant;c['source']='analytic CAD truth + severe seeded artificial user variability';rng=random.Random(zlib.crc32(c['id'].encode()));f=c['plane'];angle=math.radians([23,-37,61,12,-19][vi]);shift=[.007,-.011]
            def transform(p): q=rotate2(uv(p,f),angle);return world([q[k]+shift[k] for k in range(2)],f)
            for truth in c['truth']:
                truth['points']=[transform(p) for p in truth['points']]
                if truth['centerWorld']: truth['centerWorld']=transform(truth['centerWorld'])
                for feature in truth.get('curveFeatures',[]): feature['points']=[transform(p) for p in feature['points']]
            strokes=[];omitted=None
            if variant=='omitted-hole':
                omitted=next(t['id'] for t in reversed(c['truth']) if t['hole'] and t['kind']=='circle');c['truth']=[t for t in c['truth'] if t['id']!=omitted];c['expected']={k:v-1 for k,v in c['expected'].items()};c['unobservableFeature']='A hole was not drawn; expected output omits it, rather than inventing the known original CAD feature.'
            for li,originalStroke in enumerate(original['strokes']):
                if omitted and original['truth'][li]['id']==omitted: continue
                points=np.array([uv(transform(p),f) for p in originalStroke['points']]);span=float(np.linalg.norm(points.max(axis=0)-points.min(axis=0)));n=len(points);amplitude=span*(.018 if variant=='tremor-uneven-speed' else .012);phase=rng.random()*math.tau
                raw=[[float(p[0]+amplitude*math.sin(i*math.tau*7/(n-1)+phase)+rng.uniform(-1,1)*amplitude*(.45 if variant=='tremor-uneven-speed' else .1)),float(p[1]+amplitude*.8*math.cos(i*math.tau*5/(n-1)+phase)+rng.uniform(-1,1)*amplitude*(.45 if variant=='tremor-uneven-speed' else .1))] for i,p in enumerate(points)]
                parts=[raw]
                if variant=='tremor-uneven-speed':
                    # Uneven dwell density and occasional repeated stationary samples.
                    raw=[p for i,p in enumerate(raw) if i%5==0 or rng.random()<.65];parts=[[p for p in raw for _ in range(1+(rng.random()<.15))]]
                elif variant=='overshoot-large-gaps':
                    raw=raw[:max(4,int(n*.88))];t=np.array(raw[-1])-np.array(raw[-2]);t=t/(np.linalg.norm(t) or 1);raw+=[(np.array(raw[-1])+t*span*.04).tolist()];parts=[raw]
                elif variant=='shuffled-paused-fragments':
                    cuts=[round(n*k/4) for k in range(5)];parts=[raw[a+1:b-1] for a,b in zip(cuts,cuts[1:])];parts=[p[::-1] if rng.random()<.5 else p for p in parts]
                for p in parts: strokes.append({'id':'stress-'+str(len(strokes)),'points':[world(q,f) for q in p]})
            if variant=='shuffled-paused-fragments': rng.shuffle(strokes)
            if variant=='stray-marks':
                allp=np.array([uv(p,f) for s in strokes for p in s['points']]);lo,hi=allp.min(axis=0),allp.max(axis=0);span=float(np.linalg.norm(hi-lo));stray=[]
                for i in range(3):
                    center=lo+np.array([.15+i*.3,-.1])*span;coords=[(center+np.array([j*.004,math.sin(j*2)*.003])*span).tolist() for j in range(5)];idx=len(strokes);strokes.append({'id':'stress-'+str(idx),'points':[world(q,f) for q in coords]});stray.append(idx)
                c['accidentalInputIndices']=stray
            for i,s in enumerate(strokes): s.update({'id':'stress-'+str(i),'started':i*(5100 if variant=='shuffled-paused-fragments' else 500),'ended':i*(5100 if variant=='shuffled-paused-fragments' else 500)+350})
            c['strokes']=strokes;c['noise']={'seed':zlib.crc32(c['id'].encode()),'designRotationDegrees':angle*180/math.pi,'simulated':True,'variant':variant};prep.render_case(c);cases.append(c)
    manifest['cases']=cases;manifest['warning']+=' Added severe jitter, dwell variation, incomplete loops, overshoot, shuffled/reversed fragments separated by long pauses, accidental marks, and an omitted-feature negative control. These remain simulated, not human recordings.';(DIR/'cases.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({'cases':len(cases),'newCases':len(cases)-len(base),'maxStrokes':max(len(c['strokes']) for c in cases)},indent=2))
if __name__=='__main__': main()
