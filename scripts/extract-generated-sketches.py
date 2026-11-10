"""Extract centerline graph paths, NOT inferred pen history, from a generated sheet."""
import json, math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from skimage.morphology import skeletonize
import cv2

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / 'tests/fixtures/generated-sketches-v1'
NAMES = ['circle','ellipse','rotated-rectangle','rounded-tab','L-bracket','vase','open-U','car','keyhole','S-curve','star','asymmetric-leaf']
EXPECTED = [
 {'kinds':['circle'],'closed':1,'symmetry':'both'},
 {'kinds':['ellipse'],'closed':1,'symmetry':'both'},
 {'kinds':['rectangle'],'closed':1,'symmetry':'both'},
 {'kinds':['profile'],'closed':1,'representation':'mixed','symmetry':'one'},
 {'kinds':['profile'],'closed':1,'representation':'lines'},
 {'kinds':['profile'],'closed':1,'symmetry':'one'},
 {'kinds':['profile'],'closed':0,'representation':'lines','symmetry':'one'},
 {'kinds':['profile','circle','circle'],'closed':3,'representation':'mixed'},
 {'kinds':['profile'],'closed':1,'representation':'mixed','symmetry':'one'},
 {'kinds':['profile'],'closed':0,'symmetry':'none'},
 {'kinds':['profile'],'closed':1,'representation':'lines','symmetry':'one'},
 {'kinds':['profile'],'closed':1},
]

def graph_paths(mask):
    """Trace degree-2 chains. Branches remain branches; cycles remain cycles."""
    ys, xs = np.nonzero(mask)
    pixels = set(zip(xs.tolist(),ys.tolist()))
    def build_graph(pixels):
        graph={}
        for x,y in pixels:
            neighbors=[]
            for dx,dy in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
                q=(x+dx,y+dy)
                if q not in pixels: continue
                if dx and dy and ((x+dx,y) in pixels or (x,y+dy) in pixels): continue
                neighbors.append(q)
            graph[(x,y)]=sorted(neighbors,key=lambda p:(p[1],p[0]))
        return graph
    pruned=0
    for _ in range(3):
        graph=build_graph(pixels);remove=set()
        for p in graph:
            if len(graph[p])!=1: continue
            trail=[p];previous,current=p,graph[p][0]
            while len(graph[current])==2 and len(trail)<8:
                trail.append(current);nxt=next(q for q in graph[current] if q!=previous);previous,current=current,nxt
            if len(graph[current])>2 and len(trail)<6: remove.update(trail)
        if not remove: break
        pixels-=remove;pruned+=len(remove)
    graph=build_graph(pixels)
    visited=set(); paths=[]
    edge=lambda a,b:tuple(sorted((a,b)))
    def walk(a,b):
        points=[a];previous,current=a,b;visited.add(edge(a,b))
        while True:
            points.append(current)
            if current==a or len(graph[current])!=2: break
            candidates=[p for p in graph[current] if p!=previous]
            nxt=candidates[0]
            if edge(current,nxt) in visited: break
            visited.add(edge(current,nxt));previous,current=current,nxt
        return points
    for p in sorted(graph,key=lambda p:(p[1],p[0])):
        if len(graph[p])==2: continue
        for q in graph[p]:
            if edge(p,q) not in visited: paths.append(walk(p,q))
    for p in sorted(graph,key=lambda p:(p[1],p[0])):
        for q in graph[p]:
            if edge(p,q) not in visited: paths.append(walk(p,q))
    return [p for p in paths if len(p)>=5], {'prunedSpurPixels':pruned,'skeletonPixels':len(pixels),'junctionPixels':sum(len(v)>2 for v in graph.values()),'endpointPixels':sum(len(v)==1 for v in graph.values()),'visitedEdges':len(visited)}

def simplify_path(points,tolerance=.65):
    closed=points[0]==points[-1]
    a=np.array(points,dtype=np.float32)
    approx=cv2.approxPolyDP(a,tolerance,closed).reshape(-1,2).astype(float).tolist()
    if closed: approx.append(approx[0])
    # Densify straight segments so raw-sample weighting doesn't favor corners.
    out=[]
    for a,b in zip(approx,approx[1:]):
        n=max(1,math.ceil(math.dist(a,b)/2))
        out.extend([[a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n] for i in range(n)])
    out.append(approx[-1]);return out

def main():
    image=Image.open(FIXTURE/'source-sheet.png').convert('RGB')
    width,height=image.size;cases=[];contact=Image.new('RGB',(1200,4*440),'white');draw=ImageDraw.Draw(contact)
    for i,name in enumerate(NAMES):
        col,row=i%3,i//3;rect=[round(col*width/3),round(row*height/4),round((col+1)*width/3),round((row+1)*height/4)]
        crop=image.crop(rect);crop.save(FIXTURE/(name+'.png'))
        gray=np.array(crop.convert('L'));mask=(gray<150).astype(np.uint8)
        count,labels,stats,_=cv2.connectedComponentsWithStats(mask,8)
        clean=np.zeros_like(mask,dtype=bool)
        for label in range(1,count):
            if stats[label,cv2.CC_STAT_AREA]>=20: clean|=labels==label
        skeleton=skeletonize(clean);paths,diagnostics=graph_paths(skeleton)
        strokes=[]
        for j,path in enumerate(paths):
            points=simplify_path(path)
            # Fixed image-plane scale; world origin/basis are explicit.
            points3d=[[(p[0]-crop.width/2)*.0005,(crop.height/2-p[1])*.0005,0] for p in points]
            strokes.append({'id':f'generated-{i+1}-path-{j+1}','points':points3d,'started':j*1500,'ended':j*1500+1000,'extractionClosed':path[0]==path[-1]})
        entry={'id':name,'image':name+'.png','sourceRect':rect,'imageSize':list(crop.size),'pixelToPlane':{'originPixel':[crop.width/2,crop.height/2],'metresPerPixel':.0005,'u':'right','v':'up'},'expected':EXPECTED[i],'extraction':{**diagnostics,'pathCount':len(paths),'closedPathCount':sum(s['extractionClosed'] for s in strokes)},'strokes':strokes,'plane':{'origin':[0,0,0],'xAxis':[1,0,0],'yAxis':[0,1,0]}}
        cases.append(entry)
        debug=crop.copy();d=ImageDraw.Draw(debug)
        for j,path in enumerate(paths): d.line(path,fill=(215,48,62),width=1)
        debug.thumbnail((390,390));contact.paste(debug,(col*400+5,row*440+25));draw.text((col*400+10,row*440+5),f'{name}: {len(paths)} paths, {entry["extraction"]["closedPathCount"]} closed',fill='black')
    manifest={'version':1,'source':'source-sheet.png','generation':'Built-in image_gen, one 3x4 benchmark sheet, 2026-11-04','method':'Threshold<150; remove components<20px; skeletonize; prune endpoint spurs<6px; trace degree-2 graph chains; RDP 0.65px; resample 2px','warning':'Synthetic images. Centerline path order/direction and timing are simulated; intersections do not reveal original pen strokes. Expected labels are evaluator metadata and must never be sent to the decision model.','cases':cases}
    (FIXTURE/'cases.json').write_text(json.dumps(manifest,indent=2))
    contact.save(FIXTURE/'extraction-contact-sheet.png')
    print(json.dumps([{'id':c['id'],**c['extraction']} for c in cases],indent=2))

if __name__=='__main__': main()
