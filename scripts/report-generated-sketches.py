"""Publish source/extraction/fit comparisons and a standalone scientific contact sheet."""
import json, html, shutil
from pathlib import Path
import numpy as np
from PIL import Image
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT=Path(__file__).resolve().parents[1]
FIXTURE=ROOT/'tests/fixtures/generated-sketches-v1'
OUT=ROOT/'public/benchmarks/decision-images-v1'

def main():
    fixture=json.loads((FIXTURE/'cases.json').read_text());reports=[]
    for p in sorted((ROOT/'artifacts/generated-sketches-v1').glob('*.json')):
        report=json.loads(p.read_text())
        if report.get('results'): reports.append(report)
    if not reports: raise RuntimeError('Run the API benchmark first')
    OUT.mkdir(parents=True,exist_ok=True)
    for p in FIXTURE.glob('*.png'): shutil.copy2(p,OUT/p.name)
    shutil.copy2(FIXTURE/'cases.json',OUT/'cases.json')
    shutil.copy2(FIXTURE/'generation-prompt.txt',OUT/'generation-prompt.txt')
    latest=next((r for r in reports if r.get('variant','').startswith('combined')),reports[-1]); rows={r['id']:r for r in latest['results']}
    fig,axes=plt.subplots(4,3,figsize=(12,16),dpi=150)
    cards=[]
    for case,ax in zip(fixture['cases'],axes.flat):
        row=rows.get(case['id'],{});result=row.get('result',{});width,height=case['imageSize'];source=Image.open(FIXTURE/case['image'])
        ax.imshow(source,alpha=.40);ax.set_xlim(0,width);ax.set_ylim(height,0);ax.axis('off');elements=[]
        def pixels(points): return [[p[0]/.0005+width/2,height/2-p[1]/.0005] for p in points]
        def svg_path(points,cls): return '<polyline class="'+cls+'" points="'+' '.join(f'{x:.2f},{y:.2f}' for x,y in pixels(points))+'" fill="none"/>'
        for s in case['strokes']: elements.append(svg_path(s['points'],'extracted'))
        for fitted in result.get('results',[]):
            points=np.array(pixels(fitted['pathWorld']));ax.plot(points[:,0],points[:,1],color='#087f83',linewidth=1.4);elements.append(svg_path(fitted['pathWorld'],'fitted'))
        verdict='PASS' if row.get('fullPass',row.get('corePass')) else 'REVIEW';actual=row.get('actual',{});error=actual.get('maxRelativeError');label=case['id']+' · '+verdict
        if error is not None: label+=f' · {error*100:.1f}% max error'
        ax.set_title(label,fontsize=10,color='#146546' if verdict=='PASS' else '#ad3e25')
        svg=f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(case["id"])} comparison"><image class="source" href="{case["image"]}" width="{width}" height="{height}"/>'+''.join(elements)+'</svg>'
        duration=result.get('timings',{}).get('totalMs');cost=result.get('cost',{}).get('usd')
        info=f'{duration/1000:.2f} s · ${cost:.6f}' if duration is not None and cost is not None else html.escape(row.get('error','Not run'))
        diagnostic={'expected':case['expected'],'extraction':case['extraction'],'actual':actual,'checks':row.get('checks'),'decisions':result.get('decisions'),'warnings':result.get('warnings'),'timings':result.get('timings'),'cost':result.get('cost'),'evaluationVariant':row.get('evaluationVariant'),'lastAttemptError':row.get('lastAttemptError')}
        cards.append(f'<article><h2>{html.escape(label)}</h2>{svg}<p>{info}</p><p><a class="try-case" data-case="{case["id"]}" href="/desktop.html?experiment=decision">Try this sketch</a></p><p>Symmetry: {html.escape(str(actual.get("symmetry",[])))}</p><details><summary>Decisions & measurements</summary><pre>{html.escape(json.dumps(diagnostic,indent=2))}</pre></details></article>')
    fig.tight_layout();fig.savefig(OUT/'fitting-contact-sheet.png',facecolor='white');plt.close(fig)
    summary=latest['summary'];cached=[r for r in latest['results'] if r.get('result',{}).get('cost',{}).get('usageKnown')]
    mean=summary['knownCostUSD']/max(1,summary['completed']) if cached else None
    explanation='Generated images → thresholded ink → skeleton graph → simulated strokes → OpenAI Decisions → numerical fit. Source is grey, extracted paths red, fitted geometry teal. Geometry checks cover component count, primitive type, closure, 6% maximum contour deviation, native edit contract and rigid frame consistency. Full constraints also require expected symmetry. Selected cases were re-evaluated after inspecting baseline failures; original attempts, including transport errors, remain in Full results. Expected shape names are evaluator labels and were NOT included in API inputs. These tests do not measure human drawing accuracy or original pen timing.'
    totals=f'{summary["corePass"]}/{summary.get("cases",summary["attempts"])} geometry checks; full constraints {summary.get("fullPass",summary["corePass"])}/{summary.get("cases",summary["attempts"])}; symmetry {summary["symmetryPass"]}/{summary["symmetryAssessed"]}; known API cost ${summary["knownCostUSD"]:.6f}; {summary["unknownCostAttempts"]} unknown-cost attempts.'
    document='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sketch fitting tests</title><style>body{margin:32px auto;max-width:1280px;padding:0 20px;background:#f4f5f6;color:#20282c;font:15px system-ui}h1{font-size:28px}p{line-height:1.55}nav{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}article{background:white;border:1px solid #dce1e3;padding:18px;border-radius:8px}h2{font-size:15px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}svg{width:100%;background:white;max-height:390px}.source{opacity:.35}.extracted{stroke:#d74b5c;stroke-width:1;display:none}.fitted{stroke:#087f83;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}pre{white-space:pre-wrap;max-height:400px;overflow:auto;font-size:11px}select,button{font:inherit;padding:7px}a{color:#176878}@media(max-width:800px){main{grid-template-columns:1fr}}</style><h1>Sketch fitting tests</h1>'''
    document+=f'<p>{explanation}</p><p><strong>{totals}</strong></p>'
    if mean is not None: document+=f'<p>Measured mean: ${mean:.6f}/case. At 120 similar updates/hour: ${mean*120:.3f}/hour, ${mean*120*160:.2f}/160-hour month. Excludes image generation, audio, CAD agent and hosting.</p>'
    document+='''<nav><label>View <select id="view"><option value="overlay">Source + fit</option><option value="source">Source image</option><option value="extracted">Extracted paths</option><option value="fit">Fitted paths</option></select></label><a href="source-sheet.png">Generated sheet</a><a href="generation-prompt.txt">Generation prompt</a><a href="extraction-contact-sheet.png">Extraction checks</a><a href="fitting-contact-sheet.png">Download comparison</a><a href="cases.json">Stroke fixtures</a><a href="report.json">Full results</a></nav><main>'''+''.join(cards)+'''</main><script>for(const a of document.querySelectorAll('.try-case'))a.href='/desktop.html?experiment=decision&fixture='+encodeURIComponent(a.dataset.case)+'&session='+crypto.randomUUID();document.querySelector('#view').onchange=e=>{const v=e.target.value;for(const n of document.querySelectorAll('.source')){n.style.display=v==='fit'?'none':'';n.style.opacity=v==='source'?'1':'.35'}for(const n of document.querySelectorAll('.extracted'))n.style.display=v==='extracted'?'block':'none';for(const n of document.querySelectorAll('.fitted'))n.style.display=['overlay','fit'].includes(v)?'block':'none';};</script></html>'''
    (OUT/'index.html').write_text(document,encoding='utf-8');(OUT/'report.json').write_text(json.dumps(latest,indent=2))
    dist=ROOT/'dist/benchmarks/decision-images-v1';shutil.copytree(OUT,dist,dirs_exist_ok=True)
    print(json.dumps({'page':str(OUT/'index.html'),'summary':summary,'meanDecisionCostUSD':mean},indent=2))

if __name__=='__main__': main()
