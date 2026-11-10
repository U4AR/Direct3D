import {bounds,simplify} from '../src/decision-sketch/math.js';
import {knotsToSegments} from '../src/decision-sketch/constraints.js';

// Decisions can group adjacent ink before the planner assigns distinct
// feature roles. Use that later assignment when a single open path remains.
export function separateBaseGuide(source,sketches,strokes){
 if(source?.kind!=='spline'||source.closed||(source.strokeIds?.length||0)<2)return source;
 const assigned=new Set(sketches.flatMap(s=>s.strokeIds));
 const remaining=source.strokeIds.filter(id=>!assigned.has(id));
 if(remaining.length!==1)return source;
 const guide=strokes.find(s=>s.id===remaining[0]);
 if(!guide?.points?.length)return source;
 const local=guide.points.map(p=>[source.xAxis,source.yAxis].map(axis=>axis.reduce((sum,v,i)=>sum+v*(p[i]-source.origin[i]),0)));
 const span=bounds(local).span;
 if(span<1e-6)throw Error('The base guide has no measurable length.');
 const knots=simplify(local,span*.008);
 const start=source.segments[0].slice(0,2);
 const distance=p=>Math.hypot(p[0]-start[0],p[1]-start[1]);
 if(distance(knots.at(-1))<distance(knots[0]))knots.reverse();
 return {...source,strokeIds:remaining,segments:knotsToSegments(knots).map(s=>s.coordinates)};
}
