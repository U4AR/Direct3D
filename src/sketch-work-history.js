export function summarizeSketchWork(data,result){
 return {instruction:(data.prompt||'').slice(0,1400),requestedDeliverable:result.requestedDeliverable||null,
  outcome:result.solidEdits?.length||result.edits?.some(e=>e.extrusionMetres>0)?'solid':'sketch',
  summary:(result.refinement?.summary||'').slice(0,320)};
}

// Link by figure provenance, never by recency alone. Older sessions have
// case assets but no compact summary; read only the relevant records.
export function figureWorkCaseIds(rule){
 const current=typeof rule?.id==='string'?rule.id.split(':')[0]:null;
 return [...new Set([...(rule?.previousCaseIds||[]),current].filter(Boolean))].slice(-3);
}

export async function previousSketchWork(figures,rules,cases,readCase,{includeGuides=false}={}){
 const ids=new Set(figures.map(f=>f.id)),byCase=new Map();
 for(const rule of rules){
  if(!ids.has(rule.figureId)||typeof rule.id!=='string')continue;
  for(const caseId of figureWorkCaseIds(rule)){
   if(!byCase.has(caseId))byCase.set(caseId,new Set());
   byCase.get(caseId).add(rule.figureId);
  }
 }
 const items=[];
 for(const c of cases.filter(c=>byCase.has(c.id)).slice(-3)){
  if(['discarded','incorrect'].includes(c.feedback?.at(-1)?.verdict))continue;
  let info=c.work;
  let guides=[];
  if(c.asset&&(!info||includeGuides)){
   let record;
   try{record=await readCase(c.asset);}
   catch(error){if(error instanceof SyntaxError||error.name==='NotFoundError')continue;throw error;}
   if(record?.data&&record.result){
    info??=summarizeSketchWork(record.data,record.result);
    const sourceIds=new Set(figures.filter(f=>byCase.get(c.id).has(f.id)).flatMap(f=>f.strokeIds||[]));
    guides=(includeGuides?record.data.strokes||[]:[]).filter(s=>sourceIds.has(s.id)&&s.points?.length>1).slice(0,12).map(s=>({
     id:s.id,plane:s.plane||record.data.plane,points:s.points.filter((_,i)=>i%Math.ceil(s.points.length/96)===0||i===s.points.length-1)
    }));
   }
  }
  if(info?.instruction)items.push({...info,...(guides.length?{guides}:{}),figureIds:[...byCase.get(c.id)]});
 }
 return items;
}

// Explicit continuations inherit the last substantive instruction. A specific
// new request has its own scope even when it targets the same figure.
export const isSketchContinuation=value=>/^(?:please )?(?:continue|go ahead|do (?:it|something)|finish(?: it| this| that)?|try again|carry on|keep going)[.!?\s]*$/i.test(value.trim());
export function resumeSketchWork(prompt,history=[]){
 if(!isSketchContinuation(prompt||''))return null;
 return history.findLast(w=>w.instruction&&!isSketchContinuation(w.instruction))||null;
}
