// Synthetic paid API evaluation; never mutates a user's scene or reads private recordings.
import {mkdir,writeFile} from 'node:fs/promises';
import {runSketchDecisions} from './decision-sketch-api.mjs';
const lerp=(a,b,n=24)=>Array.from({length:n},(_,i)=>a.map((v,k)=>v+(b[k]-v)*i/(n-1)));
const rectangle=[[-.08,-.03],[.08,-.03],[.08,.03],[-.08,.03],[-.08,-.03]],rounded=[...lerp([-.08,-.03],[.03,-.03]),...Array.from({length:41},(_,i)=>[.03+.03*Math.cos(-Math.PI/2+i*Math.PI/40),.03*Math.sin(-Math.PI/2+i*Math.PI/40)]),...lerp([.03,.03],[-.08,.03]),...lerp([-.08,.03],[-.08,-.03])];
const cases=[{name:'rough-rectangle',points:rectangle.slice(1).flatMap((p,i)=>lerp(rectangle[i],p)),expected:'rectangle'},{name:'oval',points:Array.from({length:100},(_,i)=>[.08*Math.cos(i*2*Math.PI/99),.035*Math.sin(i*2*Math.PI/99)]),expected:'ellipse'},{name:'rounded-end',points:rounded,expected:'profile'},{name:'open-U',points:[...lerp([-.04,.05],[-.04,-.03]),...lerp([-.04,-.03],[.04,-.03]),...lerp([.04,-.03],[.04,.05])],expected:'profile'}];
const reports=[];for(const [i,c]of cases.entries()){
 const angle=.37,points=c.points.map(([x,y],j)=>{const wobble=.0004*Math.sin(j*2.1);return [.2+x*Math.cos(angle)-y*Math.sin(angle),.4+x*Math.sin(angle)+y*Math.cos(angle)+wobble,-.3];});
 const data={strokes:[{id:'synthetic-'+i,points}],plane:{origin:[0,0,-.3],xAxis:[1,0,0],yAxis:[0,1,0]},prompt:'Clean the drawing, preserving its intended outline.'};
 try{const r=await runSketchDecisions(data),f=r.results[0];reports.push({name:c.name,expected:c.expected,kind:f.kind,closed:f.constraints.closed,constraints:f.constraints,metrics:f.metrics,timings:r.timings,cost:r.cost,decisions:r.decisions,warnings:[...r.warnings,...f.warnings],id:r.id});console.log(JSON.stringify(reports.at(-1)));}catch(e){reports.push({name:c.name,error:e.message});console.log(JSON.stringify(reports.at(-1)));}
}
const succeeded=reports.filter(r=>r.cost?.usageKnown),cost=succeeded.reduce((n,r)=>n+r.cost.usd,0),summary={source:'Synthetic coordinate/feature input plus clean plane-projected ink images; no claim of human-drawing accuracy',requests:reports.length,successes:succeeded.length,totalCostUSD:cost,meanCostUSD:cost/(succeeded.length||1),reports};await mkdir('artifacts',{recursive:true});await writeFile('artifacts/decision-api-live.json',JSON.stringify(summary,null,2));
