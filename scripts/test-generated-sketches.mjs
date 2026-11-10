import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {runSketchDecisions} from './decision-sketch-api.mjs';
const root=new URL('../tests/fixtures/generated-sketches-v1/',import.meta.url),fixture=JSON.parse(await readFile(new URL('cases.json',root),'utf8'));
const output=path.resolve('artifacts/generated-sketches-v1');await mkdir(output,{recursive:true});
const execute=process.argv.includes('--execute'),only=process.argv.find(a=>a.startsWith('--only='))?.slice(7),variant=process.argv.find(a=>a.startsWith('--variant='))?.slice(10)||'baseline';
const report={version:1,variant,at:new Date().toISOString(),source:'Built-in image_gen sheet; extracted centerline paths',warnings:[fixture.warning,'This is a generated-image benchmark, not held-out human drawing accuracy. No expected labels, object names or generation prompts are sent to the decision model.'],results:[]};
for(const c of fixture.cases.filter(c=>!only||only.split(',').includes(c.id))){
 const row={id:c.id,expected:c.expected,extraction:c.extraction,sourceImage:c.image};report.results.push(row);
 if(execute){const data={strokes:c.strokes.map(({extractionClosed,...s})=>s),plane:c.plane,image:'data:image/png;base64,'+(await readFile(new URL(c.image,root))).toString('base64'),prompt:'Refine this planar drawing while preserving its intended outline and separate components. Do not create 3D geometry.'};
  try{const result=await runSketchDecisions(data);row.result=result;row.actual={kinds:result.results.map(r=>r.kind),closed:result.results.filter(r=>r.constraints.closed).length,symmetry:result.results.map(r=>r.constraints.symmetry),maxRelativeError:Math.max(...result.results.map(r=>r.metrics.relativeMax)),maxErrorMetres:Math.max(...result.results.map(r=>r.metrics.max))};
   const actual=[...row.actual.kinds].sort(),expected=[...c.expected.kinds].sort();row.checks={componentCount:actual.length===expected.length,representation:JSON.stringify(actual)===JSON.stringify(expected),closure:row.actual.closed===c.expected.closed,contourBudget:row.actual.maxRelativeError<=.06,symmetry:c.expected.symmetry?result.results.length===1&&result.results[0].constraints.symmetry===c.expected.symmetry:null};row.corePass=['componentCount','representation','closure','contourBudget'].every(k=>row.checks[k]);
  }catch(e){row.error=e.message;row.corePass=false;}
 }
 const costs=report.results.filter(r=>r.result?.cost.usageKnown);report.summary={attempts:report.results.length,completed:report.results.filter(r=>r.result).length,corePass:report.results.filter(r=>r.corePass).length,symmetryPass:report.results.filter(r=>r.checks?.symmetry===true).length,symmetryAssessed:report.results.filter(r=>typeof r.checks?.symmetry==='boolean').length,knownCostUSD:costs.reduce((n,r)=>n+r.result.cost.usd,0),unknownCostAttempts:report.results.filter(r=>!r.result?.cost.usageKnown).length};await writeFile(path.join(output,variant+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({id:c.id,actual:row.actual,checks:row.checks,error:row.error,ms:row.result?.timings.totalMs,usd:row.result?.cost.usd}));
}
console.log(JSON.stringify(report.summary));
