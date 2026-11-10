"""Known analytic CAD profiles plus simulated imperfect strokes and raster examples."""
import json, math, random, importlib.util, zlib
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from skimage.morphology import skeletonize
import cv2
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'tests/fixtures/cad-robustness-v2'
spec=importlib.util.spec_from_file_location('extract_sketches',ROOT/'scripts/extract-generated-sketches.py');extract=importlib.util.module_from_spec(spec);spec.loader.exec_module(extract)

def arc(cx,cy,r,start,end):
    n=max(4,math.ceil(abs(end-start)/2));return [[cx+r*math.cos(math.radians(start+(end-start)*i/n)),cy+r*math.sin(math.radians(start+(end-start)*i/n))] for i in range(n+1)]
def line(a,b):
    n=max(2,math.ceil(math.dist(a,b)));return [[a[k]+(b[k]-a[k])*i/n for k in range(2)] for i in range(n+1)]
def closed(points): return points if math.dist(points[0],points[-1])<1e-8 else points+line(points[-1],points[0])[1:]
def polygon(vertices): return [p for a,b in zip(vertices,vertices[1:]+vertices[:1]) for p in line(a,b)[:-1]]+[vertices[0]]
def ring(name,cx,cy,r,hole=True): return {'id':name,'kind':'circle','hole':hole,'center':[cx,cy],'radius':r,'points':arc(cx,cy,r,0,360)}
def profile(name,points,hole=False): return {'id':name,'kind':'profile','hole':hole,'points':closed(points)}
def roundrect(w,h,r):
    chunks=[arc(w/2-r,h/2-r,r,0,90),arc(-w/2+r,h/2-r,r,90,180),arc(-w/2+r,-h/2+r,r,180,270),arc(w/2-r,-h/2+r,r,270,360)];points=chunks[0]
    for chunk in chunks[1:]: points+=line(points[-1],chunk[0])[1:]+chunk[1:]
    return closed(points)
def designs():
    flange=[ring('outer',0,0,60,False),ring('bore',0,0,24)]+[ring('bolt'+str(i),44*math.cos(i*math.pi/3),44*math.sin(i*math.pi/3),5) for i in range(6)]
    slot=arc(35,0,10,-90,90)+line([35,10],[-35,10])[1:]+arc(-35,0,10,90,270)[1:]+line([-35,-10],[35,-10])[1:]
    rail=[profile('outer',roundrect(160,80,10)),profile('slot',slot,True)]+[ring('bolt'+str(i),x,y,5) for i,(x,y) in enumerate([(-60,-25),(60,-25),(60,25),(-60,25)])]
    a=math.degrees(math.asin(12/25));left=arc(-45,0,25,a,360-a);right=arc(45,0,25,180+a,540-a);dog=closed(left+line(left[-1],right[0])[1:]+right[1:])
    link=[profile('outer',dog),ring('left-bore',-45,0,10),ring('right-bore',45,0,10)]
    bracket=polygon([[0,0],[0,100],[38,100],[38,56]])[:-1] # replace closing edge with a concave fillet + steps
    bracket=line([0,0],[0,100])+line([0,100],[38,100])[1:]+line([38,100],[38,56])[1:]+arc(44,56,6,180,270)[1:]+line([44,50],[80,50])[1:]+line([80,50],[80,30])[1:]+line([80,30],[120,30])[1:]+line([120,30],[120,0])[1:]+line([120,0],[0,0])[1:]
    step=[profile('outer',bracket)]+[ring('mount'+str(i),x,y,4.5) for i,(x,y) in enumerate([(18,18),(18,80),(100,15)])]
    return {'six-bolt-flange':flange,'slotted-plate':rail,'connecting-link':link,'filleted-step-bracket':step}

def make_frame(index):
    a=math.radians([0,17,-31,53][index]);tilt=math.radians(index*8)
    return {'origin':[.2+index*.03,.35-index*.02,-.6],'xAxis':[math.cos(a),math.sin(a),0],'yAxis':[-math.sin(a)*math.cos(tilt),math.cos(a)*math.cos(tilt),math.sin(tilt)]}
def world(p,plane): return [plane['origin'][k]+p[0]*.001*plane['xAxis'][k]+p[1]*.001*plane['yAxis'][k] for k in range(3)]
def local(p,plane): return [sum((p[k]-plane['origin'][k])*plane[a][k] for k in range(3)) for a in ['xAxis','yAxis']]
def perturb(points,variant,rng):
    p=np.array(points);span=float(np.linalg.norm(p.max(axis=0)-p.min(axis=0)));amplitude=span*{'clean':0,'wobbly':.014,'fragmented':.012,'retraced-messy':.027}[variant];phase=rng.random()*math.tau
    return [[float(x+amplitude*(math.sin(3*math.tau*i/(len(p)-1)+phase)+.22*math.sin(11*math.tau*i/(len(p)-1)))+rng.uniform(-.12,.12)*amplitude),float(y+amplitude*(.7*math.cos(4*math.tau*i/(len(p)-1)+phase)+.18*math.sin(9*math.tau*i/(len(p)-1)))+rng.uniform(-.12,.12)*amplitude)] for i,(x,y) in enumerate(p)]

def render_case(case):
    plane=case['plane'];paths=[[local(p,plane) for p in s['points']] for s in case['strokes']];points=np.array([p for path in paths for p in path]);lo,hi=points.min(axis=0),points.max(axis=0);center=(lo+hi)/2;scale=560/max(hi-lo);width,height=700,560
    def pixel(p): return (float(width/2+(p[0]-center[0])*scale),float(height/2-(p[1]-center[1])*scale))
    image=Image.new('RGB',(width,height),'white');draw=ImageDraw.Draw(image)
    for path in paths: draw.line([pixel(p) for p in path],fill=(25,30,36),width=2)
    image.save(OUT/(case['id']+'.png'));case['image']=case['id']+'.png';case['imageMap']={'width':width,'height':height,'centerUV':center.tolist(),'pixelsPerMetre':float(scale)}

def main():
    OUT.mkdir(parents=True,exist_ok=True);cases=[]
    for family,loops in designs().items():
        for vi,variant in enumerate(['clean','wobbly','fragmented','retraced-messy']):
            rng=random.Random(zlib.crc32((family+variant).encode()));plane=make_frame(vi);strokes=[];truth=[]
            for li,loop in enumerate(loops):
                ideal=loop['points'];raw=perturb(ideal,variant,rng);parts=[raw]
                if variant=='fragmented':
                    cuts=[0,len(raw)//3,2*len(raw)//3,len(raw)];parts=[raw[a+1:b-1] for a,b in zip(cuts,cuts[1:])]
                elif variant=='retraced-messy':
                    # A visible accidental closing gap, and duplicate overtraces.
                    raw=raw[:-max(2,len(raw)//40)];parts=[raw]
                    if li in [0,len(loops)-1]: parts.append([[x+.45,y-.35] for x,y in perturb(ideal,variant,rng)])
                for piece in parts:
                    j=len(strokes);strokes.append({'id':f'{family}-{variant}-s{j}','points':[world(p,plane) for p in piece],'started':j*500,'ended':j*500+350})
                truth.append({**{k:v for k,v in loop.items() if k!='points'},'points':[world(p,plane) for p in ideal],'centerWorld':world(loop['center'],plane) if 'center' in loop else None,'radiusMetres':loop.get('radius',0)*.001 or None})
            case={'id':family+'-'+variant,'family':family,'variant':variant,'source':'analytic CAD profile + seeded simulated pen imperfections','plane':plane,'strokes':strokes,'truth':truth,'expected':{'components':len(loops),'holes':sum(l['hole'] for l in loops),'circles':sum(l['kind']=='circle' for l in loops)},'noise':{'wobble':variant!='clean','fragmentation':variant=='fragmented','retracing':variant=='retraced-messy','randomSeed':zlib.crc32((family+variant).encode())}}
            render_case(case);cases.append(case)
    sheet=Image.open(OUT/'generated-sheet.png').convert('RGB');names=['flange','slot-plate','connecting-link','filleted-bracket'];counts=[8,6,3,4];circles=[8,4,2,3]
    for i,name in enumerate(names):
        w,h=sheet.size;crop=sheet.crop((round(i%2*w/2),round(i//2*h/2),round((i%2+1)*w/2),round((i//2+1)*h/2)));gray=np.array(crop.convert('L'));mask=(gray<150).astype(np.uint8);count,labels,stats,_=cv2.connectedComponentsWithStats(mask,8);clean=np.zeros_like(mask,dtype=bool)
        for label in range(1,count):
            if stats[label,cv2.CC_STAT_AREA]>=20: clean|=labels==label
        paths,diag=extract.graph_paths(skeletonize(clean));plane={'origin':[0,0,0],'xAxis':[1,0,0],'yAxis':[0,1,0]};strokes=[]
        for j,p in enumerate(paths): strokes.append({'id':f'image-{i}-path-{j}','points':[[(q[0]-crop.width/2)*.0003,(crop.height/2-q[1])*.0003,0] for q in extract.simplify_path(p)],'started':j*1500,'ended':j*1500+1000})
        case={'id':'generated-'+name,'family':name,'variant':'generated-raster','source':'built-in image_gen; skeletonized centerline paths; simulated order/timing','plane':plane,'strokes':strokes,'truth':[],'expected':{'components':counts[i],'holes':counts[i]-1,'circles':circles[i]},'extraction':{**diag,'pathCount':len(paths),'closedPaths':sum(p[0]==p[-1] for p in paths)},'image':'generated-'+name+'.png','imageMap':{'width':crop.width,'height':crop.height,'centerUV':[0,0],'pixelsPerMetre':1/.0003}}
        crop.save(OUT/case['image']);cases.append(case)
    manifest={'version':2,'warning':'Analytic profiles provide known CAD truth; noisy trajectories and timestamps are simulated, not human recordings. Generated raster cases have manual feature-count expectations but no exact dimension truth. Labels/truth must not be sent to the model.','cases':cases};(OUT/'cases.json').write_text(json.dumps(manifest,indent=2));print(json.dumps([{'id':c['id'],'strokes':len(c['strokes']),'expected':c['expected'],'extraction':c.get('extraction')} for c in cases],indent=2))

if __name__=='__main__': main()
